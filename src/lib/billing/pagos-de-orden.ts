"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCorregirCobro } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericClient = SupabaseClient<any, any, any>;

/** Una línea de cobro tal como la ve el encargado en el detalle del pedido. */
export type PagoDeOrden = {
  id: string;
  created_at: string;
  method: string;
  amount_cents: number;
  tip_cents: number;
  /** Lo que el cliente entregó (spec 177). Null en pagos viejos. */
  received_cents: number | null;
  anulado: boolean;
  refunded_reason: string | null;
  caja: string | null;
  operado_por: string | null;
  mozo: string | null;
};

/**
 * Los cobros de una orden, anulados incluidos — issue #339.
 *
 * El detalle del pedido mostraba el total y un chip «pendiente / pagado», nada
 * más. Cuando algo sale mal (un pago cargado dos veces, una línea anulada) lo
 * que el encargado necesita ver es cada línea: cuánto, cómo, en qué caja,
 * quién, y si se anuló, por qué. Va por el service client porque cruza
 * `payments` con `business_users` y `cajas`; el gate es el mismo que el del
 * historial de correcciones de la caja.
 */
export async function listarPagosDeOrden(
  slug: string,
  orderId: string,
): Promise<ActionResult<PagoDeOrden[]>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCorregirCobro(ctxResult.data.role)) {
    return actionError("No tenés permiso para ver los cobros.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("payments")
    .select(
      "id, created_at, method, amount_cents, tip_cents, received_cents, payment_status, refunded_reason, caja_id, operated_by, attributed_mozo_id",
    )
    .eq("business_id", business.id)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) return actionError("No pudimos leer los cobros.");

  const rows = (data ?? []) as Array<{
    id: string;
    created_at: string;
    method: string;
    amount_cents: number;
    tip_cents: number;
    received_cents: number | null;
    payment_status: string;
    refunded_reason: string | null;
    caja_id: string | null;
    operated_by: string | null;
    attributed_mozo_id: string | null;
  }>;
  // Los `pending` son MP en curso: todavía no son un cobro.
  const vivos = rows.filter((r) => r.payment_status !== "pending");

  const userIds = [
    ...new Set(
      vivos.flatMap((r) => [r.operated_by, r.attributed_mozo_id]).filter(Boolean),
    ),
  ] as string[];
  const cajaIds = [
    ...new Set(vivos.map((r) => r.caja_id).filter(Boolean)),
  ] as string[];

  const [usersRes, cajasRes] = await Promise.all([
    userIds.length
      ? service
          .from("business_users")
          .select("user_id, full_name")
          .eq("business_id", business.id)
          .in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    cajaIds.length
      ? service
          .from("cajas")
          .select("id, name")
          .eq("business_id", business.id)
          .in("id", cajaIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nombre = new Map(
    ((usersRes.data ?? []) as { user_id: string; full_name: string | null }[]).map(
      (u) => [u.user_id, u.full_name],
    ),
  );
  const caja = new Map(
    ((cajasRes.data ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  );

  return actionOk(
    vivos.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      method: r.method,
      amount_cents: Number(r.amount_cents),
      tip_cents: Number(r.tip_cents ?? 0),
      received_cents: r.received_cents == null ? null : Number(r.received_cents),
      anulado: r.payment_status === "refunded",
      refunded_reason: r.refunded_reason,
      caja: r.caja_id ? (caja.get(r.caja_id) ?? null) : null,
      operado_por: r.operated_by ? (nombre.get(r.operated_by) ?? null) : null,
      mozo: r.attributed_mozo_id
        ? (nombre.get(r.attributed_mozo_id) ?? null)
        : null,
    })),
  );
}
