import type { ReservationStatus } from "@/lib/reservations/types";

/**
 * H-14 — regla única de «¿el cliente puede cancelar online?». La comparten la
 * UI (my-reservations-screen, reservar/confirmacion) y `cancelOwnReservation`,
 * para que la UI no ofrezca un botón que el server después rechaza.
 *
 * Cancelable sólo si está `pending` o `confirmed` (una `seated` ya está en la
 * mesa) y todavía no pasó `starts_at - lead_time_min`. En el límite exacto el
 * server deja pasar (rechaza sólo si `now > cutoff`), así que acá también.
 */
export function canCancelReservation(params: {
  status: ReservationStatus;
  startsAt: string | Date;
  leadTimeMin: number;
  now?: Date;
}): boolean {
  if (params.status !== "pending" && params.status !== "confirmed") return false;
  const now = (params.now ?? new Date()).getTime();
  const cutoff = new Date(params.startsAt).getTime() - params.leadTimeMin * 60_000;
  if (Number.isNaN(cutoff)) return false;
  return !(now > cutoff);
}
