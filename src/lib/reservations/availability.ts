import { fromZonedTime } from "date-fns-tz";

import type {
  FloorTable,
  Reservation,
  ReservationSettings,
  WeeklySchedule,
} from "@/lib/reservations/types";
import { LIVE_RESERVATION_STATUSES } from "@/lib/reservations/types";
import { dentroDelHorizonte } from "@/lib/reservations/horizonte";

/**
 * A slot that the customer can pick. Represented as the local "HH:MM" string
 * the user sees plus the resolved start/end timestamps so the booking action
 * doesn't need to recompute them.
 */
export type AvailableSlot = {
  slot: string;
  starts_at: Date;
  ends_at: Date;
  /**
   * Spec 144 — mesas del pool que quedan libres **en este slot** (activas, con
   * lugar para el grupo y sin conflicto contando el buffer). El picker del
   * formulario de reserva pinta el plano con esto: antes miraba el
   * `operational_status`, que es el estado del *ahora* y para una reserva de
   * mañana no dice nada.
   */
  freeTableIds: string[];
};

export type ComputeSlotsParams = {
  /** Local YYYY-MM-DD in the business timezone (the date the customer picked). */
  date: string;
  partySize: number;
  settings: Pick<
    ReservationSettings,
    "slot_duration_min" | "buffer_min" | "lead_time_min" | "advance_days_max" | "max_party_size" | "schedule"
  >;
  /** All active tables of the business (we filter status here). */
  tables: FloorTable[];
  /** Live reservations (confirmed/seated) overlapping the day. */
  reservations: Pick<Reservation, "table_id" | "starts_at" | "ends_at" | "status">[];
  timezone: string;
  /** Defaults to `new Date()` — injectable for tests. */
  now?: Date;
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDayKey(date: string): keyof WeeklySchedule | null {
  // date is YYYY-MM-DD interpreted in the business TZ. We compute dayOfWeek
  // by treating the date as a local calendar date, which is TZ-agnostic
  // (Sunday is Sunday no matter where you stand).
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  // UTC date avoids DST shifts shifting the weekday.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return String(dow) as keyof WeeklySchedule;
}

function combineDateAndSlot(date: string, slot: string, timezone: string): Date | null {
  if (!HHMM_RE.test(slot)) return null;
  // Build a local-wall-clock string and convert to UTC instant via TZ.
  const wall = `${date}T${slot}:00`;
  const utc = fromZonedTime(wall, timezone);
  if (Number.isNaN(utc.getTime())) return null;
  return utc;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * True if the given window overlaps any LIVE reservation already booked on
 * that table. The turnover buffer is added to BOTH ends of the existing
 * reservation so two back-to-back bookings get the gap regardless of the order
 * in which they were made (spec 36 · R-E2). Antes el buffer se sumaba sólo al
 * `ends_at`, así que una reserva nueva ANTERIOR entraba pegada sin gap.
 */
function tableHasConflict(
  tableId: string,
  windowStart: Date,
  windowEnd: Date,
  bufferMs: number,
  reservations: ComputeSlotsParams["reservations"],
): boolean {
  for (const r of reservations) {
    if (r.table_id !== tableId) continue;
    if (!LIVE_RESERVATION_STATUSES.includes(r.status)) continue;
    const rs = new Date(new Date(r.starts_at).getTime() - bufferMs);
    const re = new Date(new Date(r.ends_at).getTime() + bufferMs);
    if (rangesOverlap(windowStart, windowEnd, rs, re)) return true;
  }
  return false;
}

/**
 * Reservation-lookup window (UTC ISO) covering the full local day plus its
 * neighbors, so the buffer/overlap logic near midnight is correct in ANY
 * timezone. Built from the business TZ via `fromZonedTime` — NOT from a fixed
 * UTC midnight (that older approach only worked for negative offsets like AR
 * by luck). One day of padding on each side absorbs the turnover buffer of
 * reservations that start the day before / end the day after.
 */
export function availabilityLookupWindow(
  date: string,
  timezone: string,
): { fromIso: string; toIso: string } {
  const dayStart = fromZonedTime(`${date}T00:00:00`, timezone);
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    fromIso: new Date(dayStart.getTime() - dayMs).toISOString(),
    toIso: new Date(dayStart.getTime() + 2 * dayMs).toISOString(),
  };
}

/**
 * Pure function. Given settings, tables, and existing reservations, returns
 * the slots a customer with `partySize` can book on `date`. A slot is
 * available when at least one active table fits the party AND has no live
 * reservation overlapping (slot + duration + buffer).
 */
export function computeAvailableSlots(params: ComputeSlotsParams): AvailableSlot[] {
  const { date, partySize, settings, tables, reservations, timezone } = params;
  const now = params.now ?? new Date();

  if (partySize < 1 || partySize > settings.max_party_size) return [];

  // Reject dates beyond the booking horizon. We compare in the business TZ
  // calendar to avoid edge-of-day off-by-one near midnight UTC.
  const todayInTz = fromZonedTime(`${formatYmdLocal(now, timezone)}T00:00:00`, timezone);
  const target = fromZonedTime(`${date}T00:00:00`, timezone);
  if (target < todayInTz) return [];
  // #372 — la misma regla que valida el alta (días calendario del negocio).
  if (!dentroDelHorizonte(date, now, settings.advance_days_max, timezone)) return [];

  const dayKey = parseDayKey(date);
  if (!dayKey) return [];
  const day = settings.schedule[dayKey];
  if (!day || !day.open || day.slots.length === 0) return [];

  const leadCutoff = new Date(now.getTime() + settings.lead_time_min * 60_000);
  const durationMs = settings.slot_duration_min * 60_000;
  const bufferMs = settings.buffer_min * 60_000;

  const eligibleTables = tables.filter(
    (t) => t.status === "active" && t.seats >= partySize,
  );
  if (eligibleTables.length === 0) return [];

  const out: AvailableSlot[] = [];
  const seen = new Set<string>();

  for (const slot of day.slots) {
    if (seen.has(slot)) continue;
    seen.add(slot);
    const start = combineDateAndSlot(date, slot, timezone);
    if (!start) continue;
    if (start < leadCutoff) continue;
    const end = new Date(start.getTime() + durationMs);

    const freeTableIds = eligibleTables
      .filter((t) => !tableHasConflict(t.id, start, end, bufferMs, reservations))
      .map((t) => t.id);
    if (freeTableIds.length > 0) {
      out.push({ slot, starts_at: start, ends_at: end, freeTableIds });
    }
  }

  // Stable ordering by starts_at (slots may not be sorted in DB).
  out.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
  return out;
}

/**
 * YYYY-MM-DD in the given timezone. Avoids importing formatInTimeZone here
 * just for one use; keeps the date math local to this module.
 */
function formatYmdLocal(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}
