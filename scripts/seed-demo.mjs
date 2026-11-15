// Llena la base con datos de PRUEBA en la cuenta de la profe Mayra Alejandra Espinosa.
//   node --env-file=.env.local scripts/seed-demo.mjs            -> carga los datos (la cuenta debe estar vacía)
//   node --env-file=.env.local scripts/seed-demo.mjs --limpiar  -> borra SOLO los datos de la cuenta (no la cuenta)
// No cambia usuario, contraseña ni nombre de la cuenta, y no toca ninguna otra.
// Las fotos de los estudiantes salen de la carpeta "niños" (se reparten y repiten).
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const DEMO_USER = process.env.SEED_USER || "alejaespinosa"; // SEED_USER solo se usa para pruebas internas
const OLD_DEMO_USERS = ["docentedemo", "alejandra"]; // cuentas demo anteriores (creadas por el script): se eliminan

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function ins(table, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 400) {
    const { data, error } = await db.from(table).insert(rows.slice(i, i + 400)).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
  }
  return out;
}

async function removeUser(username) {
  const { data: profile } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  if (!profile) return false;
  await db.from("grade_history").delete().eq("teacher_id", profile.id);
  const { error } = await db.auth.admin.deleteUser(profile.id); // el perfil y todo lo suyo se borra en cascada
  if (error) throw new Error(`No se pudo borrar a ${username}: ${error.message}`);
  return true;
}

/** Borra los datos de un docente (instituciones, estudiantes, notas, fotos de estudiantes) sin borrar su cuenta. */
async function cleanTeacherData(teacherId) {
  const { data: students } = await db.from("students").select("photo_url").eq("teacher_id", teacherId);
  await db.from("grade_history").delete().eq("teacher_id", teacherId);
  await db.from("institutions").delete().eq("teacher_id", teacherId); // cascada: años, periodos, cursos, materias, matrículas, notas, asistencia
  await db.from("students").delete().eq("teacher_id", teacherId); // cascada: acudientes, observaciones
  const photos = (students ?? []).map((s) => s.photo_url).filter(Boolean);
  if (photos.length) await db.storage.from("media").remove(photos);
  const { data: reports } = await db.storage.from("media").list(`${teacherId}/retiros`, { limit: 1000 });
  const files = (reports ?? []).filter((f) => f.id).map((f) => `${teacherId}/retiros/${f.name}`);
  if (files.length) await db.storage.from("media").remove(files);
}

// Las cuentas demo anteriores (creadas por este script) se eliminan siempre.
for (const old of OLD_DEMO_USERS) if (await removeUser(old)) console.log(`Cuenta demo anterior "${old}" eliminada.`);

const { data: teacher } = await db.from("profiles").select("*").eq("username", DEMO_USER).maybeSingle();
if (!teacher || teacher.role !== "teacher") {
  console.error(`No existe la cuenta de docente "${DEMO_USER}". Créala primero desde el panel del super admin.`);
  process.exit(1);
}
const teacherId = teacher.id;

if (process.argv.includes("--limpiar")) {
  await cleanTeacherData(teacherId);
  console.log(`Datos de "${DEMO_USER}" borrados (la cuenta sigue igual).`);
  process.exit(0);
}

const [{ count: instCount }, { count: studentCount }] = await Promise.all([
  db.from("institutions").select("id", { count: "exact", head: true }).eq("teacher_id", teacherId),
  db.from("students").select("id", { count: "exact", head: true }).eq("teacher_id", teacherId),
]);
if ((instCount ?? 0) > 0 || (studentCount ?? 0) > 0) {
  console.error(
    `La cuenta "${DEMO_USER}" ya tiene datos. Para recargar los datos de prueba, corre primero con --limpiar (borra solo sus datos).`
  );
  process.exit(1);
}
const todayIso = new Date().toISOString().slice(0, 10);
if (!teacher.is_active || (teacher.plan_expires_at && teacher.plan_expires_at < todayIso)) {
  console.error("El plan de esa cuenta no está activo o está vencido: actívalo desde el panel antes de cargar datos.");
  process.exit(1);
}
// Los datos de prueba necesitan al menos 1 institución, 6 cursos y 30 estudiantes.
const limits = {
  max_institutions: Math.max(teacher.max_institutions, 1),
  max_courses: Math.max(teacher.max_courses, 6),
  max_students: Math.max(teacher.max_students, 30),
};
if (
  limits.max_institutions !== teacher.max_institutions ||
  limits.max_courses !== teacher.max_courses ||
  limits.max_students !== teacher.max_students
) {
  await db.from("profiles").update(limits).eq("id", teacherId);
  console.log("Se subieron los límites del plan lo mínimo necesario para los datos de prueba:", limits);
}

// ---- Utilidades -----------------------------------------------------------
let seed = 20260514;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n) => Math.min(5, Math.max(1, n));
const addDays = (iso, days) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

const subjectNames = ["Matemáticas", "Lengua Castellana", "Ciencias Naturales", "Ciencias Sociales", "Inglés"];
const actWeights = [20, 30, 30, 20];
const actNames = ["Quiz", "Taller en clase", "Proyecto", "Evaluación"];

// ---- Datos -----------------------------------------------------------------
try {
  const [institution] = await ins("institutions", [
    { teacher_id: teacherId, name: "I.E. Santa María", city: "Santa María, Huila" },
  ]);

  // ---- 30 estudiantes con acudientes -----------------------------------
  const firstNames = [
    "Juan Camilo", "María Fernanda", "Santiago", "Valentina", "Andrés Felipe", "Laura Sofía", "Daniel", "Camila",
    "Sebastián", "Isabela", "Mateo", "Luciana", "Nicolás", "Mariana", "Samuel", "Gabriela", "Emmanuel", "Daniela",
    "Joaquín", "Paula Andrea", "Tomás", "Sara", "Felipe", "Natalia", "Esteban", "Juliana", "Alejandro", "Karen",
    "David", "Ximena",
  ];
  const lastNames = [
    "Pérez Gómez", "Rodríguez Silva", "García Torres", "Martínez Ruiz", "López Cárdenas", "Hernández Rojas",
    "Ramírez Vargas", "Castro Mejía", "Ortiz Peña", "Moreno Duarte", "Suárez Parra", "Jiménez Cruz",
    "Vargas Medina", "Rojas Salazar", "Gutiérrez Mora", "Torres Aguirre", "Díaz Cortés", "Sánchez Ibarra",
    "Cabrera Lara", "Montoya Bernal", "Quintero Ávila", "Navarro León", "Delgado Pardo", "Bonilla Reyes",
    "Zapata Fonseca", "Cortés Arias", "Peña Villamil", "Ospina Beltrán", "Cuéllar Ramos", "Trujillo Neira",
  ];
  const guardianNames = ["María Gómez", "Carlos Silva", "Luz Torres", "Jorge Ruiz", "Ana Cárdenas", "Pedro Rojas"];

  const students = await ins(
    "students",
    firstNames.map((first, i) => ({
      teacher_id: teacherId,
      first_name: first,
      last_name: lastNames[i],
      document_number: String(1000000100 + i),
      birth_date: `${2012 + Math.floor(i / 10)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      notes: i === 5 ? "Alergia a la penicilina." : null,
    }))
  );

  // Fotos: se reparten las de la carpeta "niños" entre los estudiantes (se repiten). Cada estudiante
  // tiene su propia copia en el almacenamiento, para que cambiar o borrar una no afecte a las demás.
  const photoDir = join(process.cwd(), "niños");
  let photoFiles = [];
  try {
    photoFiles = readdirSync(photoDir).filter((f) => [".jpg", ".jpeg", ".png", ".webp"].includes(extname(f).toLowerCase())).sort();
  } catch {
    console.warn(`No se encontró la carpeta "niños": los estudiantes quedan sin foto.`);
  }
  let photosUploaded = 0;
  for (let i = 0; i < students.length && photoFiles.length > 0; i++) {
    const file = photoFiles[i % photoFiles.length];
    const ext = extname(file).toLowerCase() === ".jpeg" ? ".jpg" : extname(file).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const path = `${teacherId}/${crypto.randomUUID()}${ext}`;
    const { error: uploadError } = await db.storage.from("media").upload(path, readFileSync(join(photoDir, file)), { contentType });
    if (uploadError) throw new Error(`foto ${file}: ${uploadError.message}`);
    await db.from("students").update({ photo_url: path }).eq("id", students[i].id);
    photosUploaded++;
  }

  const guardianRows = [];
  students.forEach((s, i) => {
    guardianRows.push({
      teacher_id: teacherId,
      student_id: s.id,
      full_name: `${guardianNames[i % guardianNames.length]} ${s.last_name.split(" ")[0]}`,
      relationship: i % 3 === 0 ? "Padre" : "Madre",
      whatsapp: `57300000${String(1000 + i)}`, // números ficticios
      is_primary: true,
    });
    if (i % 3 === 0) {
      guardianRows.push({
        teacher_id: teacherId,
        student_id: s.id,
        full_name: `${guardianNames[(i + 3) % guardianNames.length]} ${s.last_name.split(" ")[1] ?? s.last_name}`,
        relationship: i % 2 === 0 ? "Madre" : "Abuela",
        whatsapp: `57310000${String(1000 + i)}`,
        is_primary: false,
      });
    }
  });
  const guardians = await ins("guardians", guardianRows);

  // Rendimiento de cada estudiante. Posición en el curso (0..9): 3 = muy bajo, 6 = excelente.
  const posOf = (i) => i % 10;
  const WEAK = 3;
  const STAR = 6;
  const baseOf = students.map((_, i) => (posOf(i) === WEAK ? 2.3 : posOf(i) === STAR ? 4.7 : 3.4 + rand() * 1.1));
  const REPEATER = 15; // 7°A en 2026: el año pasado perdió 7° y lo repite
  const WITHDRAWN = 19; // 7°A en 2026: se retira en septiembre

  // ---- Construye un año lectivo completo ------------------------------------
  async function buildYear(cfg) {
    const [year] = await ins("academic_years", [
      {
        teacher_id: teacherId,
        institution_id: institution.id,
        year: cfg.year,
        scale_min: 1,
        scale_max: 5,
        pass_grade: 3,
        final_formula: [1, 2, 3, 4].map((period) => ({ period, weight: 25 })),
      },
    ]);
    const periods = await ins(
      "periods",
      cfg.periodDates.map(([starts_on, ends_on], i) => ({
        teacher_id: teacherId,
        academic_year_id: year.id,
        number: i + 1,
        name: `Periodo ${i + 1}`,
        starts_on,
        ends_on,
        weight: 25,
      }))
    );
    const courses = await ins(
      "courses",
      cfg.courseDefs.map((c) => ({
        teacher_id: teacherId,
        academic_year_id: year.id,
        grade: c.grade,
        grade_order: c.order,
        section: "A",
      }))
    );
    const subjects = await ins(
      "course_subjects",
      courses.flatMap((course) =>
        subjectNames.map((name) => ({
          teacher_id: teacherId,
          course_id: course.id,
          name,
          weekly_hours: name === "Matemáticas" ? 5 : 3,
        }))
      )
    );
    const enrollments = await ins(
      "enrollments",
      students.map((s, i) => ({
        teacher_id: teacherId,
        student_id: s.id,
        course_id: courses[cfg.courseIdx(i)].id,
        academic_year_id: year.id,
      }))
    );

    const activityRows = [];
    for (const subject of subjects) {
      for (const period of periods) {
        actWeights.forEach((weight, k) => {
          activityRows.push({
            teacher_id: teacherId,
            course_subject_id: subject.id,
            period_id: period.id,
            name: `${actNames[k]} ${period.number}`,
            weight,
            activity_date: addDays(period.starts_on, Math.floor(((k + 1) * 60) / 5)),
          });
        });
      }
    }
    const activities = await ins("activities", activityRows);

    const subjectOffset = new Map(subjects.map((s) => [s.id, (rand() - 0.5) * 0.5]));
    const actsByKey = new Map();
    for (const a of activities) {
      const k = `${a.course_subject_id}:${a.period_id}`;
      actsByKey.set(k, [...(actsByKey.get(k) ?? []), a]);
    }
    const gradeRows = [];
    enrollments.forEach((enrollment, i) => {
      const courseId = courses[cfg.courseIdx(i)].id;
      for (const subject of subjects.filter((s) => s.course_id === courseId)) {
        for (const period of periods) {
          (actsByKey.get(`${subject.id}:${period.id}`) ?? []).forEach((activity, k) => {
            if (!cfg.includeGrade(i, period.number, k)) return;
            const value = round1(clamp(cfg.baseOf(i) + subjectOffset.get(subject.id) + (rand() - 0.5) * 0.9));
            gradeRows.push({ teacher_id: teacherId, activity_id: activity.id, enrollment_id: enrollment.id, value });
          });
        }
      }
    });
    await ins("grades", gradeRows);

    const attendanceRows = [];
    subjects.forEach((subject, sIdx) => {
      const courseIdx = courses.findIndex((c) => c.id === subject.course_id);
      const dates = cfg.classDates(sIdx);
      enrollments.forEach((enrollment, i) => {
        if (cfg.courseIdx(i) !== courseIdx) return;
        dates.forEach((date, di) => {
          if (!cfg.includeDate(i, date)) return;
          let status = "presente";
          const r = rand();
          if (cfg.heavyAbsence && posOf(i) === 2 && subject.name === "Matemáticas" && di % 2 === 0) status = "falta";
          else if (cfg.heavyAbsence && posOf(i) === 2 && subject.name === "Inglés" && di % 4 === 0) status = "falta";
          else if (r < 0.03) status = "falta";
          else if (r < 0.07) status = "excusa";
          else if (r < 0.12) status = "tarde";
          attendanceRows.push({
            teacher_id: teacherId,
            course_subject_id: subject.id,
            enrollment_id: enrollment.id,
            attendance_date: date,
            status,
          });
        });
      });
    });
    await ins("attendance", attendanceRows);

    return { year, periods, courses, subjects, enrollments, activities, gradeCount: gradeRows.length, attCount: attendanceRows.length };
  }

  // ---- Año 2025 (se cierra al final: historial) -----------------------------
  const y25 = await buildYear({
    year: 2025,
    periodDates: [
      ["2025-01-27", "2025-04-04"],
      ["2025-04-07", "2025-06-13"],
      ["2025-07-07", "2025-09-19"],
      ["2025-09-22", "2025-11-21"],
    ],
    courseDefs: [
      { grade: "5°", order: 5 },
      { grade: "6°", order: 6 },
      { grade: "7°", order: 7 },
    ],
    // El repetidor estaba en 7° (índice 2); los demás en el grado anterior al de 2026.
    courseIdx: (i) => (i === REPEATER ? 2 : Math.floor(i / 10)),
    baseOf: (i) => (i === REPEATER ? 2.3 : baseOf[i]),
    includeGrade: () => true,
    classDates: (sIdx) => Array.from({ length: 8 }, (_, w) => addDays("2025-08-04", w * 14 + (sIdx % 5))),
    includeDate: () => true,
    heavyAbsence: false,
  });

  // ---- Año 2026 (en curso) ---------------------------------------------------
  const y26 = await buildYear({
    year: 2026,
    periodDates: [
      ["2026-01-26", "2026-04-02"],
      ["2026-04-06", "2026-06-12"],
      ["2026-07-06", "2026-09-18"],
      ["2026-09-21", "2026-11-20"],
    ],
    courseDefs: [
      { grade: "6°", order: 6 },
      { grade: "7°", order: 7 },
      { grade: "8°", order: 8 },
    ],
    courseIdx: (i) => Math.floor(i / 10),
    baseOf: (i) => baseOf[i],
    // Periodo 4 en curso: solo las 2 primeras actividades. El retirado: solo periodos 1-2.
    includeGrade: (i, period, k) => !(period === 4 && k > 1) && !(i === WITHDRAWN && period > 2),
    classDates: (sIdx) =>
      Array.from({ length: 15 }, (_, w) => addDays("2026-08-03", w * 7 + (sIdx % 5))).filter((d) => d <= "2026-11-13"),
    includeDate: (i, date) => !(i === WITHDRAWN && date >= "2026-09-10"),
    heavyAbsence: true,
  });

  // ---- Observador (2026) ---------------------------------------------------------
  await ins("observations", [
    {
      teacher_id: teacherId,
      student_id: students[WEAK].id,
      kind: "academico",
      note: "Bajo rendimiento en varias materias. Se cita al acudiente para acordar un plan de refuerzo.",
      commitment: "El acudiente se compromete a supervisar tareas en casa.",
      follow_up_on: "2026-11-10", // vencido: genera alerta de seguimiento
      observed_on: "2026-10-27",
      resolved: false,
    },
    {
      teacher_id: teacherId,
      student_id: students[1].id,
      kind: "convivencia",
      note: "Conversa constantemente durante las explicaciones. Se hace llamado de atención verbal.",
      observed_on: "2026-10-05",
      resolved: true,
    },
    {
      teacher_id: teacherId,
      student_id: students[STAR].id,
      kind: "otro",
      note: "Excelente desempeño y liderazgo. Se propone como monitor del curso.",
      observed_on: "2026-09-15",
      resolved: false,
    },
    {
      teacher_id: teacherId,
      student_id: students[REPEATER].id,
      kind: "compromiso",
      note: "Repite el grado. Se acuerda acompañamiento y entrega de tareas semanales.",
      commitment: "Reunión mensual con el acudiente.",
      follow_up_on: "2026-12-01",
      observed_on: "2026-02-10",
      resolved: false,
    },
    {
      teacher_id: teacherId,
      student_id: students[2].id,
      kind: "seguimiento",
      note: "Inasistencias frecuentes en Matemáticas e Inglés. Se llama al acudiente.",
      observed_on: "2026-10-20",
      resolved: false,
    },
  ]);

  // ---- Boletines ya enviados (periodos 1 y 2 de 6°A) --------------------------------
  const primaryGuardian = new Map(guardians.filter((g) => g.is_primary).map((g) => [g.student_id, g.id]));
  const sendRows = [];
  y26.enrollments.slice(0, 10).forEach((enrollment) => {
    for (const periodNumber of [1, 2]) {
      sendRows.push({
        teacher_id: teacherId,
        enrollment_id: enrollment.id,
        period_number: periodNumber,
        guardian_id: primaryGuardian.get(enrollment.student_id) ?? null,
        channel: "whatsapp_compartir",
      });
    }
  });
  await ins("bulletin_sends", sendRows);

  // ---- Cierres y retiro ------------------------------------------------------------
  // Periodos 1-3 de 2026 cerrados (el 4 sigue abierto).
  await db.from("periods").update({ status: "cerrado" }).eq("academic_year_id", y26.year.id).lte("number", 3);

  // Retiro en 2026.
  const { error: wError } = await db
    .from("enrollments")
    .update({
      status: "retirado",
      withdrawn_on: "2026-09-10",
      withdrawn_reason: "Traslado a otra institución",
      withdrawn_note: "Se trasladó con su familia a Bogotá.",
    })
    .eq("id", y26.enrollments[WITHDRAWN].id);
  if (wError) throw new Error(`retiro: ${wError.message}`);

  // Cierre de 2025: resultados, periodos y año congelados (queda como historial).
  await db.from("enrollments").update({ status: "aprobo" }).eq("academic_year_id", y25.year.id);
  await db.from("enrollments").update({ status: "perdio" }).eq("id", y25.enrollments[REPEATER].id);
  await db.from("periods").update({ status: "cerrado" }).eq("academic_year_id", y25.year.id);
  const { error: cError } = await db
    .from("academic_years")
    .update({ status: "cerrado", closed_at: "2025-12-05T12:00:00Z", fail_subjects_limit: 3 })
    .eq("id", y25.year.id);
  if (cError) throw new Error(`cierre 2025: ${cError.message}`);

  console.log("Datos de prueba creados:");
  console.log("  I.E. Santa María (Santa María, Huila)");
  console.log("  Año 2025 cerrado (historial, con 1 estudiante que repitió) y año 2026 en curso (periodos 1-3 cerrados)");
  console.log("  3 cursos por año · 15 materias por año · 30 estudiantes (algunos con 2 acudientes) · 1 retirado");
  console.log(
    `  ${y25.activities.length + y26.activities.length} actividades · ${y25.gradeCount + y26.gradeCount} notas · ${y25.attCount + y26.attCount} registros de asistencia · ${sendRows.length} boletines enviados`
  );
  console.log(`  ${photosUploaded} fotos de estudiantes cargadas.`);
  console.log(`
Entra con el usuario "${DEMO_USER}" y su contraseña de siempre (no se cambió).`);
} catch (error) {
  console.error("Falló, deshaciendo lo creado:", error.message);
  await db.from("grade_history").delete().eq("teacher_id", teacherId);
  await cleanTeacherData(teacherId);
  process.exit(1);
}
