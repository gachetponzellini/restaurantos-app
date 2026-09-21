import { TZ_AR } from "@/lib/timezone";

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatHours(minutes: number): string {
  if (minutes === 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatHoursDecimal(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

export function elapsedSince(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * `new Date("2026-09-03")` es medianoche UTC, que en AR es el 2 a las 21:00:
 * una fecha sin hora (`YYYY-MM-DD`) se ancla al **mediodía UTC** (09:00 en AR)
 * y todo se formatea en `TZ_AR`, así ningún timezone la mueve de día — ni el
 * del server ni el de una tablet mal configurada. Un timestamp completo (ya trae
 * su propia hora) se deja como está.
 */
function parseLocalDay(iso: string): Date {
  return iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
}

/** El día calendario argentino de un instante, como `YYYY-MM-DD`. */
function diaAR(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_AR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatDateShort(iso: string): string {
  return parseLocalDay(iso).toLocaleDateString("es-AR", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "short",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "2-digit",
  });
}

export function formatMonthName(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: TZ_AR,
    month: "long",
    year: "numeric",
  });
}

/**
 * «Hoy / Ayer / Hace Nd» en **días de calendario argentinos**, no en bloques de
 * 24 h: un fichaje de las 23:50 visto a las 00:10 es de «Ayer».
 */
export function relativeDate(iso: string, now: Date = new Date()): string {
  // `Date.parse("YYYY-MM-DD")` es medianoche UTC de ese día: la resta da días
  // enteros exactos, sin horario de verano ni zona de por medio.
  const diffDays = Math.round(
    (Date.parse(diaAR(now)) - Date.parse(diaAR(new Date(iso)))) /
      (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays}d`;
  return formatDateShort(iso);
}
