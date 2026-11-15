import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ChevronRight, School } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionForm, Field } from "@/components/action-form";
import { YearSelect } from "@/components/docente/year-select";
import { isPlanActive, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createInstitution } from "@/lib/actions/docente";
import { syncNotifications } from "@/lib/notifications";
import type { AcademicYear, Course, Enrollment, Institution } from "@/lib/supabase/types";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const profile = await requireProfile();
  if (profile.role === "super_admin") redirect("/superadmin");

  await syncNotifications(profile);
  const supabase = await createClient();
  const sp = await searchParams;
  const active = isPlanActive(profile);
  const editable = active;

  const [{ data: instData }, { data: yearData }] = await Promise.all([
    supabase.from("institutions").select("*").is("deleted_at", null).order("name"),
    supabase.from("academic_years").select("*").order("year", { ascending: false }),
  ]);
  const institutions = (instData ?? []) as Institution[];
  const years = ((yearData ?? []) as AcademicYear[]).filter((y) => institutions.some((i) => i.id === y.institution_id));

  // Filtro de año: por defecto el año vigente; también salen los años que ya existen.
  const currentYear = new Date().getFullYear();
  const yearNumbers = [...new Set([currentYear, ...years.map((y) => y.year)])].sort((a, b) => b - a);
  const selectedYear = yearNumbers.includes(Number(sp.year)) ? Number(sp.year) : currentYear;

  const yearOf = (institutionId: string) =>
    years.find((y) => y.institution_id === institutionId && y.year === selectedYear) ?? null;
  const selectedYearIds = institutions.map((i) => yearOf(i.id)?.id).filter((id): id is string => !!id);

  const [{ data: courseData }, { data: enrollData }, studentCount, courseCount] = await Promise.all([
    selectedYearIds.length
      ? supabase.from("courses").select("id, academic_year_id").in("academic_year_id", selectedYearIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    selectedYearIds.length
      ? supabase
          .from("enrollments")
          .select("academic_year_id, status")
          .in("academic_year_id", selectedYearIds)
          .in("status", ["activa", "aprobo", "perdio"])
      : Promise.resolve({ data: [] }),
    supabase.from("students").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("courses").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);
  const courses = (courseData ?? []) as Pick<Course, "id" | "academic_year_id">[];
  const enrollments = (enrollData ?? []) as Pick<Enrollment, "academic_year_id" | "status">[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">Hola, {profile.full_name.split(" ")[0]}</h1>
          <p className="text-sm text-brand-muted">
            Tus instituciones. Elige el año y entra a una institución para ver sus cursos.
          </p>
        </div>
        <YearSelect
          basePath="/dashboard"
          value={String(selectedYear)}
          options={yearNumbers.map((y) => ({ id: String(y), label: y === currentYear ? `${y} (actual)` : String(y) }))}
        />
      </div>

      {!active && (
        <div className="flex items-start gap-3 rounded-[var(--radius-brand-md)] border border-brand-danger/30 bg-brand-danger/10 p-4 text-sm text-brand-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Tu plan no está activo
            {profile.plan_expires_at ? ` (venció el ${profile.plan_expires_at})` : ""}. Puedes consultar tu información,
            pero no registrar cambios. Comunícate con el proveedor para reactivarlo.
          </p>
        </div>
      )}

      {institutions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-brand-muted">
            Aún no tienes instituciones. Crea la primera aquí abajo.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {institutions.map((inst) => {
            const year = yearOf(inst.id);
            const courseTotal = year ? courses.filter((c) => c.academic_year_id === year.id).length : 0;
            const studentTotal = year ? enrollments.filter((e) => e.academic_year_id === year.id).length : 0;
            return (
              <Link key={inst.id} href={`/dashboard/instituciones/${inst.id}?year=${selectedYear}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 p-5">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-dark">
                      <School className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-semibold text-brand-ink">{inst.name}</p>
                      {inst.city && <p className="truncate text-sm text-brand-muted">{inst.city}</p>}
                      {year ? (
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-brand-muted">
                          <Badge className={year.status === "cerrado" ? "opacity-60" : ""}>
                            {year.status === "cerrado" ? "Cerrado" : "Abierto"}
                          </Badge>
                          {courseTotal} cursos · {studentTotal} estudiantes
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-brand-muted">Aún sin año lectivo {selectedYear}</p>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-brand-muted" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Nueva institución</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createInstitution} submitLabel="Agregar institución" className="sm:flex-row sm:items-end">
              <Field label="Nombre" className="flex-1">
                <Input name="name" required />
              </Field>
              <Field label="Ciudad (opcional)" className="flex-1">
                <Input name="city" />
              </Field>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-brand-muted">
        Tu plan: {institutions.length}/{profile.max_institutions} instituciones · {courseCount.count ?? 0}/
        {profile.max_courses} cursos · {studentCount.count ?? 0}/{profile.max_students} estudiantes
        {profile.plan_expires_at && active ? ` · activo hasta el ${profile.plan_expires_at}` : ""}.
      </p>
    </div>
  );
}
