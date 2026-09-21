import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";

/**
 * Tope de reservas vivas por cliente y por día (auditoría de reservas · ALTA).
 *
 * Sin tope, una sola cuenta podía crear N reservas `pending` y ocupar el cupo
 * de un servicio durante días (recién vencen 2 h antes del turno). Máximo 2
 * vivas (pending | confirmed) por cuenta, por día local del turno, por negocio:
 * alcanza para «almuerzo y cena» y corta el abuso.
 */
export const MAX_RESERVAS_VIVAS_POR_DIA = 2;

export const TOPE_RESERVAS_MSG =
  "Ya tenés reservas para ese día. Si querés cambiarla, cancelá la anterior desde Mis reservas.";

export async function excedeTopeDeReservas(
  service: SupabaseClient,
  params: {
    businessId: string;
    userId: string;
    /** Día local del turno, `YYYY-MM-DD`. */
    fechaLocal: string;
    timezone: string;
  },
): Promise<boolean> {
  const desde = fromZonedTime(`${params.fechaLocal}T00:00:00`, params.timezone);
  const hasta = new Date(desde.getTime() + 24 * 3600_000);
  const { count, error } = await service
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", params.businessId)
    .eq("user_id", params.userId)
    .in("status", ["pending", "confirmed"])
    .gte("starts_at", desde.toISOString())
    .lt("starts_at", hasta.toISOString());
  if (error) {
    console.error("excedeTopeDeReservas", error);
    return false;
  }
  return (count ?? 0) >= MAX_RESERVAS_VIVAS_POR_DIA;
}
