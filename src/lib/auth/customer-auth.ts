"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import {
  safeNextPath,
  SignInCustomerInput,
  SignUpCustomerInput,
} from "@/lib/auth/customer-auth-shared";
import { limitLogin } from "@/lib/rate-limit";
import { clientIpFromForwarded } from "@/lib/rrhh/ip-allowlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────────
// SPEC 25 (PENDING) — Verificación por WhatsApp DESACTIVADA.
// Los imports y las actions de verificación quedan comentados hasta aprobar
// el template "authentication" en Meta y reactivar el flujo. Ver más abajo.
// import { requestPhoneCode, verifyPhoneCode } from "@/lib/auth/phone-verification";
// import { getBusiness } from "@/lib/tenant";
// ─────────────────────────────────────────────────────────────────────

const DEMASIADOS_INTENTOS =
  "Demasiados intentos. Esperá un minuto y probá de nuevo.";

/** Resultado del alta cuando Confirm email está activo (sin sesión todavía). */
export type SignUpPendingConfirmation = {
  status: "confirm_email";
  email: string;
};

// H-04: `error.code` de Supabase Auth → mensaje claro para el cliente.
const SIGNUP_ERROR_MESSAGES: Record<string, string> = {
  email_address_invalid: "Ese email no es válido.",
  weak_password:
    "La contraseña es muy débil. Probá con una más larga o con otros caracteres.",
  over_email_send_rate_limit: "Demasiados intentos, probá en unos minutos.",
  over_request_rate_limit: "Demasiados intentos, probá en unos minutos.",
};

// H-05: mismo techo por IP que el login del staff (`sign-in.ts`). Va antes de
// tocar Supabase Auth.
async function checkAuthRateLimit(): Promise<boolean> {
  const h = await headers();
  const ip = clientIpFromForwarded(h.get("x-forwarded-for"));
  const { success } = await limitLogin(ip ?? "unknown");
  return success;
}

export async function signInCustomer(
  input: unknown,
): Promise<ActionResult<never>> {
  const parsed = SignInCustomerInput.safeParse(input);
  if (!parsed.success)
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  if (!(await checkAuthRateLimit())) return actionError(DEMASIADOS_INTENTOS);

  const { business_slug, email, password, next } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return actionError("Email o contraseña incorrectos.");

  redirect(safeNextPath(next, business_slug));
}

export async function signUpCustomer(
  input: unknown,
): Promise<ActionResult<SignUpPendingConfirmation>> {
  const parsed = SignUpCustomerInput.safeParse(input);
  if (!parsed.success)
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  if (!(await checkAuthRateLimit())) return actionError(DEMASIADOS_INTENTOS);

  const { business_slug, email, password, phone, next } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { phone } },
  });

  if (error) {
    const code = (error as { code?: string }).code;
    console.error("[signUpCustomer] signUp falló", code ?? "sin_code");
    return actionError(
      (code && SIGNUP_ERROR_MESSAGES[code]) ||
        "No pudimos completar la operación, probá de nuevo.",
    );
  }

  if (!data.session) {
    // Email ya registrado: Supabase no lo delata con un error, devuelve un
    // user "ofuscado" con `identities` vacías.
    if (data.user?.identities?.length === 0) {
      return actionError("Ya existe una cuenta con ese email. Probá ingresar.");
    }
    // Confirm email activo: alta válida, falta que confirme el mail.
    return actionOk({ status: "confirm_email", email });
  }

  // ─── SPEC 25 (PENDING) — disparo de verificación por WhatsApp, desactivado ───
  // Cuando se reactive: tras el alta, encolar el código y redirigir al paso de
  // verificación si se envió; degradar a /menu si el negocio no tiene WhatsApp.
  //
  // const safeNext = safeNextPath(next, business_slug);
  // const business = await getBusiness(business_slug);
  // if (business) {
  //   const sentResult = await requestPhoneCode({
  //     userId: data.user!.id,
  //     businessId: business.id,
  //     phone,
  //   });
  //   if (sentResult.sent) {
  //     redirect(
  //       `/${business_slug}/verificar?next=${encodeURIComponent(safeNext)}`,
  //     );
  //   }
  // }
  // redirect(safeNext);
  // ─────────────────────────────────────────────────────────────────────────

  redirect(safeNextPath(next, business_slug));
}

// ═══════════════════════════════════════════════════════════════════════
// SPEC 25 (PENDING) — Actions de verificación de código por WhatsApp.
// Desactivadas hasta aprobar el template "authentication" en Meta. Preservadas
// (comentadas) para reactivar el flujo sin reescribirlo.
// ═══════════════════════════════════════════════════════════════════════
//
// export const VerifyPhoneCodeInput = z.object({
//   business_slug: z.string().min(1),
//   code: z
//     .string()
//     .transform((v) => v.replace(/\D/g, ""))
//     .refine((v) => v.length === 6, "Ingresá los 6 dígitos del código."),
//   next: z.string().optional(),
// });
//
// const VERIFY_ERRORS: Record<string, string> = {
//   mismatch: "Código incorrecto.",
//   expired: "El código expiró, pedí uno nuevo.",
//   no_code: "El código expiró, pedí uno nuevo.",
//   max_attempts: "Demasiados intentos. Pedí un código nuevo.",
//   consumed: "Ese código ya se usó. Pedí uno nuevo.",
// };
//
// export async function verifyPhoneCodeAction(
//   input: unknown,
// ): Promise<ActionResult<never>> {
//   const parsed = VerifyPhoneCodeInput.safeParse(input);
//   if (!parsed.success)
//     return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
//
//   const { business_slug, code, next } = parsed.data;
//   const supabase = await createSupabaseServerClient();
//   const {
//     data: { user },
//   } = await supabase.auth.getUser();
//   if (!user) return actionError("Tu sesión expiró. Ingresá de nuevo.");
//
//   const result = await verifyPhoneCode({ userId: user.id, code });
//   if (!result.ok) {
//     return actionError(
//       VERIFY_ERRORS[result.reason] ??
//         "No pudimos verificar el código, probá de nuevo.",
//     );
//   }
//
//   redirect(safeNextPath(next, business_slug));
// }
//
// export const ResendPhoneCodeInput = z.object({
//   business_slug: z.string().min(1),
// });
//
// export async function resendPhoneCodeAction(
//   input: unknown,
// ): Promise<ActionResult<null>> {
//   const parsed = ResendPhoneCodeInput.safeParse(input);
//   if (!parsed.success) return actionError("Datos inválidos.");
//
//   const { business_slug } = parsed.data;
//   const supabase = await createSupabaseServerClient();
//   const {
//     data: { user },
//   } = await supabase.auth.getUser();
//   if (!user) return actionError("Tu sesión expiró. Ingresá de nuevo.");
//
//   const phone = (user.user_metadata?.phone as string | undefined) ?? "";
//   if (!phone) return actionError("No encontramos tu teléfono. Ingresá de nuevo.");
//
//   const business = await getBusiness(business_slug);
//   if (!business) return actionError("Negocio no encontrado.");
//
//   const result = await requestPhoneCode({
//     userId: user.id,
//     businessId: business.id,
//     phone,
//   });
//
//   if (!result.sent) {
//     return actionError(
//       result.reason === "rate_limited"
//         ? "Esperá un momento antes de pedir otro código."
//         : "La verificación no está disponible por ahora.",
//     );
//   }
//
//   return actionOk(null);
// }
