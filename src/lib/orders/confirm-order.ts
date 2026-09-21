"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canConfirmOrder } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { routeOrderToCocina, type RouteOrderResult } from "./route-to-cocina";
import { esperaSuHoraDeMarcha, isScheduledForLater } from "./scheduled";
import { notifyScheduledConfirmed } from "@/lib/notifications/delivery-notify";

type GenericClient = SupabaseClient;

export type ConfirmarPedidoResult = RouteOrderResult;

/**
 * Fallback manual: toma un pedido entrante (delivery / take-away / web /
 * chatbot) en estado `pending`, rutea a cocina vía `routeOrderToCocina`.
 *
 * Sobre un pedido programado es el botón «Marchar ahora»: lo manda a cocina en
 * el acto, sin esperar el lead. Por eso acepta también `confirmed` (spec 061):
 * un programado que el encargado ya aceptó sigue necesitando el escape manual.
 *
 * Solo encargado / admin / platform admin (`canConfirmOrder`).
 * Idempotente via `routeOrderToCocina`.
 */
export async function confirmarPedido(
  orderId: string,
  slug: string,
  /**
   * Indicación para cocina que el encargado escribe RECIÉN al marchar («21:30»,
   * «junto con la mesa 5»). Sale como «ENTREGAR x» arriba de la comanda. Se
   * guarda antes de rutear, así el papel ya sale con ella; si viene vacía se
   * borra la que hubiera (el encargado la sacó a propósito), y si viene
   * `undefined` —el botón inline de la card, que no la pide— no se toca nada.
   */
  kitchenNotes?: string,
): Promise<ActionResult<ConfirmarPedidoResult>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canConfirmOrder(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden confirmar pedidos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: order } = await service
    .from("orders")
    .select("id, business_id, status, delivery_type, kitchen_at, scheduled_at")
    .eq("id", orderId)
    .maybeSingle();
  type OrderRow = {
    id: string;
    business_id: string;
    status: string;
    delivery_type: string;
    kitchen_at: string | null;
    scheduled_at: string | null;
  };
  const orderRow = order as OrderRow | null;
  if (!orderRow || orderRow.business_id !== business.id) {
    return actionError("Pedido no encontrado.");
  }
  if (orderRow.delivery_type === "dine_in") {
    return actionError(
      "Los pedidos en mesa no se confirman acá — los carga el mozo desde el salón.",
    );
  }
  // `preparing` se acepta para poder **rescatar** un pedido roto (spec 093):
  // los que H-18 (botón «Preparar» sobre un programado vencido) y H-22 (ningún
  // ítem resolvió sector) dejaron en `preparing` sin una sola comanda no tenían
  // salida — el cron ya no los mira y este mismo techo los rechazaba. El filtro
  // fino lo hace `routeOrderToCocina`, que corta por idempotencia si la orden ya
  // tiene comandas: un pedido sano en `preparing` sigue devolviendo no-op.
  if (
    orderRow.status !== "pending" &&
    orderRow.status !== "confirmed" &&
    orderRow.status !== "preparing"
  ) {
    return actionError(`El pedido ya está en estado "${orderRow.status}".`);
  }

  if (kitchenNotes !== undefined) {
    const nota = kitchenNotes.trim().slice(0, 120);
    const { error: notesErr } = await service
      .from("orders")
      .update({ kitchen_notes: nota || null })
      .eq("id", orderId)
      .eq("business_id", business.id);
    // Si falla, se marcha igual: mejor la comanda sin la nota que el pedido
    // trabado en el board. Queda en el log del server.
    if (notesErr) console.error("confirmarPedido · kitchen_notes", notesErr);
  }

  // Spec 127 — el papel y el estado se separan. Un encargue de hoy para las
  // 21:30 necesita que la comanda salga ahora (cocina se organiza con la hora
  // impresa, que es lo que ya hacía) pero NO que el pedido aparezca en
  // «Preparando» tres horas antes: la columna mostraría quince pedidos en
  // preparación de los que ninguno se está preparando. El estado lo avanza el
  // cron a `kitchen_at − lead`.
  const esperando = esperaSuHoraDeMarcha(orderRow, business);
  const result = await routeOrderToCocina(orderId, business.id, {
    skipStatusAdvance: esperando,
  });

  revalidatePath(`/${slug}/admin/pedidos`);
  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/mozo`);

  return result;
}

/**
 * Acepta un pedido **programado** sin marcharlo (spec 061).
 *
 * Es la contrapartida de `confirmarPedido` para el diferido: el encargado avala
 * el pedido ahora (`pending → confirmed`) pero la comanda no se crea ni se
 * imprime — de eso se encarga el cron cuando entra en ventana, con el lead del
 * negocio. Sin este gesto, un programado en efectivo (que nace impago) nunca
 * cumpliría la condición de auto-march de spec 047 y se quedaría en «Próximos»
 * para siempre.
 *
 * Solo encargado / admin / platform admin (`canConfirmOrder`), el mismo gate
 * que «Marchar ahora».
 */
export async function aceptarPedidoProgramado(
  orderId: string,
  slug: string,
): Promise<ActionResult<{ order_id: string }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canConfirmOrder(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden aceptar pedidos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: order } = await service
    .from("orders")
    .select("id, business_id, status, delivery_type, scheduled_at")
    .eq("id", orderId)
    .maybeSingle();
  type ScheduledOrderRow = {
    id: string;
    business_id: string;
    status: string;
    delivery_type: string;
    scheduled_at: string | null;
  };
  const orderRow = order as ScheduledOrderRow | null;
  if (!orderRow || orderRow.business_id !== business.id) {
    return actionError("Pedido no encontrado.");
  }
  if (orderRow.delivery_type === "dine_in") {
    return actionError("Los pedidos en mesa no se programan.");
  }
  if (!isScheduledForLater(orderRow.scheduled_at)) {
    return actionError(
      'Este pedido no está programado para más tarde — usá "Marchar ahora".',
    );
  }
  if (orderRow.status !== "pending") {
    return actionError(`El pedido ya está en estado "${orderRow.status}".`);
  }

  const { error } = await service
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", orderId);
  if (error) {
    console.error("aceptarPedidoProgramado · update", error);
    return actionError("No pudimos aceptar el pedido.");
  }

  // Auditoría de pedidos · media — aceptarlo no le avisaba al cliente, que se
  // quedaba sin saber si su programado en efectivo estaba tomado. Si ya se le
  // avisó al aprobarse un pago de MP, el log de mensajes no lo repite.
  await notifyScheduledConfirmed({ orderId });

  revalidatePath(`/${slug}/admin/pedidos`);
  revalidatePath(`/${slug}/admin/operacion`);

  return actionOk({ order_id: orderId });
}
