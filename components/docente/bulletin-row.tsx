"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Loader2, MessageCircle } from "lucide-react";

import { StudentAvatar } from "@/components/docente/student-avatar";
import { recordBulletinSend } from "@/lib/actions/boletines";
import { buildBulletinPdf, type PdfBulletin } from "@/lib/boletin-pdf";

type Guardian = { id: string; name: string; relationship: string | null; whatsapp: string | null };

export type BulletinRowProps = {
  enrollmentId: string;
  periodNumber: number | null;
  /** Nombre para mostrar en la lista ("Apellidos Nombres"); student.name es "Nombres Apellidos". */
  listName: string;
  student: PdfBulletin["student"];
  photoUrl: string | null;
  guardians: Guardian[];
  sentAt: string | null;
  header: Omit<PdfBulletin, "student" | "observation" | "photoUrl">;
  readOnly: boolean;
};

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function BulletinRow({ enrollmentId, periodNumber, listName, student, photoUrl, guardians, sentAt, header, readOnly }: BulletinRowProps) {
  const router = useRouter();
  const [guardianId, setGuardianId] = React.useState(guardians[0]?.id ?? "");
  const [observation, setObservation] = React.useState("");
  const [busy, setBusy] = React.useState<"pdf" | "wa" | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const guardian = guardians.find((g) => g.id === guardianId) ?? null;
  // Nombre del estudiante en el mensaje: "Nombres Apellidos" (name viene "Apellidos Nombres").
  const studentLabel = student.name;

  const makePdf = () => buildBulletinPdf({ ...header, student, observation, photoUrl });

  async function download() {
    setBusy("pdf");
    setMessage(null);
    try {
      const file = await makePdf();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      if (!readOnly) {
        await recordBulletinSend({ enrollmentId, periodNumber, guardianId: guardian?.id ?? null, channel: "descarga" });
        router.refresh();
      }
    } catch {
      setMessage("No se pudo generar el PDF");
    } finally {
      setBusy(null);
    }
  }

  async function sendWhatsapp() {
    setBusy("wa");
    setMessage(null);
    try {
      const file = await makePdf();
      const greeting = guardian ? `Hola ${firstName(guardian.name)}` : "Hola";
      const text = `${greeting}, este es el boletín de ${studentLabel} correspondiente a ${header.periodLabel}.`;

      let channel: "whatsapp_compartir" | "whatsapp_enlace" = "whatsapp_enlace";
      const canShareFile = typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [file] });

      if (canShareFile) {
        // Celular: el menú de compartir del teléfono lleva el PDF adjunto; el docente elige WhatsApp.
        try {
          await navigator.share({ files: [file], text });
          channel = "whatsapp_compartir";
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return; // canceló
          throw error;
        }
      } else {
        // Computador: se descarga el PDF y se abre WhatsApp con el mensaje; el docente adjunta el archivo.
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        const phone = guardian?.whatsapp?.replace(/\D/g, "") ?? "";
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
        setMessage("PDF descargado. Adjúntalo en la conversación de WhatsApp que se abrió.");
      }

      if (!readOnly) {
        await recordBulletinSend({ enrollmentId, periodNumber, guardianId: guardian?.id ?? null, channel });
        router.refresh();
      }
    } catch {
      setMessage("No se pudo preparar el envío");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <StudentAvatar name={student.name} url={photoUrl} size={44} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-brand-ink">{listName}</p>
            <p className="text-xs text-brand-muted">
              Promedio: <strong>{student.average ?? "—"}</strong>
              {sentAt && <span className="ml-2 text-brand-success">· Enviado {sentAt}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={download}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-brand-sm)] border border-brand-border px-3 text-sm font-medium hover:bg-black/5 disabled:opacity-50"
          >
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            PDF
          </button>
          <a
            href={`/api/reportes/notas-estudiante?enrollment=${enrollmentId}&formato=xlsx`}
            title="Notas de todas las materias y periodos en Excel"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-brand-sm)] border border-brand-border px-3 text-sm font-medium hover:bg-black/5"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </a>
          <button
            onClick={sendWhatsapp}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-brand-sm)] bg-[#25D366] px-3 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50"
          >
            {busy === "wa" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Enviar por WhatsApp
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-brand-muted">
          Enviar a
          {guardians.length === 0 ? (
            <span className="rounded border border-dashed border-brand-border px-3 py-2 text-sm font-normal text-brand-danger">
              Sin acudiente registrado (se abrirá WhatsApp sin número)
            </span>
          ) : (
            <select
              value={guardianId}
              onChange={(e) => setGuardianId(e.target.value)}
              className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm font-normal text-brand-ink"
            >
              {guardians.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.relationship ? ` (${g.relationship})` : ""} — {g.whatsapp ? `+${g.whatsapp}` : "sin WhatsApp"}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-brand-muted">
          Observación para el boletín (opcional)
          <input
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm font-normal text-brand-ink"
          />
        </label>
      </div>
      {message && <p className="text-xs text-brand-muted">{message}</p>}
    </li>
  );
}
