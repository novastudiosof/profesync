# ProfeSync — Plan del proyecto

Sistema para **docentes** (no para instituciones). Superadmin (Nova Studio) activa docentes manualmente; el cobro se maneja por fuera del sistema.

## Decisiones tomadas
- Nombre: **ProfeSync** (la carpeta CSM es provisional).
- Stack: igual que Stockia (Next.js + React + Tailwind + Supabase + Zod + ExcelJS). Proyecto Supabase **nuevo**.
- Login: mismo estilo que Stockia.
- Pagos: fuera del sistema. El superadmin solo activa/desactiva cuentas y fija vencimiento.
- WhatsApp: opción A (sin API de pago). Mensaje personalizado + PDF del boletín.
- Offline: fase 5, pero con datos preparados desde ya (UUID + updated_at + soft delete).
- IA: módulo activable por docente con cupo mensual (ver abajo).
- Marca: logo ProfeSync, nombre del software, foto del docente en el menú; foto de cada estudiante (obligatoria en el registro, opcional de omitir) visible en su bitácora/ficha, listas y toma de asistencia.

## Modelo de datos
```
profiles (docente)  -> plan: activo, vence_el, límites (instituciones, cursos, estudiantes), módulos, cupo_ia, tema
institutions        -> docente_id
academic_years      -> institution_id, estado (abierto|cerrado), formula_final (jsonb)
periods             -> academic_year_id, número, fechas, peso_final, estado (abierto|cerrado)
courses             -> academic_year_id, grado, grupo
course_subjects     -> course_id, nombre, escala_id
students            -> docente_id, nombres, apellidos, documento, foto_url, fecha_nac
guardians           -> student_id, nombre, parentesco, whatsapp, principal
enrollments         -> student_id, course_id, academic_year_id, estado (activa|aprobó|perdió|retirado)
activities          -> course_subject_id, period_id, nombre, peso_pct, fecha
grades              -> activity_id, enrollment_id, valor  (+ grade_history)
attendance          -> enrollment_id, fecha, estado (presente|tarde|excusa|falta)
observations        -> enrollment_id/student_id, tipo, texto, compromiso, seguimiento_el
materials           -> course_subject_id, period_id?, archivo
notifications       -> profile_id, tipo, mensaje, leída
grading_scales      -> docente_id, tipo (numérica|desempeño), rangos (jsonb)
```

Reglas en la base de datos:
- UNIQUE(student_id, academic_year_id) en enrollments => un solo curso por año y sin doble matrícula.
- Periodo cerrado => no se editan actividades ni notas (trigger).
- RLS: cada docente solo ve lo suyo; superadmin ve todo.
- Límites del plan validados en triggers (no solo en la interfaz).
- Cierre de año: calcula definitivas, marca estado, congela el año; asistente de promoción crea las matrículas del año siguiente.

## Superadmin
Crear/activar docentes, vencimiento, límites, módulos (WhatsApp, IA, material), cupo de IA, uso por docente. Cuenta vencida => solo lectura + exportar (nunca se borran datos).

## Fases
1. Base: login, superadmin, límites, instituciones, años, periodos, cursos, materias, estudiantes (con foto) y matrículas con reglas, tema y logo.
2. Núcleo: actividades, notas, fórmulas, asistencia, observador, importar desde Excel, exportar Excel/PDF.
3. Comunicación: boletín PDF por estudiante, envío WhatsApp, notificaciones y alertas.
4. Cierre y promoción de año, historial.
5. Material por año/periodo, IA, offline (PWA), mejoras.

## WhatsApp con PDF (opción A)
- Celular: Web Share API comparte el PDF directo a WhatsApp, con el mensaje "Hola {acudiente}, este es el boletín de {estudiante} del periodo {n}".
- Computador: botón "Descargar y enviar": descarga el PDF y abre `wa.me/<número>?text=...`; el docente adjunta el archivo descargado.
- Los datos (nombre y número del acudiente) salen del registro del estudiante.

## IA
Módulo opcional (observaciones de boletín, rúbricas, planeaciones). Usa la API de Claude: tiene costo por uso. Se controla con cupo mensual por docente definido por el superadmin.

## Ajustes posteriores
- La foto del docente la sube él/ella desde "Mi cuenta" (bucket privado `media`, carpeta por docente con RLS). Lo mismo la foto de cada estudiante.
- IA: **fuera por ahora**. Ya quedan en `profiles` los campos `ai_enabled` y `ai_monthly_quota`, y la tabla `teacher_modules` para activarla después sin cambiar el esquema.

## Estado (fase 1 construida)
Hecho: login estilo Stockia, superadmin (docentes, vencimiento, límites, contraseña), perfil con foto y color, instituciones, años lectivos con periodos, cursos, materias, estudiantes con foto y acudientes, matrículas con reglas en base de datos.
Retirado que vuelve o cambia de curso en el mismo año: resuelto (se reactiva su única matrícula del año).

## Estado (fase 2 construida)
SQL `sql/004_notas_asistencia.sql`. Hecho: actividades con peso libre, planilla de notas con guardado automático y nota de periodo en vivo, cierre/reapertura de periodo con bloqueo, fórmula de nota final editable, definitivas con desempeño, historial de cambios de notas (base de datos), asistencia de un toque con alerta de 3+ faltas, observador por estudiante con compromisos y seguimiento, importar estudiantes pegando desde Excel, exportación a Excel y vista de impresión/PDF.
Pendiente: probar todo con Supabase real.

## Estado (fase 3 construida)
SQL `sql/005_boletines_notificaciones.sql`. Hecho: página Boletines (por curso y periodo o nota final del año) con PDF generado en el navegador (foto del estudiante, notas por materia, desempeño, faltas, observación opcional); envío por WhatsApp: en celular comparte el PDF adjunto, en computador descarga y abre wa.me con el mensaje "Hola {acudiente}, este es el boletín de {estudiante}…"; elección del acudiente destinatario; registro de cada envío ("Enviado 14 nov"); notificaciones (inasistencias reiteradas, seguimientos vencidos del observador, fin de periodo, plan por vencer) con contador en el menú; fechas de inicio/fin por periodo.
Pendiente: probar todo con Supabase real; cierre y promoción de año (fase 4).

## Estado (fase 4 construida, SQL `sql/007_cierre_anio.sql`)
Cursos: selector compacto de año lectivo (por defecto el año actual). Cierre: página `/dashboard/cierre/[yearId]` (enlaces desde Cursos e Instituciones): paso 1 prepara el año siguiente (lo crea con misma escala/periodos/fórmula y copia cursos y materias); paso 2 asistente con regla "pierde con N o más materias perdidas" (editable, por defecto 3), resultado y curso destino por estudiante (propuesta: aprobó→grado siguiente por orden de grado, perdió→repite el mismo; todo editable). Cierre atómico en la función SQL `close_academic_year` (matrículas aprobó/perdió, matrículas del año siguiente, periodos y año cerrados, asistencia congelada). Año cerrado = historial de solo lectura con resultados, definitivas y a qué curso pasó cada uno. No hay "reabrir año" (decisión: evitar inconsistencias con las promociones).
Pendiente: probar con Supabase real.

## Ajustes antes de la fase 4 (SQL `sql/006_retiros_alertas.sql`)
- Navegación: Cursos → elegir institución y año (chips) → abrir un curso, con pestañas Estudiantes (foto + conteo de faltas que lleva a sus fechas), Materias (accesos a Notas y Asistencia, agregar/quitar) y Retirados. "Estudiantes" sigue en el menú como lista general con buscador.
- Ficha del estudiante: tarjeta Asistencia con totales por matrícula y lista de fechas (filtro por tipo y materia), para activos, cerrados y retirados.
- Retiro: motivo, fecha y nota; genera y guarda un PDF (notas, faltas con fechas, observaciones) en `media/<docente>/retiros/`; botón "Informe de retiro" siempre disponible. Nada se borra; si vuelve a matricularse se limpian los datos del retiro.
- Alertas parametrizables en Mi cuenta (tabla `alert_settings`, siempre activas): faltas sin excusa cada N, nota de periodo ≤ X, nota final ≤ Y (vacío = nota para aprobar del año). Periodo: alerta si está cerrado o 100% calificado; final: cuando todos los periodos tienen nota.

## Nuevo flujo de navegación (SQL `sql/008_usuario_sin_mayusculas.sql`, opcional pero recomendado)
- **Inicio** = solo instituciones, con filtro de año (por defecto el año vigente). Cada institución abre sus cursos del año elegido (`/dashboard/instituciones/[id]?year=`); ahí también se crean años, cursos y se configuran los periodos.
- **Curso** (`/dashboard/cursos/[id]`): pestañas Estudiantes (con foto y faltas), Materias, Notas (planilla actual), Asistencia, Boletines y Retirados.
- **Estudiante** (`?enr=` desde el curso): notas de todas las materias y periodos, boletín por periodo (PDF/WhatsApp), asistencia con fechas, observador, acudientes.
- Menú izquierdo: Inicio, Notas, Asistencia, Estudiantes, Boletines, Notificaciones, Mi cuenta (atajos sin entrar a cada curso). Barra lateral fija.
- Materias ↔ estudiantes: las materias son de un curso; el estudiante se matricula en el curso y aparece en todas sus materias (sin vínculo manual).
- **Reportes PDF y Excel** (`/api/reportes/<tipo>?formato=pdf|xlsx`): notas-materia, notas-curso (consolidado), notas-estudiante, asistencia-curso, asistencia-estudiante, resultados-anio. Se arman en el servidor; botones en cada vista.
- Usuario: se guarda como se escribe; el login no distingue mayúsculas; no pueden repetirse sin importarlas. El super admin puede eliminar docentes (con todo lo suyo) y restablecer su contraseña.
- Datos de prueba: `scripts/seed-demo.mjs` (cuenta `alejaespinosa`, fotos de la carpeta `niños/`; `--limpiar` borra solo sus datos).
