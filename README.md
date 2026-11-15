# ProfeSync

Sistema para docentes (Next.js + Supabase). Ver PLAN.md.

## Puesta en marcha
1. Crear un proyecto nuevo en Supabase.
2. En el editor SQL ejecutar, en orden: `sql/001_schema.sql`, `sql/002_rls_policies.sql`, `sql/003_storage.sql`, `sql/004_notas_asistencia.sql`, `sql/005_boletines_notificaciones.sql`, `sql/006_retiros_alertas.sql`, `sql/007_cierre_anio.sql`, `sql/008_usuario_sin_mayusculas.sql`.
3. Copiar `.env.example` a `.env.local` y completar URL, anon key y service role key.
4. Crear el super admin: `node --env-file=.env.local scripts/bootstrap-super-admin.mjs <usuario> <clave> "<Nombre>"`
5. `npm run dev` y entrar en http://localhost:3000/login.
