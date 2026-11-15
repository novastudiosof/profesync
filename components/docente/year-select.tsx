"use client";

import { useRouter } from "next/navigation";

import { selectClasses } from "@/components/action-form";

/** Selector compacto de año lectivo: al cambiarlo se recarga la página con ese año. */
export function YearSelect({
  options,
  value,
  basePath = "/dashboard",
}: {
  options: { id: string; label: string }[];
  value: string;
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-brand-muted">
      Año lectivo
      <select
        value={value}
        onChange={(e) => router.push(`${basePath}?year=${e.target.value}`)}
        className={selectClasses + " h-9 w-auto min-w-28 font-medium"}
        aria-label="Año lectivo"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
