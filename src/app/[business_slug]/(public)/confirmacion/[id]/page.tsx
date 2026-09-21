import { notFound, redirect } from "next/navigation";

import { OrderStatusPoller } from "@/components/checkout/order-status-poller";
import { OrderTracking } from "@/components/checkout/order-tracking";
import {
  PaymentBanner,
  type ReintentoPago,
} from "@/components/checkout/payment-banner";
import { PaymentStatusPoller } from "@/components/checkout/payment-status-poller";
import { findPaymentByExternalRef } from "@/lib/payments/mercadopago";
import { etiquetaProgramado } from "@/lib/orders/etiqueta-programado";
import { evaluarReintentoPago } from "@/lib/orders/reintentar-pago";
import { reconcileMpPayment } from "@/lib/payments/reconcile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export default async function ConfirmacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business_slug, id } = await params;
  const search = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // If MP just redirected the customer back (?payment_id=X), ask MP's API
  // what happened and sync the order state. After that, redirect to the
  // clean URL so refreshes don't retrigger reconciliation.
  const rawPaymentId = search.payment_id ?? search.collection_id;
  const paymentId = Array.isArray(rawPaymentId)
    ? rawPaymentId[0]
    : rawPaymentId;
  if (paymentId) {
    await reconcileMpPayment({
      orderId: id,
      businessId: business.id,
      paymentId,
    });
    redirect(`/${business_slug}/confirmacion/${id}`);
  }

  const supabase = createSupabaseServiceClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, delivery_type, total_cents, subtotal_cents,
       delivery_fee_cents, payment_method, payment_status, customer_id,
       lifecycle_status, created_at, scheduled_at,
       customers!inner(user_id),
       order_items(product_name, quantity, subtotal_cents,
         is_combo_component, daily_menu_snapshot,
         order_item_modifiers(modifier_name))`,
    )
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!order) notFound();

  // Fallback: if this is an MP order still pending and we don't have a
  // payment_id in the URL (user closed MP tab, navigated back manually, or
  // came from their profile), ask MP if any payment exists under this
  // order's external_reference.
  if (order.payment_method === "mp" && order.payment_status === "pending") {
    const { data: biz } = await supabase
      .from("businesses")
      .select("mp_access_token")
      .eq("id", business.id)
      .maybeSingle();
    if (biz?.mp_access_token) {
      const foundPaymentId = await findPaymentByExternalRef(
        biz.mp_access_token,
        order.id,
      );
      if (foundPaymentId) {
        await reconcileMpPayment({
          orderId: id,
          businessId: business.id,
          paymentId: foundPaymentId,
        });
        redirect(`/${business_slug}/confirmacion/${id}`);
      }
    }
  }

  const tagline =
    (business.settings as { tagline?: string } | null)?.tagline ??
    business.address ??
    null;

  const whatsappHref = business.phone
    ? `https://wa.me/${business.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola! Consulto por el pedido #${order.order_number}`,
      )}`
    : null;

  // Compute cancel eligibility. The customer can cancel if:
  // - they are logged in AND own this order
  // - status is still pending / confirmed (server action re-validates this)
  // If the order was paid via MP, cancellation also attempts an automatic
  // refund — handled server-side in the cancel action.
  const authSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  const orderCustomerUserId = (
    order.customers as { user_id: string | null } | null
  )?.user_id;
  const canCancel =
    user != null &&
    orderCustomerUserId === user.id &&
    (order.status === "pending" || order.status === "confirmed");

  // #368 — ¿se le puede ofrecer volver a pagar con MP? Lo decide el server,
  // con la misma regla que valida la action.
  const evaluacion = evaluarReintentoPago(order, new Date());
  const reintento: ReintentoPago = evaluacion.puede
    ? "puede"
    : evaluacion.motivo === "vencido" || evaluacion.motivo === "cancelado"
      ? "vencido"
      : "no";

  return (
    <>
      <PaymentStatusPoller
        paymentStatus={order.payment_status}
        paymentMethod={order.payment_method}
      />
      <OrderStatusPoller status={order.status} />
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <PaymentBanner
          slug={business_slug}
          orderId={order.id}
          paymentStatus={order.payment_status}
          paymentMethod={order.payment_method}
          reintento={reintento}
        />
      </div>
      <OrderTracking
        slug={business_slug}
        orderId={order.id}
        businessName={business.name}
        tagline={tagline}
        orderNumber={order.order_number}
        status={order.status as React.ComponentProps<typeof OrderTracking>["status"]}
        deliveryType={order.delivery_type as "delivery" | "pickup"}
        items={(order.order_items ?? [])
          .filter((it) => !(it as any).is_combo_component)
          .map((it) => {
            const menuSnap = it.daily_menu_snapshot as
              | { components?: { label: string }[] }
              | null;
            return {
              product_name: it.product_name,
              quantity: it.quantity,
              subtotal_cents: Number(it.subtotal_cents),
              modifiers: (it.order_item_modifiers ?? []).map(
                (m) => m.modifier_name,
              ),
              daily_menu_components: (menuSnap?.components ?? []).map(
                (c) => c.label,
              ),
            };
          })}
        subtotalCents={Number(order.subtotal_cents)}
        deliveryFeeCents={Number(order.delivery_fee_cents)}
        totalCents={Number(order.total_cents)}
        estimatedMinutes={business.estimated_delivery_minutes}
        whatsappHref={whatsappHref}
        canCancel={canCancel}
        wasPaid={order.payment_status === "paid"}
        programadoPara={etiquetaProgramado(
          (order as { scheduled_at?: string | null }).scheduled_at ?? null,
          business.timezone,
        )}
      />
    </>
  );
}
