import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";

/**
 * H-30 — formato único de fecha y hora de una reserva para el cliente:
 * «mié 7 de oct · 21:00 hs», siempre en la TZ del negocio. Sale en minúsculas
 * a propósito: la UI no debe aplicar `text-transform: capitalize`, que rompe
 * «de» → «De» y «hs» → «Hs».
 */
export function formatReservationWhen(
  startsAt: string | Date,
  timezone: string,
): string {
  const d = new Date(startsAt);
  return `${formatReservationDay(d, timezone)} · ${formatInTimeZone(d, timezone, "HH:mm")} hs`;
}

/** Sólo el día: «mié 7 de oct». */
export function formatReservationDay(
  startsAt: string | Date,
  timezone: string,
): string {
  return formatInTimeZone(new Date(startsAt), timezone, "EEE d 'de' MMM", {
    locale: es,
  });
}

/**
 * Igual que `formatReservationWhen` pero desde la fecha ("YYYY-MM-DD") y el
 * slot ("HH:MM") locales del negocio, como los guarda el intent del chatbot.
 */
export function formatReservationSlotWhen(
  date: string,
  slot: string,
  timezone: string,
): string {
  return formatReservationWhen(
    fromZonedTime(`${date}T${slot}:00`, timezone),
    timezone,
  );
}
