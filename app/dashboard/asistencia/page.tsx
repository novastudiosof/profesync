import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { AsistenciaPanel } from "@/components/docente/asistencia-panel";
import { isPlanActive, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AcademicYear, Course, CourseSubject, Institution } from "@/lib/supabase/types";

export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; date?: string }>;
}) {
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: subjData }, { data: courseData }, { data: yearData }, { data: instData }] = await Promise.all([
    supabase.from("course_subjects").select("*").is("deleted_at", null).order("name"),
    supabase.from("courses").select("*").is("deleted_at", null),
    supabase.from("academic_years").select("*").eq("status", "abierto"),
    supabase.from("institutions").select("*"),
  ]);
  const courses = (courseData ?? []) as Course[];
  const years = (yearData ?? []) as AcademicYear[];
  const institutions = (instData ?? []) as Institution[];
  // Solo materias de años abiertos: la asistencia se toma en el año en curso.
  const subjects = ((subjData ?? []) as CourseSubject[]).filter((s) =>
    years.some((y) => y.id === courses.find((c) => c.id === s.course_id)?.academic_year_id)
  );

  const labelOf = (s: CourseSubject) => {
    const c = courses.find((course) => course.id === s.course_id);
    const y = years.find((year) => year.id === c?.academic_year_id);
    const inst = institutions.find((i) => i.id === y?.institution_id);
    return `${c?.grade ?? ""} ${c?.section ?? ""} · ${s.name} · ${inst?.name ?? ""}`;
  };

  if (subjects.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-brand-ink">Asistencia</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-brand-muted">
            Necesitas una materia en un año abierto. Créala dentro de un curso, desde{" "}
            <Link href="/dashboard" className="font-medium text-brand-dark underline">
              Inicio
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  const subjectId = subjects.find((s) => s.id === sp.subject)?.id ?? subjects[0].id;
  const today = new Date().toISOString().slice(0, 10);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold text-brand-ink">Asistencia</h1>
      <AsistenciaPanel
        subjectId={subjectId}
        subjectOptions={subjects.map((s) => ({ id: s.id, label: labelOf(s) }))}
        date={date}
        editable={editable}
      />
    </div>
  );
}
