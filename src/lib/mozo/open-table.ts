/**
 * openTable — lógica compartida para abrir una mesa (crear order + marcar ocupada).
 *
 * Usado por:
 *   - sentarWalkIn (mozo sienta cliente sin reserva)
 *   - sentarReserva (admin sienta reserva confirmada)
 *
 * NO es server action — es un helper interno. Los callers manejan auth,
 * customer upsert y revalidatePath.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canTransition, nextOpenedAt } from "@/lib/mozo/state-machine";

type GenericClient = SupabaseClient;

export type OpenTableOpts = {
  service: GenericClient;
  businessId: string;
  table: {
    id: string;
    operational_status: string;
    opened_at: string | null;
    mozo_id: string | null;
  };
  actorUserId: string;
  customerName: string;
  customerPhone: string;
  customerId: string | null;
  notes: string | null;
  /** Cuántas personas se sentaron (spec 111). Hasta la migración 0045 este
   *  dato llegaba hasta acá y se perdía: no había dónde guardarlo. */
  partySize?: number | null;
};

export type OpenTableResult = {
  orderId: string | null;
  autoAssignedMozo: boolean;
};

export async function openTable(
  opts: OpenTableOpts,
): Promise<ActionResult<OpenTableResult>> {
  const {
    service,
    businessId,
    table,
    actorUserId,
    customerName,
    customerPhone,
    customerId,
    notes,
    partySize,
  } = opts;

  // Guard: solo mesas libres.
  if (table.operational_status !== "libre") {
    return actionError("La mesa no está libre.");
  }
  if (!canTransition("libre", "ocupada")) {
    return actionError("Transición no permitida.");
  }

  // Orden `open` ya existente en la mesa. Reusarla es la idempotencia del
  // doble tap (la creó un toque anterior y todavía está vacía). Pero una mesa
  // **libre** con una cuenta que ya tiene consumo es una cuenta huérfana del
  // grupo anterior: reusarla le cargaba sus platos al grupo nuevo (#148 ·
  // H-47). Se chequea antes de tocar la mesa, para no dejarla a medio abrir.
  const { data: existingOrder } = await service
    .from("orders")
    .select("id")
    .eq("table_id", table.id)
    .eq("business_id", businessId)
    .eq("lifecycle_status", "open")
    .maybeSingle();
  if (existingOrder) {
    const { count: itemsVivos } = await service
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", (existingOrder as { id: string }).id)
      .is("cancelled_at", null);
    if ((itemsVivos ?? 0) > 0) {
      return actionError(
        "Esta mesa tiene una cuenta abierta de antes, con consumo. Cobrala o anulala antes de sentar a alguien nuevo.",
      );
    }
  }

  // Auto-asignación: si la mesa no tenía mozo, queda el actor.
  const willAssignMozo = table.mozo_id === null;
  const newMozoId = table.mozo_id ?? actorUserId;

  const newOpenedAt = nextOpenedAt("libre", "ocupada", table.opened_at);
  const { error: tableErr } = await service
    .from("tables")
    .update({
      operational_status: "ocupada",
      opened_at: newOpenedAt,
      mozo_id: newMozoId,
    })
    .eq("id", table.id);
  if (tableErr) {
    console.error("openTable table update", tableErr);
    return actionError("No pudimos abrir la mesa.");
  }

  // Crear order open (o reusar la vacía de arriba — idempotencia).
  let orderId: string | null = existingOrder
    ? (existingOrder as { id: string }).id
    : null;
  if (!existingOrder) {
    const { data: orderData, error: orderErr } = await service
      .from("orders")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: customerName || "Walk-in",
        customer_phone: customerPhone || "-",
        customer_id: customerId,
        delivery_type: "dine_in",
        table_id: table.id,
        mozo_id: newMozoId,
        lifecycle_status: "open",
        subtotal_cents: 0,
        delivery_fee_cents: 0,
        total_cents: 0,
        delivery_notes: notes || null,
        party_size: partySize ?? null,
        payment_method: "cash",
      } as any)
      .select("id")
      .single();
    if (orderErr) {
      console.error("openTable order insert", orderErr);
      // No bloqueante: enviarComanda la creará al cargar items.
    } else {
      orderId = (orderData as { id: string }).id;
    }
  }

  // Vincular order a la mesa.
  if (orderId) {
    await service
      .from("tables")
      .update({ current_order_id: orderId })
      .eq("id", table.id);
  }

  // Audit log.
  const auditRows: Array<{
    table_id: string;
    business_id: string;
    kind: "status" | "assignment";
    from_value: string | null;
    to_value: string | null;
    by_user_id: string;
  }> = [
    {
      table_id: table.id,
      business_id: businessId,
      kind: "status",
      from_value: "libre",
      to_value: "ocupada",
      by_user_id: actorUserId,
    },
  ];
  if (willAssignMozo) {
    auditRows.push({
      table_id: table.id,
      business_id: businessId,
      kind: "assignment",
      from_value: null,
      to_value: actorUserId,
      by_user_id: actorUserId,
    });
  }
  const { error: auditErr } = await service
    .from("tables_audit_log")
    .insert(auditRows);
  if (auditErr) console.error("openTable audit", auditErr);

  return actionOk({ orderId, autoAssignedMozo: willAssignMozo });
}
