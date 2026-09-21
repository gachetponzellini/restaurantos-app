"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

import { I } from "@/components/delivery/primitives";
import { CancelReservationButton } from "@/components/reservations/cancel-reservation-button";
import type { Reservation, ReservationStatus } from "@/lib/reservations/types";

type Row = Reservation & { tables: { label: string } | null };

const STATUS_LABEL: Record<ReservationStatus, string> = {
  // Spec 131 — mientras el local no la responda es un pedido, y así se lee.
  pending: "Pendiente de confirmar",
  rejected: "No pudimos tomarla",
  expired: "Venció sin confirmar",
  confirmed: "Confirmada",
  seated: "En curso",
  completed: "Completada",
  no_show: "No asististe",
  cancelled: "Cancelada",
};

// Color tokens use the public-theme palette where available, with mild
// fallbacks for statuses that don't have a brand-token equivalent.
const STATUS_DOT: Record<ReservationStatus, string> = {
  pending: "#C78A3B",
  rejected: "#C25A5A",
  expired: "var(--ink-3)",
  confirmed: "var(--primary)",
  seated: "var(--fresh)",
  completed: "var(--ink-3)",
  no_show: "#C78A3B",
  cancelled: "#C25A5A",
};

type Tab = "upcoming" | "past";

export function MyReservationsScreen({
  slug,
  timezone,
  reservations,
}: {
  slug: string;
  timezone: string;
  reservations: Row[];
}) {
  const [tab, setTab] = useState<Tab>("upcoming");

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const upcoming: Row[] = [];
    const past: Row[] = [];
    for (const r of reservations) {
      // Spec 131 — la pendiente va en "próximas": todavía puede pasar, y es
      // justo la que el cliente quiere mirar (y cancelar si se arrepiente).
      const isActiveStatus =
        r.status === "pending" || r.status === "confirmed" || r.status === "seated";
      const isFuture = new Date(r.starts_at).getTime() > now - 30 * 60_000;
      if (isActiveStatus && isFuture) upcoming.push(r);
      else past.push(r);
    }
    // Upcoming: ascending (next first); Past: descending (most recent first)
    upcoming.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    return { upcoming, past };
  }, [reservations]);

  const visible = tab === "upcoming" ? upcoming : past;

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
      {/* Header */}
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
        <div style={{ flex: 1, fontSize: 16, fontWeight: 600, letterSpacing: -0.1 }}>
          Mis reservas
        </div>
        <Link
          href={`/${slug}/reservar`}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 99,
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: -0.1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            textDecoration: "none",
          }}
        >
          {I.plus("var(--primary-foreground)", 14)}
          Nueva
        </Link>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--hairline)",
          padding: "0 8px",
        }}
      >
        <TabButton
          label="Próximas"
          count={upcoming.length}
          active={tab === "upcoming"}
          onClick={() => setTab("upcoming")}
        />
        <TabButton
          label="Pasadas"
          count={past.length}
          active={tab === "past"}
          onClick={() => setTab("past")}
        />
      </div>

      {/* Body */}
      {visible.length === 0 ? (
        <EmptyState slug={slug} tab={tab} />
      ) : (
        <div style={{ padding: "12px 16px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((r) => (
            <ReservationCard key={r.id} row={r} slug={slug} timezone={timezone} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── pieces ──────────────────────────────────────────────────────────── */

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "14px 8px 12px",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        letterSpacing: -0.1,
        cursor: "pointer",
        marginBottom: -1,
        fontFamily: "inherit",
        transition: "color 180ms",
      }}
    >
      {label}
      <span
        style={{
          marginLeft: 6,
          fontSize: 11,
          color: active ? "var(--primary)" : "var(--ink-3)",
          fontWeight: 600,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function ReservationCard({
  row,
  slug,
  timezone,
}: {
  row: Row;
  slug: string;
  timezone: string;
}) {
  const dayLabel = formatInTimeZone(
    new Date(row.starts_at),
    timezone,
    "EEE d 'de' MMM",
    { locale: es },
  );
  const timeLabel = formatInTimeZone(new Date(row.starts_at), timezone, "HH:mm");
  // Auditoría de reservas · baja — no ofrecer «Cancelar» en una reserva ya
  // sentada ni en una que ya pasó: el server la rechaza y el cliente sólo veía
  // un error. (El plazo exacto de anticipación lo sigue validando el server.)
  const canCancel =
    (row.status === "pending" || row.status === "confirmed") &&
    new Date(row.starts_at).getTime() > Date.now();
  const isClosed = [
    "completed",
    "no_show",
    "cancelled",
    "rejected",
    "expired",
  ].includes(row.status);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        border: "1px solid var(--hairline)",
        background: "var(--bg)",
        padding: 14,
        opacity: isClosed ? 0.85 : 1,
      }}
    >
      <Link
        href={`/${slug}/reservar/confirmacion?id=${row.id}`}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 14,
          // Keep the link transparent so the cancel button below it stays
          // clickable. We pull the cancel button above with z-index.
        }}
        aria-label="Ver detalle"
      />

      {/* Top row: status pill + chev */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: "var(--ink-2)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: STATUS_DOT[row.status],
              display: "inline-block",
            }}
          />
          {STATUS_LABEL[row.status]}
        </span>
        <span style={{ position: "relative", color: "var(--ink-3)" }}>
          {I.chevRight("var(--ink-3)", 14)}
        </span>
      </div>

      {/* Big date+time row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          className="d-display"
          style={{
            fontSize: 24,
            color: "var(--ink)",
            lineHeight: 1.05,
            textTransform: "capitalize",
          }}
        >
          {dayLabel}
        </span>
        <span
          className="d-display"
          style={{
            fontSize: 24,
            color: "var(--primary)",
            lineHeight: 1.05,
          }}
        >
          {timeLabel} hs
        </span>
      </div>

      {/* Meta row */}
      <div
        style={{
          fontSize: 13,
          color: "var(--ink-2)",
          marginTop: 6,
        }}
      >
        {row.party_size} {row.party_size === 1 ? "persona" : "personas"}
        {row.tables ? ` · Mesa ${row.tables.label}` : ""}
      </div>

      {row.notes ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            marginTop: 6,
            lineHeight: 1.4,
          }}
        >
          {row.notes}
        </div>
      ) : null}

      {/* Cancel action — sits above the overlay link */}
      {canCancel ? (
        <div
          style={{
            position: "relative",
            zIndex: 2,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--hairline)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <CancelReservationButton id={row.id} />
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ slug, tab }: { slug: string; tab: Tab }) {
  const isUpcoming = tab === "upcoming";
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 32px",
        gap: 18,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 99,
          background: "var(--hairline)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-hidden
      >
        {I.clock("var(--ink-2)", 24)}
      </div>
      <div>
        <div
          className="d-display"
          style={{ fontSize: 26, color: "var(--ink)", lineHeight: 1.1 }}
        >
          {isUpcoming ? "Sin reservas próximas" : "Sin reservas pasadas"}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-2)",
            marginTop: 8,
            maxWidth: 280,
            lineHeight: 1.5,
          }}
        >
          {isUpcoming
            ? "Reservá una mesa y la vas a ver acá."
            : "Cuando tengas reservas completadas o canceladas, van a aparecer en esta pestaña."}
        </div>
      </div>
      {isUpcoming ? (
        <Link
          href={`/${slug}/reservar`}
          style={{
            height: 48,
            padding: "0 22px",
            borderRadius: 12,
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: -0.1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          Reservar mesa
        </Link>
      ) : null}
    </div>
  );
}
