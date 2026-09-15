"use client";

import Link from "next/link";

import { I } from "@/components/delivery/primitives";
import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ProfileScreen({
  slug,
  firstName,
  lastName,
  email,
}: {
  slug: string;
  firstName: string;
  lastName: string;
  email: string;
}) {
  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = `/${slug}/menu`;
  };

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
          href={`/${slug}/menu`}
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

      <div style={{ flex: 1, paddingBottom: 40 }}>
        <div style={{ padding: "16px 24px 32px" }}>
          <div
            className="d-display"
            style={{
              fontSize: 36,
              lineHeight: 1.05,
              color: "var(--ink)",
            }}
          >
            {firstName} {lastName}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 6 }}>
            {email}
          </div>
        </div>

        <div style={{ padding: "0 24px" }}>
          <MenuRow label="Reservar mesa" href={`/${slug}/reservar`} />
          <MenuRow label="Mis reservas" href={`/${slug}/perfil/reservas`} />
          <MenuRow label="Mis pedidos" href={`/${slug}/perfil/pedidos`} />
          <MenuRow
            label={copyDeEntrega(slug).porLote ? "Lotes" : "Direcciones"}
            href={`/${slug}/perfil/direcciones`}
          />
          <MenuRow label="Métodos de pago" disabled />
          <MenuRow label="Ayuda" disabled last />
        </div>

        <div style={{ padding: "40px 24px 0" }}>
          <button
            onClick={handleSignOut}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--ink-3)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuRow({
  label,
  href,
  disabled,
  last,
}: {
  label: string;
  href?: string;
  disabled?: boolean;
  last?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    padding: "18px 0",
    background: "none",
    border: "none",
    borderBottom: last ? "none" : "1px solid var(--hairline)",
    textAlign: "left",
    textDecoration: "none",
    color: disabled ? "var(--ink-3)" : "var(--ink)",
    cursor: disabled ? "default" : "pointer",
  };

  const labelEl = (
    <>
      <span
        style={{
          flex: 1,
          fontSize: 15,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {disabled ? (
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            fontStyle: "italic",
          }}
        >
          Próximamente
        </span>
      ) : (
        I.chevRight("var(--ink-3)", 14)
      )}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} style={baseStyle}>
        {labelEl}
      </Link>
    );
  }

  return <div style={baseStyle}>{labelEl}</div>;
}
