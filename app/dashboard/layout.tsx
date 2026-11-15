import { requireProfile, signedMediaUrl } from "@/lib/auth";
import { Sidebar, type SidebarNavItem } from "@/components/sidebar";
import { BrandFooter } from "@/components/brand-footer";
import { darken, isHexColor } from "@/lib/theme";
import { unreadNotificationCount } from "@/lib/notifications";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const isSuperAdmin = profile.role === "super_admin";
  const [photoUrl, unread] = await Promise.all([
    signedMediaUrl(profile.photo_url),
    isSuperAdmin ? Promise.resolve(0) : unreadNotificationCount(),
  ]);
  const themeColor = isHexColor(profile.theme_color) ? profile.theme_color : null;

  const items: SidebarNavItem[] = isSuperAdmin
    ? [{ href: "/superadmin", label: "Docentes", icon: "superadmin" }]
    : [
        { href: "/dashboard", label: "Inicio", icon: "inicio" },
        { href: "/dashboard/notas", label: "Notas", icon: "notas" },
        { href: "/dashboard/asistencia", label: "Asistencia", icon: "asistencia" },
        { href: "/dashboard/estudiantes", label: "Estudiantes", icon: "estudiantes" },
        { href: "/dashboard/boletines", label: "Boletines", icon: "boletines" },
        { href: "/dashboard/notificaciones", label: "Notificaciones", icon: "notificaciones", badge: unread },
      ];
  items.push({ href: "/dashboard/cuenta", label: "Mi cuenta", icon: "cuenta" });

  return (
    <div className="flex min-h-screen">
      {themeColor && (
        <style>{`:root{--color-primary:${themeColor};--color-primary-dark:${darken(themeColor)};}`}</style>
      )}
      <div className="app-aurora" aria-hidden="true">
        <div className="app-aurora-grid" />
      </div>
      <Sidebar
        fullName={profile.full_name}
        roleLabel={isSuperAdmin ? "Super administrador" : "Docente"}
        items={items}
        photoUrl={photoUrl}
      />
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 pt-20 md:px-8 md:py-8 md:pt-8">
        <div className="mx-auto w-full max-w-6xl flex-1">{children}</div>
        <BrandFooter />
      </main>
    </div>
  );
}
