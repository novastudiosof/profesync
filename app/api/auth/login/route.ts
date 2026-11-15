import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearLoginFailures,
  loginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  username: z.string().trim().min(1, "El usuario es obligatorio"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

const INVALID_CREDENTIALS = "Usuario o contraseña incorrectos";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { username, password } = parsed.data;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  const userKey = `u:${username.toLowerCase()}`;
  const ipKey = `ip:${ip}:${username.toLowerCase()}`;

  const retryAfter = Math.max(loginRetryAfterSeconds(userKey), loginRetryAfterSeconds(ipKey));
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(retryAfter / 60)} minuto(s).` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const fail = () => {
    recordLoginFailure(userKey);
    recordLoginFailure(ipKey);
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  };

  const admin = createAdminClient();
  // Mayúsculas y minúsculas valen igual: "Maria" y "maria" son el mismo usuario.
  const { data: profiles } = await admin
    .from("profiles")
    .select("auth_email")
    .ilike("username", username.replace(/[\\%_]/g, (ch) => `\\${ch}`))
    .limit(1);
  const profile = profiles?.[0];
  if (!profile) return fail();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: profile.auth_email,
    password,
  });
  if (error) return fail();

  // Una cuenta con plan vencido SÍ puede entrar (solo lectura y exportar),
  // por eso aquí no se bloquea el acceso.
  clearLoginFailures(userKey);
  clearLoginFailures(ipKey);
  return NextResponse.json({ ok: true });
}
