import "server-only";

import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mismoTelefono, normalizePhone } from "@/lib/phone";
import {
  getAvailability,
  getBusinessSalones,
  getBusinessTables,
  getReservationSettings,
} from "@/lib/reservations/queries";
import type { Reservation } from "@/lib/reservations/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

/**
 * Chatbot-side actions for the reservations feature.
 *
 * Architectural notes:
 * - These functions are the bridge between the LangChain tools in
 *   `src/lib/chatbot/agent.ts` and the canonical reservation logic in
 *   `availability.ts` / `booking-actions.ts`. They don't duplicate domain
 *   rules — they wrap the existing ones.
 * - Creation goes through a token + web confirmation (mirror of the cart
 *   handoff in 0014_chatbot_cart.sql). The chatbot never inserts into
 *   `reservations` directly; that happens from `/reservar/[token]` once the
 *   customer logs in. See `createReservationIntent` below.
 * - "List my reservations" and "confirm reservation" use phone-based identity:
 *   the `contactIdentifier` from the conversation is normalized to digits and
 *   compared against `reservations.customer_phone`. This is weak auth on
 *   purpose — WhatsApp owns the phone, so in production this is good enough.
 *   On the `web-test` channel the identifier may not be a phone; in that case
 *   `normalizePhone` returns "" and the tools return `requires_phone: true`
 *   so the bot asks the user explicitly.
 */

const RESERVATION_INTENT_TOKEN_LENGTH = 16;

export type ReservationIntent = {
  date: string; // YYYY-MM-DD in business TZ
  slot: string; // HH:MM in business TZ
  party_size: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  notes?: string | null;
  /** Salón elegido. Null/ausente cuando el negocio tiene un único salón o
   *  el bot no preguntó (intents viejos previos a multi-salón). */
  floor_plan_id?: string | null;
};

/**
 * Digits-only phone normalization. Anything that doesn't look phone-like
 * collapses to "" — the tools use that to ask the user explicitly.
 *
 * Vive en `@/lib/phone` porque la comparten checkout, walk-in y reservas para
 * identificar clientes (issue #114). Se re-exporta acá para no romper imports.
 */
export { normalizePhone };

type Business = {
  id: string;
  slug: string;
  timezone: string;
};

async function getBusinessById(businessId: string): Promise<Business | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("businesses")
    .select("id, slug, timezone")
    .eq("id", businessId)
    .maybeSingle();
  return (data as Business | null) ?? null;
}

/**
 * Spec 077 — el bot todavía razona en modo **estricto** (slots de `schedule` +
 * `pickTable` + ventana de 90 min). Contra un negocio **flexible** eso promete
 * un modelo que el local no usa y, peor, esquiva el cupo del servicio que la
 * web sí respeta. Hasta que las tools sepan de servicios (US3 de la spec), el
 * bot no ofrece ni reserva en flexible: deriva al flujo web, que es correcto.
 */
function flexibleModeHandoff(slug: string) {
  return {
    diagnostic: "flexible_mode_web_only" as const,
    booking_url_path: `/${slug}/reservar`,
    hint:
      "Este local maneja las reservas por servicio (mediodía / cena) y el bot todavía no puede tomarlas. Pasale al cliente el link de reservas del local para que la haga ahí, o decile que llame.",
  };
}

/**
 * Read-only summary of the business's reservation policy. The chatbot uses
 * this for questions like "¿hasta cuántas personas?", "¿con cuánta antelación?".
 */
export async function getReservationPolicyForChatbot(businessId: string) {
  const settings = await getReservationSettings(businessId, { useService: true });
  // Translate the schedule into a human-friendly summary: list of open days
  // with their slot count. The bot can format this freely.
  const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const open_days = (Object.entries(settings.schedule) as [string, { open: boolean; slots: string[] }][])
    .filter(([, day]) => day?.open && day.slots.length > 0)
    .map(([dow, day]) => ({
      day_of_week: Number(dow),
      day_name: dayNames[Number(dow)],
      slot_count: day.slots.length,
      first_slot: day.slots[0] ?? null,
      last_slot: day.slots[day.slots.length - 1] ?? null,
    }));

  return {
    max_party_size: settings.max_party_size,
    advance_days_max: settings.advance_days_max,
    lead_time_min: settings.lead_time_min,
    slot_duration_min: settings.slot_duration_min,
    open_days,
    accepts_reservations: open_days.length > 0,
  };
}

/**
 * Lista los salones del negocio que aceptan reservas (al menos una mesa
 * activa). El bot la usa de paso 0: si `multi_salon` es true, debe preguntar
 * al cliente cuál antes de pedir horarios.
 */
export async function listSalonesForChatbot(businessId: string) {
  const salones = await getBusinessSalones(businessId, { useService: true });
  return {
    salones,
    multi_salon: salones.length > 1,
  };
}

/**
 * Check available slots for a given date and party size.
 * Wraps `computeAvailableSlots` with pre-loaded settings/tables/reservations.
 *
 * `floorPlanId` restringe el cómputo a las mesas de ese salón. Sin él,
 * cae al primer floor_plan (legacy).
 */
export async function checkAvailabilityForChatbot(
  businessId: string,
  date: string,
  partySize: number,
  floorPlanId?: string | null,
) {
  const business = await getBusinessById(businessId);
  if (!business) return { error: "business_not_found" as const };

  const settings = await getReservationSettings(businessId, { useService: true });

  // Spec 077 — negocio flexible: el bot deriva a la web en vez de ofrecer los
  // slots viejos de `schedule`, que el local ya no usa.
  if (settings.mode === "flexible") {
    return {
      date,
      party_size: partySize,
      slots: [] as string[],
      count: 0,
      ...flexibleModeHandoff(business.slug),
    };
  }

  if (partySize < 1) {
    return { error: "invalid_party_size" as const };
  }
  if (partySize > settings.max_party_size) {
    return {
      error: "party_size_too_large" as const,
      max_party_size: settings.max_party_size,
    };
  }

  const slots = await getAvailability(
    businessId,
    business.timezone,
    { date, partySize, floorPlanId: floorPlanId ?? null },
    { useService: true },
  );

  // Si hay slots, devolvemos rápido. Si no, computamos un diagnóstico para
  // que el bot pueda explicarle al cliente *por qué* no hay (config faltante,
  // mesas chicas, fuera del horizonte, etc.) en vez de un "no hay nada"
  // pelado.
  if (slots.length > 0) {
    return {
      date,
      party_size: partySize,
      slots: slots.map((s) => s.slot),
      count: slots.length,
    };
  }

  // ── Diagnóstico de availability vacía ──────────────────────────────
  // Camino frío (no hay slots): recargamos las mesas para explicar el porqué.
  const tables = await getBusinessTables(businessId, {
    useService: true,
    floorPlanId: floorPlanId ?? null,
    excludeBar: true,
  });
  const [y, m, d] = date.split("-").map(Number);
  const dow = String(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) as
    | "0" | "1" | "2" | "3" | "4" | "5" | "6";
  const daySchedule = settings.schedule[dow];

  // 1. ¿El negocio tiene algún día con horarios cargados?
  const anyDayOpen = Object.values(settings.schedule).some(
    (s) => s?.open && s.slots.length > 0,
  );
  if (!anyDayOpen) {
    return {
      date,
      party_size: partySize,
      slots: [],
      count: 0,
      diagnostic: "no_schedule_configured" as const,
      hint:
        "El negocio todavía no cargó horarios de reserva en /admin/reservas/configuracion. Pedile al cliente que pruebe llamando o pasando por el local.",
    };
  }

  // 2. ¿El día solicitado tiene horarios?
  if (!daySchedule || !daySchedule.open || daySchedule.slots.length === 0) {
    const openDays = (Object.entries(settings.schedule) as [
      string,
      { open: boolean; slots: string[] },
    ][])
      .filter(([, s]) => s?.open && s.slots.length > 0)
      .map(([k]) => Number(k));
    return {
      date,
      party_size: partySize,
      slots: [],
      count: 0,
      diagnostic: "day_closed" as const,
      open_days_of_week: openDays, // 0=dom, 1=lun, …, 6=sáb
      hint:
        "Ese día el local no acepta reservas. Sugerile al cliente otra fecha (mirá `open_days_of_week`).",
    };
  }

  // 3. ¿Hay alguna mesa que entre el party_size?
  const eligibleTables = tables.filter(
    (t) => t.status === "active" && t.seats >= partySize,
  );
  if (eligibleTables.length === 0) {
    const maxSeats = tables.reduce(
      (m, t) => (t.status === "active" && t.seats > m ? t.seats : m),
      0,
    );
    return {
      date,
      party_size: partySize,
      slots: [],
      count: 0,
      diagnostic: "no_tables_fit_party" as const,
      max_seats_available: maxSeats,
      hint:
        maxSeats === 0
          ? "El negocio no tiene mesas activas cargadas en el floor plan. Avisale al cliente que llame al local."
          : `La mesa más grande del local tiene ${maxSeats} cubiertos; sugerile al cliente reservar para esa cantidad o dividir en varias mesas.`,
    };
  }

  // 4. Hay día abierto + mesas que entran, pero igual no hay slots:
  //    o todo está ocupado, o estamos fuera de lead time / horizonte.
  //    Distinguimos comparando contra los slots del día sin filtrar nada.
  const dayHasFutureSlots = daySchedule.slots.some((slot) => {
    const [hh, mm] = slot.split(":").map(Number);
    const slotStart = fromZonedTime(`${date}T${slot}:00`, business.timezone);
    const leadCutoff = new Date(Date.now() + settings.lead_time_min * 60_000);
    return !Number.isNaN(slotStart.getTime()) &&
      slotStart >= leadCutoff &&
      !Number.isNaN(hh) &&
      !Number.isNaN(mm);
  });
  if (!dayHasFutureSlots) {
    return {
      date,
      party_size: partySize,
      slots: [],
      count: 0,
      diagnostic: "lead_time_or_past" as const,
      lead_time_min: settings.lead_time_min,
      hint:
        "Todos los turnos del día solicitado ya pasaron o están dentro de la ventana de anticipación mínima. Sugerile al cliente probar otro día.",
    };
  }

  // 5. Default: todas las mesas elegibles están ocupadas en esos slots.
  return {
    date,
    party_size: partySize,
    slots: [],
    count: 0,
    diagnostic: "fully_booked" as const,
    hint:
      "Ese día hay turnos abiertos pero todas las mesas que entran están reservadas. Sugerí otra fecha o party_size distinto.",
  };
}

/**
 * Create a reservation intent: validates the slot exists in availability,
 * persists `{intent, token}` on `chatbot_conversations`, returns the token.
 *
 * Re-uses the same 16-hex token shape as `cart_token` so log inspection is
 * consistent.
 */
export async function createReservationIntent(input: {
  businessId: string;
  conversationId: string;
  date: string;
  slot: string;
  partySize: number;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  floorPlanId?: string | null;
}): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string; available_slots?: string[] }
> {
  const business = await getBusinessById(input.businessId);
  if (!business) return { ok: false, error: "business_not_found" };

  const settings = await getReservationSettings(input.businessId, { useService: true });
  // Spec 077 — sin soporte flexible en el bot, no se generan intents: el
  // camino estricto crearía una reserva con otro modelo y salteando el cupo.
  if (settings.mode === "flexible") {
    return { ok: false, error: "flexible_mode_web_only" };
  }
  if (input.partySize < 1 || input.partySize > settings.max_party_size) {
    return {
      ok: false,
      error: `El máximo es ${settings.max_party_size} comensales.`,
    };
  }

  const slots = await getAvailability(
    input.businessId,
    business.timezone,
    { date: input.date, partySize: input.partySize, floorPlanId: input.floorPlanId ?? null },
    { useService: true },
  );

  const isAvailable = slots.some((s) => s.slot === input.slot);
  if (!isAvailable) {
    return {
      ok: false,
      error: "slot_no_longer_available",
      available_slots: slots.map((s) => s.slot),
    };
  }

  const token = globalThis.crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, RESERVATION_INTENT_TOKEN_LENGTH);

  const intent: ReservationIntent = {
    date: input.date,
    slot: input.slot,
    party_size: input.partySize,
    customer_name: input.customerName ?? null,
    customer_phone: input.customerPhone ?? null,
    notes: input.notes ?? null,
    floor_plan_id: input.floorPlanId ?? null,
  };

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("chatbot_conversations")
    .update({ reservation_intent: intent, reservation_token: token })
    .eq("id", input.conversationId)
    .eq("business_id", input.businessId);
  if (error) {
    return { ok: false, error: `failed_to_persist_intent: ${error.message}` };
  }
  return { ok: true, token };
}

/**
 * Look up an intent by token. Used by the `/reservar/[token]` web route.
 * Returns the parsed intent or null if not found / conversation closed.
 */
export async function getReservationIntentByToken(token: string): Promise<
  | {
      conversationId: string;
      businessId: string;
      intent: ReservationIntent;
    }
  | null
> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("chatbot_conversations")
    .select("id, business_id, reservation_intent, closed_at")
    .eq("reservation_token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    business_id: string;
    reservation_intent: ReservationIntent | null;
    closed_at: string | null;
  };
  if (row.closed_at) return null;
  if (!row.reservation_intent) return null;
  return {
    conversationId: row.id,
    businessId: row.business_id,
    intent: row.reservation_intent,
  };
}

/**
 * Devuelve el intent a la conversación si la reserva no se pudo crear (el
 * horario se llenó, una validación falló…): el claim lo consume ANTES de crear,
 * y sin esto el link quedaba quemado y el cliente no podía reintentar. Sólo
 * restaura si sigue vacío — no pisa un intent nuevo que haya generado el bot.
 */
export async function releaseReservationIntent(
  token: string,
  intent: ReservationIntent,
): Promise<void> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("chatbot_conversations")
    .update({ reservation_intent: intent })
    .eq("reservation_token", token)
    .is("reservation_intent", null);
  if (error) console.error("releaseReservationIntent", error);
}

/**
 * Auditoría de reservas del cliente (bug #2) — consumo atómico del intent.
 *
 * Un doble click en el link de confirmación del bot dispara dos llamadas a
 * `confirmReservationFromIntent` casi simultáneas. Antes, las dos leían el
 * mismo intent (todavía no nulo) vía `getReservationIntentByToken`, las dos
 * pasaban la validación, y recién DESPUÉS de crear la reserva se llamaba
 * `consumeReservationIntent` — que no protegía nada, sólo limpiaba. Resultado:
 * dos reservas por un solo click.
 *
 * Este `UPDATE ... WHERE reservation_token = $1 AND reservation_intent IS NOT
 * NULL` es atómico a nivel fila (Postgres serializa los UPDATE concurrentes
 * sobre la misma fila): sólo el primero en llegar ve `reservation_intent IS
 * NOT NULL` y gana la carrera; el segundo no actualiza ninguna fila y
 * `claimed` sale `false`. El caller tiene que llamarlo ANTES de crear la
 * reserva y abortar si `claimed` es `false`.
 */
export async function claimReservationIntent(token: string): Promise<boolean> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("chatbot_conversations")
    .update({ reservation_intent: null })
    .eq("reservation_token", token)
    .not("reservation_intent", "is", null)
    .select("id");
  if (error) {
    console.error("claimReservationIntent", error);
    return false;
  }
  return ((data ?? []) as { id: string }[]).length > 0;
}

/**
 * Upcoming reservations for the given phone. "Upcoming" = live status
 * (confirmed | seated) AND starts_at in the future.
 *
 * Returns shape designed for the LLM: small, named fields, ISO timestamps.
 */
export async function listChatbotReservationsByPhone(
  businessId: string,
  phone: string,
): Promise<{
  reservations: Array<
    Pick<Reservation, "id" | "starts_at" | "ends_at" | "party_size" | "status" | "customer_name">
    & { client_confirmed_at: string | null }
  >;
  count: number;
}> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const nowIso = new Date().toISOString();
  const { data } = await service
    .from("reservations")
    .select("id, starts_at, ends_at, party_size, status, customer_name, customer_phone, client_confirmed_at")
    .eq("business_id", businessId)
    // Auditoría de reservas · media — `pending` también: un cliente con una
    // solicitud sin confirmar preguntaba «¿tengo reserva?», el bot decía que
    // no y le ofrecía reservar de nuevo (otro duplicado). Va con su estado
    // para que el bot diga «pendiente de confirmación».
    .in("status", ["pending", "confirmed", "seated"])
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  const rows = (data ?? []) as Array<
    Reservation & { client_confirmed_at: string | null }
  >;

  // Filter client-side by normalized phone (the DB stores it raw).
  // Número nacional (últimos 10 dígitos): el WhatsApp llega con 549 y la web
  // no (auditoría de reservas · media).
  const filtered = rows.filter((r) => mismoTelefono(r.customer_phone, phone));

  return {
    count: filtered.length,
    reservations: filtered.map((r) => ({
      id: r.id,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      party_size: r.party_size,
      status: r.status,
      customer_name: r.customer_name,
      client_confirmed_at: r.client_confirmed_at,
    })),
  };
}

/**
 * Mark a reservation as client-confirmed. Validates ownership by phone
 * (same identity model as `listChatbotReservationsByPhone`).
 *
 * Refuses to confirm reservations that are not in a live status — there's
 * nothing meaningful to "confirm" once it's completed/cancelled/no_show.
 */
export async function confirmReservationByChatbot(
  businessId: string,
  reservationId: string,
  contactPhone: string,
): Promise<
  | { ok: true; client_confirmed_at: string }
  | { ok: false; error: string }
> {
  const normalized = normalizePhone(contactPhone);
  if (!normalized) {
    return { ok: false, error: "phone_required" };
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: existing } = await service
    .from("reservations")
    .select("id, business_id, customer_phone, status, client_confirmed_at")
    .eq("id", reservationId)
    .maybeSingle();
  const r = existing as
    | Pick<Reservation, "id" | "business_id" | "customer_phone" | "status">
        & { client_confirmed_at: string | null }
    | null;

  if (!r) return { ok: false, error: "reservation_not_found" };
  if (r.business_id !== businessId) return { ok: false, error: "reservation_not_found" };
  if (!mismoTelefono(r.customer_phone, contactPhone)) {
    return { ok: false, error: "reservation_not_found" };
  }
  if (r.status !== "confirmed" && r.status !== "seated") {
    return { ok: false, error: "reservation_not_active" };
  }
  if (r.client_confirmed_at) {
    return { ok: true, client_confirmed_at: r.client_confirmed_at };
  }

  const nowIso = new Date().toISOString();
  const { error } = await service
    .from("reservations")
    .update({ client_confirmed_at: nowIso })
    .eq("id", reservationId)
    .eq("business_id", businessId);
  if (error) {
    return { ok: false, error: `update_failed: ${error.message}` };
  }
  return { ok: true, client_confirmed_at: nowIso };
}
