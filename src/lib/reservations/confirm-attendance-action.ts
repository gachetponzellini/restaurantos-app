"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatReservationWhen } from "@/lib/reservations/format-when";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

export type ReservationByToken = {
  businessName: string;
  whenLabel: string;
  partySize: number;
  status: string;
  alreadyConfirmed: boolean;
};

/**
 * Lee una reserva por su `confirm_token` (double opt-in, spec 45). Read-only,
 * sin login: el token opaco es la credencial. Devuelve null si no existe **o si
 * la reserva no es del negocio del slug** de la URL (H-08): mismo resultado que
 * un token inválido, para no revelar que el token existe bajo otro negocio.
 */
export async function getReservationByConfirmToken(
  token: string,
  businessSlug: string,
): Promise<ReservationByToken | null> {
  if (!token || token.length < 8) return null;
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: reservation } = await service
    .from("reservations")
    .select("business_id, party_size, starts_at, status, client_confirmed_at")
    .eq("confirm_token", token)
    .maybeSingle();
  if (!reservation) return null;

  const { data: business } = await service
    .from("businesses")
    .select("slug, name, timezone")
    .eq("id", reservation.business_id)
    .maybeSingle();
  if (!business || business.slug !== businessSlug) return null;

  return {
    businessName: business.name,
    whenLabel: formatReservationWhen(
      reservation.starts_at,
      business.timezone ?? DEFAULT_TZ,
    ),
    partySize: reservation.party_size,
    status: reservation.status,
    alreadyConfirmed: Boolean(reservation.client_confirmed_at),
  };
}

export type ConfirmAttendanceResult =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; error: string };

/**
 * Marca `client_confirmed_at` para la reserva del token (asistencia confirmada
 * por el cliente). Sólo para reservas activas; idempotente. Mutación por POST
 * (form action), no en el GET de la página, para no confirmar por prefetch.
 */
export async function confirmReservationAttendance(
  token: string,
  businessSlug: string,
): Promise<ConfirmAttendanceResult> {
  if (!token || token.length < 8) {
    return { ok: false, error: "Link inválido." };
  }
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: reservation } = await service
    .from("reservations")
    .select("id, business_id, status, client_confirmed_at")
    .eq("confirm_token", token)
    .maybeSingle();
  if (!reservation) return { ok: false, error: "No encontramos la reserva." };

  // H-08: la reserva tiene que ser del negocio del slug de la URL.
  const { data: business } = await service
    .from("businesses")
    .select("slug")
    .eq("id", reservation.business_id)
    .maybeSingle();
  if (!business || business.slug !== businessSlug) {
    return { ok: false, error: "No encontramos la reserva." };
  }

  if (reservation.status === "pending") {
    return {
      ok: false,
      error: "El local todavía no confirmó tu reserva. Te avisamos cuando lo haga.",
    };
  }
  if (reservation.status !== "confirmed" && reservation.status !== "seated") {
    return { ok: false, error: "Esta reserva ya no está activa." };
  }
  if (reservation.client_confirmed_at) {
    return { ok: true, alreadyConfirmed: true };
  }

  const { error } = await service
    .from("reservations")
    .update({ client_confirmed_at: new Date().toISOString() })
    .eq("id", reservation.id);
  if (error) {
    console.error("confirmReservationAttendance", error);
    return { ok: false, error: "No pudimos confirmar. Probá de nuevo." };
  }
  return { ok: true, alreadyConfirmed: false };
}
