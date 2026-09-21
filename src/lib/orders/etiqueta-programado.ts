import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

/**
 * «21:30» si el programado es para hoy (día del local), «sáb 27 · 21:30» si no.
 * `null` si el pedido no está programado (auditoría de pedidos · baja).
 */
export function etiquetaProgramado(
  scheduledAt: string | null,
  timezone: string,
  now: Date = new Date(),
): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  const hoy = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const dia = formatInTimeZone(d, timezone, "yyyy-MM-dd");
  const hora = formatInTimeZone(d, timezone, "HH:mm");
  return dia === hoy ? hora : `${formatInTimeZone(d, timezone, "EEE d", { locale: es })} · ${hora}`;
}
