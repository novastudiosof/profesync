import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { buildPdf, buildXlsx, loadReport } from "@/lib/reportes";

export const runtime = "nodejs";

const asciiName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w .-]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "reporte";

/**
 * Reportes descargables en PDF o Excel:
 * /api/reportes/<tipo>?formato=pdf|xlsx&subject=|course=|enrollment=|year=|period=
 * Tipos: notas-materia, notas-curso, notas-estudiante, asistencia-curso,
 * asistencia-estudiante, resultados-anio. Solo ve lo del propio docente (RLS).
 */
export async function GET(request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "teacher") return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { tipo } = await params;
  const url = new URL(request.url);
  const formato = url.searchParams.get("formato") === "xlsx" ? "xlsx" : "pdf";
  const query = Object.fromEntries(url.searchParams.entries());

  const doc = await loadReport(tipo, query, profile.full_name);
  if (!doc) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });

  const fileName = `${asciiName(doc.fileBase)}.${formato}`;
  const body = formato === "xlsx" ? await buildXlsx(doc) : buildPdf(doc);

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
