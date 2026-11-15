import { redirect } from "next/navigation";

// Los cursos ahora se ven dentro de cada institución (Inicio → institución).
export default function CursosPage() {
  redirect("/dashboard");
}
