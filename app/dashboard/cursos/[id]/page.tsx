import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, ClipboardList, UserPlus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionForm, Field } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { AsistenciaPanel } from "@/components/docente/asistencia-panel";
import { BoletinesPanel } from "@/components/docente/boletines-panel";
import { NotasPanel } from "@/components/docente/notas-panel";
import { StudentAvatar } from "@/components/docente/student-avatar";
import { WithdrawalReportButton } from "@/components/docente/withdraw-form";
import { isPlanActive, requireRole, signedMediaUrls } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSubject, deleteSubject } from "@/lib/actions/docente";
import { cn } from "@/lib/utils";
import type { AcademicYear, Course, CourseSubject, Enrollment, Institution, Student } from "@/lib/supabase/types";

type Tab = "estudiantes" | "materias" | "notas" | "asistencia" | "boletines" | "retirados";
const TABS: Tab[] = ["estudiantes", "materias", "notas", "asistencia", "boletines", "retirados"];

const formatDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function CursoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; subject?: string; period?: string; vista?: string; date?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);
  const supabase = await createClient();

  const { data: courseData } = await supabase.from("courses").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!courseData) notFound();
  const course = courseData as Course;

  const { data: yearData } = await supabase.from("academic_years").select("*").eq("id", course.academic_year_id).single();
  const year = yearData as AcademicYear;
  const { data: instData } = await supabase.from("institutions").select("*").eq("id", year.institution_id).maybeSingle();
  const institution = instData as Institution | null;

  const [{ data: enrollData }, { data: subjectData }] = await Promise.all([
    supabase.from("enrollments").select("*").eq("course_id", id),
    supabase.from("course_subjects").select("*").eq("course_id", id).is("deleted_at", null).order("name"),
  ]);
  const enrollments = (enrollData ?? []) as Enrollment[];
  const subjects = (subjectData ?? []) as CourseSubject[];

  const studentIds = enrollments.map((e) => e.student_id);
  const enrollmentIds = enrollments.map((e) => e.id);
  const [{ data: studentData }, { data: faltaData }] = await Promise.all([
    studentIds.length ? supabase.from("students").select("*").in("id", studentIds) : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? supabase.from("attendance").select("enrollment_id").in("enrollment_id", enrollmentIds).eq("status", "falta")
      : Promise.resolve({ data: [] }),
  ]);
  const students = new Map(((studentData ?? []) as Student[]).map((s) => [s.id, s]));
  const faltas = new Map<string, number>();
  (faltaData ?? []).forEach((f) => faltas.set(f.enrollment_id, (faltas.get(f.enrollment_id) ?? 0) + 1));
  const photos = await signedMediaUrls([...students.values()].map((s) => s.photo_url));

  const byName = (a: Enrollment, b: Enrollment) => {
    const sa = students.get(a.student_id);
    const sb = students.get(b.student_id);
    return `${sa?.last_name} ${sa?.first_name}`.localeCompare(`${sb?.last_name} ${sb?.first_name}`, "es");
  };
  const active = enrollments.filter((e) => e.status !== "retirado" && students.has(e.student_id)).sort(byName);
  const withdrawn = enrollments.filter((e) => e.status === "retirado" && students.has(e.student_id)).sort(byName);

  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "estudiantes";
  const canEdit = editable && year.status === "abierto";
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "estudiantes", label: "Estudiantes", count: active.length },
    { key: "materias", label: "Materias", count: subjects.length },
    { key: "notas", label: "Notas" },
    { key: "asistencia", label: "Asistencia" },
    { key: "boletines", label: "Boletines" },
    { key: "retirados", label: "Retirados", count: withdrawn.length },
  ];
  const subjectOptions = subjects.map((s) => ({ id: s.id, label: s.name }));
  const subjectId = subjects.find((s) => s.id === sp.subject)?.id ?? subjects[0]?.id;
  const today = new Date().toISOString().slice(0, 10);
  const attendanceDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/instituciones/${year.institution_id}?year=${year.year}`}
          className="text-sm text-brand-muted hover:underline"
        >
          ← {institution?.name ?? "Institución"} · cursos {year.year}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-brand-ink">
          {course.grade} {course.section}
        </h1>
        <p className="text-sm text-brand-muted">
          {institution?.name} · Año {year.year}
          {year.status === "cerrado" ? " (cerrado: solo consulta)" : ""}
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-brand-border">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/cursos/${id}?tab=${t.key}`}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm transition-colors",
              tab === t.key
                ? "border-brand-dark font-medium text-brand-ink"
                : "border-transparent text-brand-muted hover:text-brand-ink"
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="text-xs text-brand-muted"> ({t.count})</span>}
          </Link>
        ))}
      </div>

      {tab === "notas" &&
        (subjectId ? (
          <NotasPanel
            subjectId={subjectId}
            subjectOptions={subjectOptions}
            periodId={sp.period}
            vista={sp.vista === "definitivas" ? "definitivas" : "planilla"}
            basePath={`/dashboard/cursos/${id}`}
            fixed={{ tab: "notas" }}
            keys={{ subject: "subject", period: "period", vista: "vista" }}
            editable={editable}
          />
        ) : (
          <p className="text-sm text-brand-muted">Primero agrega materias al curso, en la pestaña Materias.</p>
        ))}

      {tab === "asistencia" &&
        (subjectId ? (
          <AsistenciaPanel
            subjectId={subjectId}
            subjectOptions={subjectOptions}
            date={attendanceDate}
            fixed={{ tab: "asistencia" }}
            editable={editable}
          />
        ) : (
          <p className="text-sm text-brand-muted">Primero agrega materias al curso, en la pestaña Materias.</p>
        ))}

      {tab === "boletines" && (
        <BoletinesPanel
          courseId={id}
          periodParam={sp.period}
          fixed={{ tab: "boletines" }}
          editable={editable}
          teacherName={profile.full_name}
        />
      )}

      {tab === "estudiantes" && (
        <div className="flex flex-col gap-4">
          {canEdit && (
            <div>
              <Link
                href={`/dashboard/estudiantes?course=${id}`}
                className="inline-flex items-center gap-2 rounded-[var(--radius-brand-sm)] border border-brand-border px-3 py-2 text-sm hover:bg-black/5"
              >
                <UserPlus className="h-4 w-4" /> Registrar o importar estudiantes en este curso
              </Link>
            </div>
          )}
          {active.length === 0 ? (
            <p className="text-sm text-brand-muted">Este curso aún no tiene estudiantes.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((e) => {
                const s = students.get(e.student_id)!;
                const n = faltas.get(e.id) ?? 0;
                return (
                  <Card key={e.id} className="transition-shadow hover:shadow-md">
                    <CardContent className="flex items-center gap-3 p-4">
                      <Link href={`/dashboard/estudiantes/${s.id}?enr=${e.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                        <StudentAvatar
                          name={`${s.first_name} ${s.last_name}`}
                          url={s.photo_url ? photos.get(s.photo_url) ?? null : null}
                          size={56}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-brand-ink">
                            {s.last_name} {s.first_name}
                          </p>
                          <p className="truncate text-xs text-brand-muted">
                            {e.status === "aprobo" ? "Aprobó" : e.status === "perdio" ? "Perdió" : "Cursando"}
                          </p>
                        </div>
                      </Link>
                      <Link
                        href={`/dashboard/estudiantes/${s.id}?enr=${e.id}#asistencia`}
                        title="Ver las fechas de sus faltas"
                        className={cn(
                          "shrink-0 rounded-full px-2 py-1 text-xs font-medium hover:underline",
                          n > 0 ? "bg-red-50 text-red-700" : "bg-black/5 text-brand-muted"
                        )}
                      >
                        {n} {n === 1 ? "falta" : "faltas"}
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "materias" && (
        <div className="flex flex-col gap-4">
          {subjects.length === 0 && <p className="text-sm text-brand-muted">Sin materias todavía.</p>}
          <ul className="flex flex-col gap-2">
            {subjects.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-brand-md)] border border-brand-border bg-white px-4 py-3"
              >
                <div>
                  <p className="font-medium text-brand-ink">{s.name}</p>
                  {s.weekly_hours ? <p className="text-xs text-brand-muted">{s.weekly_hours} h/semana</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/cursos/${id}?tab=notas&subject=${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-brand-sm)] border border-brand-border px-3 py-1.5 text-sm hover:bg-black/5"
                  >
                    <ClipboardList className="h-4 w-4" /> Notas
                  </Link>
                  <Link
                    href={`/dashboard/cursos/${id}?tab=asistencia&subject=${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-brand-sm)] border border-brand-border px-3 py-1.5 text-sm hover:bg-black/5"
                  >
                    <CalendarCheck className="h-4 w-4" /> Asistencia
                  </Link>
                  {canEdit && (
                    <ConfirmButton
                      action={deleteSubject.bind(null, s.id)}
                      message={`¿Quitar la materia "${s.name}"?`}
                      variant="ghost"
                      size="sm"
                    >
                      Quitar
                    </ConfirmButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Agregar materia</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={createSubject.bind(null, id)} submitLabel="Agregar" className="sm:flex-row sm:items-end">
                  <Field label="Materia" className="flex-1">
                    <Input name="name" required />
                  </Field>
                  <Field label="Horas/sem." className="w-24">
                    <Input name="weeklyHours" type="number" min={1} />
                  </Field>
                </ActionForm>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "retirados" && (
        <div className="flex flex-col gap-3">
          {withdrawn.length === 0 ? (
            <p className="text-sm text-brand-muted">Ningún estudiante ha sido retirado de este curso.</p>
          ) : (
            withdrawn.map((e) => {
              const s = students.get(e.student_id)!;
              return (
                <Card key={e.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <StudentAvatar
                      name={`${s.first_name} ${s.last_name}`}
                      url={s.photo_url ? photos.get(s.photo_url) ?? null : null}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/estudiantes/${s.id}?enr=${e.id}`} className="font-medium text-brand-ink hover:underline">
                        {s.last_name} {s.first_name}
                      </Link>
                      <p className="text-xs text-brand-muted">
                        Retirado el {e.withdrawn_on ? formatDay(e.withdrawn_on) : "—"}
                        {e.withdrawn_reason ? ` · ${e.withdrawn_reason}` : ""}
                      </p>
                      {e.withdrawn_note && <p className="text-xs text-brand-muted">{e.withdrawn_note}</p>}
                    </div>
                    <Link
                      href={`/dashboard/estudiantes/${s.id}?enr=${e.id}#asistencia`}
                      className="rounded-full bg-black/5 px-2 py-1 text-xs hover:underline"
                    >
                      {faltas.get(e.id) ?? 0} faltas
                    </Link>
                    <WithdrawalReportButton enrollmentId={e.id} />
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
