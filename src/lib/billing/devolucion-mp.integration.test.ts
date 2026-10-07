// @vitest-environment node
//
// Spec 212 (#385) — pagos devueltos por Mercado Pago.
//
//  · R3 — si Mercado Pago devuelve la plata y no queda nada vivo, el pedido
//    queda anulado (sale de entregados y de «por cobrar»). Si devuelve uno de
//    dos pagos, el pedido sigue cerrado con lo que falta.
//  · Anular un cobro hecho en el local sigue como siempre (D2 se descartó: Juan,
//    2026-10-07, «está mal esto de que no se pueda anular»).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crearSalon, dbAvailable } from "./test-helpers/salon-fixture";
import { aplicarReembolsoMp } from "@/lib/payments/efectos-pago-mp";

const s = crearSalon(`test-cobro-rigido-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

async function pago(orderId: string, amount: number, method = "cash", extra: Record<string, unknown> = {}) {
  const { data, error } = await s.sb
    .from("payments")
    .insert({
      order_id: orderId, business_id: s.ctx.businessId, caja_id: s.ctx.cajaId,
      operated_by: s.ctx.encargadoId, attributed_mozo_id: s.ctx.mozoId,
      method, amount_cents: amount, tip_cents: 0, payment_status: "paid", ...extra,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}
async function cerrar(orderId: string, total: number) {
  const { error } = await s.sb
    .from("orders")
    .update({ lifecycle_status: "closed", status: "delivered", payment_status: "paid", total_paid_cents: total })
    .eq("id", orderId);
  if (error) throw error;
}

describe.skipIf(!dbAvailable)("pagos devueltos por MP (spec 212)", () => {
  beforeAll(async () => {
    await s.setup();
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("en un pedido abierto anular un pago parcial sigue andando", async () => {
    const m = await s.mesa([30_000]);
    const pagoId = await pago(m.orderId, 10_000, "card_manual");
    const r = await s.sb.rpc("anular_pago_tx", {
      p_payment_id: pagoId, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId, p_reason: "Se cargó mal",
    });
    expect(r.error).toBeNull();
    // Y la cuenta queda abierta, para cobrarla como corresponde.
    await s.sb.from("orders").update({ lifecycle_status: "closed", status: "cancelled" }).eq("id", m.orderId);
  });

  it("si Mercado Pago devuelve la plata de un pedido cerrado, el pedido queda anulado", async () => {
    const m = await s.mesa([12_000]);
    const mpId = `test-mp-${Date.now()}`;
    await pago(m.orderId, 12_000, "mp_link", { mp_payment_id: mpId });
    await cerrar(m.orderId, 12_000);

    const { reembolsados } = await aplicarReembolsoMp(s.sb, { orderId: m.orderId, businessId: s.ctx.businessId, paymentId: mpId });
    expect(reembolsados).toBe(1);

    const { data: o } = await s.sb
      .from("orders")
      .select("lifecycle_status, status, cancelled_reason")
      .eq("id", m.orderId)
      .single();
    expect(o!.lifecycle_status).toBe("cancelled");
    expect(o!.status).toBe("cancelled");
    expect(o!.cancelled_reason).toMatch(/Mercado Pago/);
  });

  it("si MP devuelve sólo uno de dos pagos, el pedido no se anula (queda con lo que falta)", async () => {
    const m = await s.mesa([20_000]);
    const mpId = `test-mp2-${Date.now()}`;
    await pago(m.orderId, 10_000, "mp_link", { mp_payment_id: mpId });
    await pago(m.orderId, 10_000, "card_manual");
    await cerrar(m.orderId, 20_000);
    await aplicarReembolsoMp(s.sb, { orderId: m.orderId, businessId: s.ctx.businessId, paymentId: mpId });
    const { data: o } = await s.sb.from("orders").select("lifecycle_status").eq("id", m.orderId).single();
    expect(o!.lifecycle_status).toBe("closed");
  });
});
