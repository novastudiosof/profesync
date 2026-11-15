import { AlertTriangle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Field, selectClasses } from "@/components/action-form";
import { AttendanceList } from "@/components/docente/attendance-list";
import { ReportButtons } from "@/components/docente/report-buttons";
import { signedMediaUrls } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadSubjectContext } from "@/lib/notas-data";
import { loadAlertConfig } from "@/lib/notifications";
import type { Attendance } from "@/lib/supabase/types";

/**
 * Toma de asistencia de una materia en una fecha. Se usa en la página
 * "Asistencia" y dentro de cada curso (fixed y keys conservan la página).
 */
export async function AsistenciaPanel({
  subjectId,
  subjectOptions,
  date,
  fixed = {},
  keys = { subject: "subject", date: "date" },
  editable,
}: {
  subjectId: string;
  subjectOptions: { id: string; label: string }[];
  date: string;
  fixed?: Record<string, string>;
  keys?: { subject: string; date: string };
  editable: boolean;
}) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  // Faltas sin excusa a partir de las cuales se alerta (configurable en Mi cuenta).
  const absenceAlert = (await loadAlertConfig()).absenceStep;

  const ctx = await loadSubjectContext(subjectId);
  if (!ctx) return <p className="text-sm text-brand-muted">No se pudo cargar la materia.</p>;

  const { data: attData } = await supabase.from("attendance").select("*").eq("course_subject_id", subjectId);
  const attendance = (attData ?? []) as Attendance[];
  const photos = await signedMediaUrls(ctx.roster.map((r) => r.student.photo_url));

  const rows = ctx.roster.map((r) => ({
    enrollmentId: r.enrollment.id,
    name: `${r.student.last_name} ${r.student.first_name}`,
    photoUrl: r.student.photo_url ? photos.get(r.student.photo_url) ?? null : null,
    status: attendance.find((a) => a.enrollment_id === r.enrollment.id && a.attendance_date === date)?.status ?? null,
  }));

  // Alertas: estudiantes con muchas faltas sin excusa en esta materia.
  const alerts = ctx.roster
    .map((r) => ({
      name: `${r.student.last_name} ${r.student.first_name}`,
      absences: attendance.filter((a) => a.enrollment_id === r.enrollment.id && a.status === "falta").length,
    }))
    .filter((a) => a.absences >= absenceAlert)
    .sort((a, b) => b.absences - a.absences);

  const yearClosed = ctx.year.status === "cerrado";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-brand-muted">Toca una opción por estudiante; se guarda al instante.</p>
        <ReportButtons
          reports={[{ label: "Asistencia del curso", tipo: "asistencia-curso", params: { course: ctx.course.id } }]}
        />
      </div>

      <form className="flex flex-wrap items-end gap-2">
        {Object.entries(fixed).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {subjectOptions.length > 1 && (
          <Field label="Materia" className="min-w-[240px] flex-1">
            <select name={keys.subject} defaultValue={subjectId} className={selectClasses}>
              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {subjectOptions.length <= 1 && <input type="hidden" name={keys.subject} value={subjectId} />}
        <Field label="Fecha" className="w-44">
          <Input name={keys.date} type="date" defaultValue={date} max={today} />
        </Field>
        <button className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border px-4 text-sm hover:bg-black/5">
          Ver
        </button>
      </form>

      {yearClosed && <p className="text-sm text-brand-muted">El año está cerrado: solo consulta.</p>}

      {alerts.length > 0 && (
        <div className="rounded-[var(--radius-brand-md)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> Inasistencias reiteradas ({absenceAlert} o más faltas)
          </p>
          <ul className="mt-1 list-inside list-disc">
            {alerts.map((a) => (
              <li key={a.name}>
                {a.name}: {a.absences} faltas
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-brand-muted">Este curso aún no tiene estudiantes matriculados.</p>
      ) : (
        <AttendanceList
          key={`${subjectId}:${date}`}
          subjectId={subjectId}
          date={date}
          rows={rows}
          readOnly={!editable || yearClosed}
        />
      )}
    </div>
  );
}
