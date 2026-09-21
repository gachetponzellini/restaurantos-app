import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recomputeOrderTotals } from "./totals-recompute";

type GenericClient = SupabaseClient;

/** Comandas que todavía pueden dejar de cocinarse. */
const COMANDAS_ACTIVAS = ["pendiente", "en_preparacion"] as const;

export type CancelDownstreamResult = {
  itemsCancelled: number;
  comandasCancelled: number;
};

export type CancelarOrdenResult = CancelDownstreamResult & {
  /** La orden pasó de viva a cancelada **en esta llamada**. */
  cancelled: boolean;
};

/**
 * Matar un pedido, completo, en un solo lugar (spec 090).
 *
 * ## El problema que resuelve
 *
 * Cancelar un pedido se hacía en cinco lugares y **ninguno lo hacía entero**.
 * Cada uno escribía el subconjunto de ejes que su autor tenía en la cabeza:
 *
 * | Write-site | `status` | `lifecycle_status` | ítems | comandas |
 * |---|:-:|:-:|:-:|:-:|
 * | `anularMesa`               | ❌ | ✅ | ⚠️ parcial | ✅ |
 * | `updateOrderStatus`        | ✅ | ❌ | ❌ | ❌ |
 * | `cancelOrderByCustomer`    | ✅ | ❌ | ❌ | ❌ |
 * | `liberarMesa`              | ❌ | ✅ | ❌ | ❌ |
 * | rescate de venta mostrador | ❌ | ✅ | ❌ | — |
 *
 * Son espejos exactos: el salón escribía `lifecycle_status` y nunca `status`;
 * el canal online, `status` y nada más. De ahí salían los dos síntomas medidos
 * en el cloud —23 mesas anuladas que la analítica contaba como venta y 4
 * pedidos cancelados con la cuenta abierta— más las comandas que seguían vivas
 * en cocina después de cancelar un delivery.
 *
 * ## Por qué el barrido de ítems cambia
 *
 * `anularMesa` derivaba los ítems a cancelar **desde las comandas activas**, así
 * que quedaban vivos (a) todo producto `track_stock` —las bebidas tienen
 * `station_id = null` y nunca entran a `comanda_items`— y (b) los ítems de
 * comandas ya entregadas. En el cloud eso dejó 29 ítems vivos por $606.200 en
 * órdenes canceladas. Acá se cancelan **todos los ítems vivos de la orden**, y
 * el recorrido por comandas queda sólo para decidir a quién se le imprime el
 * ticket «ANULADA».
 *
 * Que se cancelen todos los ítems **no** significa que todo el stock vuelva: de
 * eso se ocupa el trigger de la spec 089, que saltea las líneas
 * `kitchen_status='delivered'`. La comida que salió no vuelve a la heladera.
 *
 * ## Idempotencia
 *
 * Las tres escrituras son idempotentes por dato: la de la orden va guardada
 * contra `lifecycle_status <> 'cancelled'`, y las de ítems y comandas filtran
 * por `cancelled_at is null`. Llamar dos veces no duplica nada ni revierte
 * stock dos veces (ver spec 089).
 */
export async function cancelarOrden(
  service: GenericClient,
  params: {
    orderId: string;
    businessId: string;
    motivo: string;
    actorUserId: string | null;
    /** ISO del momento de la anulación. Se comparte entre las tres escrituras. */
    nowIso?: string;
    /**
     * Sólo cancelar si, **en el momento de escribir**, el pedido sigue sin
     * aceptar (`status = 'pending'`) y sin pagar. Para el barrido de vencidos
     * (#148 · H-20/H-45): decide con lo que leyó al principio del tick, y un
     * pago de MP o un «Aceptar» del local pueden entrar entre medio.
     */
    soloSiPendienteImpago?: boolean;
  },
): Promise<CancelarOrdenResult> {
  const nowIso = params.nowIso ?? new Date().toISOString();

  let update = service
    .from("orders")
    .update({
      // Los dos ejes, siempre. Es el punto de toda la spec.
      status: "cancelled",
      lifecycle_status: "cancelled",
      cancelled_at: nowIso,
      cancelled_reason: params.motivo,
      cancelled_by: params.actorUserId,
    })
    .eq("id", params.orderId)
    .eq("business_id", params.businessId)
    // Sólo desde `open`, y a propósito. Es guarda optimista contra la carrera
    // "el mozo cobra la mesa mientras el encargado la anula": entre el SELECT
    // del caller y este UPDATE la orden puede haberse cerrado, y anular algo ya
    // cobrado es una decisión con plata adentro que le corresponde a la spec 092
    // (guardas de `payments` e `invoices`), no a este helper.
    .eq("lifecycle_status", "open");
  if (params.soloSiPendienteImpago) {
    update = update.eq("status", "pending").neq("payment_status", "paid");
  }
  const { data: cancelled } = await update.select("id");

  const didCancel = ((cancelled ?? []) as { id: string }[]).length > 0;

  // Si el UPDATE no matcheó, la orden ya no estaba `open`: la cobraron o ya la
  // habían anulado. En ninguno de los dos casos hay que seguir. Correr la
  // cascada igual sería peor que no hacer nada: cancelaría los ítems de una
  // orden **cobrada** y el recompute le bajaría el `total_cents` por debajo de
  // lo que el cliente ya pagó.
  if (!didCancel) {
    return { cancelled: false, itemsCancelled: 0, comandasCancelled: 0 };
  }

  const downstream = await cancelDownstream(service, { ...params, nowIso });

  return { cancelled: true, ...downstream };
}

/**
 * La cascada sin el update de `orders`: ítems, comandas y totales.
 *
 * Existe aparte porque hay call-sites que **ya escribieron la orden con el
 * cliente RLS** y no pueden repetir esa escritura con el service client sin
 * perder la comprobación de permisos. Ahí el patrón es: el UPDATE bajo RLS
 * prueba que el usuario podía, y recién entonces la cascada corre con el
 * service client (que necesita tocar `order_items` y `comandas`, tablas donde
 * el rol del usuario puede no tener escritura directa).
 */
export async function cancelDownstream(
  service: GenericClient,
  params: {
    orderId: string;
    motivo: string;
    actorUserId: string | null;
    nowIso?: string;
  },
): Promise<CancelDownstreamResult> {
  const nowIso = params.nowIso ?? new Date().toISOString();

  // 0) El cupón vuelve (auditoría de pedidos · media, 0130): un pedido
  //    cancelado no gasta el cupón. Idempotente en la base — si la cascada
  //    corre dos veces, resta una sola.
  const { error: promoErr } = await service.rpc("devolver_uso_promo", {
    p_order_id: params.orderId,
  });
  if (promoErr) console.error("cancelDownstream · devolver_uso_promo", promoErr);

  // 1) Todos los ítems vivos. Dispara el trigger de la 089 → vuelve el stock
  //    de lo que no se entregó.
  const { data: items } = await service
    .from("order_items")
    .update({
      cancelled_at: nowIso,
      cancelled_reason: params.motivo,
      cancelled_by: params.actorUserId,
    })
    .eq("order_id", params.orderId)
    .is("cancelled_at", null)
    .select("id");
  const itemsCancelled = ((items ?? []) as { id: string }[]).length;

  // 2) Las comandas ACTIVAS: se anulan y se encola el ticket «ANULADA» para que
  //    cocina se entere. Las ENTREGADAS se respetan — la comida ya salió, y la
  //    orden cancelada ya garantiza que no se cobra (mismo criterio que
  //    `cancelarComanda` y que el trigger de la 089).
  const { data: comandas } = await service
    .from("comandas")
    .update({
      cancelled_at: nowIso,
      cancelled_reason: params.motivo,
      cancelled_by: params.actorUserId,
      reprint_requested_at: nowIso,
      print_failed_at: null,
    })
    .eq("order_id", params.orderId)
    .in("status", COMANDAS_ACTIVAS)
    .is("cancelled_at", null)
    .select("id");
  const comandasCancelled = ((comandas ?? []) as { id: string }[]).length;

  // 3) Los totales. `anularMesa` no recalculaba —a diferencia de `cancelarItem`
  //    y `cancelarComanda`, que sí— y por eso una mesa anulada conservaba su
  //    `total_cents` completo: es el número que `emitInvoice` usaba para
  //    facturar y el que inflaba el denominador del reporte fiscal.
  await recomputeOrderTotals(service, params.orderId);

  return { itemsCancelled, comandasCancelled };
}
