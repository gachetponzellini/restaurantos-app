"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCerrarSinCobro } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { liberarMesaDeOrden } from "./liberar-mesa-de-orden";

type GenericClient = SupabaseClient;

/**
 * Cierra una cuenta de $0 sin cobrarla — la invitación total (migración 0126).
 *
 * Una cuenta en $0 no se cobra (no hay pago de $0) y nunca se daba por saldada:
 * la mesa quedaba abierta y trababa el cierre de caja. La única salida era
 * «Anular mesa», que cancela la orden — la venta desaparece del día, el stock
 * vuelve aunque la comida se sirvió, y no queda quién invitó.
 *
 * Esto la cierra como entregada, sin pago ni comprobante (la base facturable
 * es $0), con el stock descontado, y deja escrito por qué, quién, y cuánto
 * valía de carta lo que se regaló.
 *
 * El total se recalcula acá desde los ítems vivos: `orders.total_cents` puede
 * estar viejo, y esto es la única puerta por la que una mesa se va sin pagar.
 */
export async function cerrarSinCobro(
  orderId: string,
  motivo: string,
  businessSlug: string,
): Promise<ActionResult<{ valor_carta_cents: number }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canCerrarSinCobro(ctx.role)) {
    return actionError("Sólo encargado o admin pueden cerrar una cuenta sin cobrarla.");
  }
  const reason = motivo.trim();
  if (!reason) return actionError("Decí por qué se invita: queda en el resumen del día.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: orderRow } = await service
    .from("orders")
    .select(
      "id, business_id, order_number, table_id, lifecycle_status, status, tip_cents, discount_cents, delivery_fee_cents",
    )
    .eq("id", orderId)
    .maybeSingle();
  const order = orderRow as {
    id: string;
    business_id: string;
    order_number: number;
    table_id: string | null;
    lifecycle_status: string;
    status: string;
    tip_cents: number;
    discount_cents: number | null;
    delivery_fee_cents: number | null;
  } | null;
  if (!order || order.business_id !== business.id) return actionError("Orden no encontrada.");
  if (order.status === "cancelled") return actionError("El pedido está cancelado.");
  if (order.lifecycle_status !== "open") return actionError("La cuenta ya está cerrada.");

  const { data: itemRows } = await service
    .from("order_items")
    .select("quantity, subtotal_cents, unit_price_cents, price_original_cents, cancelled_at")
    .eq("order_id", orderId);
  const vivos = (
    (itemRows ?? []) as Array<{
      quantity: number;
      subtotal_cents: number;
      unit_price_cents: number;
      price_original_cents: number | null;
      cancelled_at: string | null;
    }>
  ).filter((i) => !i.cancelled_at);
  if (vivos.length === 0) {
    return actionError("La mesa no tiene consumo: no hay nada que invitar. Liberá la mesa.");
  }

  const subtotal = vivos.reduce((n, i) => n + Number(i.subtotal_cents), 0);
  const total = Math.max(
    0,
    subtotal + Number(order.tip_cents) + Number(order.delivery_fee_cents ?? 0) -
      Number(order.discount_cents ?? 0),
  );
  if (total > 0) {
    return actionError("Esta cuenta debe plata: se cobra. Sólo se cierra sin cobro una cuenta de $0.");
  }

  // Si ya entró algún pago, esto no es una invitación: hay plata que ubicar.
  const { count: pagos } = await service
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("payment_status", "paid");
  if ((pagos ?? 0) > 0) {
    return actionError("Esta cuenta tiene cobros registrados: anulalos antes de cerrarla sin cobro.");
  }

  // Lo que valía de carta: el precio original del ítem (si se lo pisó a $0) o
  // su precio, por la cantidad. Es el número que el dueño mira.
  const valorCarta = vivos.reduce(
    (n, i) =>
      n + Number(i.price_original_cents ?? i.unit_price_cents) * Number(i.quantity),
    0,
  );

  const { data: cerrada, error } = await service
    .from("orders")
    .update({
      lifecycle_status: "closed",
      closed_at: new Date().toISOString(),
      status: "delivered",
      // Saldada: no debe nada. Es lo que lee todo lo que pregunta «¿está paga?».
      payment_status: "paid",
      total_cents: 0,
      total_paid_cents: 0,
      cortesia_reason: reason,
      cortesia_by: ctx.userId,
      cortesia_valor_cents: valorCarta,
      comprobante_elegido: null,
    })
    .eq("id", orderId)
    .eq("lifecycle_status", "open")
    .select("id");
  if (error || ((cerrada ?? []) as unknown[]).length === 0) {
    return actionError(`No se pudo cerrar la cuenta${error ? `: ${error.message}` : "."}`);
  }

  await liberarMesaDeOrden(service, {
    businessId: business.id,
    orderId,
    orderNumber: order.order_number,
    tableIdFallback: order.table_id,
    motivo: `cerrada sin cobro (invitación) order ${order.order_number}`,
  });

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({ valor_carta_cents: valorCarta });
}
