"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * H-16 — 404 de la parte pública del cliente: pedido inexistente, link del
 * chat vencido o ya usado, reserva ajena. Va por separado de
 * `src/app/not-found.tsx`, que es el de "negocio inexistente" (ese sigue
 * sirviendo cuando el slug no existe: lo dispara el layout del negocio, que
 * está por encima de este boundary).
 */
export default function PublicNotFound() {
  const { business_slug } = useParams<{ business_slug: string }>();
  const menuHref = business_slug ? `/${business_slug}/menu` : "/";

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "0 28px",
        textAlign: "center",
      }}
    >
      <h1
        className="d-display"
        style={{ margin: 0, fontSize: 30, lineHeight: 1.1, color: "var(--ink)" }}
      >
        No encontramos lo que buscás
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink-2)",
          maxWidth: 320,
        }}
      >
        El link puede haber vencido o ya se usó.
      </p>
      <Link
        href={menuHref}
        style={{
          minHeight: 48,
          padding: "0 22px",
          borderRadius: 12,
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          fontSize: 15,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textDecoration: "none",
        }}
      >
        Ver el menú
      </Link>
    </div>
  );
}
