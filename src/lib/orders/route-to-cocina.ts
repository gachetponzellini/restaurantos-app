import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createComandasForItems } from "@/lib/comandas/route-items";
import { resolveStations } from "@/lib/comandas/routing";
import { createNotification } from "@/lib/notifications/create";
import { notifyDeliveryStatusChange } from "@/lib/notifications/delivery-notify";
import { emitControlTicket } from "@/lib/print/control-ticket-emit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

export type RouteOrderResult = {
  order_id: string;
  comanda_ids: string[];
  items_without_station: number;
  /**
   * El control de pedido no se pudo emitir por un error real (spec 093). Un
   * duplicado o un pedido que no lleva control dejan esto en `false`: sólo se
   * prende cuando de verdad falta el papel y hay que ir a buscarlo.
   */
  control_failed: boolean;
  /**
   * La orden **ya tenía comandas**: esta llamada fue no-op por idempotencia
   * (spec 127). Lo mira el cron, que para un encargue de hoy —cuyo papel ya
   * salió al cargarlo— tiene que avanzar el estado por su cuenta: el camino
   * normal lo avanza `routeOrderToCocina`, y por acá no pasa.
   */
  already_had_comandas: boolean;
};

/**
 * Los únicos estados desde los que tiene sentido mandar algo a cocina.
 *
 * `preparing` está adentro **a propósito** y es seguro: el chequeo de
 * idempotencia de arriba corta antes cuando la orden ya tiene comandas, así que
 * acá sólo llega un `preparing` **sin una sola comanda** — o sea, un pedido roto
 * por H-18/H-22, exactamente lo que hay que poder rescatar. Un pedido sano en
 * `preparing` nunca pasa por esta línea.
 */
const MARCHABLE = ["pending", "confirmed", "preparing"] as const;

/**
 * Rutea items por sector, crea comandas y avanza el pedido a `preparing`.
 * Sin auth — usado tanto por auto-march como por el fallback manual.
 * Idempotente: si ya tiene comandas, no-op.
 *
 * **Guarda de estado (spec 093).** El avance a `preparing` se hacía con un
 * `.eq("id", orderId)` pelado: todo el control de "a quién marchar" vivía en el
 * SELECT de cada caller, y el webhook de MP ni siquiera miraba `orders.status`.
 * Un pedido cancelado por el cliente mientras el pago seguía `pending` —típico
 * de los medios offline de MP, que se aprueban horas después— volvía a
 * `preparing` cuando llegaba la aprobación: se imprimía, se cocinaba y se
 * despachaba algo que el cliente ya había cancelado en la app. Ahora el estado
 * se chequea dos veces: en el SELECT de arriba (para abortar **antes** de crear
 * comandas) y en el propio UPDATE (guarda optimista contra la carrera).
 */
export async function routeOrderToCocina(
  orderId: string,
  businessId: string,
  opts: {
    /**
     * Crear las comandas **sin** mover `orders.status` (spec 091).
     *
     * Lo usa la venta de mostrador, que cobra y cierra la orden **antes** de
     * rutear: para cuando llega acá el pedido ya está `delivered` —se pagó y se
     * entregó en el mismo gesto— y avanzarlo a `preparing` sería mentir. El
     * papel de cocina sí tiene que salir: el tostado hay que hacerlo.
     */
    skipStatusAdvance?: boolean;
  } = {},
): Promise<ActionResult<RouteOrderResult>> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Idempotencia: si ya tiene comandas, alguien confirmó/auto-marchó antes.
  const { count: existingComandas } = await service
    .from("comandas")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  if ((existingComandas ?? 0) > 0) {
    // Igual se intenta el control: entre la 0034 y la spec 093 **ningún**
    // delivery lo emitió, así que re-marchar es el único rescate de los pedidos
    // que quedaron con comandas y sin papel. `emitControlTicket` es idempotente.
    const control = await emitControlTicket(service, orderId, businessId).catch(
      (e) => {
        console.error("routeOrderToCocina · emitControlTicket", orderId, e);
        return { emitted: false, failed: true };
      },
    );
    return actionOk({
      order_id: orderId,
      comanda_ids: [],
      items_without_station: 0,
      control_failed: control.failed,
      already_had_comandas: true,
    });
  }

  // Guarda de estado #1 (ver docblock): abortar antes de tocar nada.
  const { data: orderRow } = await service
    .from("orders")
    .select("id, status, delivery_type")
    .eq("id", orderId)
    .eq("business_id", businessId)
    .maybeSingle();
  const order = orderRow as {
    status: string;
    delivery_type: string;
  } | null;
  if (!order) return actionError("Pedido no encontrado.");
  if (
    !opts.skipStatusAdvance &&
    !(MARCHABLE as readonly string[]).includes(order.status)
  ) {
    return actionError(
      `El pedido está en "${order.status}" — no se puede mandar a cocina.`,
    );
  }

  const { data: items } = await service
    .from("order_items")
    .select("id, product_id")
    .eq("order_id", orderId)
    .is("cancelled_at", null);
  type ItemRow = { id: string; product_id: string | null };
  const itemRows = (items ?? []) as ItemRow[];
  if (itemRows.length === 0) {
    return actionError("El pedido no tiene items.");
  }

  const productIds = [
    ...new Set(itemRows.map((i) => i.product_id).filter((id): id is string => !!id)),
  ];
  type ProductRow = {
    id: string;
    station_id: string | null;
    extra_station_ids: string[] | null;
    sin_comanda: boolean;
    category: { station_id: string | null; extra_station_ids: string[] | null } | null;
  };
  let productById = new Map<string, ProductRow>();
  if (productIds.length > 0) {
    const { data: productRows } = await service
      .from("products")
      .select("id, station_id, extra_station_ids, sin_comanda, category:categories(station_id, extra_station_ids)")
      .in("id", productIds);
    productById = new Map(
      ((productRows ?? []) as unknown as ProductRow[]).map((p) => [p.id, p]),
    );
  }

  const itemsByStation = new Map<string, string[]>();
  let withoutStation = 0;

  for (const item of itemRows) {
    const product = item.product_id ? productById.get(item.product_id) : null;
    // Spec 180 — la primera es el sector principal; las demás reciben su
    // propia comanda.
    const stations = product ? resolveStations(product, null) : [];
    const stationId = stations[0] ?? null;

    const { error: updErr } = await service
      .from("order_items")
      .update({
        station_id: stationId,
        // Sin sector no hay comanda, y sin comanda nadie lo va a marcar nunca:
        // dejarlo `pending` es una cola de cocina que no existe. La gaseosa y
        // el alfajor salen con la venta. Es la misma regla que aplica
        // `enviarComanda` en el salón (issue #189 — ahí un ítem sin sector
        // quedaba `delivered` y por mostrador quedaba `pending` para siempre).
        kitchen_status: stationId ? "pending" : "delivered",
      })
      .eq("id", item.id);
    if (updErr) {
      console.error("routeOrderToCocina · order_item update", updErr);
      return actionError("No pudimos rutear los items.");
    }

    if (stationId) {
      for (const st of stations) {
        const bucket = itemsByStation.get(st) ?? [];
        bucket.push(item.id);
        itemsByStation.set(st, bucket);
      }
    } else {
      withoutStation += 1;
    }
  }

  // `primeraRuteada`: confirmar una orden online pasa una sola vez, así que su
  // batch es siempre el 1 y el unique de la tabla puede arbitrar la carrera de
  // las dos pestañas (issue #259).
  const route = await createComandasForItems(service, orderId, itemsByStation, {
    primeraRuteada: true,
  });
  if (!route.ok) return actionError(route.error);

  // Guarda de estado #2 (ver docblock): optimista, cierra la ventana entre el
  // SELECT de arriba y este UPDATE. Si el pedido se canceló mientras tanto, no
  // matchea ninguna fila y se corta acá.
  if (!opts.skipStatusAdvance) {
    const { data: advanced, error: orderErr } = await service
      .from("orders")
      .update({ status: "preparing" })
      .eq("id", orderId)
      .in("status", MARCHABLE)
      .select("id");
    if (orderErr) {
      console.error("routeOrderToCocina · order update", orderErr);
      return actionError("No pudimos avanzar el pedido.");
    }
    if (((advanced ?? []) as { id: string }[]).length === 0) {
      return actionError(
        "El pedido cambió de estado mientras se mandaba a cocina.",
      );
    }
  }

  // Control de pedido (spec 063): el papel del repartidor sale junto con las
  // comandas de cocina. Best-effort a propósito — si falla, la comida entra a
  // cocina igual. Perder el control es un papel menos; abortar la marcha por
  // eso sería dejar el pedido sin cocinar. Lo que sí cambia con la spec 093 es
  // que el fallo deja de ser mudo: viaja en `control_failed`.
  let controlFailed = false;
  try {
    const control = await emitControlTicket(service, orderId, businessId);
    controlFailed = control.failed;
  } catch (e) {
    console.error("routeOrderToCocina · emitControlTicket", orderId, e);
    controlFailed = true;
  }

  // Marcha sin un solo papel de cocina (spec 093 · H-22). No se bloquea: un
  // pedido de sólo kiosco (una gaseosa y un alfajor) legítimamente no genera
  // comanda — es el modelado del producto (spec 08), no un error. Lo que no
  // puede pasar es que nadie se entere, que es lo que pasaba: el cron miraba
  // sólo `res.ok` y descartaba `items_without_station`.
  if (route.comanda_ids.length === 0 && withoutStation > 0) {
    await createNotification({
      businessId,
      targetRole: "encargado",
      type: "pedido.sin_comanda",
      payload: { orderId, itemsWithoutStation: withoutStation },
    }).catch((e) =>
      console.error("routeOrderToCocina · aviso sin comanda", orderId, e),
    );
  }

  // El aviso «Estamos preparando tu pedido» (spec 093 · H-39). Vivía sólo en
  // `updateOrderStatus`, que es justamente el camino que la spec 047 bloquea
  // para un online en `pending` → el mensaje que el dueño redacta en
  // Configuración no se mandaba nunca. Best-effort: no lanza ni bloquea, y la
  // supresión por tipo de entrega (salón) la aplica `renderDeliveryBody`.
  await notifyDeliveryStatusChange({ orderId, toStatus: "preparing" });

  return actionOk({
    order_id: orderId,
    comanda_ids: route.comanda_ids,
    items_without_station: withoutStation,
    control_failed: controlFailed,
    already_had_comandas: false,
  });
}
