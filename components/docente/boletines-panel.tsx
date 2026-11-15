import { Field, selectClasses } from "@/components/action-form";
import { BulletinRow } from "@/components/docente/bulletin-row";
import { ReportButtons } from "@/components/docente/report-buttons";
import { signedMediaUrls } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCourseBulletins } from "@/lib/boletin-data";
import type { BulletinSend } from "@/lib/supabase/types";

/**
 * Boletines de un curso en un periodo (o la nota final): PDF, WhatsApp y
 * reportes del curso. Se usa en la página "Boletines" y dentro de cada curso.
 */
export async function BoletinesPanel({
  courseId,
  periodParam,
  fixed = {},
  keys = { course: "course", period: "period" },
  courseOptions,
  editable,
  teacherName,
}: {
  courseId: string;
  periodParam?: string;
  fixed?: Record<string, string>;
  keys?: { course: string; period: string };
  /** Si se pasa, se muestra el selector de curso (página "Boletines"). */
  courseOptions?: { id: string; label: string }[];
  editable: boolean;
  teacherName: string;
}) {
  const supabase = await createClient();

  let periodNumber: number | null;
  if (periodParam === "final") {
    periodNumber = null;
  } else if (Number(periodParam) > 0) {
    periodNumber = Number(periodParam);
  } else {
    // Periodo por defecto: el primero abierto (o el último).
    const { data: course } = await supabase.from("courses").select("academic_year_id").eq("id", courseId).maybeSingle();
    const { data: yearPeriods } = course
      ? await supabase.from("periods").select("number, status").eq("academic_year_id", course.academic_year_id).order("number")
      : { data: [] };
    periodNumber = yearPeriods?.find((p) => p.status === "abierto")?.number ?? yearPeriods?.at(-1)?.number ?? 1;
  }
  const data = await loadCourseBulletins(courseId, periodNumber);
  if (!data) return <p className="text-sm text-brand-muted">No se pudo cargar el curso.</p>;

  const photos = await signedMediaUrls(data.students.map((s) => s.photoPath));

  const enrollmentIds = data.students.map((s) => s.enrollmentId);
  const { data: sendData } = enrollmentIds.length
    ? await supabase.from("bulletin_sends").select("*").in("enrollment_id", enrollmentIds).order("created_at", { ascending: false })
    : { data: [] };
  const sends = (sendData ?? []) as BulletinSend[];
  const sentLabel = (enrollmentId: string) => {
    const send = sends.find(
      (s) => s.enrollment_id === enrollmentId && s.period_number === data.periodNumber && s.channel !== "descarga"
    );
    return send ? new Date(send.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : null;
  };

  const selectedPeriod = data.periodNumber === null ? "final" : String(data.periodNumber);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-brand-muted">
        Descarga el boletín en PDF o envíalo al acudiente por WhatsApp. En el celular el PDF va adjunto; en el computador
        se descarga y se abre el chat.
      </p>

      <form className="flex flex-wrap items-end gap-2">
        {Object.entries(fixed).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {courseOptions ? (
          <Field label="Curso" className="min-w-[240px] flex-1">
            <select name={keys.course} defaultValue={courseId} className={selectClasses}>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Periodo" className="w-48">
          <select name={keys.period} defaultValue={selectedPeriod} className={selectClasses}>
            {data.periods.map((p) => (
              <option key={p.id} value={p.number}>
                {p.name}
              </option>
            ))}
            <option value="final">Nota final del año</option>
          </select>
        </Field>
        <button className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border px-4 text-sm hover:bg-black/5">
          Ver
        </button>
      </form>

      <ReportButtons
        reports={[
          {
            label: `Consolidado del curso (${data.periodLabel})`,
            tipo: "notas-curso",
            params: { course: courseId, period: selectedPeriod },
          },
        ]}
      />

      {data.students.length === 0 ? (
        <p className="text-sm text-brand-muted">Este curso aún no tiene estudiantes matriculados.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.students.map((s) => (
            <BulletinRow
              key={`${s.enrollmentId}:${selectedPeriod}`}
              enrollmentId={s.enrollmentId}
              periodNumber={data.periodNumber}
              listName={s.name}
              student={{ name: s.displayName, document: s.document, rows: s.rows, average: s.average }}
              photoUrl={s.photoPath ? photos.get(s.photoPath) ?? null : null}
              guardians={s.guardians}
              sentAt={sentLabel(s.enrollmentId)}
              readOnly={!editable}
              header={{
                institution: data.institution,
                courseLabel: data.courseLabel,
                year: data.year,
                periodLabel: data.periodLabel,
                teacherName,
                pass: data.scale.pass,
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
