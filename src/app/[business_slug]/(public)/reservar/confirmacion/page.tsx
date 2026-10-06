import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

import { I } from "@/components/delivery/primitives";
import {
  CancelOutOfWindowNote,
  CancelReservationButton,
} from "@/components/reservations/cancel-reservation-button";
import { GuestPolicyNotice } from "@/components/reservations/guest-policy-notice";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";
import { canCancelReservation } from "@/lib/reservations/cancel-window";
import { formatReservationWhen } from "@/lib/reservations/format-when";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { Reservation } from "@/lib/reservations/types";

export const dynamic = "force-dynamic";

export default async function ReservarConfirmacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { business_slug } = await params;
  const { id } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  if (!id) redirect(`/${business_slug}/reservar`);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    redirect(
      `/${business_slug}/login?next=/${business_slug}/reservar/confirmacion?id=${id}`,
    );

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await service
    .from("reservations")
    .select("*, tables(label)")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  const reservation = data as
    | (Reservation & { tables: { label: string } | null })
    | null;
  if (!reservation || reservation.user_id !== user.id) notFound();

  const tz = business.timezone;
  const dayLabel = formatInTimeZone(
    new Date(reservation.starts_at),
    tz,
    "EEE d 'de' MMM",
    { locale: es },
  );
  const timeLabel = formatInTimeZone(new Date(reservation.starts_at), tz, "HH:mm");
  const whenLabel = formatReservationWhen(reservation.starts_at, tz);
  // H-14 — «Cancelar» sólo dentro de la ventana online (misma regla que el
  // server: `starts_at - lead_time_min`). Fuera de la ventana, aviso al local.
  const settings = await getReservationSettings(business.id, {
    useService: true,
  });
  const canCancel = canCancelReservation({
    status: reservation.status,
    startsAt: reservation.starts_at,
    leadTimeMin: settings.lead_time_min,
  });
  const cancelOutOfWindow =
    (reservation.status === "pending" || reservation.status === "confirmed") &&
    !canCancel &&
    new Date(reservation.starts_at).getTime() > Date.now();
  // Spec 131 — la solicitud sigue viva (para invitados, etc.): todavía puede pasar.
  const isCancellable =
    reservation.status === "pending" ||
    reservation.status === "confirmed" ||
    reservation.status === "seated";
  const pendingApproval = reservation.status === "pending";
  const cancelled = reservation.status === "cancelled";
  const completed = reservation.status === "completed";
  const noShow = reservation.status === "no_show";
  const rejected = reservation.status === "rejected";
  const expired = reservation.status === "expired";

  // Eyebrow + big headline mirroring order-tracking visual hierarchy.
  let eyebrow: string;
  let bigLine: string;
  let subLine: string;
  if (cancelled) {
    eyebrow = "Reserva cancelada";
    bigLine = "Cancelada";
    subLine = "Cuando quieras, armá una nueva.";
  } else if (rejected) {
    // Spec 131 — el local decidió que no, con el motivo si lo escribió.
    eyebrow = "Reserva no tomada";
    bigLine = "Sin lugar";
    const motivo = reservation.rejection_reason?.trim();
    subLine = motivo
      ? `${motivo[0].toUpperCase()}${motivo.slice(1)}. Escribinos y buscamos otro día u horario.`
      : `No pudimos tomarla. Escribinos y buscamos otro día u horario.`;
  } else if (expired) {
    eyebrow = "Pedido vencido";
    bigLine = "Sin confirmar";
    subLine = "El local no llegó a responderlo, así que no tenés mesa reservada.";
  } else if (pendingApproval) {
    eyebrow = "Solicitud enviada";
    bigLine = whenLabel;
    subLine = `Falta que ${business.name} la confirme. Te avisamos apenas la respondan.`;
  } else if (completed) {
    eyebrow = "¡Gracias por la visita!";
    bigLine = "Completada";
    subLine = "Esperamos que la hayas pasado bien.";
  } else if (noShow) {
    eyebrow = "Reserva sin asistencia";
    bigLine = "No asististe";
    subLine = "Si fue un error, contactá al local.";
  } else {
    eyebrow = "Reserva confirmada";
    bigLine = whenLabel;
    subLine = `Te esperamos en ${business.name}.`;
  }

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
          href={`/${business_slug}/menu`}
          aria-label="Cerrar"
          style={{
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {I.close("var(--ink)", 20)}
        </Link>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.1 }}>
            Tu reserva
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            #{reservation.id.slice(0, 8).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Big headline block */}
      <div style={{ padding: "20px 16px 16px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: cancelled ? "var(--ink-3)" : "var(--primary)",
          }}
        >
          {eyebrow}
        </div>
        <div
          className="d-display"
          style={{
            fontSize: "clamp(20px, 6.5vw, 30px)",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            color: "var(--ink)",
            marginTop: 4,
          }}
        >
          {bigLine}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-2)",
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          {subLine}
        </div>
      </div>

      {/* Quick stats row (only when active) */}
      {!cancelled && !completed && !noShow && !rejected && !expired ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 1,
            margin: "0 16px 8px",
            background: "var(--hairline)",
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid var(--hairline)",
          }}
        >
          <Stat label="Día" value={dayLabel} />
          <Stat label="Hora" value={`${timeLabel}`} />
          <Stat label="Personas" value={`${reservation.party_size}`} />
        </div>
      ) : null}

      {/* Section spacer (8px solid divider, matching order-tracking) */}
      <div style={{ borderTop: "1px solid var(--hairline)", marginTop: 16 }} />

      {/* "En" — business block */}
      <div style={{ padding: "16px" }}>
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
          En
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {business.logo_url ? (
            <div
              style={{
                position: "relative",
                width: 44,
                height: 44,
                borderRadius: 12,
                overflow: "hidden",
                flexShrink: 0,
                border: "1px solid var(--hairline)",
              }}
            >
              <Image
                src={business.logo_url}
                alt={business.name}
                fill
                sizes="44px"
                style={{ objectFit: "cover" }}
              />
            </div>
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "#E8D9BA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {I.store("var(--ink)", 20)}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: -0.1,
              }}
            >
              {business.name}
            </div>
            {business.address ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  marginTop: 2,
                  lineHeight: 1.4,
                }}
              >
                {business.address}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Section spacer */}
      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      {/* Detail rows */}
      <div style={{ padding: "8px 16px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: "var(--ink-3)",
            padding: "8px 0",
          }}
        >
          Detalles
        </div>
        <DetailRow label="A nombre de" value={reservation.customer_name} />
        <DetailRow label="Teléfono" value={reservation.customer_phone} />
        {/* H-31 — pendiente: la mesa es un código interno que puede cambiar al
            confirmar, no se muestra hasta entonces. */}
        {reservation.tables && !pendingApproval ? (
          <DetailRow label="Mesa" value={reservation.tables.label} />
        ) : null}
        {reservation.notes ? (
          <DetailRow label="Notas" value={reservation.notes} />
        ) : null}
      </div>

      {/* Spec 080 — clubes: registrar los invitados por WhatsApp. Sólo con la
          reserva viva (una cancelada o pasada no tiene invitados que sumar).
          El mensaje sale con el día y la hora de esta reserva. */}
      {isCancellable ? (
        <div style={{ padding: "8px 16px 16px" }}>
          <GuestPolicyNotice
            slug={business_slug}
            phone={business.phone ?? null}
            service={reservation.service ?? null}
            dayLabel={dayLabel}
            timeLabel={timeLabel}
          />
        </div>
      ) : null}

      {/* Footer actions */}
      <div
        style={{
          padding: "16px",
          marginTop: "auto",
          borderTop: "1px solid var(--hairline)",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <Link
          href={`/${business_slug}/perfil/reservas`}
          style={{
            height: 48,
            padding: "0 20px",
            borderRadius: 12,
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: -0.1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          Ver mis reservas
        </Link>
        {canCancel ? (
          <CancelReservationButton id={reservation.id} />
        ) : cancelOutOfWindow ? (
          <CancelOutOfWindowNote />
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--bg)",
        padding: "12px 8px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--ink-3)",
        }}
      >
        {label}
      </div>
      <div
        className="d-display"
        style={{
          fontSize: 18,
          color: "var(--ink)",
          marginTop: 4,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px solid var(--hairline)",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink-2)", flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink)",
          textAlign: "right",
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  );
}
