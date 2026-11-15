import "server-only";

import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { createClient } from "@/lib/supabase/server";
import { loadCourseBulletins } from "@/lib/boletin-data";
import { loadClosingData } from "@/lib/cierre-data";
import { computeResults, loadSubjectContext } from "@/lib/notas-data";
import { gradeMap, performanceLabel, periodGrade } from "@/lib/grades";
import { loadWithdrawalReport } from "@/lib/retiro-data";
import type { Attendance, AttendanceStatus, Course, CourseSubject, Enrollment, Student } from "@/lib/supabase/types";

// ==========================================================================
// Modelo común: un reporte = encabezado + secciones (tablas). De ahí salen el
// PDF y el Excel, así los dos formatos siempre muestran lo mismo.
// ==========================================================================
type Cell = string | number | null;

export type ReportSection = {
  /** Nombre de la hoja de Excel y título de la tabla en el PDF. */
  heading: string;
  head: string[];
  rows: Cell[][];
  /** Columnas de notas (rango de índices) que se pintan en rojo si están por debajo de `pass`. */
  gradeCols?: { from: number; to: number; pass: number };
  /** Desde esta columna se centra el contenido. */
  centerFrom?: number;
};

export type ReportDoc = {
  fileBase: string;
  institution: string;
  title: string;
  subtitle: string;
  teacher: string;
  sections: ReportSection[];
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  presente: "Presente",
  tarde: "Tardanza",
  excusa: "Excusa",
  falta: "Falta",
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-CO", { weekday: "long", timeZone: "UTC" });

const numberOr = (value: number | null | undefined): Cell => (value === null || value === undefined ? "" : value);

// ==========================================================================
// Cargadores de cada tipo de reporte
// ==========================================================================
export type ReportParams = Record<string, string | undefined>;

export async function loadReport(tipo: string, p: ReportParams, teacherName: string): Promise<ReportDoc | null> {
  switch (tipo) {
    case "notas-materia":
      return p.subject ? notasMateria(p.subject, teacherName) : null;
    case "notas-curso":
      return p.course ? notasCurso(p.course, p.period ?? "final", teacherName) : null;
    case "notas-estudiante":
      return p.enrollment ? notasEstudiante(p.enrollment, teacherName) : null;
    case "asistencia-curso":
      return p.course ? asistenciaCurso(p.course, teacherName) : null;
    case "asistencia-estudiante":
      return p.enrollment ? asistenciaEstudiante(p.enrollment, teacherName) : null;
    case "resultados-anio":
      return p.year ? resultadosAnio(p.year, teacherName) : null;
    default:
      return null;
  }
}

async function notasMateria(subjectId: string, teacher: string): Promise<ReportDoc | null> {
  const ctx = await loadSubjectContext(subjectId);
  if (!ctx) return null;
  const { scale_min: min, scale_max: max, pass_grade: pass } = ctx.year;

  const sections: ReportSection[] = ctx.periods.map((period) => {
    const acts = ctx.activities.filter((a) => a.period_id === period.id);
    return {
      heading: period.name,
      head: ["#", "Estudiante", "Documento", ...acts.map((a) => `${a.name} (${a.weight}%)`), "Nota del periodo"],
      rows: ctx.roster.map((r, i) => {
        const mine = gradeMap(ctx.grades.filter((g) => g.enrollment_id === r.enrollment.id));
        return [
          i + 1,
          `${r.student.last_name} ${r.student.first_name}`,
          r.student.document_number ?? "",
          ...acts.map((a) => numberOr(mine.get(a.id))),
          numberOr(periodGrade(acts, mine).value),
        ];
      }),
      gradeCols: { from: 3, to: 3 + acts.length, pass },
      centerFrom: 3,
    };
  });

  sections.push({
    heading: "Definitivas",
    head: ["#", "Estudiante", "Documento", ...ctx.periods.map((p) => `P${p.number}`), "Nota final", "Desempeño"],
    rows: computeResults(ctx).map((r, i) => [
      i + 1,
      `${r.row.student.last_name} ${r.row.student.first_name}`,
      r.row.student.document_number ?? "",
      ...ctx.periods.map((p) => numberOr(r.periodGrades.get(p.number))),
      numberOr(r.final),
      performanceLabel(r.final, min, max, pass),
    ]),
    gradeCols: { from: 3, to: 3 + ctx.periods.length, pass },
    centerFrom: 3,
  });

  return {
    fileBase: `Notas ${ctx.course.grade}${ctx.course.section} ${ctx.subject.name} ${ctx.year.year}`,
    institution: ctx.institution?.name ?? "",
    title: `Notas de ${ctx.subject.name}`,
    subtitle: `${ctx.course.grade} ${ctx.course.section} · Año ${ctx.year.year} · escala ${min}–${max} · aprueba con ${pass}`,
    teacher,
    sections,
  };
}

async function notasCurso(courseId: string, periodParam: string, teacher: string): Promise<ReportDoc | null> {
  const periodNumber = periodParam === "final" ? null : Number(periodParam);
  if (periodNumber !== null && !(periodNumber > 0)) return null;
  const data = await loadCourseBulletins(courseId, periodNumber);
  if (!data) return null;
  const subjectNames = data.students[0]?.rows.map((r) => r.subject) ?? [];

  return {
    fileBase: `Consolidado ${data.courseLabel} ${data.periodLabel} ${data.year}`,
    institution: data.institution,
    title: `Consolidado de notas — ${data.periodLabel}`,
    subtitle: `${data.courseLabel} · Año ${data.year} · aprueba con ${data.scale.pass}`,
    teacher,
    sections: [
      {
        heading: "Consolidado",
        head: ["#", "Estudiante", "Documento", ...subjectNames, "Promedio", "Faltas"],
        rows: data.students.map((s, i) => [
          i + 1,
          s.name,
          s.document ?? "",
          ...s.rows.map((r) => numberOr(r.grade)),
          numberOr(s.average),
          s.rows.reduce((sum, r) => sum + r.absences, 0),
        ]),
        gradeCols: { from: 3, to: 3 + subjectNames.length, pass: data.scale.pass },
        centerFrom: 3,
      },
    ],
  };
}

async function notasEstudiante(enrollmentId: string, teacher: string): Promise<ReportDoc | null> {
  const data = await loadWithdrawalReport(enrollmentId, teacher);
  if (!data) return null;
  const periodLabels = data.subjects[0]?.periods.map((p) => p.label) ?? [];
  return {
    fileBase: `Notas ${data.student.name} ${data.year}`,
    institution: data.institution,
    title: `Notas de ${data.student.name}`,
    subtitle: `${data.courseLabel} · Año ${data.year}${data.student.document ? ` · Documento ${data.student.document}` : ""}`,
    teacher,
    sections: [
      {
        heading: "Notas por materia",
        head: ["Materia", ...periodLabels, "Definitiva", "Desempeño", "Faltas", "Excusas", "Tardanzas"],
        rows: data.subjects.map((s) => [
          s.name,
          ...s.periods.map((p) => numberOr(p.grade)),
          numberOr(s.final),
          s.performance,
          s.absences,
          s.excuses,
          s.late,
        ]),
        gradeCols: { from: 1, to: 1 + periodLabels.length, pass: data.pass },
        centerFrom: 1,
      },
    ],
  };
}

async function asistenciaEstudiante(enrollmentId: string, teacher: string): Promise<ReportDoc | null> {
  const supabase = await createClient();
  const { data: enrollmentData } = await supabase.from("enrollments").select("*").eq("id", enrollmentId).maybeSingle();
  if (!enrollmentData) return null;
  const enrollment = enrollmentData as Enrollment;

  const [{ data: studentData }, { data: courseData }, { data: yearData }, { data: attData }] = await Promise.all([
    supabase.from("students").select("*").eq("id", enrollment.student_id).maybeSingle(),
    supabase.from("courses").select("*").eq("id", enrollment.course_id).maybeSingle(),
    supabase.from("academic_years").select("*").eq("id", enrollment.academic_year_id).maybeSingle(),
    supabase.from("attendance").select("*").eq("enrollment_id", enrollmentId).order("attendance_date", { ascending: false }),
  ]);
  if (!studentData || !courseData || !yearData) return null;
  const student = studentData as Student;
  const course = courseData as Course;
  const attendance = (attData ?? []) as Attendance[];

  const [{ data: instData }, { data: subjectData }] = await Promise.all([
    supabase.from("institutions").select("name").eq("id", yearData.institution_id).maybeSingle(),
    supabase.from("course_subjects").select("*").eq("course_id", course.id),
  ]);
  const subjects = (subjectData ?? []) as CourseSubject[];
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? "Materia";
  const count = (subjectId: string, status: AttendanceStatus) =>
    attendance.filter((a) => a.course_subject_id === subjectId && a.status === status).length;

  return {
    fileBase: `Asistencia ${student.first_name} ${student.last_name} ${yearData.year}`,
    institution: instData?.name ?? "",
    title: `Asistencia de ${student.first_name} ${student.last_name}`,
    subtitle: `${course.grade} ${course.section} · Año ${yearData.year}`,
    teacher,
    sections: [
      {
        heading: "Resumen por materia",
        head: ["Materia", "Presente", "Faltas", "Excusas", "Tardanzas"],
        rows: [...subjects]
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
          .map((s) => [s.name, count(s.id, "presente"), count(s.id, "falta"), count(s.id, "excusa"), count(s.id, "tarde")]),
        centerFrom: 1,
      },
      {
        heading: "Detalle por fecha",
        head: ["Fecha", "Día", "Materia", "Estado"],
        rows: attendance
          .filter((a) => a.status !== "presente")
          .map((a) => [fmtDate(a.attendance_date), weekday(a.attendance_date), subjectName(a.course_subject_id), STATUS_LABEL[a.status]]),
      },
    ],
  };
}

async function asistenciaCurso(courseId: string, teacher: string): Promise<ReportDoc | null> {
  const supabase = await createClient();
  const { data: courseData } = await supabase.from("courses").select("*").eq("id", courseId).is("deleted_at", null).maybeSingle();
  if (!courseData) return null;
  const course = courseData as Course;

  const [{ data: yearData }, { data: subjectData }, { data: enrollData }] = await Promise.all([
    supabase.from("academic_years").select("*").eq("id", course.academic_year_id).single(),
    supabase.from("course_subjects").select("*").eq("course_id", courseId).is("deleted_at", null).order("name"),
    supabase.from("enrollments").select("*").eq("course_id", courseId).in("status", ["activa", "aprobo", "perdio"]),
  ]);
  if (!yearData) return null;
  const subjects = (subjectData ?? []) as CourseSubject[];
  const enrollments = (enrollData ?? []) as Enrollment[];
  const subjectIds = subjects.map((s) => s.id);

  const [{ data: instData }, { data: studentData }, { data: attData }] = await Promise.all([
    supabase.from("institutions").select("name").eq("id", yearData.institution_id).maybeSingle(),
    enrollments.length
      ? supabase.from("students").select("*").in("id", enrollments.map((e) => e.student_id))
      : Promise.resolve({ data: [] }),
    subjectIds.length ? supabase.from("attendance").select("*").in("course_subject_id", subjectIds) : Promise.resolve({ data: [] }),
  ]);
  const students = new Map(((studentData ?? []) as Student[]).map((s) => [s.id, s]));
  const attendance = (attData ?? []) as Attendance[];

  const roster = enrollments
    .map((e) => ({ enrollment: e, student: students.get(e.student_id) }))
    .filter((r): r is { enrollment: Enrollment; student: Student } => !!r.student)
    .sort((a, b) =>
      `${a.student.last_name} ${a.student.first_name}`.localeCompare(`${b.student.last_name} ${b.student.first_name}`, "es")
    );
  const name = (s: Student) => `${s.last_name} ${s.first_name}`;
  const mine = (enrollmentId: string, status?: AttendanceStatus) =>
    attendance.filter((a) => a.enrollment_id === enrollmentId && (!status || a.status === status));

  const faltas: Cell[][] = [];
  for (const r of roster) {
    for (const a of mine(r.enrollment.id, "falta").sort((x, y) => x.attendance_date.localeCompare(y.attendance_date))) {
      faltas.push([name(r.student), subjects.find((s) => s.id === a.course_subject_id)?.name ?? "", fmtDate(a.attendance_date)]);
    }
  }

  return {
    fileBase: `Asistencia ${course.grade}${course.section} ${yearData.year}`,
    institution: instData?.name ?? "",
    title: "Asistencia del curso",
    subtitle: `${course.grade} ${course.section} · Año ${yearData.year}`,
    teacher,
    sections: [
      {
        heading: "Resumen",
        head: ["#", "Estudiante", "Faltas", "Excusas", "Tardanzas", ...subjects.map((s) => `Faltas ${s.name}`)],
        rows: roster.map((r, i) => [
          i + 1,
          name(r.student),
          mine(r.enrollment.id, "falta").length,
          mine(r.enrollment.id, "excusa").length,
          mine(r.enrollment.id, "tarde").length,
          ...subjects.map(
            (s) => attendance.filter((a) => a.enrollment_id === r.enrollment.id && a.course_subject_id === s.id && a.status === "falta").length
          ),
        ]),
        centerFrom: 2,
      },
      { heading: "Detalle de faltas", head: ["Estudiante", "Materia", "Fecha"], rows: faltas },
    ],
  };
}

async function resultadosAnio(yearId: string, teacher: string): Promise<ReportDoc | null> {
  const data = await loadClosingData(yearId);
  if (!data) return null;
  const pass = Number(data.year.pass_grade);
  const label: Record<string, string> = { activa: "Cursando", aprobo: "Aprobó", perdio: "Perdió", retirado: "Retirado" };
  const nextLabel = (id: string | null) => {
    const c = data.nextCourses.find((course) => course.id === id);
    return c ? `${c.grade} ${c.section} (${data.year.year + 1})` : "";
  };

  const courseLabels = [...new Set(data.rows.map((r) => r.courseLabel))];
  const sections: ReportSection[] = courseLabels.map((courseLabel) => {
    const rows = data.rows.filter((r) => r.courseLabel === courseLabel);
    const subjectNames = rows[0]?.subjects.map((s) => s.name) ?? [];
    return {
      heading: courseLabel,
      head: ["#", "Estudiante", ...subjectNames, "Perdidas", "Resultado", "Pasa a"],
      rows: rows.map((r, i) => [
        i + 1,
        r.name,
        ...r.subjects.map((s) => numberOr(s.final)),
        r.lost,
        label[r.status],
        nextLabel(r.nextCourseId),
      ]),
      gradeCols: { from: 2, to: 2 + subjectNames.length, pass },
      centerFrom: 2,
    };
  });

  return {
    fileBase: `Resultados ${data.year.year}`,
    institution: data.institution?.name ?? "",
    title: data.year.status === "cerrado" ? `Resultados finales del año ${data.year.year}` : `Resultados parciales del año ${data.year.year}`,
    subtitle: `Definitivas por materia · aprueba con ${pass}${data.withdrawnCount ? ` · ${data.withdrawnCount} retirado(s) no incluidos` : ""}`,
    teacher,
    sections,
  };
}

// ==========================================================================
// Excel
// ==========================================================================
const sheetName = (name: string, used: Set<string>) => {
  let base = name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Hoja";
  let n = 2;
  while (used.has(base.toLowerCase())) base = `${base.slice(0, 28)} ${n++}`;
  used.add(base.toLowerCase());
  return base;
};

export async function buildXlsx(doc: ReportDoc): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProfeSync";
  const used = new Set<string>();
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

  for (const section of doc.sections) {
    const sheet = workbook.addWorksheet(sheetName(section.heading, used));
    sheet.addRow([doc.institution]).font = { bold: true, size: 14 };
    sheet.addRow([doc.title]).font = { bold: true, size: 12 };
    sheet.addRow([`${doc.subtitle} — ${section.heading}`]);
    sheet.addRow([]);
    const header = sheet.addRow(section.head);
    header.font = { bold: true };
    header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    header.eachCell((cell) => {
      cell.fill = headerFill;
      cell.border = { bottom: { style: "thin" } };
    });
    const headerRowNumber = header.number;

    for (const cells of section.rows) {
      const row = sheet.addRow(cells.map((c) => (c === null ? "" : c)));
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const index = col - 1;
        if (section.centerFrom !== undefined && index >= section.centerFrom) cell.alignment = { horizontal: "center" };
        if (section.gradeCols && index >= section.gradeCols.from && index < section.gradeCols.to) {
          if (typeof cell.value === "number" && cell.value < section.gradeCols.pass) cell.font = { color: { argb: "FFC0392B" } };
        }
      });
    }

    section.head.forEach((title, i) => {
      const longest = Math.max(title.length, ...section.rows.map((r) => String(r[i] ?? "").length));
      sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 3, i === 0 && title === "#" ? 5 : 10), 44);
    });
    sheet.views = [{ state: "frozen", ySplit: headerRowNumber }];

    const footer = sheet.addRow([]);
    footer.getCell(1).value = `Docente: ${doc.teacher} · Generado con ProfeSync`;
    footer.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

// ==========================================================================
// PDF (se arma en el servidor con jsPDF; helvetica incluye tildes y ñ)
// ==========================================================================
export function buildPdf(doc: ReportDoc): ArrayBuffer {
  const wide = Math.max(...doc.sections.map((s) => s.head.length)) > 7;
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: wide ? "landscape" : "portrait" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 36;
  let y = 44;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(doc.institution || "ProfeSync", margin, y);
  y += 18;
  pdf.setFontSize(12);
  pdf.text(doc.title, margin, y);
  y += 15;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  pdf.text(doc.subtitle, margin, y);
  pdf.setTextColor(0);
  y += 16;

  for (const section of doc.sections) {
    if (y > height - 90) {
      pdf.addPage();
      y = 44;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(section.heading, margin, y + 6);

    autoTable(pdf, {
      startY: y + 12,
      head: [section.head],
      body: section.rows.length ? section.rows.map((r) => r.map((c) => (c === null ? "" : String(c)))) : [["Sin registros"]],
      margin: { left: margin, right: margin, bottom: 40 },
      styles: { fontSize: wide ? 8 : 9, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [31, 41, 55], halign: "center" },
      didParseCell: (hook) => {
        const index = hook.column.index;
        if (hook.section === "body" || hook.section === "head") {
          if (section.centerFrom !== undefined && index >= section.centerFrom) hook.cell.styles.halign = "center";
        }
        if (hook.section === "body" && section.gradeCols) {
          const { from, to, pass } = section.gradeCols;
          const value = Number(hook.cell.raw);
          if (index >= from && index < to && hook.cell.raw !== "" && Number.isFinite(value) && value < pass) {
            hook.cell.styles.textColor = [192, 57, 43];
          }
        }
      },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  }

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text(`Docente: ${doc.teacher} · Generado con ProfeSync`, margin, height - 22);
    pdf.text(`Página ${i} de ${pages}`, width - margin, height - 22, { align: "right" });
  }
  return pdf.output("arraybuffer");
}
