"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { getSiteUrl } from "@/lib/orders/persist-order";
import { evaluarReintentoPago } from "@/lib/orders/reintentar-pago";
import { createPreference } from "@/lib/payments/mercadopago";
import { limitCreateOrder } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

const Input = z.object({
  business_slug: z.string().min(1),
  order_id: z.string().uuid(),
});

const MOTIVOS: Record<string, string> = {
  no_mp: "Este pedido no se paga con Mercado Pago.",
  pagado: "Este pedido ya está pagado.",
  cancelado: "Este pedido se canceló. Podés hacer uno nuevo desde el menú.",
  no_disponible: "Este pedido ya no está esperando el pago.",
  vencido: "Este pedido venció. Podés hacer uno nuevo desde el menú.",
};

/**
 * Link nuevo de Mercado Pago para un pedido que el cliente no terminó de pagar
 * (#368). Mismo `external_reference` (el id del pedido), así el webhook y la
 * conciliación lo reconocen igual que al primero.
 *
 * La autorización es la misma que ver la confirmación: tener su link, cuyo id
 * no se adivina. Lo que se valida es el pedido —MP, impago, abierto, sin
 * aceptar y todavía a tiempo (`evaluarReintentoPago`)— y el cobro es el
 * `total_cents` de la orden, no lo que diga el cliente.
 */
export async function reintentarPagoMp(
  input: unknown,
): Promise<ActionResult<{ initPoint: string }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { business_slug, order_id } = parsed.data;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success: allowed } = await limitCreateOrder(ip);
  if (!allowed) return actionError("Demasiados intentos, esperá un minuto.");

  const business = await getBusiness(business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  const service = createSupabaseServiceClient();
  const { data: order } = await service
    .from("orders")
    .select(
      "id, order_number, total_cents, payment_method, payment_status, status, lifecycle_status, created_at",
    )
    .eq("id", order_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!order) return actionError("Pedido no encontrado.");

  const evaluacion = evaluarReintentoPago(order, new Date());
  if (!evaluacion.puede) return actionError(MOTIVOS[evaluacion.motivo]);

  if (!business.mp_access_token || !business.mp_accepts_payments) {
    return actionError("El local no está cobrando con Mercado Pago ahora.");
  }
  const totalCents = Number(order.total_cents);
  if (totalCents <= 0) return actionError("El total del pedido es 0.");

  let pref;
  try {
    pref = await createPreference({
      accessToken: business.mp_access_token,
      siteUrl: getSiteUrl(),
      businessId: business.id,
      businessSlug: business.slug,
      orderId: order.id,
      orderNumber: order.order_number,
      // Una sola línea por el total de la orden: envío, cupón y modificadores
      // ya están adentro, y reconstruirlos línea a línea arriesga el desfase
      // entre lo que se cobra y lo que dice la orden (#269).
      items: [
        {
          id: "pedido",
          title: `Pedido #${order.order_number}`,
          quantity: 1,
          unit_price: Math.round(totalCents / 100),
        },
      ],
      venceEl: evaluacion.venceEl,
    });
  } catch (err) {
    console.error("reintentarPagoMp · createPreference", err);
    return actionError("No pudimos generar el link de pago. Probá de nuevo.");
  }

  await service
    .from("orders")
    .update({ mp_preference_id: pref.preferenceId })
    .eq("id", order.id);
  // Un intento nuevo está en curso: «falló» deja de ser cierto.
  await service
    .from("orders")
    .update({ payment_status: "pending" })
    .eq("id", order.id)
    .eq("payment_status", "failed");

  return actionOk({ initPoint: pref.initPoint });
}
