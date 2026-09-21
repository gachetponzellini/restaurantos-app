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
 * una fecha sin hora (`YYYY-MM-DD`) se ancla al mediodía para que ningún
 * timezone la mueva de día. Un timestamp completo (ya trae su propia hora)
 * se deja como está.
 */
function parseLocalDay(iso: string): Date {
  return iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
}

export function formatDateShort(iso: string): string {
  return parseLocalDay(iso).toLocaleDateString("es-AR", {
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

export function relativeDate(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays}d`;
  return formatDateShort(iso);
}
