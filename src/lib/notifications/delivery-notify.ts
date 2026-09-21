import "server-only";

import { formatInTimeZone } from "date-fns-tz";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { dispatchCustomerMessage } from "./customer-dispatch";
import {
  orderScheduledEmail,
  orderStatusEmail,
  resolveBusinessBrand,
} from "./customer-email-templates";
import { renderDeliveryBody } from "./delivery-templates";

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

/**
 * Avisa al cliente un cambio de estado de delivery por el canal del negocio
 * (spec 45: WhatsApp / email / ambos). Best-effort: NUNCA lanza ni bloquea el
 * cambio de estado. Resuelve todo desde `orderId` con el service client.
 *
 * El texto (`renderDeliveryBody`) es agnóstico de canal y aplica la supresión
 * (estado no notificable, salón, take-away en "en camino", plantilla apagada);
 * si no corresponde, no se despacha nada. El chequeo de destinatario lo hace
 * cada canal: WhatsApp exige teléfono (por eso el payload de WhatsApp sólo se
 * arma si hay teléfono), email exige `customer_email` (lo chequea el outbox).
 */
export async function notifyDeliveryStatusChange(params: {
  orderId: string;
  /**
   * El estado que dispara el aviso. Casi siempre es el estado nuevo del pedido;
   * `rejected` (spec 139) es la excepción: el pedido queda `cancelled`, pero el
   * aviso que se manda es el del rechazo, que es otra noticia.
   */
  toStatus: string;
  /** Spec 139 — el motivo del rechazo, que viaja al cliente. */
  motivo?: string;
}): Promise<void> {
  try {
    const service = createSupabaseServiceClient();

    const { data: order } = await service
      .from("orders")
      .select(
        "id, business_id, order_number, customer_name, customer_email, customer_phone, delivery_type",
      )
      .eq("id", params.orderId)
      .maybeSingle();
    if (!order) return;

    const { data: business } = await service
      .from("businesses")
      .select("name, timezone, logo_url, address, phone, settings")
      .eq("id", order.business_id)
      .maybeSingle();
    if (!business) return;
    const brand = resolveBusinessBrand(business);

    // Plantilla editable del dueño para este estado (si la cargó). Sin fila →
    // la lógica pura cae a la plantilla default.
    const { data: template } = await service
      .from("delivery_message_templates")
      .select("body, enabled, template_name, template_lang")
      .eq("business_id", order.business_id)
      .eq("status", params.toStatus)
      .maybeSingle();

    const body = renderDeliveryBody({
      status: params.toStatus,
      motivo: params.motivo,
      deliveryType: order.delivery_type,
      customerName: order.customer_name,
      orderNumber: order.order_number,
      businessName: business.name,
      template: template ?? null,
      timezone: business.timezone ?? undefined,
    });
    if (!body) return;

    // Aviso proactivo por WhatsApp → template aprobado por Meta (fuera de 24h el
    // texto libre se rechaza). Convención: {{1}} = cliente, {{2}} = nº pedido.
    const tpl = template?.template_name
      ? {
          name: template.template_name,
          lang: template.template_lang ?? "es_AR",
          params: [order.customer_name, String(order.order_number)],
        }
      : undefined;

    const hasPhone = Boolean(
      order.customer_phone && order.customer_phone.trim().length > 0,
    );
    const email = orderStatusEmail({
      brand,
      orderNumber: order.order_number,
      body,
    });

    await dispatchCustomerMessage({
      businessId: order.business_id,
      event: `order_status:${params.toStatus}`,
      refId: order.id,
      recipient: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
      },
      whatsapp: hasPhone ? { body, template: tpl } : null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: business.name,
      },
    });
  } catch (err) {
    console.error("notifyDeliveryStatusChange", err);
  }
}

/**
 * Aviso al cliente de que su pedido diferido (spec 31) quedó **agendado** tras
 * aprobarse el pago MP. Primer aviso del flujo; el "listo para retirar" sale
 * después por el cambio de estado normal. Best-effort, sólo pickup con
 * `scheduled_at`. Se despacha por el canal del negocio (spec 45).
 */
export async function notifyScheduledConfirmed(params: {
  orderId: string;
}): Promise<void> {
  try {
    const service = createSupabaseServiceClient();

    const { data: order } = await service
      .from("orders")
      .select(
        "id, business_id, order_number, customer_name, customer_email, customer_phone, delivery_type, scheduled_at",
      )
      .eq("id", params.orderId)
      .maybeSingle();
    // Auditoría de pedidos · media — antes sólo salía para retiro: un delivery
    // programado nunca recibía «agendado».
    if (!order || !order.scheduled_at) return;
    if (order.delivery_type !== "pickup" && order.delivery_type !== "delivery") return;

    const { data: business } = await service
      .from("businesses")
      .select("name, timezone, logo_url, address, phone, settings")
      .eq("id", order.business_id)
      .maybeSingle();
    if (!business) return;
    const brand = resolveBusinessBrand(business);

    const tz = business.timezone ?? DEFAULT_TZ;
    const whenLabel = formatInTimeZone(
      new Date(order.scheduled_at),
      tz,
      "dd/MM 'a las' HH:mm 'hs'",
    );
    const text =
      `¡Listo ${order.customer_name}! Tu pedido #${order.order_number} quedó ` +
      `agendado para el ${whenLabel}. ` +
      (order.delivery_type === "delivery"
        ? "Te avisamos cuando salga para tu casa. 🙌"
        : "Te avisamos cuando esté para retirar. 🙌");

    const hasPhone = Boolean(
      order.customer_phone && order.customer_phone.trim().length > 0,
    );
    const email = orderScheduledEmail({
      brand,
      customerName: order.customer_name,
      orderNumber: order.order_number,
      whenLabel,
      deliveryType: order.delivery_type,
    });

    await dispatchCustomerMessage({
      businessId: order.business_id,
      event: "order_scheduled",
      refId: order.id,
      recipient: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
      },
      whatsapp: hasPhone ? { body: text } : null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: business.name,
      },
    });
  } catch (err) {
    console.error("notifyScheduledConfirmed", err);
  }
}
