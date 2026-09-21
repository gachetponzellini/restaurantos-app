/**
 * La zona horaria del producto (regla dura: timezone SIEMPRE explícita).
 *
 * Sin esto, `toLocaleTimeString` formatea con la zona de quien renderiza: en el
 * server de Vercel (UTC) sale corrida 3 h y se corrige recién al hidratar, y
 * una tablet mal configurada la muestra mal para siempre (issue #157).
 */
export const TZ_AR = "America/Argentina/Buenos_Aires";

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `DD/MM/YYYY` en día argentino.
 *
 * Una columna `date` llega como `"YYYY-MM-DD"` y **no es un instante**:
 * `new Date("2026-08-20")` es medianoche UTC, que en AR es el 19 a las 21:00, y
 * formatearla como instante la corría un día para atrás (el vencimiento del CAE
 * salía mal en el ticket fiscal). Esas se arman sin pasar por `Date`; los
 * timestamps se formatean en `TZ_AR`. Vacío o inválido → `""`.
 */
export function formatFechaAR(iso: string): string {
  const soloFecha = SOLO_FECHA.exec(iso);
  if (soloFecha) return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`;
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("day")}/${pick("month")}/${pick("year")}`;
}
