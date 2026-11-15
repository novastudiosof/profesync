import { z } from "zod";

const limit = (label: string) =>
  z.coerce.number({ message: `${label} debe ser un número` }).int().min(0, `${label} no puede ser negativo`).max(100000);

export const createTeacherSchema = z.object({
  fullName: z.string().trim().min(3, "El nombre es obligatorio"),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,30}$/, "Usuario: 3 a 30 caracteres (letras, números, . _ -)"),
  password: z.string().min(8, "La contraseña debe tener mínimo 8 caracteres"),
  phone: z.string().trim().optional(),
  planExpiresAt: z.string().trim().optional(),
  maxInstitutions: limit("Instituciones"),
  maxCourses: limit("Cursos"),
  maxStudents: limit("Estudiantes"),
});

export const updateTeacherSchema = z.object({
  fullName: z.string().trim().min(3, "El nombre es obligatorio"),
  phone: z.string().trim().optional(),
  isActive: z.boolean(),
  planExpiresAt: z.string().trim().optional(),
  maxInstitutions: limit("Instituciones"),
  maxCourses: limit("Cursos"),
  maxStudents: limit("Estudiantes"),
});
