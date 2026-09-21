import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getDefaultCaja } from "@/lib/caja/queries";
import { notifyScheduledConfirmed } from "@/lib/notifications/delivery-notify";
import {
  notifyPagoDuplicado,
  notifyPagoSobrePedidoCancelado,
} from "@/lib/notifications/events";
import { routeOrderToCocina } from "@/lib/orders/route-to-cocina";
import { isScheduledForLater } from "@/lib/orders/scheduled";

/**
 * Lo que pasa cuando MP aprueba el pago de un pedido online: la plata entra a
 * la caja y el pedido sigue su curso (a cocina, agendado, o —si ya estaba
 * cancelado— aviso para devolverla).
 *
 * Auditoría de pedidos · ALTA: esto vivía sólo en el webhook. Si el cliente
 * volvía de MP antes, `reconcileMpPayment` marcaba la orden `paid` sin estos
 * efectos, y el webhook después veía el pago «ya procesado» y cortaba: pedido
 * pagado sin comanda y fuera del arqueo. Ahora lo llaman los dos caminos.
 *
 * **Una sola vez**: la llave es el índice único `payments (business_id,
 * mp_payment_id)` (0026). El primero que asienta la plata dispara la marcha y
 * los avisos; el segundo choca con 23505 y no repite nada. Sin caja cargada no
 * hay llave: se marcha igual (la marcha es idempotente) y se avisa fuerte.
 */
export async function aplicarPagoMpAprobado(
  service: SupabaseClient,
  params: {
    order: {
      id: string;
      business_id: string;
      status: string;
      scheduled_at?: string | null;
      total_cents: number;
    };
    paymentId: string;
    /**
     * El que llama ya tenía este pago registrado como `paid` antes de llegar
     * (reentrega del webhook de MP, o el regreso después del webhook). Sin
     * caja no hay llave en `payments`: con esto no se repiten marcha ni avisos.
     */
    yaRegistrado?: boolean;
  },
): Promise<{ aplicado: boolean }> {
  const { order, paymentId } = params;

  // Revisión adversarial — ¿ya había OTRO pago aprobado de este pedido? (link
  // viejo + reintento, o un cupón offline que se aprobó tarde). La plata entró
  // igual y se asienta, pero el pedido no se vuelve a cocinar: se avisa para
  // devolver el segundo.
  const { data: otrosPagos } = await service
    .from("payments")
    .select("id")
    .eq("order_id", order.id)
    .eq("payment_status", "paid")
    .neq("mp_payment_id", paymentId);
  const esDuplicado = ((otrosPagos ?? []) as { id: string }[]).length > 0;

  let llaveTomada = false;
  const caja = await getDefaultCaja(order.business_id);
  if (!caja) {
    // Sin cajas cargadas no hay dónde asentarlo. El pago quedó acreditado en
    // la orden; no se pierde, pero la caja va a cerrar sin esta venta.
    console.error("MP · negocio sin cajas, pago sin asentar", {
      orderId: order.id,
      businessId: order.business_id,
    });
  } else {
    const { error: payErr } = await service.from("payments").insert({
      order_id: order.id,
      business_id: order.business_id,
      split_id: null,
      caja_id: caja.id,
      method: "mp_link",
      amount_cents: order.total_cents,
      tip_cents: 0,
      mp_payment_id: paymentId,
      payment_status: "paid",
    });
    // 23505 = ya lo asentó el otro camino (o una entrega previa del mismo
    // webhook): los efectos ya corrieron.
    if (payErr?.code === "23505") return { aplicado: false };
    llaveTomada = !payErr;
    if (payErr) {
      console.error("MP · no se pudo asentar el pago en la caja", {
        orderId: order.id,
        error: payErr,
      });
    } else {
      // #352 — lo pagado de la orden sale de la regla común (0117).
      const { error: recErr } = await service.rpc("recalcular_pagado_orden", {
        p_order_id: order.id,
      });
      if (recErr) console.error("MP · recalcular lo pagado", recErr);
    }
  }

  // Sin llave (sin caja, o el insert falló) la repetición la corta quien llama.
  if (!llaveTomada && params.yaRegistrado) return { aplicado: false };

  if (esDuplicado) {
    console.warn("MP · segundo pago aprobado del mismo pedido", { orderId: order.id, paymentId });
    await notifyPagoDuplicado({
      businessId: order.business_id,
      orderId: order.id,
      paymentId,
      amountCents: order.total_cents,
    }).catch((e) => console.error("MP · aviso de pago duplicado", e));
    return { aplicado: true };
  }

  if (order.status === "cancelled") {
    // spec 093 · H-21 — la plata entró pero un pedido cancelado no se cocina.
    console.warn("MP · pago aprobado sobre pedido cancelado", { orderId: order.id });
    await notifyPagoSobrePedidoCancelado({
      businessId: order.business_id,
      orderId: order.id,
      paymentId,
      amountCents: order.total_cents,
    }).catch((e) => console.error("MP · aviso de pago sobre cancelado", e));
  } else if (isScheduledForLater(order.scheduled_at ?? null)) {
    // spec 31 — el pago confirma el agendado; lo marcha el cron más tarde.
    await notifyScheduledConfirmed({ orderId: order.id });
  } else {
    try {
      await routeOrderToCocina(order.id, order.business_id);
    } catch (e) {
      console.error("MP · auto-march failed", e);
    }
  }
  return { aplicado: true };
}
