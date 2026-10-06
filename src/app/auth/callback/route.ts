import { NextResponse, type NextRequest } from "next/server";

import { isSafeNextPath } from "@/lib/auth/customer-auth-shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");

  // Only allow redirects to same-origin paths (no protocol, no //).
  const next = isSafeNextPath(rawNext) ? rawNext : "/";

  console.log("[auth/callback]", { hasCode: !!code, rawNext, next });

  if (!code) {
    console.warn("[auth/callback] missing code param");
    return NextResponse.redirect(`${origin}${next}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchange failed", error);
    return NextResponse.redirect(
      `${origin}${next}?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
