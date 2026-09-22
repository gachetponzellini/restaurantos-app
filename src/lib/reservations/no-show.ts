import type { Reservation } from "@/lib/reservations/types";

/**
 * Predicado puro del auto-cierre (spec 22): ¿una reserva quedó vencida sin
 * sentarse? True solo para `confirmed` cuyo `starts_at + gracia` ya pasó Y su
 * mesa no está ocupada.
 *
 * Espejo en TS de la condición de la función SQL
 * `mark_overdue_reservations_no_show()` (pg_cron) — vive acá aparte para poder
 * testearla sin correr el cron. Solo `confirmed` se cierra: `seated` ya está en
 * mesa, y `completed`/`cancelled`/`no_show` son terminales.
 *
 * `mesaOcupada` (#148 · H-46) — sentar la reserva como walk-in (único camino
 * que tenía la app del mozo antes de esto) ocupaba la mesa sin tocar
 * `reservations.status`: la reserva se quedaba `confirmed` con la mesa llena,
 * y a los `graceMin` el cron la marcaba `no_show` con gente comiendo. Con la
 * mesa ocupada, no se cierra — alguien la tomó. `undefined` (reserva sin mesa
 * fija, `table_id` null) no cuenta como ocupada: sigue la regla de siempre.
 */
export function isOverdueConfirmed(
  reservation: Pick<Reservation, "status" | "starts_at">,
  graceMin: number,
  now: Date,
  mesaOcupada = false,
): boolean {
  if (reservation.status !== "confirmed") return false;
  if (mesaOcupada) return false;
  const cutoff = new Date(new Date(reservation.starts_at).getTime() + graceMin * 60_000);
  return cutoff.getTime() < now.getTime();
}
