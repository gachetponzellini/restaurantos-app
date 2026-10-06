import { z } from "zod";

// Helpers y schemas compartidos del login de cliente. Viven fuera de
// `customer-auth.ts` porque ese archivo es `"use server"` y un módulo de
// Server Actions solo puede exportar funciones async — no helpers sync ni
// schemas. Acá se pueden importar tanto del server como de tests/cliente.

/**
 * H-02 — un `next` es seguro sólo si es un path same-origin. Rechaza `//`,
 * `/\\` (el navegador normaliza `\` a `/`, así que `/\evil` termina siendo
 * `//evil`), backslashes en cualquier posición, caracteres de control (tab,
 * CR, LF y NUL que el parser de URLs elimina) y esquemas.
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return false;
  try {
    return new URL(next, "http://x").origin === "http://x";
  } catch {
    return false;
  }
}

export function safeNextPath(
  next: string | null | undefined,
  slug: string,
): string {
  return isSafeNextPath(next) ? next : `/${slug}/menu`;
}

export const SignInCustomerInput = z.object({
  business_slug: z.string().min(1),
  email: z.string().email("Ingresá un email válido."),
  password: z.string().min(1, "Ingresá tu contraseña."),
  next: z.string().optional(),
});

export const SignUpCustomerInput = z.object({
  business_slug: z.string().min(1),
  email: z.string().email("Ingresá un email válido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
  phone: z
    .string()
    .min(1, "Ingresá un teléfono válido.")
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length >= 8, "Ingresá un teléfono válido."),
  next: z.string().optional(),
});
