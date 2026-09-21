import { toZonedTime } from "date-fns-tz";

export type BusinessHour = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
};

function timeToSeconds(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
}

function effectiveClose(t: string): number {
  const secs = timeToSeconds(t);
  return secs === 0 ? 86400 : secs;
}

export function computeIsOpen(
  hours: BusinessHour[],
  timezone: string,
  now: Date = new Date(),
): boolean {
  const zoned = toZonedTime(now, timezone);
  const dow = zoned.getDay();
  const secondsNow =
    zoned.getHours() * 3600 + zoned.getMinutes() * 60 + zoned.getSeconds();

  const ayer = (dow + 6) % 7;
  return hours.some((h) => {
    const abre = timeToSeconds(h.opens_at);
    const cierra = effectiveClose(h.closes_at);
    // Turno que cruza la medianoche (20:00–01:00): hoy desde que abre hasta el
    // final del día, y la cola del turno de AYER hasta que cierra.
    if (cierra <= abre) {
      if (h.day_of_week === dow && secondsNow >= abre) return true;
      if (h.day_of_week === ayer && secondsNow < cierra) return true;
      return false;
    }
    return h.day_of_week === dow && secondsNow >= abre && secondsNow < cierra;
  });
}

/**
 * ¿Se puede tomar un pedido **inmediato** del checkout público ahora?
 *
 * Auditoría de pedidos · ALTA: el server no miraba el horario — a las 3 de la
 * mañana un pedido pagado por MP se marchaba solo e imprimía. Un local sin
 * horarios cargados no se bloquea: rechazar todo sería peor que el hueco.
 * (Los programados se validan aparte, contra su grilla.)
 */
export function aceptaPedidoInmediato(
  hours: BusinessHour[],
  timezone: string,
  now: Date = new Date(),
): boolean {
  if (hours.length === 0) return true;
  return computeIsOpen(hours, timezone, now);
}
