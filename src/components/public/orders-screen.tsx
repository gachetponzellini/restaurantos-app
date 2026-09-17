"use client";

import Link from "next/link";

import { I } from "@/components/delivery/primitives";
import { formatCurrency } from "@/lib/currency";
import type { CustomerOrder } from "@/lib/customers/orders";
import { formatRelativeEs } from "@/lib/relative-time";
import type { OrderStatus } from "@/lib/orders/status";

const STATUS_META: Record<
  OrderStatus,
  { label: string; tone: "active" | "done" | "cancelled" }
> = {
  pending: { label: "Pendiente", tone: "active" },
  confirmed: { label: "Confirmado", tone: "active" },
  preparing: { label: "En preparación", tone: "active" },
  // Ya no se usan (el local entrega directo); se muestran igual que cocina.
  ready: { label: "En preparación", tone: "active" },
  on_the_way: { label: "En preparación", tone: "active" },
  delivered: { label: "Entregado", tone: "done" },
  cancelled: { label: "Cancelado", tone: "cancelled" },
};

function statusStyle(tone: "active" | "done" | "cancelled"): React.CSSProperties {
  switch (tone) {
    case "active":
      return {
        background: "color-mix(in oklch, var(--accent) 12%, #fff)",
        color: "var(--accent)",
        border: "1px solid color-mix(in oklch, var(--accent) 25%, transparent)",
      };
    case "done":
      return {
        background: "color-mix(in oklch, var(--fresh) 10%, #fff)",
        color: "var(--fresh)",
        border: "1px solid color-mix(in oklch, var(--fresh) 25%, transparent)",
      };
    case "cancelled":
      return {
        background: "#F5EEE6",
        color: "#9A4A2B",
        border: "1px solid #E6D5C3",
      };
  }
}

export function OrdersScreen({
  slug,
  orders,
}: {
  slug: string;
  orders: CustomerOrder[];
}) {
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
      <Header slug={slug} title="Mis pedidos" />

      <div style={{ flex: 1, padding: "8px 16px 40px" }}>
        {orders.length === 0 ? (
          <EmptyState slug={slug} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {orders.map((o) => (
              <OrderCard key={o.id} slug={slug} order={o} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ slug, title }: { slug: string; title: string }) {
  return (
    <div
      style={{
        paddingTop: 12,
        paddingBottom: 14,
        paddingLeft: 8,
        paddingRight: 16,
        display: "flex",
        alignItems: "center",
        gap: 4,
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <Link
        href={`/${slug}/perfil`}
        aria-label="Volver"
        style={{
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {I.chevLeft("var(--ink)", 22)}
      </Link>
      <div
        className="d-display"
        style={{
          fontSize: 22,
          lineHeight: 1.1,
          color: "var(--ink)",
        }}
      >
        {title}
      </div>
    </div>
  );
}

function OrderCard({ slug, order }: { slug: string; order: CustomerOrder }) {
  const meta = STATUS_META[order.status];
  const itemsLine =
    order.items_extra > 0
      ? `${order.items_summary}…`
      : order.items_summary || "—";

  return (
    <Link
      href={`/${slug}/confirmacion/${order.id}`}
      style={{
        display: "block",
        background: "#fff",
        border: "1px solid var(--hairline)",
        borderRadius: 14,
        padding: "14px 16px",
        textDecoration: "none",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "#F1EBDF",
              flexShrink: 0,
            }}
          >
            {order.delivery_type === "delivery"
              ? I.moto("var(--ink-2)", 14)
              : I.bag("var(--ink-2)", 14)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: -0.1,
              }}
            >
              Pedido #{order.order_number}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
              {formatRelativeEs(order.created_at)}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 99,
            letterSpacing: 0.2,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            ...statusStyle(meta.tone),
          }}
        >
          {meta.label}
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          color: "var(--ink-2)",
          marginTop: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={order.items_summary}
      >
        {itemsLine}
      </div>

      {order.status === "cancelled" && order.cancelled_reason && (
        <div
          style={{
            fontSize: 12,
            color: "#9A4A2B",
            marginTop: 6,
            fontStyle: "italic",
          }}
        >
          Motivo: {order.cancelled_reason}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px dashed var(--hairline)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {order.delivery_type === "delivery" ? "Envío" : "Retiro"}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
          {formatCurrency(order.total_cents)}
        </span>
      </div>
    </Link>
  );
}

function EmptyState({ slug }: { slug: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "60px 24px 20px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 99,
          background: "#F1EBDF",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {I.bag("var(--ink-3)", 24)}
      </span>
      <div
        className="d-display"
        style={{ fontSize: 22, color: "var(--ink)" }}
      >
        Todavía no hiciste ningún pedido
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-3)", maxWidth: 320 }}>
        Cuando hagas tu primer pedido en este local, lo vas a ver acá.
      </div>
      <Link
        href={`/${slug}/menu`}
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 22px",
          borderRadius: 99,
          background: "var(--accent)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
          letterSpacing: -0.1,
        }}
      >
        Ver menú
      </Link>
    </div>
  );
}
