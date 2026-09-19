import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { closeOrderIfFullyPaid } from "@/lib/billing/cobro-actions";
import { getDefaultCaja } from "@/lib/caja/queries";
import { notifyScheduledConfirmed } from "@/lib/notifications/delivery-notify";
import { routeOrderToCocina } from "@/lib/orders/route-to-cocina";
import { isScheduledForLater } from "@/lib/orders/scheduled";
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
    .select("id, business_id, status, payment_status, scheduled_at, total_cents")
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

  // Skip the write if nothing changed (idempotent replay).
  if (
    existingByPayment &&
    existingByPayment.payment_status === nextPaymentStatus
  ) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { error: updErr } = await service
    .from("orders")
    .update(updatePayload)
    .eq("id", order.id);
  if (updErr) {
    console.error("MP webhook: update failed", updErr);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  // ── El pago entra a la caja ───────────────────────────────────
  // Hasta acá el flow legacy sólo marcaba `orders.payment_status`: la plata de
  // un delivery pagado online no existía en `payments`, así que no aparecía en
  // la caja ni en la recaudación del cierre de turno (que se arma leyendo
  // `payments`). Como no hay cajero que elija dónde asentarlo, va a la caja por
  // defecto del negocio.
  //
  // Idempotente por el índice único parcial `(business_id, mp_payment_id)`
  // (migración 0026): MP reintenta hasta recibir un 2xx y un reintento no puede
  // acreditar la misma plata dos veces.
  if (nextPaymentStatus === "paid") {
    const caja = await getDefaultCaja(business.id);
    if (!caja) {
      // Sin cajas cargadas no hay dónde asentarlo. El pago ya quedó acreditado
      // en la orden; no se pierde, pero hay que avisar fuerte porque la caja va
      // a cerrar sin esta venta.
      console.error("MP webhook: negocio sin cajas, pago sin asentar", {
        orderId: order.id,
        businessId,
      });
    } else {
      const { error: payErr } = await service.from("payments").insert({
        order_id: order.id,
        business_id: business.id,
        split_id: null,
        caja_id: caja.id,
        method: "mp_link",
        amount_cents: (order as { total_cents: number }).total_cents,
        tip_cents: 0,
        mp_payment_id: paymentId,
        payment_status: "paid",
      });
      // 23505 = unique_violation: ya lo habíamos asentado en una entrega previa
      // del mismo webhook. Es el camino esperado en un reintento, no un error.
      if (payErr && payErr.code !== "23505") {
        console.error("MP webhook: no se pudo asentar el pago en la caja", {
          orderId: order.id,
          error: payErr,
        });
      } else {
        // #352 — lo pagado de la orden sale de la regla común (0117).
        const { error: recErr } = await service.rpc("recalcular_pagado_orden", {
          p_order_id: order.id,
        });
        if (recErr) console.error("MP webhook: recalcular lo pagado", recErr);
      }
    }
  }

  // Auto-march (spec-05): pago aprobado → rutear a cocina.
  // Diferido (spec 31): si el pedido es para más tarde, el pago aprobado sólo
  // **confirma el agendado** (avisa al cliente) — NO marcha. Lo marcha el cron
  // ~40 min antes (o "marchar ahora"). Sin scheduled_at futuro, marcha como hoy.
  if (nextPaymentStatus === "paid") {
    const scheduledAt = (order as { scheduled_at?: string | null })
      .scheduled_at;
    if (order.status === "cancelled") {
      // spec 093 · H-21. El pago se acredita igual (la plata entró y tiene que
      // estar en la caja), pero un pedido cancelado NO se cocina. La ventana es
      // real con los medios offline de MP —efectivo, Rapipago— que se aprueban
      // horas después de generado el link: para entonces el cliente ya pudo
      // cancelar desde la app. `order.status` se seleccionaba arriba y no se
      // usaba en ningún lado.
      console.warn("MP webhook: pago aprobado sobre pedido cancelado", {
        orderId: order.id,
      });
    } else if (isScheduledForLater(scheduledAt)) {
      await notifyScheduledConfirmed({ orderId: order.id });
    } else {
      try {
        await routeOrderToCocina(order.id, order.business_id);
      } catch (e) {
        console.error("MP webhook: auto-march failed", e);
      }
    }
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
