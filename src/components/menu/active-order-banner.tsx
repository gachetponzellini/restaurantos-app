"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { ActiveOrder } from "@/lib/customers/active-orders";

type StatusStyle = {
  label: string;
  dotColor: string;
  pulse: boolean;
};

function styleFor(status: ActiveOrder["status"]): StatusStyle {
  switch (status) {
    case "pending":
      return { label: "Esperando confirmación", dotColor: "#F5B941", pulse: false };
    case "confirmed":
      return { label: "Confirmado", dotColor: "#F5B941", pulse: false };
    case "preparing":
    // `ready`/`on_the_way` ya no se usan (el local entrega directo desde
    // cocina); los pedidos legacy en esos estados muestran lo mismo.
    case "ready":
    case "on_the_way":
      return { label: "En cocina", dotColor: "var(--accent)", pulse: true };
    default:
      return { label: "", dotColor: "var(--accent)", pulse: false };
  }
}

/**
 * Minutes elapsed since the order was created. Updates every 30s on client so
 * "faltan X min" counts down naturally without a server roundtrip.
 */
function useElapsedMinutes(createdAt: string): number {
  const [mins, setMins] = useState(() =>
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000),
  );
  useEffect(() => {
    const tick = () =>
      setMins(
        Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000),
      );
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [createdAt]);
  return Math.max(0, mins);
}

function etaLabel(
  status: ActiveOrder["status"],
  elapsedMins: number,
  estimatedMinutes: number | null,
): string | null {
  if (!estimatedMinutes) return null;
  if (status === "pending" || status === "confirmed") return null;
  const remaining = estimatedMinutes - elapsedMins;
  if (remaining <= 0) return "llegando";
  if (remaining <= 5) return "llega en unos minutos";
  return `~${remaining} min`;
}

export function ActiveOrderBanner({
  slug,
  orders,
  estimatedMinutes,
}: {
  slug: string;
  orders: ActiveOrder[];
  estimatedMinutes: number | null;
}) {
  if (orders.length === 0) return null;

  const multiple = orders.length > 1;
  const latest = orders[0];

  return (
    <Link
      href={`/${slug}/confirmacion/${latest.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px 10px 16px",
        background: "color-mix(in oklch, var(--accent) 8%, #fff)",
        borderBottom: "1px solid color-mix(in oklch, var(--accent) 20%, transparent)",
        textDecoration: "none",
        color: "var(--ink)",
      }}
    >
      {multiple ? (
        <MultiOrderContent count={orders.length} />
      ) : (
        <SingleOrderContent
          order={latest}
          estimatedMinutes={estimatedMinutes}
        />
      )}

      <span
        aria-hidden
        style={{
          marginLeft: "auto",
          fontSize: 20,
          color: "var(--ink-3)",
          lineHeight: 1,
        }}
      >
        ›
      </span>

      <style>{`
        @keyframes banner-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.25); }
        }
      `}</style>
    </Link>
  );
}

function SingleOrderContent({
  order,
  estimatedMinutes,
}: {
  order: ActiveOrder;
  estimatedMinutes: number | null;
}) {
  const elapsed = useElapsedMinutes(order.created_at);
  const style = styleFor(order.status);
  const eta = etaLabel(order.status, elapsed, estimatedMinutes);

  return (
    <>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 99,
          flexShrink: 0,
          background: style.dotColor,
          animation: style.pulse ? "banner-pulse 1.8s ease-in-out infinite" : undefined,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: -0.1,
            color: "var(--ink)",
          }}
        >
          {style.label}
          {eta && (
            <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
              {" · "}
              {eta}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
          Pedido #{order.order_number}
        </div>
      </div>
    </>
  );
}

function MultiOrderContent({ count }: { count: number }) {
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 99,
          flexShrink: 0,
          background: "var(--accent)",
          animation: "banner-pulse 1.8s ease-in-out infinite",
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: -0.1,
            color: "var(--ink)",
          }}
        >
          Tenés {count} pedidos activos
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
          Tocá para ver el último
        </div>
      </div>
    </>
  );
}
