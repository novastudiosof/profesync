"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyDbError } from "@/lib/db-errors";
import { createTeacherSchema, updateTeacherSchema } from "@/lib/validations/superadmin";

type ActionResult = { error?: string; success?: string } | void;

/** Escapa % _ \ para usar el texto como coincidencia exacta en ilike. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const dateOrNull =(value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

export async function createTeacher(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireRole("super_admin");

  const parsed = createTeacherSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
    password: formData.get("password"),
    phone: formData.get("phone") || undefined,
    planExpiresAt: formData.get("planExpiresAt") || undefined,
    maxInstitutions: formData.get("maxInstitutions"),
    maxCourses: formData.get("maxCourses"),
    maxStudents: formData.get("maxStudents"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  const admin = createAdminClient();

  // El usuario distingue mayúsculas al guardarse, pero no puede repetirse sin importarlas.
  const { data: existing } = await admin.from("profiles").select("id").ilike("username", escapeLike(d.username)).limit(1);
  if (existing && existing.length > 0) return { error: "Ese nombre de usuario ya está en uso" };

  const authEmail = `${crypto.randomUUID()}@profesync.internal`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: d.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return { error: friendlyDbError(createError, "createTeacher:auth", "No se pudo crear el usuario") };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    username: d.username,
    full_name: d.fullName,
    auth_email: authEmail,
    role: "teacher",
    phone: d.phone || null,
    plan_expires_at: dateOrNull(d.planExpiresAt),
    max_institutions: d.maxInstitutions,
    max_courses: d.maxCourses,
    max_students: d.maxStudents,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: friendlyDbError(profileError, "createTeacher:profile", "No se pudo crear el perfil") };
  }

  revalidatePath("/superadmin");
  redirect("/superadmin");
}

export async function updateTeacher(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireRole("super_admin");

  const parsed = updateTeacherSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone") || undefined,
    isActive: formData.get("isActive") === "on",
    planExpiresAt: formData.get("planExpiresAt") || undefined,
    maxInstitutions: formData.get("maxInstitutions"),
    maxCourses: formData.get("maxCourses"),
    maxStudents: formData.get("maxStudents"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: d.fullName,
      phone: d.phone || null,
      is_active: d.isActive,
      plan_expires_at: dateOrNull(d.planExpiresAt),
      max_institutions: d.maxInstitutions,
      max_courses: d.maxCourses,
      max_students: d.maxStudents,
    })
    .eq("id", teacherId)
    .eq("role", "teacher");
  if (error) return { error: friendlyDbError(error, "updateTeacher", "No se pudo guardar") };

  revalidatePath("/superadmin");
  revalidatePath(`/superadmin/docentes/${teacherId}`);
  return { success: "Cambios guardados" };
}

/** Borra todos los archivos (fotos, informes) de la carpeta de un docente en el bucket "media". */
async function removeTeacherFiles(admin: ReturnType<typeof createAdminClient>, teacherId: string) {
  for (const folder of [teacherId, `${teacherId}/retiros`]) {
    const { data } = await admin.storage.from("media").list(folder, { limit: 1000 });
    const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
    if (files.length > 0) await admin.storage.from("media").remove(files);
  }
}

/** Elimina al docente con TODO lo suyo (instituciones, estudiantes, notas, fotos). No se puede deshacer. */
export async function deleteTeacher(teacherId: string): Promise<{ error?: string }> {
  const me = await requireRole("super_admin");
  if (teacherId === me.id) return { error: "No puedes eliminar tu propia cuenta" };

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("role").eq("id", teacherId).maybeSingle();
  if (!target || target.role !== "teacher") return { error: "Docente no encontrado" };

  await removeTeacherFiles(admin, teacherId);
  await admin.from("grade_history").delete().eq("teacher_id", teacherId);
  // El perfil y todos sus datos se borran en cascada al eliminar el usuario.
  const { error } = await admin.auth.admin.deleteUser(teacherId);
  if (error) return { error: "No se pudo eliminar al docente" };

  revalidatePath("/superadmin");
  redirect("/superadmin");
}

export async function resetTeacherPassword(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireRole("super_admin");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "La contraseña debe tener mínimo 8 caracteres" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(teacherId, { password });
  if (error) return { error: "No se pudo cambiar la contraseña" };
  return { success: "Contraseña actualizada" };
}
