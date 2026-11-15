"use server";

import { revalidatePath } from "next/cache";

import { requireActiveTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import type { AttendanceStatus, FinalFormulaItem, ObservationKind } from "@/lib/supabase/types";

type Result = { error?: string; success?: string } | void;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const optional = (fd: FormData, key: string) => text(fd, key) || null;
const num = (value: string) => Number(value.replace(",", "."));

// ==========================================================================
// Periodos: pesos de la nota final y cierre
// ==========================================================================
export async function updatePeriodWeights(yearId: string, _prev: Result, formData: FormData): Promise<Result> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { data: periods } = await supabase.from("periods").select("id, number").eq("academic_year_id", yearId).order("number");
  if (!periods?.length) return { error: "El año no tiene periodos" };

  const weights = periods.map((p) => ({ id: p.id, number: p.number, weight: num(text(formData, `w_${p.id}`)) }));
  if (weights.some((w) => !Number.isFinite(w.weight) || w.weight < 0 || w.weight > 100)) {
    return { error: "Cada peso debe ser un número entre 0 y 100" };
  }
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (Math.abs(total - 100) > 0.01) return { error: `Los pesos suman ${total}%; deben sumar 100%` };

  const date = (key: string) => {
    const value = text(formData, key);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  for (const w of weights) {
    const starts = date(`start_${w.id}`);
    const ends = date(`end_${w.id}`);
    if (starts && ends && ends < starts) return { error: `En el periodo ${w.number} la fecha final es anterior a la inicial` };
    const { error } = await supabase
      .from("periods")
      .update({ weight: w.weight, starts_on: starts, ends_on: ends })
      .eq("id", w.id);
    if (error) return { error: friendlyDbError(error, "updatePeriodWeights", "No se pudieron guardar los pesos") };
  }
  const formula: FinalFormulaItem[] = weights.map((w) => ({ period: w.number, weight: w.weight }));
  const { error } = await supabase.from("academic_years").update({ final_formula: formula }).eq("id", yearId);
  if (error) return { error: friendlyDbError(error, "updatePeriodWeights:formula", "No se pudo guardar la fórmula") };

  revalidatePath("/dashboard", "layout");
  return { success: "Fórmula de la nota final guardada" };
}

export async function setPeriodStatus(periodId: string, status: "abierto" | "cerrado"): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { error } = await supabase.from("periods").update({ status }).eq("id", periodId);
  if (error) return { error: friendlyDbError(error, "setPeriodStatus", "No se pudo cambiar el periodo") };
  revalidatePath("/dashboard", "layout");
  return {};
}

// ==========================================================================
// Actividades y notas
// ==========================================================================
export async function createActivity(
  subjectId: string,
  periodId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const profile = await requireActiveTeacher();
  const name = text(formData, "name");
  const weight = num(text(formData, "weight"));
  if (!name) return { error: "El nombre de la actividad es obligatorio" };
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100) return { error: "El peso debe estar entre 1 y 100" };

  const supabase = await createClient();
  const { error } = await supabase.from("activities").insert({
    teacher_id: profile.id,
    course_subject_id: subjectId,
    period_id: periodId,
    name,
    weight,
    activity_date: optional(formData, "date"),
  });
  if (error) return { error: friendlyDbError(error, "createActivity", "No se pudo crear la actividad") };
  revalidatePath("/dashboard", "layout");
  return { success: "Actividad creada" };
}

export async function deleteActivity(activityId: string): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { error } = await supabase
    .from("activities")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", activityId);
  if (error) return { error: friendlyDbError(error, "deleteActivity", "No se pudo eliminar la actividad") };
  revalidatePath("/dashboard", "layout");
  return {};
}

/** Guarda (o borra, si value es null) la nota de una celda de la planilla. */
export async function saveGrade(
  activityId: string,
  enrollmentId: string,
  value: number | null
): Promise<{ error?: string }> {
  const profile = await requireActiveTeacher();
  const supabase = await createClient();

  if (value === null) {
    const { error } = await supabase.from("grades").delete().eq("activity_id", activityId).eq("enrollment_id", enrollmentId);
    if (error) return { error: friendlyDbError(error, "saveGrade:delete", "No se pudo borrar la nota") };
    return {};
  }
  if (!Number.isFinite(value)) return { error: "Nota inválida" };

  const { error } = await supabase.from("grades").upsert(
    { teacher_id: profile.id, activity_id: activityId, enrollment_id: enrollmentId, value },
    { onConflict: "activity_id,enrollment_id" }
  );
  if (error) return { error: friendlyDbError(error, "saveGrade", "No se pudo guardar la nota") };
  return {};
}

// ==========================================================================
// Asistencia
// ==========================================================================
const ATTENDANCE: AttendanceStatus[] = ["presente", "tarde", "excusa", "falta"];

export async function saveAttendance(
  subjectId: string,
  enrollmentId: string,
  date: string,
  status: AttendanceStatus | null
): Promise<{ error?: string }> {
  const profile = await requireActiveTeacher();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Fecha inválida" };
  const supabase = await createClient();

  if (status === null) {
    const { error } = await supabase
      .from("attendance")
      .delete()
      .eq("course_subject_id", subjectId)
      .eq("enrollment_id", enrollmentId)
      .eq("attendance_date", date);
    if (error) return { error: "No se pudo quitar el registro" };
    return {};
  }
  if (!ATTENDANCE.includes(status)) return { error: "Estado inválido" };

  const { error } = await supabase.from("attendance").upsert(
    {
      teacher_id: profile.id,
      course_subject_id: subjectId,
      enrollment_id: enrollmentId,
      attendance_date: date,
      status,
    },
    { onConflict: "course_subject_id,enrollment_id,attendance_date" }
  );
  if (error) return { error: friendlyDbError(error, "saveAttendance", "No se pudo guardar la asistencia") };
  return {};
}

/** Marca a todos los estudiantes del curso como presentes en una fecha (los ya marcados se respetan). */
export async function markAllPresent(
  subjectId: string,
  date: string,
  enrollmentIds: string[]
): Promise<{ error?: string }> {
  const profile = await requireActiveTeacher();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Fecha inválida" };
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("attendance")
    .select("enrollment_id")
    .eq("course_subject_id", subjectId)
    .eq("attendance_date", date);
  const done = new Set((existing ?? []).map((a) => a.enrollment_id));
  const rows = enrollmentIds
    .filter((id) => !done.has(id))
    .map((id) => ({
      teacher_id: profile.id,
      course_subject_id: subjectId,
      enrollment_id: id,
      attendance_date: date,
      status: "presente" as AttendanceStatus,
    }));
  if (rows.length === 0) return {};
  const { error } = await supabase.from("attendance").insert(rows);
  if (error) return { error: friendlyDbError(error, "markAllPresent", "No se pudo marcar la asistencia") };
  return {};
}

// ==========================================================================
// Observador
// ==========================================================================
const KINDS: ObservationKind[] = ["convivencia", "academico", "compromiso", "seguimiento", "otro"];

export async function addObservation(studentId: string, _prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const note = text(formData, "note");
  const kind = text(formData, "kind") as ObservationKind;
  if (!note) return { error: "Escribe la observación" };
  if (!KINDS.includes(kind)) return { error: "Tipo inválido" };

  const supabase = await createClient();
  const { error } = await supabase.from("observations").insert({
    teacher_id: profile.id,
    student_id: studentId,
    kind,
    note,
    commitment: optional(formData, "commitment"),
    follow_up_on: optional(formData, "followUp"),
    observed_on: optional(formData, "observedOn") ?? new Date().toISOString().slice(0, 10),
  });
  if (error) return { error: friendlyDbError(error, "addObservation", "No se pudo guardar la observación") };
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  return { success: "Observación registrada" };
}

export async function toggleObservationResolved(
  observationId: string,
  studentId: string,
  resolved: boolean
): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { error } = await supabase.from("observations").update({ resolved }).eq("id", observationId);
  if (error) return { error: "No se pudo actualizar" };
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  return {};
}

export async function deleteObservation(observationId: string, studentId: string): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { error } = await supabase.from("observations").delete().eq("id", observationId);
  if (error) return { error: "No se pudo eliminar" };
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  return {};
}

// ==========================================================================
// Importar estudiantes pegando desde Excel
// ==========================================================================
/**
 * Cada línea: Apellidos <tab> Nombres <tab> Documento (opcional) <tab> Acudiente
 * (opcional) <tab> WhatsApp (opcional). Se separa por tabulador (pegado de
 * Excel), punto y coma o coma.
 */
export async function importStudents(_prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const raw = String(formData.get("rows") ?? "");
  const courseId = text(formData, "courseId");

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { error: "Pega al menos una fila" };
  if (lines.length > 300) return { error: "Máximo 300 estudiantes por importación" };

  const supabase = await createClient();
  let yearId: string | null = null;
  if (courseId) {
    const { data: course } = await supabase.from("courses").select("academic_year_id").eq("id", courseId).single();
    if (!course) return { error: "Curso no encontrado" };
    yearId = course.academic_year_id;
  }

  let created = 0;
  const problems: string[] = [];

  for (const [index, line] of lines.entries()) {
    const cols = line.split(/\t|;|,/).map((c) => c.trim());
    const [lastName, firstName, doc, guardian, phoneRaw] = cols;
    if (!lastName || !firstName) {
      problems.push(`Fila ${index + 1}: faltan apellidos o nombres`);
      continue;
    }
    const { data: student, error } = await supabase
      .from("students")
      .insert({
        teacher_id: profile.id,
        first_name: firstName,
        last_name: lastName,
        document_number: doc || null,
      })
      .select("id")
      .single();
    if (error || !student) {
      const msg = friendlyDbError(error, "importStudents", "no se pudo crear", {
        "23505": "documento repetido",
      });
      problems.push(`Fila ${index + 1} (${lastName} ${firstName}): ${msg}`);
      if (/máximo de estudiantes/i.test(msg)) break;
      continue;
    }
    created++;
    const phone = (phoneRaw ?? "").replace(/\D/g, "");
    if (guardian) {
      await supabase.from("guardians").insert({
        teacher_id: profile.id,
        student_id: student.id,
        full_name: guardian,
        whatsapp: phone.length >= 10 ? phone : null,
        is_primary: true,
      });
    }
    if (courseId && yearId) {
      const { error: enrollError } = await supabase.from("enrollments").insert({
        teacher_id: profile.id,
        student_id: student.id,
        course_id: courseId,
        academic_year_id: yearId,
      });
      if (enrollError) problems.push(`Fila ${index + 1}: creado pero no matriculado`);
    }
  }

  revalidatePath("/dashboard", "layout");
  const summary = `${created} estudiante(s) importado(s).`;
  if (problems.length > 0) {
    return { error: `${summary} Con problemas: ${problems.slice(0, 5).join(" · ")}${problems.length > 5 ? " …" : ""}` };
  }
  return { success: summary };
}
