import { formatInTimeZone } from "date-fns-tz";
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
  return `${formatInTimeZone(d, timezone, "EEE d 'de' MMM", { locale: es })} · ${formatInTimeZone(d, timezone, "HH:mm")} hs`;
}
