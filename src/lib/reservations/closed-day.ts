import type { WeeklySchedule } from "@/lib/reservations/types";

/**
 * H-18 — ¿el local cierra ese día? `date` es "YYYY-MM-DD" (día calendario del
 * negocio). Sólo es `true` si el schedule lo marca explícitamente
 * `open: false`; un día sin configurar no se considera cerrado.
 */
export function isClosedDay(schedule: WeeklySchedule, date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return schedule[String(dow) as keyof WeeklySchedule]?.open === false;
}
