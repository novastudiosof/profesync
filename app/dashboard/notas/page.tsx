import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { NotasPanel } from "@/components/docente/notas-panel";
import { isPlanActive, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AcademicYear, Course, CourseSubject, Institution } from "@/lib/supabase/types";

export default async function NotasPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; period?: string; tab?: string }>;
}) {
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: subjData }, { data: courseData }, { data: yearData }, { data: instData }] = await Promise.all([
    supabase.from("course_subjects").select("*").is("deleted_at", null).order("name"),
    supabase.from("courses").select("*").is("deleted_at", null),
    supabase.from("academic_years").select("*").order("year", { ascending: false }),
    supabase.from("institutions").select("*"),
  ]);
  const subjects = (subjData ?? []) as CourseSubject[];
  const courses = (courseData ?? []) as Course[];
  const years = (yearData ?? []) as AcademicYear[];
  const institutions = (instData ?? []) as Institution[];

  const labelOf = (s: CourseSubject) => {
    const c = courses.find((course) => course.id === s.course_id);
    const y = years.find((year) => year.id === c?.academic_year_id);
    const inst = institutions.find((i) => i.id === y?.institution_id);
    return `${c?.grade ?? ""} ${c?.section ?? ""} · ${s.name} · ${inst?.name ?? ""} ${y?.year ?? ""}`;
  };

  // Primero las materias de años abiertos, de más reciente a más antigua.
  const ordered = [...subjects].sort((a, b) => {
    const ya = years.find((y) => y.id === courses.find((c) => c.id === a.course_id)?.academic_year_id);
    const yb = years.find((y) => y.id === courses.find((c) => c.id === b.course_id)?.academic_year_id);
    return Number(yb?.status === "abierto") - Number(ya?.status === "abierto") || (yb?.year ?? 0) - (ya?.year ?? 0);
  });

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-brand-ink">Cuaderno de notas</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-brand-muted">
            Aún no tienes materias. Créalas dentro de un curso, desde{" "}
            <Link href="/dashboard" className="font-medium text-brand-dark underline">
              Inicio
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  const subjectId = ordered.find((s) => s.id === sp.subject)?.id ?? ordered[0].id;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold text-brand-ink">Cuaderno de notas</h1>
      <NotasPanel
        subjectId={subjectId}
        subjectOptions={ordered.map((s) => ({ id: s.id, label: labelOf(s) }))}
        periodId={sp.period}
        vista={sp.tab === "definitivas" ? "definitivas" : "planilla"}
        basePath="/dashboard/notas"
        editable={editable}
      />
    </div>
  );
}
