import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeacherForm } from "@/components/superadmin/teacher-form";
import { ResetPasswordForm } from "@/components/superadmin/reset-password-form";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteTeacher, updateTeacher } from "@/lib/actions/superadmin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";

export default async function TeacherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", id).eq("role", "teacher").maybeSingle();
  if (!data) notFound();
  const teacher = data as Profile;

  const [inst, courses, students] = await Promise.all([
    supabase.from("institutions").select("id", { count: "exact", head: true }).eq("teacher_id", id).is("deleted_at", null),
    supabase.from("courses").select("id", { count: "exact", head: true }).eq("teacher_id", id).is("deleted_at", null),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("teacher_id", id).is("deleted_at", null),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/superadmin" className="text-sm text-brand-muted hover:underline">
        ← Volver
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>{teacher.full_name}</CardTitle>
          <p className="text-sm text-brand-muted">
            @{teacher.username} · Uso: {inst.count ?? 0}/{teacher.max_institutions} instituciones ·{" "}
            {courses.count ?? 0}/{teacher.max_courses} cursos · {students.count ?? 0}/{teacher.max_students} estudiantes
          </p>
        </CardHeader>
        <CardContent>
          <TeacherForm action={updateTeacher.bind(null, id)} teacher={teacher} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contraseña</CardTitle>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm teacherId={id} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Eliminar docente</CardTitle>
          <p className="text-sm text-brand-muted">
            Borra la cuenta y todo lo suyo: instituciones, cursos, estudiantes, notas y fotos. No se puede deshacer. Si solo
            quiere que deje de entrar, desactívelo arriba.
          </p>
        </CardHeader>
        <CardContent>
          <ConfirmButton
            action={deleteTeacher.bind(null, id)}
            message={`¿Eliminar a ${teacher.full_name} y TODOS sus datos? Esta acción no se puede deshacer.`}
            variant="outline"
          >
            Eliminar a {teacher.full_name}
          </ConfirmButton>
        </CardContent>
      </Card>
    </div>
  );
}
