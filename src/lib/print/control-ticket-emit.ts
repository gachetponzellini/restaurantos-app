import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ControlTicketResult = {
  /** Se creó el papel en **esta** llamada. */
  emitted: boolean;
  /**
   * Hubo un error real. Un duplicado (ya existía) o un pedido que no lleva
   * control (`dine_in`) **no** lo son: son caminos esperados. Separar los dos
   * conceptos es lo que permite avisar del fallo sin gritar en cada re-marcha.
   */
  failed: boolean;
};

/**
 * Emisión del "control de pedido" (spec 063).
 *
 * Se dispara desde `routeOrderToCocina`, que es el **único** punto por donde
 * pasa un pedido camino a cocina — las cuatro rutas (confirmar a mano, cron de
 * programados, webhook de MP, venta de mostrador) desembocan ahí. Emitir acá
 * cubre todas sin repetir la regla en cada una.
 *
 * ## Por qué esto no es un `upsert` (spec 093)
 *
 * La unicidad de `print_jobs` es un índice **parcial** (`0034:49-51`):
 *
 * ```sql
 * create unique index print_jobs_control_uniq
 *   on print_jobs (order_id) where kind = 'control';
 * ```
 *
 * Postgres **no puede inferir un índice parcial** desde `ON CONFLICT
 * (order_id)`: devuelve `42P10` y la sentencia falla **siempre**. Este archivo
 * usaba `upsert({ onConflict: "order_id" })`, heredado de `control_tickets`,
 * que tenía un único *total* (`0028:54`). Desde que la 0034 cambió la tabla, el
 * control **no se emitió nunca** — y el error se tragaba dos veces (acá y en el
 * try/catch best-effort del caller), así que no había ni una señal.
 *
 * El índice parcial es correcto y expresa la regla real: un control por orden,
 * pero las cuentas (`kind='cuenta'`) se repiten a propósito. Por eso el fix es
 * el insert guardado —mismo patrón que `client_line_key` en
 * `comandas/actions.ts`— y **no** un índice único total sobre `(order_id, kind)`,
 * que rompería la reimpresión de cuenta.
 */
export async function emitControlTicket(
  service: SupabaseClient,
  orderId: string,
  businessId: string,
  /**
   * Quién causó el papel (spec 186 · D2). Con valor, el control sale por la
   * comandera de esa cuenta si tiene una; sin valor, por la del negocio.
   *
   * Hoy **ningún caller lo pasa**, y es a propósito: los controles de
   * delivery/pickup nacen del ruteo —a veces desde el cron de marcha
   * programada, donde no hay persona— y el local ya los espera en la impresora
   * del negocio. El que va a usarlo es el control de mesa (el F3), que sí nace
   * de alguien apretando una tecla.
   */
  requestedBy?: string | null,
): Promise<ControlTicketResult> {
  const { data: order } = await service
    .from("orders")
    .select("id, business_id, delivery_type")
    .eq("id", orderId)
    .maybeSingle();

  const row = order as { business_id: string; delivery_type: string } | null;
  if (!row) return { emitted: false, failed: true };
  // Defensa cross-tenant: el caller pasa el negocio, pero la verdad es la fila.
  if (row.business_id !== businessId) return { emitted: false, failed: true };
  // El control es para lo que sale del local. Una venta de mostrador o un
  // pedido de mesa (`dine_in`) no lo necesita: no hay nada que llevar a ningún
  // lado ni plata que salir a cobrar.
  if (row.delivery_type !== "delivery" && row.delivery_type !== "pickup") {
    return { emitted: false, failed: false };
  }

  // Pre-chequeo: lo sirve `print_jobs_order_kind_idx (order_id, kind)`. Cubre el
  // caso normal de la re-marcha sin depender de que reviente el índice.
  const { count } = await service
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("kind", "control");
  if ((count ?? 0) > 0) return { emitted: false, failed: false };

  const { error } = await service.from("print_jobs").insert({
    order_id: orderId,
    business_id: businessId,
    kind: "control",
    requested_by: requestedBy ?? null,
  });

  if (error) {
    // 23505 = unique_violation contra `print_jobs_control_uniq`: entre el
    // pre-chequeo y el insert alguien más lo creó (ticks solapados del cron,
    // doble tap de «Marchar ahora»). Es el desenlace correcto, no un fallo.
    if (error.code === "23505") return { emitted: false, failed: false };
    console.error("emitControlTicket", orderId, error);
    return { emitted: false, failed: true };
  }
  return { emitted: true, failed: false };
}
