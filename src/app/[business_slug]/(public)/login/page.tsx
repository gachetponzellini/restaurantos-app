import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { I } from "@/components/delivery/primitives";
import { CustomerAuthForm } from "@/components/public/customer-auth-form";
import { LoginWithGoogleButton } from "@/components/public/login-button";
import { safeNextPath } from "@/lib/auth/customer-auth-shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/tenant";

export default async function CustomerLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { business_slug } = await params;
  const { next } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const safeNext = safeNextPath(next, business_slug);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(safeNext);

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          paddingTop: 16,
          paddingBottom: 8,
          paddingLeft: 8,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Link
          href={`/${business_slug}/menu`}
          aria-label="Cerrar"
          style={{
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {I.close("var(--ink)", 20)}
        </Link>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "24px 28px 40px",
        }}
      >
        <div style={{ marginTop: 40 }}>
          <div
            className="d-display"
            style={{
              fontSize: 44,
              lineHeight: 1.0,
              color: "var(--ink)",
            }}
          >
            Ingresá
          </div>
          <div
            style={{
              fontSize: 15,
              color: "var(--ink-2)",
              marginTop: 12,
              lineHeight: 1.4,
              maxWidth: 280,
            }}
          >
            Para guardar tus direcciones y seguir tus pedidos en {business.name}.
          </div>
        </div>

        <div>
          <CustomerAuthForm business_slug={business_slug} next={safeNext} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "20px 0",
            }}
          >
            <div style={{ flex: 1, height: 1, background: "var(--hairline-2)" }} />
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>o</span>
            <div style={{ flex: 1, height: 1, background: "var(--hairline-2)" }} />
          </div>

          <LoginWithGoogleButton nextPath={safeNext} />

          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--ink-3)",
              marginTop: 20,
              lineHeight: 1.5,
            }}
          >
            Al continuar aceptás los Términos y la Privacidad.
          </div>
        </div>
      </div>
    </div>
  );
}
