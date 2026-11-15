import { redirect } from "next/navigation";

// Las instituciones y sus años se manejan desde Inicio.
export default function InstitucionesPage() {
  redirect("/dashboard");
}
