import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { closeOrderIfFullyPaid } from "@/lib/billing/cobro-actions";
import { aplicarPagoMpAprobado } from "@/lib/payments/efectos-pago-mp";
import { estadoDePagoAEscribir } from "@/lib/payments/estado-de-pago";
import { fetchPayment, verifySignature } from "@/lib/payments/mercadopago";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// MP's webhook expects a 2xx within ~22s, otherwise it retries. Keep this
// handler small: validate signature, fetch payment, update the order, return.
//
// The business_id is passed as a query param because a single webhook host
// serves multiple tenants; we need to resolve the right access_token and
// webhook_secret before we can verify anything.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) {
    return NextResponse.json(
      { error: "missing business_id" },
      { status: 400 },
    );
  }

  // Capture headers + body (as string for signature validation, then parse).
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  const rawBody = await req.text();

  // MP sends a few notification shapes. The new one is:
  //   { type: "payment", data: { id: "123" }, action: "...", ... }
  // The legacy IPN shape we may still get:
  //   { topic: "payment", resource: ".../v1/payments/123" }
  let payload:
    | { type?: string; action?: string; data?: { id?: string | number } }
    | { topic?: string; resource?: string }
    | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Empty body pings / malformed — ack quickly so MP doesn't retry forever.
    return NextResponse.json({ ok: true });
  }

  const paymentId = extractPaymentId(payload);
  if (!paymentId) {
    // Topics other than payment (merchant_order, etc) — ignore for now.
    return NextResponse.json({ ok: true });
  }

  const service = createSupabaseServiceClient();
  const { data: business, error: bizErr } = await service
    .from("businesses")
    .select("id, mp_access_token, mp_webhook_secret")
    .eq("id", businessId)
    .maybeSingle();
  if (bizErr || !business || !business.mp_access_token || !business.mp_webhook_secret) {
    console.error("MP webhook: business not found or MP not configured", {
      businessId,
    });
    // 200 to avoid retry storms for a business that may have disabled MP.
    return NextResponse.json({ ok: true });
  }

  // Signature check. Fails closed — if MP didn't sign or signature doesn't
  // match, drop the notification. Legitimate retries will re-sign correctly.
  const valid = verifySignature({
    xSignature,
    xRequestId,
    dataId: paymentId,
    secret: business.mp_webhook_secret,
  });
  if (!valid) {
    console.warn("MP webhook: invalid signature", {
      businessId,
      paymentId,
    });
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 401 },
    );
  }

  // Idempotency: if we've already processed this payment_id, skip.
  const { data: existingByPayment } = await service
    .from("orders")
    .select("id, payment_status")
    .eq("mp_payment_id", paymentId)
    .maybeSingle();

  // Fetch the payment details from MP using the business's access token.
  let payment;
  try {
    payment = await fetchPayment(business.mp_access_token, paymentId);
  } catch (err) {
    console.error("MP fetchPayment failed", err);
    // 500 so MP retries later — our problem, not theirs.
    return NextResponse.json({ error: "upstream error" }, { status: 500 });
  }

  if (!payment.externalReference) {
    console.warn("MP payment missing external_reference", { paymentId });
    return NextResponse.json({ ok: true });
  }

  // ── Flow nuevo (Bloque 5): payment row de mesa ────────────────
  // El external_reference apunta al payments.id (UUID). Si lo encontramos,
  // procesamos el cobro de mesa + cierre de la order si corresponde.
  // Si no, el external_reference es el orderId legacy (delivery).
  const externalRef = payment.externalReference;
  const { data: paymentRow } = await service
    .from("payments")
    .select(
      "id, order_id, business_id, split_id, amount_cents, payment_status",
    )
    .eq("id", externalRef)
    .maybeSingle();

  if (paymentRow) {
    if ((paymentRow as { business_id: string }).business_id !== business.id) {
      console.error("MP webhook: payment business mismatch", {
        externalRef,
        businessId,
      });
      return NextResponse.json({ error: "business mismatch" }, { status: 403 });
    }

    const nextStatus =
      payment.status === "approved"
        ? "paid"
        : payment.status === "rejected" || payment.status === "cancelled"
          ? "failed"
          : payment.status === "refunded" || payment.status === "charged_back"
            ? "refunded"
            : "pending";

    const prow = paymentRow as {
      id: string;
      order_id: string;
      split_id: string | null;
      amount_cents: number;
      payment_status: string;
    };
    if (prow.payment_status === nextStatus && prow.payment_status !== "pending") {
      // Idempotent skip.
      return NextResponse.json({ ok: true, skipped: true });
    }

    await service
      .from("payments")
      .update({ mp_payment_id: paymentId, payment_status: nextStatus })
      .eq("id", prow.id);

    if (nextStatus === "paid" && prow.split_id) {
      const { data: splitRow } = await service
        .from("order_splits")
        .select("id, expected_amount_cents, paid_amount_cents")
        .eq("id", prow.split_id)
        .maybeSingle();
      if (splitRow) {
        const s = splitRow as {
          id: string;
          expected_amount_cents: number;
          paid_amount_cents: number;
        };
        const newPaid = s.paid_amount_cents + prow.amount_cents;
        const splitDone = newPaid >= s.expected_amount_cents;
        await service
          .from("order_splits")
          .update({
            paid_amount_cents: newPaid,
            status: splitDone ? "paid" : "pending",
          })
          .eq("id", s.id);
      }
    }

    // Reembolso/contracargo de un pago de mesa: revertir el split (spec 36 ·
    // R-C3). Antes solo se actualizaba payments.payment_status y el split
    // quedaba `paid` con paid_amount_cents inflado → descuadre de caja. El skip
    // idempotente de arriba evita doble decremento si el webhook repite.
    if (nextStatus === "refunded" && prow.split_id) {
      const { data: splitRow } = await service
        .from("order_splits")
        .select("id, expected_amount_cents, paid_amount_cents")
        .eq("id", prow.split_id)
        .maybeSingle();
      if (splitRow) {
        const s = splitRow as {
          id: string;
          expected_amount_cents: number;
          paid_amount_cents: number;
        };
        const newPaid = Math.max(0, s.paid_amount_cents - prow.amount_cents);
        await service
          .from("order_splits")
          .update({
            paid_amount_cents: newPaid,
            status: newPaid >= s.expected_amount_cents ? "paid" : "pending",
          })
          .eq("id", s.id);
      }
    }

    if (nextStatus === "paid") {
      // Resolver slug del business para closeOrderIfFullyPaid.
      const { data: bizRow } = await service
        .from("businesses")
        .select("slug")
        .eq("id", business.id)
        .single();
      if (bizRow?.slug) {
        await closeOrderIfFullyPaid(
          service as unknown as SupabaseClient,
          prow.order_id,
          bizRow.slug as string,
        );
      }
    }

    return NextResponse.json({ ok: true, payment_status: nextStatus, kind: "mesa" });
  }

  // ── Flow legacy: orders (delivery / take-away) ────────────────
  const orderId = externalRef;
  const { data: order } = await service
    .from("orders")
    .select("id, business_id, status, payment_status, mp_payment_id, scheduled_at, total_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) {
    console.warn("MP webhook: order not found", { orderId });
    return NextResponse.json({ ok: true });
  }
  if (order.business_id !== business.id) {
    // Cross-tenant tampering attempt — fail loud.
    console.error("MP webhook: business mismatch", {
      orderId,
      businessId,
      orderBiz: order.business_id,
    });
    return NextResponse.json({ error: "business mismatch" }, { status: 403 });
  }

  // Map MP status to our payment_status + optional order.status bump.
  const nextPaymentStatus =
    payment.status === "approved"
      ? "paid"
      : payment.status === "rejected" || payment.status === "cancelled"
        ? "failed"
        : payment.status === "refunded" || payment.status === "charged_back"
          ? "refunded"
          : "pending";

  // Payment and order status are decoupled on purpose — see reconcile.ts.
  const updatePayload: { mp_payment_id: string; payment_status: string } = {
    mp_payment_id: paymentId,
    payment_status: nextPaymentStatus,
  };

  // Skip if nothing changed (idempotent replay). Un pago aprobado NO corta
  // acá: si el cliente volvió de MP antes, `reconcileMpPayment` ya dejó la
  // orden `paid` con este `mp_payment_id`, y cortar dejaba el pedido sin caja
  // ni cocina (auditoría de pedidos · ALTA). Los efectos son idempotentes.
  if (
    existingByPayment &&
    existingByPayment.payment_status === nextPaymentStatus &&
    nextPaymentStatus !== "paid"
  ) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Auditoría de pedidos · MEDIA — una orden pagada no baja por un rechazo
  // tardío de otro intento (reintento #368), y un segundo aprobado no le pisa
  // el `mp_payment_id` al primero (lo trata `aplicarPagoMpAprobado`).
  const orderPaymentId = (order as { mp_payment_id?: string | null }).mp_payment_id ?? null;
  const aEscribir = estadoDePagoAEscribir(
    { actual: order.payment_status, actualPaymentId: orderPaymentId },
    { siguiente: nextPaymentStatus, paymentId },
  );
  const segundoAprobado =
    order.payment_status === "paid" &&
    nextPaymentStatus === "paid" &&
    orderPaymentId !== null &&
    orderPaymentId !== paymentId;
  if (aEscribir !== null && !segundoAprobado) {
    const { error: updErr } = await service
      .from("orders")
      .update({ ...updatePayload, payment_status: aEscribir })
      .eq("id", order.id);
    if (updErr) {
      console.error("MP webhook: update failed", updErr);
      return NextResponse.json({ error: "update failed" }, { status: 500 });
    }
  } else if (aEscribir === null) {
    console.warn("MP webhook: estado de pago tardío ignorado", {
      orderId: order.id,
      paymentId,
      nextPaymentStatus,
    });
  }

  // ── Efectos del pago aprobado: caja + cocina/agendado/aviso ───
  // Compartidos con el regreso de MP (`reconcileMpPayment`); una sola vez por
  // `mp_payment_id` (ver `aplicarPagoMpAprobado`).
  if (nextPaymentStatus === "paid") {
    await aplicarPagoMpAprobado(service as unknown as SupabaseClient, {
      order: {
        id: order.id,
        business_id: business.id,
        status: order.status,
        scheduled_at: (order as { scheduled_at?: string | null }).scheduled_at,
        total_cents: (order as { total_cents: number }).total_cents,
        payment_status: order.payment_status,
      },
      paymentId,
      // Reentrega: este pago ya estaba registrado `paid` antes de este webhook.
      yaRegistrado: existingByPayment?.payment_status === "paid",
    });
  }

  return NextResponse.json({ ok: true, payment_status: nextPaymentStatus });
}

function extractPaymentId(
  payload:
    | { type?: string; action?: string; data?: { id?: string | number } }
    | { topic?: string; resource?: string }
    | null,
): string | null {
  if (!payload) return null;
  if ("data" in payload && payload.data?.id != null) {
    return String(payload.data.id);
  }
  if ("resource" in payload && typeof payload.resource === "string") {
    const match = payload.resource.match(/\/payments\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}
