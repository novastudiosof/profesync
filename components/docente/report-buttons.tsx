import { Download, FileSpreadsheet } from "lucide-react";

type Report = {
  label: string;
  /** Tipo de reporte: notas-materia, notas-curso, notas-estudiante, asistencia-curso, asistencia-estudiante, resultados-anio. */
  tipo: string;
  params: Record<string, string>;
};

const buttonClass =
  "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm font-medium hover:bg-black/5";

/** Botones para bajar un reporte en Excel y en PDF (para subirlos a la plataforma oficial). */
export function ReportButtons({ reports }: { reports: Report[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {reports.map((report) => {
        const query = (formato: "xlsx" | "pdf") =>
          `/api/reportes/${report.tipo}?${new URLSearchParams({ ...report.params, formato }).toString()}`;
        return (
          <div key={report.tipo + report.label} className="flex items-center gap-2">
            <span className="text-xs text-brand-muted">{report.label}:</span>
            <a href={query("xlsx")} className={buttonClass}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </a>
            <a href={query("pdf")} className={buttonClass}>
              <Download className="h-4 w-4" /> PDF
            </a>
          </div>
        );
      })}
    </div>
  );
}
