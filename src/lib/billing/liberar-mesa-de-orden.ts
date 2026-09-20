import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Libera la mesa que es dueña de una orden que se acaba de cerrar, y completa
 * su reserva sentada. Extraído de `closeOrderIfFullyPaid` para que lo comparta
 * «Cerrar sin cobro» (la mesa de $0): las dos terminan igual.
 */
export async function liberarMesaDeOrden(
  service: GenericClient,
  params: {
    businessId: string;
    orderId: string;
    orderNumber: number;
    /** `orders.table_id`: sólo si nadie referencia la orden por `current_order_id`. */
    tableIdFallback: string | null;
    /** Queda en `tables_audit_log.reason`. */
    motivo: string;
  },
): Promise<void> {
  // La mesa va directo a `libre` (sin la transición `limpiar`, migración 0038).
  //
  // La mesa a liberar es la que ACTUALMENTE es dueña de la orden
  // (`tables.current_order_id`), no `orders.table_id`: si un traslado
  // concurrente (spec 048) movió la orden entre la lectura y acá, `table_id`
  // quedó viejo y se liberaría la mesa equivocada, dejando la destino «ocupada»
  // apuntando a una orden cerrada (mesa fantasma). Keyear por
  // `current_order_id` es idempotente y sigue a la orden. El fallback a
  // `table_id` sólo corre si nadie la referencia — o sea que no hubo traslado.
  const { data: ownerRow } = await service
    .from("tables")
    .select("id, operational_status")
    .eq("current_order_id", params.orderId)
    .maybeSingle();
  const ownerTableId =
    (ownerRow as { id: string } | null)?.id ?? params.tableIdFallback;

  if (ownerTableId) {
    const fromStatus =
      (ownerRow as { operational_status: string } | null)?.operational_status ??
      null;

    // mozo_id se preserva: la asignación es fija hasta que el encargado la
    // cambie manualmente desde "Distribuir mozos". Cobrar una mesa no la
    // saca del mozo que la atiende.
    await service
      .from("tables")
      .update({
        operational_status: "libre",
        opened_at: null,
        current_order_id: null,
      })
      .eq("id", ownerTableId);

    await service.from("tables_audit_log").insert({
      table_id: ownerTableId,
      business_id: params.businessId,
      kind: "status",
      from_value: fromStatus,
      to_value: "libre",
      by_user_id: null,
      reason: params.motivo,
    });

    // La reserva seated asociada (si la hubo) pasa a completed: el cliente
    // consumió y pagó. Si no, queda pegada a la mesa libre (orphan).
    const { error: resErr } = await service
      .from("reservations")
      .update({ status: "completed" })
      .eq("table_id", ownerTableId)
      .eq("business_id", params.businessId)
      .eq("status", "seated");
    if (resErr) console.error("cobro: completar reserva seated", resErr);
  }
}
