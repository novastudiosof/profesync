"use server";

import { revalidatePath } from "next/cache";

import { requireActiveTeacher, requireRole, signedMediaUrl } from "@/lib/auth";
import { loadWithdrawalReport, type WithdrawalReport } from "@/lib/retiro-data";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import { isHexColor } from "@/lib/theme";
import type { FinalFormulaItem, Profile, Student } from "@/lib/supabase/types";

type Result = { error?: string; success?: string } | void;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const optional = (fd: FormData, key: string) => text(fd, key) || null;
const digits = (value: string) => value.replace(/\D/g, "");

const MAX_PHOTO_BYTES = 1_500_000;
const PHOTO_TYPES = ["image/webp", "image/jpeg", "image/png"];

/** Sube una foto al bucket privado "media" y devuelve su ruta (o null si no hay). */
async function uploadPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teacherId: string,
  file: FormDataEntryValue | null
): Promise<{ path: string | null; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { path: null };
  if (!PHOTO_TYPES.includes(file.type)) return { path: null, error: "La foto debe ser JPG, PNG o WebP" };
  if (file.size > MAX_PHOTO_BYTES) return { path: null, error: "La foto es demasiado pesada (máx. 1,5 MB)" };

  const ext = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
  const path = `${teacherId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) return { path: null, error: "No se pudo subir la foto" };
  return { path };
}

async function removePhoto(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined) {
  if (path) await supabase.storage.from("media").remove([path]);
}

// ==========================================================================
// Mi cuenta
// ==========================================================================
export async function updateMyProfile(_prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireRole("teacher", "super_admin");
  const fullName = text(formData, "fullName");
  if (fullName.length < 3) return { error: "El nombre es obligatorio" };

  const supabase = await createClient();
  const update: Partial<Profile> = { full_name: fullName, phone: optional(formData, "phone") };

  const photo = await uploadPhoto(supabase, profile.id, formData.get("photo"));
  if (photo.error) return { error: photo.error };
  if (photo.path) {
    update.photo_url = photo.path;
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", profile.id);
  if (error) return { error: friendlyDbError(error, "updateMyProfile", "No se pudo guardar tu perfil") };
  if (photo.path) await removePhoto(supabase, profile.photo_url);

  revalidatePath("/dashboard", "layout");
  return { success: "Perfil actualizado" };
}

export async function updateMyThemeColor(color: string | null): Promise<{ error?: string }> {
  const profile = await requireRole("teacher", "super_admin");
  if (color !== null && !isHexColor(color)) return { error: "Color inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ theme_color: color }).eq("id", profile.id);
  if (error) return { error: "No se pudo guardar el color" };
  revalidatePath("/dashboard", "layout");
  return {};
}

export async function changeMyPassword(_prev: Result, formData: FormData): Promise<Result> {
  await requireRole("teacher", "super_admin");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (password.length < 8) return { error: "La contraseña debe tener mínimo 8 caracteres" };
  if (password !== confirm) return { error: "Las contraseñas no coinciden" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "No se pudo actualizar la contraseña" };
  return { success: "Contraseña actualizada" };
}

// ==========================================================================
// Instituciones, años y periodos
// ==========================================================================
export async function createInstitution(_prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const name = text(formData, "name");
  if (name.length < 2) return { error: "El nombre de la institución es obligatorio" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("institutions")
    .insert({ teacher_id: profile.id, name, city: optional(formData, "city") });
  if (error) {
    return {
      error: friendlyDbError(error, "createInstitution", "No se pudo crear la institución", {
        "23505": "Ya tienes una institución con ese nombre",
      }),
    };
  }
  revalidatePath("/dashboard", "layout");
  return { success: "Institución creada" };
}

export async function deleteInstitution(institutionId: string): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();

  // No se borra una institución con estudiantes matriculados (protege el historial).
  const { data: years } = await supabase.from("academic_years").select("id").eq("institution_id", institutionId);
  const yearIds = (years ?? []).map((y) => y.id);
  if (yearIds.length > 0) {
    const { count } = await supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .in("academic_year_id", yearIds);
    if ((count ?? 0) > 0) {
      return { error: "Esta institución tiene estudiantes matriculados; no se puede eliminar." };
    }
  }
  const { error } = await supabase
    .from("institutions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", institutionId);
  if (error) return { error: friendlyDbError(error, "deleteInstitution", "No se pudo eliminar") };
  revalidatePath("/dashboard", "layout");
  return {};
}

export async function createAcademicYear(
  institutionId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const profile = await requireActiveTeacher();
  const year = Number(text(formData, "year"));
  const periods = Number(text(formData, "periods"));
  const passGrade = Number(text(formData, "passGrade").replace(",", "."));
  const scaleMax = Number(text(formData, "scaleMax").replace(",", "."));
  const scaleMin = Number(text(formData, "scaleMin").replace(",", "."));

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Año inválido" };
  if (![2, 3, 4, 5, 6].includes(periods)) return { error: "Los periodos deben ser entre 2 y 6" };
  if (!(scaleMax > scaleMin)) return { error: "La nota máxima debe ser mayor que la mínima" };
  if (!(passGrade >= scaleMin && passGrade <= scaleMax)) {
    return { error: "La nota para aprobar debe estar dentro de la escala" };
  }

  const supabase = await createClient();

  // Pesos iguales por defecto; el docente los ajusta después. La suma siempre 100.
  const base = Math.floor((100 / periods) * 100) / 100;
  const weights = Array.from({ length: periods }, () => base);
  weights[periods - 1] = Math.round((100 - base * (periods - 1)) * 100) / 100;
  const formula: FinalFormulaItem[] = weights.map((weight, i) => ({ period: i + 1, weight }));

  const { data: created, error } = await supabase
    .from("academic_years")
    .insert({
      teacher_id: profile.id,
      institution_id: institutionId,
      year,
      scale_min: scaleMin,
      scale_max: scaleMax,
      pass_grade: passGrade,
      final_formula: formula,
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      error: friendlyDbError(error, "createAcademicYear", "No se pudo crear el año lectivo", {
        "23505": "Esa institución ya tiene ese año lectivo",
      }),
    };
  }

  const { error: periodsError } = await supabase.from("periods").insert(
    weights.map((weight, i) => ({
      teacher_id: profile.id,
      academic_year_id: created.id,
      number: i + 1,
      name: `Periodo ${i + 1}`,
      weight,
    }))
  );
  if (periodsError) {
    await supabase.from("academic_years").delete().eq("id", created.id);
    return { error: friendlyDbError(periodsError, "createAcademicYear:periods", "No se pudieron crear los periodos") };
  }

  revalidatePath("/dashboard", "layout");
  return { success: "Año lectivo creado" };
}

// ==========================================================================
// Cursos y materias
// ==========================================================================
export async function createCourse(_prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const yearId = text(formData, "academicYearId");
  const grade = text(formData, "grade");
  const section = text(formData, "section") || "A";
  const order = Number(text(formData, "gradeOrder") || 0);
  if (!yearId) return { error: "Elige el año lectivo" };
  if (!grade) return { error: "El grado es obligatorio" };

  const supabase = await createClient();
  const { data: year } = await supabase.from("academic_years").select("status").eq("id", yearId).single();
  if (year?.status === "cerrado") return { error: "El año lectivo está cerrado" };

  const { error } = await supabase.from("courses").insert({
    teacher_id: profile.id,
    academic_year_id: yearId,
    grade,
    grade_order: Number.isFinite(order) ? order : 0,
    section,
  });
  if (error) {
    return {
      error: friendlyDbError(error, "createCourse", "No se pudo crear el curso", {
        "23505": "Ese curso (grado y grupo) ya existe en ese año",
      }),
    };
  }
  revalidatePath("/dashboard", "layout");
  return { success: "Curso creado" };
}

export async function deleteCourse(courseId: string): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { count } = await supabase
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  if ((count ?? 0) > 0) return { error: "El curso tiene estudiantes matriculados; no se puede eliminar." };
  const { error } = await supabase.from("courses").update({ deleted_at: new Date().toISOString() }).eq("id", courseId);
  if (error) return { error: friendlyDbError(error, "deleteCourse", "No se pudo eliminar el curso") };
  revalidatePath("/dashboard", "layout");
  return {};
}

export async function createSubject(courseId: string, _prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const name = text(formData, "name");
  if (!name) return { error: "El nombre de la materia es obligatorio" };
  const hours = text(formData, "weeklyHours");

  const supabase = await createClient();
  const { error } = await supabase.from("course_subjects").insert({
    teacher_id: profile.id,
    course_id: courseId,
    name,
    weekly_hours: hours ? Number(hours) : null,
  });
  if (error) {
    return {
      error: friendlyDbError(error, "createSubject", "No se pudo crear la materia", {
        "23505": "Esa materia ya existe en el curso",
      }),
    };
  }
  revalidatePath("/dashboard", "layout");
  return { success: "Materia agregada" };
}

export async function deleteSubject(subjectId: string): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { error } = await supabase
    .from("course_subjects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", subjectId);
  if (error) return { error: friendlyDbError(error, "deleteSubject", "No se pudo eliminar la materia") };
  revalidatePath("/dashboard", "layout");
  return {};
}

// ==========================================================================
// Estudiantes, acudientes y matrículas
// ==========================================================================
export async function createStudent(_prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const firstName = text(formData, "firstName");
  const lastName = text(formData, "lastName");
  if (!firstName || !lastName) return { error: "Nombres y apellidos son obligatorios" };

  const courseId = text(formData, "courseId");
  const guardianName = text(formData, "guardianName");
  const guardianPhone = digits(text(formData, "guardianWhatsapp"));
  if (guardianName && guardianPhone && guardianPhone.length < 10) {
    return { error: "El WhatsApp del acudiente debe incluir el indicativo (ej. 573001112233)" };
  }

  const supabase = await createClient();

  let yearId: string | null = null;
  if (courseId) {
    const { data: course } = await supabase.from("courses").select("academic_year_id").eq("id", courseId).single();
    if (!course) return { error: "Curso no encontrado" };
    yearId = course.academic_year_id;
  }

  const photo = await uploadPhoto(supabase, profile.id, formData.get("photo"));
  if (photo.error) return { error: photo.error };

  const { data: student, error } = await supabase
    .from("students")
    .insert({
      teacher_id: profile.id,
      first_name: firstName,
      last_name: lastName,
      document_number: optional(formData, "documentNumber"),
      birth_date: optional(formData, "birthDate"),
      photo_url: photo.path,
    })
    .select("id")
    .single();
  if (error || !student) {
    await removePhoto(supabase, photo.path);
    return {
      error: friendlyDbError(error, "createStudent", "No se pudo crear el estudiante", {
        "23505": "Ya tienes un estudiante con ese documento",
      }),
    };
  }

  if (guardianName) {
    await supabase.from("guardians").insert({
      teacher_id: profile.id,
      student_id: student.id,
      full_name: guardianName,
      relationship: optional(formData, "guardianRelationship"),
      whatsapp: guardianPhone || null,
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
    if (enrollError) {
      revalidatePath("/dashboard", "layout");
      return {
        error:
          "El estudiante se creó, pero no se pudo matricular: " +
          friendlyDbError(enrollError, "createStudent:enroll", "revisa el curso"),
      };
    }
  }

  revalidatePath("/dashboard", "layout");
  return { success: "Estudiante registrado" };
}

export async function updateStudent(studentId: string, _prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const firstName = text(formData, "firstName");
  const lastName = text(formData, "lastName");
  if (!firstName || !lastName) return { error: "Nombres y apellidos son obligatorios" };

  const supabase = await createClient();
  const { data: current } = await supabase.from("students").select("photo_url").eq("id", studentId).single();

  const update: Partial<Student> = {
    first_name: firstName,
    last_name: lastName,
    document_number: optional(formData, "documentNumber"),
    birth_date: optional(formData, "birthDate"),
    notes: optional(formData, "notes"),
  };
  const photo = await uploadPhoto(supabase, profile.id, formData.get("photo"));
  if (photo.error) return { error: photo.error };
  if (photo.path) update.photo_url = photo.path;

  const { error } = await supabase.from("students").update(update).eq("id", studentId);
  if (error) {
    await removePhoto(supabase, photo.path);
    return {
      error: friendlyDbError(error, "updateStudent", "No se pudo guardar", {
        "23505": "Ya tienes un estudiante con ese documento",
      }),
    };
  }
  if (photo.path) await removePhoto(supabase, current?.photo_url);

  revalidatePath("/dashboard", "layout");
  return { success: "Datos guardados" };
}

export async function addGuardian(studentId: string, _prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const name = text(formData, "guardianName");
  const phone = digits(text(formData, "guardianWhatsapp"));
  if (!name) return { error: "El nombre del acudiente es obligatorio" };
  if (phone && phone.length < 10) {
    return { error: "El WhatsApp debe incluir el indicativo (ej. 573001112233)" };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("guardians")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId);

  const { error } = await supabase.from("guardians").insert({
    teacher_id: profile.id,
    student_id: studentId,
    full_name: name,
    relationship: optional(formData, "guardianRelationship"),
    whatsapp: phone || null,
    is_primary: (count ?? 0) === 0,
  });
  if (error) return { error: friendlyDbError(error, "addGuardian", "No se pudo agregar el acudiente") };
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  return { success: "Acudiente agregado" };
}

export async function deleteGuardian(guardianId: string, studentId: string): Promise<{ error?: string }> {
  await requireActiveTeacher();
  const supabase = await createClient();
  const { error } = await supabase.from("guardians").delete().eq("id", guardianId);
  if (error) return { error: "No se pudo eliminar el acudiente" };
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  return {};
}

export async function enrollStudent(studentId: string, _prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireActiveTeacher();
  const courseId = text(formData, "courseId");
  if (!courseId) return { error: "Elige el curso" };

  const supabase = await createClient();
  const { data: course } = await supabase.from("courses").select("academic_year_id").eq("id", courseId).single();
  if (!course) return { error: "Curso no encontrado" };

  // Un estudiante retirado en ese año puede volver (o cambiar de curso): se
  // reactiva su única matrícula del año en vez de crear otra.
  const { data: previous } = await supabase
    .from("enrollments")
    .select("id, status")
    .eq("student_id", studentId)
    .eq("academic_year_id", course.academic_year_id)
    .maybeSingle();

  if (previous && previous.status !== "retirado") {
    return { error: "Este estudiante ya está matriculado en ese año lectivo (solo puede estar en un curso por año)." };
  }

  const { error } = previous
    ? await supabase
        .from("enrollments")
        .update({
          course_id: courseId,
          status: "activa",
          withdrawn_on: null,
          withdrawn_reason: null,
          withdrawn_note: null,
          withdrawn_report_path: null,
        })
        .eq("id", previous.id)
    : await supabase.from("enrollments").insert({
        teacher_id: profile.id,
        student_id: studentId,
        course_id: courseId,
        academic_year_id: course.academic_year_id,
      });
  if (error) {
    return {
      error: friendlyDbError(error, "enrollStudent", "No se pudo matricular", {
        "23505": "Este estudiante ya está matriculado en ese año lectivo (solo puede estar en un curso por año).",
      }),
    };
  }
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  revalidatePath("/dashboard", "layout");
  return { success: "Estudiante matriculado" };
}

/**
 * Retira al estudiante del curso: guarda motivo, fecha y nota, y devuelve los
 * datos del informe de retiro (el navegador arma el PDF y lo guarda).
 * No se borra nada: notas, asistencia y observaciones se conservan.
 */
export async function withdrawEnrollment(
  enrollmentId: string,
  studentId: string,
  input: { reason: string; date: string; note: string }
): Promise<{ error?: string; report?: WithdrawalReport }> {
  const profile = await requireActiveTeacher();
  const reason = input.reason.trim();
  const note = input.note.trim();
  const date = input.date.trim();
  if (!reason) return { error: "Elige el motivo del retiro" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Indica la fecha del retiro" };
  if (date > new Date().toISOString().slice(0, 10)) return { error: "La fecha de retiro no puede ser futura" };

  const supabase = await createClient();
  const { data: enr } = await supabase
    .from("enrollments")
    .select("status, academic_year_id, academic_years(status)")
    .eq("id", enrollmentId)
    .single();
  const status = (enr as unknown as { academic_years?: { status?: string } } | null)?.academic_years?.status;
  if (status === "cerrado") return { error: "El año está cerrado: la matrícula no se puede cambiar." };
  if ((enr as { status?: string } | null)?.status === "retirado") return { error: "El estudiante ya está retirado." };

  const { error } = await supabase
    .from("enrollments")
    .update({
      status: "retirado",
      withdrawn_on: date,
      withdrawn_reason: reason,
      withdrawn_note: note || null,
      withdrawn_report_path: null,
    })
    .eq("id", enrollmentId);
  if (error) return { error: friendlyDbError(error, "withdrawEnrollment", "No se pudo retirar al estudiante") };

  const report = await loadWithdrawalReport(enrollmentId, profile.full_name);
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard", "layout");
  return report ? { report } : {};
}

/** Guarda la ruta del PDF del informe de retiro ya subido al almacenamiento. */
export async function saveWithdrawalReportPath(
  enrollmentId: string,
  studentId: string,
  path: string
): Promise<{ error?: string }> {
  const profile = await requireActiveTeacher();
  // Solo se aceptan rutas dentro de la carpeta del propio docente.
  if (!path.startsWith(`${profile.id}/retiros/`) || path.includes("..")) return { error: "Ruta inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("enrollments").update({ withdrawn_report_path: path }).eq("id", enrollmentId);
  if (error) return { error: "No se pudo guardar el informe" };
  revalidatePath(`/dashboard/estudiantes/${studentId}`);
  revalidatePath("/dashboard", "layout");
  return {};
}

/** Datos del informe de retiro de una matrícula ya retirada (para volver a generarlo o descargarlo). */
export async function getWithdrawalReport(
  enrollmentId: string
): Promise<{ error?: string; report?: WithdrawalReport; url?: string | null }> {
  const profile = await requireRole("teacher");
  const supabase = await createClient();
  const { data: enr } = await supabase
    .from("enrollments")
    .select("withdrawn_report_path")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enr) return { error: "Matrícula no encontrada" };
  const url = await signedMediaUrl((enr as { withdrawn_report_path: string | null }).withdrawn_report_path);
  if (url) return { url };
  const report = await loadWithdrawalReport(enrollmentId, profile.full_name);
  return report ? { report } : { error: "No se pudo armar el informe" };
}

// ==========================================================================
// Alertas parametrizables
// ==========================================================================
const optionalNumber = (value: string): number | null | "invalid" => {
  const clean = value.trim().replace(",", ".");
  if (clean === "") return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : "invalid";
};

export async function updateAlertSettings(_prev: Result, formData: FormData): Promise<Result> {
  const profile = await requireRole("teacher");
  const step = Number(text(formData, "absenceStep"));
  if (!Number.isInteger(step) || step < 1 || step > 30) {
    return { error: "Las faltas para alertar deben ser un número entero entre 1 y 30" };
  }
  const periodMax = optionalNumber(text(formData, "periodGradeMax"));
  const finalMax = optionalNumber(text(formData, "finalGradeMax"));
  if (periodMax === "invalid" || finalMax === "invalid") return { error: "Las notas de alerta deben ser números (ej. 3.0)" };

  const supabase = await createClient();
  const { error } = await supabase.from("alert_settings").upsert(
    {
      teacher_id: profile.id,
      absence_step: step,
      period_grade_max: periodMax,
      final_grade_max: finalMax,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "teacher_id" }
  );
  if (error) return { error: friendlyDbError(error, "updateAlertSettings", "No se pudieron guardar las alertas") };
  revalidatePath("/dashboard", "layout");
  return { success: "Alertas actualizadas" };
}
