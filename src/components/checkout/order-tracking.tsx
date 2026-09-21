"use client";

import { Fragment } from "react";
import Link from "next/link";

import { CustomerCancelButton } from "@/components/checkout/customer-cancel-button";
import { I } from "@/components/delivery/primitives";
import { formatCurrency } from "@/lib/currency";

type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "on_the_way"
  | "delivered"
  | "cancelled";

type Item = {
  product_name: string;
  quantity: number;
  subtotal_cents: number;
  modifiers: string[];
  // Para líneas de menú del día: lista los componentes del combo.
  // Array vacío o undefined = producto normal.
  daily_menu_components?: string[];
};

export function OrderTracking({
  slug,
  orderId,
  businessName,
  tagline,
  orderNumber,
  status,
  deliveryType,
  items,
  subtotalCents,
  deliveryFeeCents,
  totalCents,
  estimatedMinutes,
  whatsappHref,
  canCancel = false,
  wasPaid = false,
  programadoPara = null,
}: {
  slug: string;
  orderId: string;
  businessName: string;
  tagline: string | null;
  orderNumber: number;
  status: OrderStatus;
  deliveryType: "delivery" | "pickup";
  items: Item[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  estimatedMinutes?: number | null;
  whatsappHref?: string | null;
  canCancel?: boolean;
  wasPaid?: boolean;
  /**
   * Auditoría de pedidos · baja — pedido programado: la hora ya formateada en
   * la zona del local. Con esto se muestra «Programado para · 21:30» en vez de
   * un «~40 min» que no tiene nada que ver.
   */
  programadoPara?: string | null;
}) {
  const stepLabels = [
    // Spec 139 — el primer paso decía «El local confirmó tu pedido» también
    // mientras el pedido estaba `pending`, o sea antes de que nadie del local
    // lo abriera. El paso es el mismo; lo que cambia es que ahora dice la
    // verdad en cada estado.
    {
      key: "received",
      label: status === "pending" ? "Recibido" : "Confirmado",
      sub:
        status === "pending"
          ? "Esperando que el local lo confirme"
          : "El local tomó tu pedido",
    },
    { key: "cooking", label: "En cocina", sub: "Están preparando la comida" },
    {
      key: "delivered",
      label: deliveryType === "pickup" ? "Retirado" : "Entregado",
      sub: "Esperamos que lo disfrutes",
    },
  ];

  const statusToStep = (s: OrderStatus): number => {
    switch (s) {
      case "pending":
      case "confirmed":
        return 0;
      case "preparing":
      // `ready`/`on_the_way` ya no se usan (el local entrega directo desde
      // cocina); se mapean al mismo paso para pedidos legacy.
      case "ready":
      case "on_the_way":
        return 1;
      case "delivered":
        return 2;
      default:
        return 0;
    }
  };
  const step = statusToStep(status);
  const cancelled = status === "cancelled";
  const itemCount = items.reduce((s, it) => s + it.quantity, 0);

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
          paddingBottom: 10,
          paddingLeft: 8,
          paddingRight: 16,
          display: "flex",
          alignItems: "center",
          gap: 4,
          borderBottom: "1px solid var(--hairline)",
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
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.1 }}>
            Tu pedido
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            #{String(orderNumber).padStart(4, "0")}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ padding: "20px 16px 16px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {cancelled
              ? "Pedido cancelado"
              : step === 2
                ? "¡Pedido completado!"
                : programadoPara
                  ? "Programado para"
                  : deliveryType === "pickup"
                    ? "Retiralo aproximadamente"
                    : "Llega aproximadamente"}
          </div>
          <div
            className="d-display"
            style={{
              fontSize: 40,
              lineHeight: 1.05,
              color: "var(--ink)",
              marginTop: 4,
            }}
          >
            {cancelled
              ? "Cancelado"
              : step === 2
                ? "¡Listo!"
                : programadoPara
                  ? programadoPara
                  : estimatedMinutes
                    ? `~${estimatedMinutes} min`
                    : "En preparación"}
          </div>
          {!cancelled && (
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
              {stepLabels[step].sub}
            </div>
          )}
        </div>

        {/* Horizontal stepper */}
        {!cancelled && (
          <div style={{ padding: "8px 16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {stepLabels.map((s, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <Fragment key={s.key}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 99,
                        flexShrink: 0,
                        background:
                          done || active ? "var(--accent)" : "#EFE9DD",
                        border: active
                          ? "3px solid color-mix(in oklch, var(--accent) 30%, transparent)"
                          : "none",
                        boxSizing: "content-box",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {done ? (
                        I.check("#fff", 14)
                      ) : active ? (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 99,
                            background: "#fff",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 99,
                            background: "#C8BEA6",
                          }}
                        />
                      )}
                    </div>
                    {i < stepLabels.length - 1 && (
                      <div
                        style={{
                          flex: 1,
                          height: 2,
                          borderRadius: 2,
                          background: done ? "var(--accent)" : "#EFE9DD",
                        }}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 10,
              }}
            >
              {stepLabels.map((s, i) => (
                <div
                  key={s.key}
                  style={{
                    fontSize: 11,
                    fontWeight: i === step ? 600 : 500,
                    color: i <= step ? "var(--ink)" : "var(--ink-3)",
                    flex: 1,
                    textAlign:
                      i === 0
                        ? "left"
                        : i === stepLabels.length - 1
                          ? "right"
                          : "center",
                  }}
                >
                  {s.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Business */}
        <div style={{ borderTop: "8px solid #F3EEE4", padding: "16px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 8,
            }}
          >
            Desde
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#E8D9BA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {I.store("var(--ink)", 18)}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                {businessName}
              </div>
              {tagline && (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {tagline}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Items */}
        <div
          style={{ padding: "16px", borderTop: "1px solid var(--hairline)" }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 10,
            }}
          >
            Tu pedido ({itemCount})
          </div>
          {items.map((it, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <div>
                <div>
                  {it.quantity}× {it.product_name}
                </div>
                {it.daily_menu_components &&
                  it.daily_menu_components.length > 0 && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-3)",
                        marginTop: 2,
                        lineHeight: 1.35,
                      }}
                    >
                      {it.daily_menu_components.join(" · ")}
                    </div>
                  )}
                {it.modifiers.length > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      marginTop: 2,
                    }}
                  >
                    {it.modifiers.join(" · ")}
                  </div>
                )}
              </div>
              <span style={{ color: "var(--ink)" }}>
                {formatCurrency(it.subtotal_cents)}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--hairline)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--ink-2)",
                padding: "2px 0",
              }}
            >
              <span>Subtotal</span>
              <span>{formatCurrency(subtotalCents)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--ink-2)",
                padding: "2px 0",
              }}
            >
              <span>{deliveryType === "pickup" ? "Retiro" : "Envío"}</span>
              <span>
                {deliveryType === "pickup"
                  ? formatCurrency(0)
                  : deliveryFeeCents === 0
                    ? "Bonificado"
                    : formatCurrency(deliveryFeeCents)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 8,
                marginTop: 6,
                borderTop: "1px solid var(--hairline)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              <span>Total</span>
              <span>{formatCurrency(totalCents)}</span>
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 16px 40px" }}>
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              style={{
                width: "100%",
                height: 48,
                borderRadius: 12,
                background: "#fff",
                border: "1px solid var(--hairline-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontSize: 14,
                fontWeight: 500,
                color: "var(--ink)",
                textDecoration: "none",
              }}
            >
              {I.whatsapp("#1FAF53", 18)} Consultar por WhatsApp
            </a>
          )}
          <Link
            href={`/${slug}/menu`}
            style={{
              width: "100%",
              height: 44,
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: "var(--ink-3)",
              textDecoration: "none",
            }}
          >
            Volver al inicio
          </Link>
          {canCancel && (
            <CustomerCancelButton
              orderId={orderId}
              businessSlug={slug}
              wasPaid={wasPaid}
            />
          )}
        </div>
      </div>
    </div>
  );
}
