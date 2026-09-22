/**
 * El horizonte de reservas, en días calendario del negocio (#372).
 *
 * Había dos reglas distintas para lo mismo:
 * - el calendario (`computeAvailableSlots`) ofrecía hasta el día `hoy + N`
 *   ENTERO, comparando fechas en la zona del negocio;
 * - el alta (`booking-actions`) rechazaba si faltaban más de `N × 24 h`
 *   exactas desde este instante.
 * Resultado: el último día se ofrecía y después se rechazaba cualquier turno
 * más tarde que la hora actual. Ahora las dos usan ésta.
 *
 * Además el cliente calculaba «hoy» con la zona del navegador y el último día
 * cortando en UTC (de 21 a 24 h en Argentina ya es mañana en UTC). Todo acá se
 * calcula en la zona del negocio. Puro: lo usan el server y la página pública.
 */

/** La fecha de hoy (YYYY-MM-DD) en la zona del negocio. */
export function hoyEnZona(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Suma días a una fecha YYYY-MM-DD (aritmética de calendario, sin horas). */
export function sumarDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** ¿Se puede reservar esa fecha? Hasta `hoy + diasMax` inclusive. */
export function dentroDelHorizonte(
  fechaYmd: string,
  now: Date,
  diasMax: number,
  timezone: string,
): boolean {
  return fechaYmd <= sumarDias(hoyEnZona(now, timezone), diasMax);
}

/** Minutos desde la medianoche en el reloj del negocio. */
export function minutosAhoraEnZona(now: Date, timezone: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
