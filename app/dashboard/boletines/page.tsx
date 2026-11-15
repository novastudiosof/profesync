import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { BoletinesPanel } from "@/components/docente/boletines-panel";
import { isPlanActive, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AcademicYear, Course, Institution } from "@/lib/supabase/types";

export default async function BoletinesPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; period?: string }>;
}) {
  const profile = await requireRole("teacher");
  const editable = isPlanActive(profile);
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: courseData }, { data: yearData }, { data: instData }] = await Promise.all([
    supabase.from("courses").select("*").is("deleted_at", null).order("grade_order"),
    supabase.from("academic_years").select("*").order("year", { ascending: false }),
    supabase.from("institutions").select("*"),
  ]);
  const years = (yearData ?? []) as AcademicYear[];
  const institutions = (instData ?? []) as Institution[];
  const courses = ((courseData ?? []) as Course[]).sort((a, b) => {
    const ya = years.find((y) => y.id === a.academic_year_id);
    const yb = years.find((y) => y.id === b.academic_year_id);
    return Number(yb?.status === "abierto") - Number(ya?.status === "abierto") || (yb?.year ?? 0) - (ya?.year ?? 0);
  });

  const labelOf = (c: Course) => {
    const y = years.find((year) => year.id === c.academic_year_id);
    const inst = institutions.find((i) => i.id === y?.institution_id);
    return `${c.grade} ${c.section} · ${inst?.name ?? ""} ${y?.year ?? ""}`;
  };

  if (courses.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-brand-ink">Boletines</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-brand-muted">
            Aún no tienes cursos. Créalos desde{" "}
            <Link href="/dashboard" className="font-medium text-brand-dark underline">
              Inicio
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  const courseId = courses.find((c) => c.id === sp.course)?.id ?? courses[0].id;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold text-brand-ink">Boletines</h1>
      <BoletinesPanel
        courseId={courseId}
        periodParam={sp.period}
        courseOptions={courses.map((c) => ({ id: c.id, label: labelOf(c) }))}
        editable={editable}
        teacherName={profile.full_name}
      />
    </div>
  );
}
