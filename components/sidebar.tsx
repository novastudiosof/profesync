"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  School,
  ShieldCheck,
  User,
  Users,
  X,
  BookOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  href: string;
  label: string;
  icon:
    | "inicio"
    | "instituciones"
    | "cursos"
    | "estudiantes"
    | "notas"
    | "asistencia"
    | "boletines"
    | "notificaciones"
    | "cuenta"
    | "superadmin";
  /** Contador que se muestra como globo (p. ej. notificaciones sin leer). */
  badge?: number;
}

const ICONS = {
  inicio: LayoutDashboard,
  instituciones: School,
  cursos: BookOpen,
  estudiantes: Users,
  notas: ClipboardList,
  asistencia: CalendarCheck,
  boletines: FileText,
  notificaciones: Bell,
  cuenta: User,
  superadmin: ShieldCheck,
};

interface SidebarProps {
  fullName: string;
  roleLabel: string;
  items: SidebarNavItem[];
  /** URL firmada de la foto del docente (null = iniciales). */
  photoUrl: string | null;
}

function Avatar({ name, photoUrl, size }: { name: string; photoUrl: string | null; size: number }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const style = { width: size, height: size };
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt={name} style={style} className="shrink-0 rounded-full bg-white object-cover" />
  ) : (
    <span
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-ink"
    >
      {initials || <GraduationCap className="h-4 w-4" />}
    </span>
  );
}

export function Sidebar({ fullName, roleLabel, items, photoUrl }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const content = (
    <div className="flex h-full flex-col bg-brand-ink text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <Image src="/brand/logo-icon.svg" alt="ProfeSync" width={40} height={40} className="h-10 w-10 rounded-xl" />
        <p className="text-lg font-semibold tracking-tight">ProfeSync</p>
      </div>

      <Link
        href="/dashboard/cuenta"
        onClick={() => setOpen(false)}
        className="flex items-center gap-3 border-b border-white/10 px-5 py-4 hover:bg-white/5"
      >
        <Avatar name={fullName} photoUrl={photoUrl} size={52} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{fullName}</p>
          <p className="text-xs text-white/60">{roleLabel}</p>
        </div>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard" ||
                pathname.startsWith("/dashboard/instituciones") ||
                pathname.startsWith("/dashboard/cursos") ||
                pathname.startsWith("/dashboard/cierre")
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-brand-sm)] px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-brand font-medium text-brand-ink"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.badge ? (
                <span className="ml-auto rounded-full bg-brand-danger px-2 py-0.5 text-[11px] font-semibold text-white">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-white/70 hover:text-white">
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-brand-ink px-4 py-2 text-white md:hidden">
        <div className="flex items-center gap-2">
          <Image src="/brand/logo-icon.svg" alt="ProfeSync" width={36} height={36} className="h-9 w-9 rounded-lg" />
          <span className="font-semibold">ProfeSync</span>
        </div>
        <div className="flex items-center gap-3">
          <Avatar name={fullName} photoUrl={photoUrl} size={34} />
          <button onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Fijo: el nombre y "Cerrar sesión" siempre quedan a la vista aunque la página sea larga. */}
      <aside className="hidden w-64 shrink-0 md:block">
        <div className="sticky top-0 h-screen">{content}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 text-white" aria-label="Cerrar menú">
              <X className="h-5 w-5" />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
