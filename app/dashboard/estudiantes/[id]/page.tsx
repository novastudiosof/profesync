import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionForm, Field, selectClasses } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { PhotoInput } from "@/components/photo-input";
import { isPlanActive, requireRole, signedMediaUrl } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addGuardian, deleteGuardian, enrollStudent, updateStudent } from "@/lib/actions/docente";
import { addObservation, deleteObservation, toggleObservationResolved } from "@/lib/actions/notas";
import { WithdrawForm, WithdrawalReportButton } from "@/components/docente/withdraw-form";
import { BulletinRow } from "@/components/docente/bulletin-row";
import { ReportButtons } from "@/components/docente/report-buttons";
import { loadCourseBulletins, type BulletinStudent, type CourseBulletins } from "@/lib/boletin-data";
import { loadWithdrawalReport, WITHDRAWAL_REASONS } from "@/lib/retiro-data";
import type {
  AcademicYear,
  Attendance,
  AttendanceStatus,
  BulletinSend,
  Course,
  CourseSubject,
  Enrollment,
  Guardian,
  Institution,
  Observation,
  ObservationKind,
  Student,
} from "@/lib/supabase/types";

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  presente: "Presente",
  tarde: "Tardanza",
  excusa: "Excusa",
  falta: "Falta",
};

const formatDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const KIND_LABEL: Record<ObservationKind, string> = {
  convivencia: "Convivencia",
  academico: "Académico",
  compromiso: "Compromiso",
  seguimiento: "Seguimiento",
  otro: "Otro",
};

const STATUS_LABEL: Record<Enrollment["status"], string> = {
  activa: "Cursando",
  aprobo: "Aprobó",
  perdio: "Perdió",
  retirado: "Retirado",
};

export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ subject?: string; status?: string; enr?: string; period?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);
  const supabase = await createClient();

  const { data: studentData } = await supabase.from("students").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!studentData) notFound();
  const student = studentData as Student;

  const [
    { data: guardianData },
    { data: enrollData },
    { data: courseData },
    { data: yearData },
    { data: instData },
    { data: obsData },
  ] = await Promise.all([
      supabase.from("guardians").select("*").eq("student_id", id).order("is_primary", { ascending: false }),
      supabase.from("enrollments").select("*").eq("student_id", id),
      supabase.from("courses").select("*").is("deleted_at", null).order("grade_order"),
      supabase.from("academic_years").select("*").order("year", { ascending: false }),
      supabase.from("institutions").select("*"),
      supabase.from("observations").select("*").eq("student_id", id).order("observed_on", { ascending: false }),
    ]);
  const observations = (obsData ?? []) as Observation[];
  const guardians = (guardianData ?? []) as Guardian[];
  const enrollments = (enrollData ?? []) as Enrollment[];
  const courses = (courseData ?? []) as Course[];
  const years = (yearData ?? []) as AcademicYear[];
  const institutions = (instData ?? []) as Institution[];

  // Asistencia de este estudiante en todas sus matrículas (activas, cerradas o retiradas).
  const enrollmentIds = enrollments.map((e) => e.id);
  const courseIdsOfStudent = [...new Set(enrollments.map((e) => e.course_id))];
  const [{ data: attData }, { data: subjData }] = await Promise.all([
    enrollmentIds.length
      ? supabase
          .from("attendance")
          .select("*")
          .in("enrollment_id", enrollmentIds)
          .order("attendance_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    courseIdsOfStudent.length
      ? supabase.from("course_subjects").select("*").in("course_id", courseIdsOfStudent)
      : Promise.resolve({ data: [] }),
  ]);
  const attendance = (attData ?? []) as Attendance[];
  const courseSubjects = (subjData ?? []) as CourseSubject[];
  const subjectName = (subjectId: string) => courseSubjects.find((s) => s.id === subjectId)?.name ?? "Materia";
  const statusFilter = (["falta", "excusa", "tarde", "todas"] as const).find((s) => s === sp.status) ?? "falta";
  const subjectFilter = courseSubjects.some((s) => s.id === sp.subject) ? sp.subject : undefined;

  const photoUrl = await signedMediaUrl(student.photo_url);
  const yearLabel = (yearId: string) => {
    const y = years.find((year) => year.id === yearId);
    const inst = institutions.find((i) => i.id === y?.institution_id);
    return `${inst?.name ?? ""} · ${y?.year ?? ""}`;
  };

  // Cursos de años abiertos donde AÚN no está matriculado (un curso por año).
  // Los retirados pueden volver a matricularse (se reactiva su matrícula del año).
  const enrolledYears = new Set(enrollments.filter((e) => e.status !== "retirado").map((e) => e.academic_year_id));
  const availableCourses = courses.filter((c) => {
    const y = years.find((year) => year.id === c.academic_year_id);
    return y?.status === "abierto" && !enrolledYears.has(c.academic_year_id);
  });

  const sortedEnrollments = [...enrollments].sort((a, b) => {
    const ya = years.find((y) => y.id === a.academic_year_id)?.year ?? 0;
    const yb = years.find((y) => y.id === b.academic_year_id)?.year ?? 0;
    return yb - ya;
  });

  // ---- Notas y boletín de la matrícula elegida (por defecto, la del año abierto) ----
  const selectedEnrollment =
    sortedEnrollments.find((e) => e.id === sp.enr) ??
    sortedEnrollments.find(
      (e) => e.status !== "retirado" && years.find((y) => y.id === e.academic_year_id)?.status === "abierto"
    ) ??
    sortedEnrollments[0] ??
    null;
  const notasReport = selectedEnrollment ? await loadWithdrawalReport(selectedEnrollment.id, profile.full_name) : null;

  let bulletin = null as CourseBulletins | null;
  let bulletinStudent = undefined as BulletinStudent | undefined;
  let bulletinSentAt: string | null = null;
  if (selectedEnrollment && selectedEnrollment.status !== "retirado") {
    const { data: periodRows } = await supabase
      .from("periods")
      .select("number, status")
      .eq("academic_year_id", selectedEnrollment.academic_year_id)
      .order("number");
    const bulletinPeriod: number | null =
      sp.period === "final"
        ? null
        : Number(sp.period) > 0
          ? Number(sp.period)
          : (periodRows?.find((p) => p.status === "abierto")?.number ?? periodRows?.at(-1)?.number ?? 1);
    bulletin = await loadCourseBulletins(selectedEnrollment.course_id, bulletinPeriod);
    bulletinStudent = bulletin?.students.find((s) => s.enrollmentId === selectedEnrollment.id);
    if (bulletinStudent) {
      const { data: sendData } = await supabase
        .from("bulletin_sends")
        .select("*")
        .eq("enrollment_id", selectedEnrollment.id)
        .order("created_at", { ascending: false });
      const send = ((sendData ?? []) as BulletinSend[]).find(
        (x) => x.period_number === (bulletin?.periodNumber ?? null) && x.channel !== "descarga"
      );
      bulletinSentAt = send ? new Date(send.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : null;
    }
  }
  const selectedCourse = selectedEnrollment ? courses.find((c) => c.id === selectedEnrollment.course_id) : undefined;
  const enrollmentLabel = (e: Enrollment) => {
    const c = courses.find((course) => course.id === e.course_id);
    const label = c ? c.grade + " " + c.section : "Curso";
    return label + " · " + (years.find((y) => y.id === e.academic_year_id)?.year ?? "");
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {sp.enr && selectedCourse ? (
        <Link href={"/dashboard/cursos/" + selectedCourse.id} className="text-sm text-brand-muted hover:underline">
          ← {selectedCourse.grade} {selectedCourse.section}
        </Link>
      ) : (
        <Link href="/dashboard/estudiantes" className="text-sm text-brand-muted hover:underline">
          ← Estudiantes
        </Link>
      )}
      <h1 className="text-2xl font-semibold text-brand-ink">
        {student.first_name} {student.last_name}
      </h1>

      {selectedEnrollment && notasReport && (
        <Card id="notas">
          <CardHeader>
            <CardTitle>Notas y boletín</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {sortedEnrollments.map((e) => (
                <Link
                  key={e.id}
                  href={"/dashboard/estudiantes/" + id + "?enr=" + e.id}
                  className={
                    "rounded-full border px-3 py-1 " +
                    (e.id === selectedEnrollment.id
                      ? "border-brand bg-brand text-brand-ink"
                      : "border-brand-border text-brand-muted hover:bg-black/5")
                  }
                >
                  {enrollmentLabel(e)}
                  {e.status === "retirado" ? " (retirado)" : ""}
                </Link>
              ))}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ReportButtons
              reports={[
                { label: "Notas", tipo: "notas-estudiante", params: { enrollment: selectedEnrollment.id } },
                { label: "Asistencia", tipo: "asistencia-estudiante", params: { enrollment: selectedEnrollment.id } },
              ]}
            />
            {notasReport.subjects.length === 0 ? (
              <p className="text-sm text-brand-muted">Este curso aún no tiene materias.</p>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-brand-md)] border border-brand-border bg-white">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-brand-border bg-black/5 text-left">
                      <th className="px-3 py-2 font-medium">Materia</th>
                      {notasReport.subjects[0].periods.map((p) => (
                        <th key={p.label} className="px-3 py-2 text-center font-medium">
                          {p.label.replace("Periodo ", "P")}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-medium">Definitiva</th>
                      <th className="px-3 py-2 text-center font-medium">Desempeño</th>
                      <th className="px-3 py-2 text-center font-medium">Faltas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notasReport.subjects.map((s) => (
                      <tr key={s.name} className="border-b border-brand-border last:border-0">
                        <td className="px-3 py-2 font-medium text-brand-ink">{s.name}</td>
                        {s.periods.map((p) => (
                          <td
                            key={p.label}
                            className={
                              "px-3 py-2 text-center " + (p.grade !== null && p.grade < notasReport.pass ? "text-brand-danger" : "")
                            }
                          >
                            {p.grade ?? "—"}
                          </td>
                        ))}
                        <td
                          className={
                            "px-3 py-2 text-center font-semibold " +
                            (s.final !== null && s.final < notasReport.pass ? "text-brand-danger" : "")
                          }
                        >
                          {s.final ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-center">{s.performance}</td>
                        <td className="px-3 py-2 text-center">
                          <a href="#asistencia" className="hover:underline">
                            {s.absences}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedEnrollment.status === "retirado" ? (
              <p className="text-sm text-brand-muted">
                Estudiante retirado: usa el «Informe de retiro» de su matrícula (más abajo) para ver sus notas hasta esa fecha.
              </p>
            ) : (
              bulletin &&
              bulletinStudent && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <p className="text-sm font-medium text-brand-ink">Boletín</p>
                    <form className="flex items-end gap-2">
                      <input type="hidden" name="enr" value={selectedEnrollment.id} />
                      <select
                        name="period"
                        defaultValue={bulletin.periodNumber === null ? "final" : String(bulletin.periodNumber)}
                        className={selectClasses + " w-48"}
                        aria-label="Periodo del boletín"
                      >
                        {bulletin.periods.map((p) => (
                          <option key={p.id} value={p.number}>
                            {p.name}
                          </option>
                        ))}
                        <option value="final">Nota final del año</option>
                      </select>
                      <button className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border px-4 text-sm hover:bg-black/5">
                        Ver
                      </button>
                    </form>
                  </div>
                  <ul>
                    <BulletinRow
                      key={selectedEnrollment.id + ":" + (bulletin.periodNumber ?? "final")}
                      enrollmentId={selectedEnrollment.id}
                      periodNumber={bulletin.periodNumber}
                      listName={bulletinStudent.name}
                      student={{
                        name: bulletinStudent.displayName,
                        document: bulletinStudent.document,
                        rows: bulletinStudent.rows,
                        average: bulletinStudent.average,
                      }}
                      photoUrl={photoUrl}
                      guardians={bulletinStudent.guardians}
                      sentAt={bulletinSentAt}
                      readOnly={!editable}
                      header={{
                        institution: bulletin.institution,
                        courseLabel: bulletin.courseLabel,
                        year: bulletin.year,
                        periodLabel: bulletin.periodLabel,
                        teacherName: profile.full_name,
                        pass: bulletin.scale.pass,
                      }}
                    />
                  </ul>
                </div>
              )
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos del estudiante</CardTitle>
        </CardHeader>
        <CardContent>
          {editable ? (
            <ActionForm
              action={updateStudent.bind(null, id)}
              submitLabel="Guardar datos"
              resetOnSuccess={false}
              className="gap-4"
            >
              <PhotoInput currentUrl={photoUrl} label="Foto del estudiante" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombres">
                  <Input name="firstName" defaultValue={student.first_name} required />
                </Field>
                <Field label="Apellidos">
                  <Input name="lastName" defaultValue={student.last_name} required />
                </Field>
                <Field label="Documento">
                  <Input name="documentNumber" defaultValue={student.document_number ?? ""} />
                </Field>
                <Field label="Fecha de nacimiento">
                  <Input name="birthDate" type="date" defaultValue={student.birth_date ?? ""} />
                </Field>
                <Field label="Notas generales" className="sm:col-span-2">
                  <Input name="notes" defaultValue={student.notes ?? ""} />
                </Field>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-brand-muted">Documento: {student.document_number ?? "—"}</p>
          )}
        </CardContent>
      </Card>

      <Card id="asistencia">
        <CardHeader>
          <CardTitle>Asistencia</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {attendance.length === 0 ? (
            <p className="text-sm text-brand-muted">Aún no hay asistencia registrada para este estudiante.</p>
          ) : (
            <>
              <form method="get" action={`/dashboard/estudiantes/${id}#asistencia`} className="flex flex-wrap items-end gap-2">
                <Field label="Ver" className="w-40">
                  <select name="status" defaultValue={statusFilter} className={selectClasses}>
                    <option value="falta">Faltas</option>
                    <option value="excusa">Excusas</option>
                    <option value="tarde">Tardanzas</option>
                    <option value="todas">Todo el registro</option>
                  </select>
                </Field>
                <Field label="Materia" className="min-w-40 flex-1">
                  <select name="subject" defaultValue={subjectFilter ?? ""} className={selectClasses}>
                    <option value="">Todas las materias</option>
                    {courseSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border px-4 text-sm hover:bg-black/5">
                  Filtrar
                </button>
              </form>

              {sortedEnrollments.map((e) => {
                const mine = attendance.filter((a) => a.enrollment_id === e.id);
                if (mine.length === 0) return null;
                const course = courses.find((c) => c.id === e.course_id);
                const count = (status: AttendanceStatus) => mine.filter((a) => a.status === status).length;
                const shown = mine.filter(
                  (a) =>
                    (statusFilter === "todas" || a.status === statusFilter) &&
                    (!subjectFilter || a.course_subject_id === subjectFilter)
                );
                return (
                  <div key={e.id} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3">
                    <p className="text-sm font-medium text-brand-ink">
                      {course ? `${course.grade} ${course.section}` : "Curso eliminado"}{" "}
                      <span className="font-normal text-brand-muted">· {yearLabel(e.academic_year_id)}</span>
                      {e.status === "retirado" && <Badge className="ml-2 opacity-70">Retirado</Badge>}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-red-50 px-2 py-1 font-medium text-red-700">
                        {count("falta")} faltas
                      </span>
                      <span className="rounded-full bg-black/5 px-2 py-1">{count("excusa")} excusas</span>
                      <span className="rounded-full bg-black/5 px-2 py-1">{count("tarde")} tardanzas</span>
                      <span className="rounded-full bg-black/5 px-2 py-1">{count("presente")} presentes</span>
                    </div>
                    <details className="mt-2" open={Boolean(sp.status || sp.subject)}>
                      <summary className="cursor-pointer text-xs font-medium text-brand-dark">
                        Ver fechas ({shown.length})
                      </summary>
                      {shown.length === 0 ? (
                        <p className="mt-2 text-xs text-brand-muted">No hay registros con ese filtro.</p>
                      ) : (
                        <ul className="mt-2 flex flex-col divide-y divide-brand-border text-sm">
                          {shown.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                              <span className="capitalize text-brand-ink">{formatDay(a.attendance_date)}</span>
                              <span className="text-brand-muted">{subjectName(a.course_subject_id)}</span>
                              <span
                                className={
                                  a.status === "falta"
                                    ? "font-medium text-red-700"
                                    : a.status === "presente"
                                      ? "text-brand-muted"
                                      : "text-amber-700"
                                }
                              >
                                {ATTENDANCE_LABEL[a.status]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acudientes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {guardians.length === 0 && <p className="text-sm text-brand-muted">Sin acudientes registrados.</p>}
          {guardians.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded bg-black/5 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-brand-ink">
                  {g.full_name} {g.is_primary && <Badge className="ml-1">Principal</Badge>}
                </p>
                <p className="text-xs text-brand-muted">
                  {g.relationship ?? "Acudiente"} · {g.whatsapp ? `+${g.whatsapp}` : "sin WhatsApp"}
                </p>
              </div>
              {editable && (
                <ConfirmButton
                  action={deleteGuardian.bind(null, g.id, id)}
                  message={`¿Quitar a ${g.full_name}?`}
                  variant="ghost"
                  size="sm"
                >
                  Quitar
                </ConfirmButton>
              )}
            </div>
          ))}
          {editable && (
            <ActionForm action={addGuardian.bind(null, id)} submitLabel="Agregar acudiente" className="gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Nombre">
                  <Input name="guardianName" required />
                </Field>
                <Field label="Parentesco">
                  <Input name="guardianRelationship" />
                </Field>
                <Field label="WhatsApp con indicativo">
                  <Input name="guardianWhatsapp" inputMode="numeric" placeholder="573001112233" />
                </Field>
              </div>
            </ActionForm>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Observador / diario de campo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <ActionForm action={addObservation.bind(null, id)} submitLabel="Registrar observación" className="gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tipo">
                  <select name="kind" className={selectClasses} defaultValue="convivencia">
                    {Object.entries(KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Fecha">
                  <Input name="observedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                </Field>
                <Field label="Seguimiento el (opcional)">
                  <Input name="followUp" type="date" />
                </Field>
              </div>
              <Field label="¿Qué pasó?">
                <textarea
                  name="note"
                  required
                  rows={3}
                  className="w-full rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </Field>
              <Field label="Compromiso (opcional)">
                <Input name="commitment" placeholder="Ej. El acudiente se compromete a…" />
              </Field>
            </ActionForm>
          )}
          {observations.length === 0 && <p className="text-sm text-brand-muted">Sin observaciones todavía.</p>}
          {observations.map((o) => (
            <div key={o.id} className="rounded-[var(--radius-brand-sm)] border border-brand-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{KIND_LABEL[o.kind]}</Badge>
                <span className="text-xs text-brand-muted">{o.observed_on}</span>
                {o.follow_up_on && (
                  <span className={`text-xs ${o.resolved ? "text-brand-muted" : "font-medium text-amber-700"}`}>
                    Seguimiento: {o.follow_up_on}
                    {o.resolved ? " (cerrado)" : ""}
                  </span>
                )}
                {editable && (
                  <span className="ml-auto flex gap-1">
                    <ConfirmButton
                      action={toggleObservationResolved.bind(null, o.id, id, !o.resolved)}
                      variant="ghost"
                      size="sm"
                    >
                      {o.resolved ? "Reabrir" : "Cerrar seguimiento"}
                    </ConfirmButton>
                    <ConfirmButton
                      action={deleteObservation.bind(null, o.id, id)}
                      message="¿Eliminar esta observación?"
                      variant="ghost"
                      size="sm"
                    >
                      Eliminar
                    </ConfirmButton>
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-brand-ink">{o.note}</p>
              {o.commitment && <p className="mt-1 text-brand-muted">Compromiso: {o.commitment}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Matrículas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sortedEnrollments.length === 0 && <p className="text-sm text-brand-muted">Sin matrículas todavía.</p>}
          {sortedEnrollments.map((e) => {
            const course = courses.find((c) => c.id === e.course_id);
            const year = years.find((y) => y.id === e.academic_year_id);
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-black/5 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-brand-ink">
                    {course ? `${course.grade} ${course.section}` : "Curso eliminado"}
                  </p>
                  <p className="text-xs text-brand-muted">{yearLabel(e.academic_year_id)}</p>
                  {e.status === "retirado" && (
                    <p className="mt-1 text-xs text-brand-muted">
                      Retirado el {e.withdrawn_on ? formatDay(e.withdrawn_on) : "—"}
                      {e.withdrawn_reason ? ` · ${e.withdrawn_reason}` : ""}
                      {e.withdrawn_note ? ` · ${e.withdrawn_note}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={e.status === "retirado" || e.status === "perdio" ? "opacity-70" : ""}>
                    {STATUS_LABEL[e.status]}
                  </Badge>
                  {e.status === "retirado" && <WithdrawalReportButton enrollmentId={e.id} />}
                  {editable && e.status === "activa" && year?.status === "abierto" && (
                    <WithdrawForm
                      enrollmentId={e.id}
                      studentId={id}
                      teacherId={profile.id}
                      reasons={WITHDRAWAL_REASONS}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {editable && availableCourses.length > 0 && (
            <ActionForm action={enrollStudent.bind(null, id)} submitLabel="Matricular" className="sm:flex-row sm:items-end">
              <Field label="Matricular en" className="flex-1">
                <select name="courseId" className={selectClasses} required defaultValue="">
                  <option value="" disabled>
                    Elige un curso…
                  </option>
                  {availableCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade} {c.section} — {yearLabel(c.academic_year_id)}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          )}
          <p className="text-xs text-brand-muted">
            Un estudiante solo puede estar en un curso por año lectivo, y no se puede matricular dos veces en el mismo año.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
