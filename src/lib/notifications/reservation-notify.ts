import "server-only";

import { formatInTimeZone } from "date-fns-tz";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type { CustomerChannel } from "./customer-channel";
import { dispatchCustomerMessage, resolveCustomerChannel } from "./customer-dispatch";
import {
  renderReservationBody,
  reservationWhatsappPayload,
  type ReservationNotifyEvent,
} from "./reservation-templates";
import {
  reservationConfirmedEmail,
  reservationExpiredEmail,
  reservationRejectedEmail,
  reservationReminderEmail,
  reservationRequestedEmail,
  resolveBusinessBrand,
  type BusinessBrand,
} from "./customer-email-templates";
import { isWhatsappConnected } from "./whatsapp-sender";

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

type ReservationRow = {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  party_size: number;
  starts_at: string;
  status: string;
  confirm_token: string;
};

async function loadReservationContext(reservationId: string): Promise<{
  reservation: ReservationRow;
  brand: BusinessBrand;
  slug: string;
  whenLabel: string;
  /** Día y hora por separado: los usa el cuerpo de WhatsApp (spec 132). */
  dateLabel: string;
  timeLabel: string;
} | null> {
  const service = createSupabaseServiceClient();
  const { data: reservation } = await service
    .from("reservations")
    .select(
      "id, business_id, customer_name, customer_email, customer_phone, party_size, starts_at, status, confirm_token",
    )
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) return null;

  const { data: business } = await service
    .from("businesses")
    .select("name, slug, timezone, logo_url, address, phone, settings")
    .eq("id", reservation.business_id)
    .maybeSingle();
  if (!business) return null;

  const tz = business.timezone ?? DEFAULT_TZ;
  const startsAt = new Date(reservation.starts_at);
  const whenLabel = formatInTimeZone(startsAt, tz, "dd/MM 'a las' HH:mm 'hs'");

  return {
    reservation: reservation as ReservationRow,
    brand: resolveBusinessBrand(business),
    slug: business.slug,
    whenLabel,
    dateLabel: formatInTimeZone(startsAt, tz, "dd/MM"),
    timeLabel: formatInTimeZone(startsAt, tz, "HH:mm"),
  };
}

/**
 * Spec 132 — el payload de WhatsApp de un aviso de reserva.
 *
 * Devuelve `undefined` cuando no corresponde mandar WhatsApp: sin teléfono, o
 * sin `template_name` cargado para ese evento. Lo segundo es a propósito (D4):
 * un aviso proactivo sin template aprobado por Meta sólo dejaría una fila
 * `failed` en el outbox, así que ni se intenta — el email sigue saliendo.
 *
 * Devuelve `null` cuando el negocio apagó el evento entero (`enabled: false`),
 * que corta también el mail. El caller distingue los dos casos.
 */
async function loadReservationWhatsapp(params: {
  businessId: string;
  event: ReservationNotifyEvent;
  customerName: string;
  businessName: string;
  dateLabel: string;
  timeLabel: string;
  partySize: number;
  phone: string | null;
  reason?: string | null;
}): Promise<
  { body: string; template?: { name: string; lang: string; params: string[] } } | null | undefined
> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("reservation_message_templates")
    .select("body, enabled, template_name, template_lang")
    .eq("business_id", params.businessId)
    .eq("event", params.event)
    .maybeSingle();
  const row = data as {
    body: string;
    enabled: boolean;
    template_name: string | null;
    template_lang: string | null;
  } | null;

  const body = renderReservationBody({
    event: params.event,
    customerName: params.customerName,
    businessName: params.businessName,
    dateLabel: params.dateLabel,
    timeLabel: params.timeLabel,
    partySize: params.partySize,
    reason: params.reason,
    template: row ? { body: row.body, enabled: row.enabled } : null,
  });
  return reservationWhatsappPayload({
    body,
    phone: params.phone,
    templateName: row?.template_name ?? null,
    templateLang: row?.template_lang ?? null,
    templateParams: [
      params.customerName,
      `${params.dateLabel} ${params.timeLabel}`,
    ],
  });
}

/**
 * Auditoría de reservas del cliente (bug #4) — fallback WhatsApp → email.
 *
 * `customer_channel` del negocio puede estar en `'whatsapp'` sin que haya
 * forma real de mandarlo: sin credenciales cargadas en `whatsapp_credentials`,
 * o sin `template_name` aprobado para el evento (ahí `wa` sale `undefined` de
 * `loadReservationWhatsapp`, o directamente `null` como en el recordatorio,
 * que todavía no tiene WhatsApp). `dispatchCustomerMessage` sólo intenta el
 * canal configurado — nunca el otro — así que sin este fallback el cliente se
 * queda sin NINGÚN aviso. Si tiene email, cae ahí en vez de quedar en silencio.
 */
async function resolveDispatchChannel(params: {
  businessId: string;
  wa: { body: string; template?: { name: string; lang: string; params: string[] } } | null | undefined;
  hasEmail: boolean;
}): Promise<CustomerChannel> {
  const channel = await resolveCustomerChannel(params.businessId);
  if (channel !== "whatsapp") return channel;
  const deliverable =
    Boolean(params.wa) && (await isWhatsappConnected(params.businessId));
  if (deliverable) return channel;
  return params.hasEmail ? "email" : channel;
}

/**
 * Acuse de reserva creada, al cliente, por el canal del negocio (spec 45).
 * Best-effort: nunca lanza. Sin WhatsApp deliverable (sin credenciales o sin
 * template para el evento), cae a email si el cliente lo tiene (bug #4).
 */
export async function notifyReservationConfirmed(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const wa = await loadReservationWhatsapp({
      businessId: ctx.reservation.business_id,
      event: "confirmed",
      customerName: ctx.reservation.customer_name,
      businessName: ctx.brand.name,
      dateLabel: ctx.dateLabel,
      timeLabel: ctx.timeLabel,
      partySize: ctx.reservation.party_size,
      phone: ctx.reservation.customer_phone,
    });
    if (wa === null) return;

    const manageUrl = `${baseUrl()}/${ctx.slug}/perfil/reservas`;
    const email = reservationConfirmedEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      partySize: ctx.reservation.party_size,
      manageUrl,
    });

    const channel = await resolveDispatchChannel({
      businessId: ctx.reservation.business_id,
      wa,
      hasEmail: Boolean(ctx.reservation.customer_email),
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_confirmed",
      refId: ctx.reservation.id,
      channel,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: wa ?? null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationConfirmed", err);
  }
}

/**
 * Spec 131 — acuse de la solicitud, al crear una reserva de cliente. Mismo
 * canal y mismo best-effort que el resto: lo único distinto es que no dice
 * "confirmada", porque todavía no lo está.
 */
export async function notifyReservationRequested(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const wa = await loadReservationWhatsapp({
      businessId: ctx.reservation.business_id,
      event: "requested",
      customerName: ctx.reservation.customer_name,
      businessName: ctx.brand.name,
      dateLabel: ctx.dateLabel,
      timeLabel: ctx.timeLabel,
      partySize: ctx.reservation.party_size,
      phone: ctx.reservation.customer_phone,
    });
    if (wa === null) return; // el negocio apagó este aviso

    const manageUrl = `${baseUrl()}/${ctx.slug}/perfil/reservas`;
    const email = reservationRequestedEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      partySize: ctx.reservation.party_size,
      manageUrl,
    });

    const channel = await resolveDispatchChannel({
      businessId: ctx.reservation.business_id,
      wa,
      hasEmail: Boolean(ctx.reservation.customer_email),
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_requested",
      refId: ctx.reservation.id,
      channel,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: wa ?? null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationRequested", err);
  }
}

/** Spec 131 — el local rechazó la solicitud. Best-effort. */
export async function notifyReservationRejected(params: {
  reservationId: string;
  reason?: string | null;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const wa = await loadReservationWhatsapp({
      businessId: ctx.reservation.business_id,
      event: "rejected",
      customerName: ctx.reservation.customer_name,
      businessName: ctx.brand.name,
      dateLabel: ctx.dateLabel,
      timeLabel: ctx.timeLabel,
      partySize: ctx.reservation.party_size,
      phone: ctx.reservation.customer_phone,
      reason: params.reason ?? null,
    });
    if (wa === null) return;

    const email = reservationRejectedEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      reason: params.reason ?? null,
    });

    const channel = await resolveDispatchChannel({
      businessId: ctx.reservation.business_id,
      wa,
      hasEmail: Boolean(ctx.reservation.customer_email),
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_rejected",
      refId: ctx.reservation.id,
      channel,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: wa ?? null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationRejected", err);
  }
}

/** Spec 131 — la solicitud venció sin respuesta del local. Best-effort. */
export async function notifyReservationExpired(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const wa = await loadReservationWhatsapp({
      businessId: ctx.reservation.business_id,
      event: "expired",
      customerName: ctx.reservation.customer_name,
      businessName: ctx.brand.name,
      dateLabel: ctx.dateLabel,
      timeLabel: ctx.timeLabel,
      partySize: ctx.reservation.party_size,
      phone: ctx.reservation.customer_phone,
    });
    if (wa === null) return;

    const email = reservationExpiredEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
    });

    const channel = await resolveDispatchChannel({
      businessId: ctx.reservation.business_id,
      wa,
      hasEmail: Boolean(ctx.reservation.customer_email),
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_expired",
      refId: ctx.reservation.id,
      channel,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: wa ?? null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationExpired", err);
  }
}

/**
 * Recordatorio antes del turno, con link de confirmación de asistencia (double
 * opt-in, spec 45). Best-effort. Lo dispara el cron de recordatorios.
 */
export async function notifyReservationReminder(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;
    if (ctx.reservation.status !== "confirmed") return;

    const confirmUrl = `${baseUrl()}/${ctx.slug}/reservar/confirmar/${ctx.reservation.confirm_token}`;
    const email = reservationReminderEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      partySize: ctx.reservation.party_size,
      confirmUrl,
    });

    // El recordatorio todavía no tiene WhatsApp (sin template de este evento):
    // `wa` es siempre null acá. Sin el fallback, un negocio en canal 'whatsapp'
    // se quedaba sin ningún recordatorio (bug #4).
    const channel = await resolveDispatchChannel({
      businessId: ctx.reservation.business_id,
      wa: null,
      hasEmail: Boolean(ctx.reservation.customer_email),
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_reminder",
      refId: ctx.reservation.id,
      channel,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationReminder", err);
  }
}
