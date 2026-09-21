"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createNotification } from "@/lib/notifications/create";
import { refundPayment } from "@/lib/payments/mercadopago";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { cancelDownstream } from "./cancel-order";
import { marcarPagosReembolsados } from "@/lib/billing/refund-payments";

const CancelInput = z.object({
  order_id: z.string().uuid(),
  business_slug: z.string().min(1),
});

/**
 * Statuses the customer can cancel on their own. We intentionally cut this
 * off at "confirmed" — once the kitchen is preparing it, cancellation needs
 * to go through the business (food may already be spoiled/paid for). The
 * customer can still coordinate via WhatsApp in that case.
 */
const CUSTOMER_CANCELLABLE_STATUSES = new Set(["pending", "confirmed"]);

/**
 * Result signals to the UI whether a refund was also processed so it can
 * show an accurate toast.
 *   - "none"     : payment was cash (or never paid)
 *   - "refunded" : MP refund succeeded
 *   - "manual"   : MP was paid but refund API failed — admin handles it
 */
export type CancelResult = { refund: "none" | "refunded" | "manual" };

export async function cancelOrderByCustomer(
  input: unknown,
): Promise<ActionResult<CancelResult>> {
  const parsed = CancelInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { order_id, business_slug } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const service = createSupabaseServiceClient();

  const { data: order } = await service
    .from("orders")
    .select(
      "id, business_id, order_number, status, payment_status, mp_payment_id, customer_id, customers!inner(user_id)",
    )
    .eq("id", order_id)
    .maybeSingle();
  if (!order) return actionError("Pedido no encontrado.");

  const customerUserId = (order.customers as { user_id: string | null } | null)
    ?.user_id;
  if (customerUserId !== user.id) {
    return actionError("Pedido no encontrado.");
  }

  if (!CUSTOMER_CANCELLABLE_STATUSES.has(order.status)) {
    return actionError(
      "Este pedido ya está en preparación. Contactá al local para cancelarlo.",
    );
  }

  const MOTIVO = "Cancelado por el cliente";
  const nowIso = new Date().toISOString();

  // Auditoría de pedidos · MEDIA — primero se cancela, con guarda de estado
  // en la misma escritura: si el local lo pasó a cocina entre la lectura de
  // arriba y acá, no se cancela. Y el reembolso va DESPUÉS: antes se
  // reembolsaba primero, y si el update fallaba la plata ya se había devuelto
  // con el pedido vivo.
  const { data: cancelada, error } = await service
    .from("orders")
    .update({
      status: "cancelled",
      // spec 090 — los dos ejes y el timestamp. Antes se escribía sólo
      // `status`, así que el pedido quedaba con la cuenta `open` y fuera del
      // bloque de anulaciones del resumen de turno (que filtra por
      // `cancelled_at`).
      lifecycle_status: "cancelled",
      cancelled_at: nowIso,
      cancelled_reason: MOTIVO,
      // spec 34 — quién anuló. Acá el actor es el propio cliente (auth.users).
      cancelled_by: user.id,
    })
    .eq("id", order_id)
    .in("status", Array.from(CUSTOMER_CANCELLABLE_STATUSES))
    .select("id");
  if (error) {
    console.error("cancelOrderByCustomer", error);
    return actionError("No pudimos cancelar el pedido.");
  }
  if (((cancelada ?? []) as { id: string }[]).length === 0) {
    return actionError(
      "Este pedido ya está en preparación. Contactá al local para cancelarlo.",
    );
  }

  // Reembolso por MP, sólo con el pedido ya cancelado. Se intenta una vez; si
  // falla, el encargado ve `paid` + `cancelled` y lo hace a mano.
  let refundOutcome: CancelResult["refund"] = "none";
  if (order.payment_status === "paid" && order.mp_payment_id) {
    const { data: biz } = await service
      .from("businesses")
      .select("mp_access_token")
      .eq("id", order.business_id)
      .maybeSingle();
    if (biz?.mp_access_token) {
      const refund = await refundPayment(
        biz.mp_access_token,
        order.mp_payment_id,
      );
      if (refund.ok) {
        refundOutcome = "refunded";
        await service
          .from("orders")
          .update({ payment_status: "refunded" })
          .eq("id", order_id);
      } else {
        console.error("MP refund failed on customer cancel", refund.error);
        refundOutcome = "manual";
      }
    } else {
      // Business has no MP token somehow — leave for manual handling.
      refundOutcome = "manual";
    }
  }

  // issue #272 — la caja no lee `orders.payment_status`, lee `payments`.
  // Sin esto, el cliente cancelaba, Mercado Pago le devolvía la plata, y el
  // arqueo la seguía esperando: «Ingresos hoy» bajaba y el efectivo esperado
  // no, así que los dos números divergían sin que nada los limpiara.
  //
  // `actorUserId` va null a propósito: acá el que canceló es el cliente, que no
  // es del equipo del local. El motivo del rastro lo dice.
  if (refundOutcome === "refunded") {
    await marcarPagosReembolsados(service, {
      orderId: order_id,
      businessId: order.business_id,
      motivo: "Cancelado por el cliente",
      actorUserId: null,
    });
  }

  // Ítems, comandas (con su ticket «ANULADA») y totales. Un pedido que el
  // cliente cancela desde el celular puede estar ya marchado: sin esto la
  // comanda seguía viva en cocina.
  await cancelDownstream(service, {
    orderId: order_id,
    motivo: MOTIVO,
    actorUserId: user.id,
    nowIso,
  });

  // spec 27 — avisar al encargado que el cliente canceló su pedido.
  await createNotification({
    businessId: order.business_id,
    targetRole: "encargado",
    type: "order.cancelled_by_customer",
    payload: { orderNumber: order.order_number },
  });

  revalidatePath(`/${business_slug}/confirmacion/${order_id}`);
  revalidatePath(`/${business_slug}/perfil/pedidos`);
  revalidatePath(`/${business_slug}/menu`);
  return actionOk({ refund: refundOutcome });
}
