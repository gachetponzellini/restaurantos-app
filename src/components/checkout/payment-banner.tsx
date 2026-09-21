"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { reintentarPagoMp } from "@/lib/orders/reintentar-pago-actions";

/**
 * Cartel de pago arriba del seguimiento del pedido (sólo pedidos con MP).
 *
 * #368 — antes, un cliente que cerraba Mercado Pago sin pagar veía «Procesando
 * tu pago… puede tardar unos segundos» para siempre, sin forma de pagar, y un
 * pago fallido sólo ofrecía «Volver al menú» (otro pedido; el viejo quedaba
 * colgado). Ahora, mientras el pedido siga a tiempo (`reintento`, lo decide el
 * server con `evaluarReintentoPago`), se ofrece un link nuevo de MP.
 */
export type ReintentoPago = "puede" | "vencido" | "no";

export function PaymentBanner({
  slug,
  orderId,
  paymentStatus,
  paymentMethod,
  reintento,
}: {
  slug: string;
  orderId: string;
  paymentStatus: string;
  paymentMethod: string;
  reintento: ReintentoPago;
}) {
  if (paymentMethod !== "mp" || paymentStatus === "paid") return null;

  if (reintento === "vencido") {
    return (
      <Aviso
        tono="error"
        titulo="Este pedido venció"
        texto="No se completó el pago a tiempo. Podés hacer el pedido de nuevo."
        accion={<VolverAlMenu slug={slug} />}
      />
    );
  }

  if (reintento !== "puede") return null;

  if (paymentStatus === "failed") {
    return (
      <Aviso
        tono="error"
        titulo="El pago no se completó"
        texto="Tu pedido te espera: podés intentar pagarlo de nuevo."
        accion={
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <BotonPagar slug={slug} orderId={orderId} label="Reintentar el pago" />
            <VolverAlMenu slug={slug} />
          </div>
        }
      />
    );
  }

  return (
    <Aviso
      tono="espera"
      titulo="Esperando tu pago"
      texto="Si ya pagaste, se confirma en unos segundos. Si cerraste Mercado Pago sin pagar, podés hacerlo ahora: tu pedido te espera."
      accion={<BotonPagar slug={slug} orderId={orderId} label="Pagar con Mercado Pago" />}
    />
  );
}

function BotonPagar({
  slug,
  orderId,
  label,
}: {
  slug: string;
  orderId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await reintentarPagoMp({ business_slug: slug, order_id: orderId });
            if (r.ok) window.location.assign(r.data.initPoint);
            else setError(r.error);
          })
        }
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          padding: "6px 12px",
          borderRadius: 99,
          border: "none",
          background: "var(--accent)",
          whiteSpace: "nowrap",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? "Abriendo…" : label}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "#B94A2A", maxWidth: 220, textAlign: "right" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function VolverAlMenu({ slug }: { slug: string }) {
  return (
    <Link
      href={`/${slug}/menu`}
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: "#B94A2A",
        textDecoration: "none",
        padding: "6px 12px",
        borderRadius: 99,
        border: "1px solid #E5AB8D",
        background: "#fff",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      Volver al menú
    </Link>
  );
}

function Aviso({
  tono,
  titulo,
  texto,
  accion,
}: {
  tono: "espera" | "error";
  titulo: string;
  texto: string;
  accion: React.ReactNode;
}) {
  const error = tono === "error";
  return (
    <div
      style={{
        margin: "12px 16px",
        padding: "12px 14px",
        borderRadius: 12,
        background: error ? "#FCEDE5" : "color-mix(in oklch, var(--accent) 10%, #fff)",
        border: error
          ? "1px solid #F4C9B0"
          : "1px solid color-mix(in oklch, var(--accent) 25%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 99,
          background: error ? "#B94A2A" : "var(--accent)",
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: error ? "#6B2E17" : "var(--ink)" }}>
          {titulo}
        </div>
        <div style={{ fontSize: 11, color: error ? "#8C4A30" : "var(--ink-2)", marginTop: 2 }}>
          {texto}
        </div>
      </div>
      {accion}
    </div>
  );
}
