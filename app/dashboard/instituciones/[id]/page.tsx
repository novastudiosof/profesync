import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionForm, Field } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { YearSelect } from "@/components/docente/year-select";
import { isPlanActive, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAcademicYear, createCourse, deleteCourse, deleteInstitution } from "@/lib/actions/docente";
import { updatePeriodWeights } from "@/lib/actions/notas";
import type { AcademicYear, Course, CourseSubject, Enrollment, Institution, Period } from "@/lib/supabase/types";

export default async function InstitucionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);
  const supabase = await createClient();

  const { data: instData } = await supabase.from("institutions").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!instData) notFound();
  const institution = instData as Institution;

  const { data: yearData } = await supabase
    .from("academic_years")
    .select("*")
    .eq("institution_id", id)
    .order("year", { ascending: false });
  const years = (yearData ?? []) as AcademicYear[];

  const currentYear = new Date().getFullYear();
  const requested = Number(sp.year);
  const selectedNumber = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : currentYear;
  const selected = years.find((y) => y.year === selectedNumber) ?? null;
  const yearNumbers = [...new Set([selectedNumber, currentYear, ...years.map((y) => y.year)])].sort((a, b) => b - a);

  const yearSelect = (
    <YearSelect
      basePath={`/dashboard/instituciones/${id}`}
      value={String(selectedNumber)}
      options={yearNumbers.map((y) => ({
        id: String(y),
        label: `${y}${y === currentYear ? " (actual)" : ""}${years.find((yr) => yr.year === y)?.status === "cerrado" ? " · cerrado" : ""}`,
      }))}
    />
  );

  const header = (
    <div className="flex flex-col gap-1">
      <Link href="/dashboard" className="text-sm text-brand-muted hover:underline">
        ← Inicio
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">{institution.name}</h1>
          {institution.city && <p className="text-sm text-brand-muted">{institution.city}</p>}
        </div>
        {yearSelect}
      </div>
    </div>
  );

  // ------------------------------------------------------------------
  // Esa institución aún no tiene el año elegido: se ofrece crearlo.
  // ------------------------------------------------------------------
  if (!selected) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>Aún no hay año lectivo {selectedNumber}</CardTitle>
          </CardHeader>
          <CardContent>
            {editable ? (
              <ActionForm
                action={createAcademicYear.bind(null, institution.id)}
                submitLabel={`Crear año ${selectedNumber}`}
                className="grid gap-3 sm:grid-cols-3"
                resetOnSuccess={false}
              >
                <input type="hidden" name="year" value={selectedNumber} />
                <Field label="Número de periodos">
                  <Input name="periods" type="number" min={2} max={6} defaultValue={4} required />
                </Field>
                <Field label="Nota para aprobar">
                  <Input name="passGrade" defaultValue="3.0" required />
                </Field>
                <span />
                <Field label="Escala: mínima">
                  <Input name="scaleMin" defaultValue="1.0" required />
                </Field>
                <Field label="Escala: máxima">
                  <Input name="scaleMax" defaultValue="5.0" required />
                </Field>
              </ActionForm>
            ) : (
              <p className="text-sm text-brand-muted">Tu plan no está activo: no puedes crear años.</p>
            )}
          </CardContent>
        </Card>
        <DeleteInstitution editable={editable} institution={institution} />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Año elegido: cursos
  // ------------------------------------------------------------------
  const { data: courseData } = await supabase
    .from("courses")
    .select("*")
    .eq("academic_year_id", selected.id)
    .is("deleted_at", null)
    .order("grade_order")
    .order("grade")
    .order("section");
  const courses = (courseData ?? []) as Course[];
  const courseIds = courses.map((c) => c.id);

  const [{ data: periodData }, { data: enrollData }, { data: subjectData }] = await Promise.all([
    supabase.from("periods").select("*").eq("academic_year_id", selected.id).order("number"),
    courseIds.length
      ? supabase.from("enrollments").select("course_id").in("course_id", courseIds).in("status", ["activa", "aprobo", "perdio"])
      : Promise.resolve({ data: [] }),
    courseIds.length
      ? supabase.from("course_subjects").select("id, course_id").in("course_id", courseIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  const periods = (periodData ?? []) as Period[];
  const studentsByCourse = new Map<string, number>();
  ((enrollData ?? []) as Pick<Enrollment, "course_id">[]).forEach((e) =>
    studentsByCourse.set(e.course_id, (studentsByCourse.get(e.course_id) ?? 0) + 1)
  );
  const subjectsByCourse = new Map<string, number>();
  ((subjectData ?? []) as Pick<CourseSubject, "id" | "course_id">[]).forEach((s) =>
    subjectsByCourse.set(s.course_id, (subjectsByCourse.get(s.course_id) ?? 0) + 1)
  );

  const canEdit = editable && selected.status === "abierto";

  return (
    <div className="flex flex-col gap-6">
      {header}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge className={selected.status === "cerrado" ? "opacity-60" : ""}>
          {selected.status === "cerrado" ? "Año cerrado" : "Año abierto"}
        </Badge>
        <span className="text-brand-muted">
          Escala {selected.scale_min}–{selected.scale_max} · aprueba con {selected.pass_grade}
        </span>
        {selected.status === "cerrado" ? (
          <Link href={`/dashboard/cierre/${selected.id}`} className="font-medium text-brand-dark underline">
            Ver resultados del año
          </Link>
        ) : (
          editable && (
            <Link href={`/dashboard/cierre/${selected.id}`} className="font-medium text-brand-dark underline">
              Cerrar año y promover estudiantes
            </Link>
          )
        )}
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo curso</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createCourse} submitLabel="Crear curso" className="sm:flex-row sm:items-end">
              <input type="hidden" name="academicYearId" value={selected.id} />
              <Field label="Grado (ej. 6°, Transición)" className="flex-1">
                <Input name="grade" required />
              </Field>
              <Field label="Grupo" className="w-28">
                <Input name="section" defaultValue="A" required />
              </Field>
              <Field label="Orden del grado (1, 2, 3…)" className="w-40">
                <Input name="gradeOrder" type="number" defaultValue={0} />
              </Field>
            </ActionForm>
            <p className="mt-2 text-xs text-brand-muted">
              El orden del grado sirve para promover a los estudiantes al grado siguiente al cerrar el año (6° = 6, 7° = 7…).
            </p>
          </CardContent>
        </Card>
      )}

      {courses.length === 0 ? (
        <p className="text-sm text-brand-muted">Este año aún no tiene cursos.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="transition-shadow hover:shadow-md">
              <CardContent className="flex flex-col gap-3 p-4">
                <Link href={`/dashboard/cursos/${course.id}`} className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold text-brand-ink">
                      {course.grade} {course.section}
                    </p>
                    <p className="text-sm text-brand-muted">
                      {studentsByCourse.get(course.id) ?? 0} estudiantes · {subjectsByCourse.get(course.id) ?? 0} materias
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-brand-muted" />
                </Link>
                {canEdit && (
                  <ConfirmButton
                    action={deleteCourse.bind(null, course.id)}
                    message={`¿Eliminar el curso ${course.grade} ${course.section}?`}
                    variant="outline"
                    size="sm"
                  >
                    Eliminar
                  </ConfirmButton>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editable && selected.status === "abierto" && (
        <details className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-brand-dark">
            Configurar periodos y fórmula de la nota final
          </summary>
          <ActionForm
            action={updatePeriodWeights.bind(null, selected.id)}
            submitLabel="Guardar fórmula"
            resetOnSuccess={false}
            className="mt-3"
          >
            <div className="flex flex-col gap-2">
              {periods.map((p) => (
                <div key={p.id} className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_9rem_9rem]">
                  <span className="text-sm font-medium text-brand-ink">{p.name}</span>
                  <Field label="Peso %">
                    <Input name={`w_${p.id}`} inputMode="decimal" defaultValue={String(p.weight)} required />
                  </Field>
                  <Field label="Inicia">
                    <Input name={`start_${p.id}`} type="date" defaultValue={p.starts_on ?? ""} />
                  </Field>
                  <Field label="Termina">
                    <Input name={`end_${p.id}`} type="date" defaultValue={p.ends_on ?? ""} />
                  </Field>
                </div>
              ))}
            </div>
            <p className="text-xs text-brand-muted">
              Los pesos deben sumar 100%. Las fechas son opcionales: con ellas el sistema te avisa cuando un periodo está
              por terminar y cuenta las faltas del boletín por periodo.
            </p>
          </ActionForm>
        </details>
      )}

      <DeleteInstitution editable={editable} institution={institution} />
    </div>
  );
}

function DeleteInstitution({ editable, institution }: { editable: boolean; institution: Institution }) {
  if (!editable) return null;
  return (
    <div className="flex justify-end">
      <ConfirmButton
        action={deleteInstitution.bind(null, institution.id)}
        message={`¿Eliminar la institución "${institution.name}"? Solo se puede si no tiene estudiantes matriculados.`}
        variant="ghost"
        size="sm"
      >
        Eliminar institución
      </ConfirmButton>
    </div>
  );
}
