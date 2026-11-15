"use server";

import { revalidatePath } from "next/cache";

import { requireActiveTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Channel = "whatsapp_compartir" | "whatsapp_enlace" | "descarga";
const CHANNELS: Channel[] = ["whatsapp_compartir", "whatsapp_enlace", "descarga"];

/** Deja constancia de que un boletín se descargó o se envió al acudiente. */
export async function recordBulletinSend(input: {
  enrollmentId: string;
  periodNumber: number | null;
  guardianId: string | null;
  channel: Channel;
}): Promise<{ error?: string }> {
  const profile = await requireActiveTeacher();
  if (!CHANNELS.includes(input.channel)) return { error: "Canal inválido" };

  const supabase = await createClient();
  const { error } = await supabase.from("bulletin_sends").insert({
    teacher_id: profile.id,
    enrollment_id: input.enrollmentId,
    period_number: input.periodNumber,
    guardian_id: input.guardianId,
    channel: input.channel,
  });
  if (error) return { error: "No se pudo registrar el envío" };
  revalidatePath("/dashboard", "layout");
  return {};
}
