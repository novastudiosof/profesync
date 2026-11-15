import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/confirm-button";
import { CloseYearWizard } from "@/components/docente/close-year-wizard";
import { ReportButtons } from "@/components/docente/report-buttons";
import { StudentAvatar } from "@/components/docente/student-avatar";
import { isPlanActive, requireRole } from "@/lib/auth";
import { DEFAULT_FAIL_LIMIT, loadClosingData } from "@/lib/cierre-data";
import { prepareNextYear } from "@/lib/actions/cierre";

export default async function CierrePage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params;
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);

  const data = await loadClosingData(yearId);
  if (!data) notFound();
  const { year, institution, rows, nextYear, nextCourses, periods } = data;

  const yearLabel = `${institution?.name ?? ""} · ${year.year}`;
  const nextLabel = nextYear ? String(nextYear.year) : null;
  const nextCourseLabel = (id: string | null) => {
    const c = nextCourses.find((course) => course.id === id);
    return c ? `${c.grade} ${c.section}` : null;
  };
  const missingNextCourses = nextYear ? Math.max(0, data.courseCount - nextCourses.length) : data.courseCount;
  const pass = Number(year.pass_grade);

  // ------------------------------------------------------------------
  // Año cerrado: historial de resultados
  // ------------------------------------------------------------------
  if (year.status === "cerrado") {
    const courseLabels = [...new Set(rows.map((r) => r.courseLabel))];
    const approved = rows.filter((r) => r.status === "aprobo").length;
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Link href={`/dashboard/instituciones/${year.institution_id}?year=${year.year}`} className="text-sm text-brand-muted hover:underline">
            ← {institution?.name ?? "Institución"}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-brand-ink">Resultados del año {year.year}</h1>
          <p className="text-sm text-brand-muted">
            {institution?.name} · cerrado
            {year.closed_at ? ` el ${new Date(year.closed_at).toLocaleDateString("es-CO")}` : ""}
            {year.fail_subjects_limit ? ` · perdía con ${year.fail_subjects_limit} o más materias perdidas` : ""}
          </p>
          <p className="mt-1 text-sm text-brand-ink">
            {approved} aprobados · {rows.length - approved} perdidos
            {data.withdrawnCount > 0 ? ` · ${data.withdrawnCount} retirados` : ""}
          </p>
          <div className="mt-3">
            <ReportButtons reports={[{ label: "Resultados del año", tipo: "resultados-anio", params: { year: year.id } }]} />
          </div>
        </div>

        {courseLabels.map((courseLabel) => (
          <Card key={courseLabel}>
            <CardHeader>
              <CardTitle>{courseLabel}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-brand-border">
              {rows
                .filter((r) => r.courseLabel === courseLabel)
                .map((r) => (
                  <details key={r.enrollmentId} className="py-2">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                      <StudentAvatar name={r.name} url={r.photoUrl} size={36} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-brand-ink">{r.name}</span>
                      <Badge className={r.status === "perdio" ? "opacity-70" : ""}>
                        {r.status === "aprobo" ? "Aprobó" : "Perdió"}
                      </Badge>
                      <span className="w-44 text-xs text-brand-muted">
                        {nextCourseLabel(r.nextCourseId)
                          ? `→ ${nextCourseLabel(r.nextCourseId)} (${nextLabel})`
                          : "Sin matrícula en el año siguiente"}
                      </span>
                    </summary>
                    <ul className="mt-2 grid gap-x-6 pl-12 text-sm sm:grid-cols-2">
                      {r.subjects.map((s) => (
                        <li key={s.name} className="flex justify-between border-b border-brand-border py-1">
                          <span>{s.name}</span>
                          <span className={s.final !== null && s.final < pass ? "font-medium text-red-700" : ""}>
                            {s.final === null ? "—" : s.final.toFixed(1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 pl-12 text-xs">
                      <Link href={`/dashboard/estudiantes/${r.studentId}`} className="text-brand-dark underline">
                        Abrir ficha del estudiante
                      </Link>
                    </p>
                  </details>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Año abierto: asistente de cierre
  // ------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/dashboard/instituciones/${year.institution_id}?year=${year.year}`} className="text-sm text-brand-muted hover:underline">
          ← {institution?.name ?? "Institución"}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-brand-ink">Cerrar el año {year.year}</h1>
        <p className="text-sm text-brand-muted">
          {institution?.name} · {rows.length} estudiantes
          {data.withdrawnCount > 0 ? ` (${data.withdrawnCount} retirados no se incluyen)` : ""}
        </p>
      </div>

      {!editable ? (
        <p className="text-sm text-brand-muted">Tu plan está vencido: no puedes cerrar años hasta renovarlo.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>1. Año siguiente ({year.year + 1})</CardTitle>
              <CardDescription>
                Es el destino de los estudiantes que continúan. Se crea con la misma escala, periodos y fórmula, y copia
                los cursos y materias de este año.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {nextYear && missingNextCourses === 0 ? (
                <p className="text-sm text-brand-ink">
                  El año {nextYear.year} está listo con {nextCourses.length} curso(s).
                </p>
              ) : (
                <>
                  <p className="text-sm text-brand-muted">
                    {nextYear
                      ? `Al año ${nextYear.year} le faltan ${missingNextCourses} curso(s) de este año.`
                      : `El año ${year.year + 1} aún no existe.`}
                  </p>
                  <ConfirmButton
                    action={prepareNextYear.bind(null, year.id)}
                    message={
                      nextYear
                        ? `¿Copiar a ${nextYear.year} los cursos y materias que le faltan?`
                        : `¿Crear el año ${year.year + 1} y copiar los cursos y materias?`
                    }
                    size="sm"
                  >
                    {nextYear ? "Copiar cursos que faltan" : `Preparar año ${year.year + 1}`}
                  </ConfirmButton>
                </>
              )}
              {data.noGradeOrder && (
                <p className="w-full text-xs text-amber-700">
                  Tus cursos no tienen &quot;orden del grado&quot;, así que no se puede proponer a qué grado pasa cada
                  estudiante: elígelo a mano en cada fila.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Resultados y promoción</CardTitle>
              <CardDescription>
                Revisa quién aprueba y a qué curso va cada estudiante. Al cerrar, las notas y la asistencia del año
                quedan congeladas como historial.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-brand-muted">Este año no tiene estudiantes activos para cerrar.</p>
              ) : (
                <CloseYearWizard
                  yearId={year.id}
                  yearLabel={yearLabel}
                  passGrade={pass}
                  defaultLimit={year.fail_subjects_limit ?? DEFAULT_FAIL_LIMIT}
                  rows={rows}
                  nextYearLabel={nextLabel}
                  nextCourses={nextCourses.map((c) => ({ id: c.id, label: `${c.grade} ${c.section}` }))}
                  openPeriods={periods.filter((p) => p.status === "abierto").length}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
