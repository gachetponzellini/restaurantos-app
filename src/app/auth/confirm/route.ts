import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { isSafeNextPath } from "@/lib/auth/customer-auth-shared";
import { destinoDeLinkCaido } from "@/lib/auth/link-caido";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VALID_TYPES: EmailOtpType[] = [
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "signup",
  "email",
];

function isValidType(t: string | null): t is EmailOtpType {
  return !!t && (VALID_TYPES as string[]).includes(t);
}

/**
 * Verifica un OTP recibido vía link generado por `auth.admin.generateLink`.
 * Usamos `verifyOtp` en lugar de `exchangeCodeForSession` porque los links
 * admin-generados no tienen `code_verifier` (PKCE) en el navegador del invitado.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const rawNext = searchParams.get("next");

  const next = isSafeNextPath(rawNext) ? rawNext : "/";

  if (!tokenHash || !isValidType(type)) {
    console.warn("[auth/confirm] missing token_hash or invalid type", {
      hasToken: !!tokenHash,
      type,
    });
    return NextResponse.redirect(`${origin}${destinoDeLinkCaido(next)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    // Spec 171 · D3/D4 — el `error.message` de Supabase («Email link is invalid
    // or has expired») no se filtra a la query: es inglés y jerga para alguien
    // que está tratando de entrar a trabajar, y el texto de un cartel no lo
    // puede elegir el que arma la URL. Va el código, y el login lo traduce.
    console.error("[auth/confirm] verifyOtp failed", error);
    return NextResponse.redirect(`${origin}${destinoDeLinkCaido(next)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
