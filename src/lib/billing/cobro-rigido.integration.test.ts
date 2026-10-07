// @vitest-environment node
//
// Spec 212 · lo cobrado y entregado no se anula (#385).
//
//  · R1 — en la base: un cobro (que no es de MP) de un pedido cerrado no pasa a
//    `refunded`, por ninguna vía (anular_pago_tx, anular_cobro_tx o un UPDATE a
//    mano), y un pedido cerrado no se reabre. Se corrige, no se anula.
//  · D1 — un pedido abierto sí: anular un pago parcial sigue andando.
//  · R3 — si Mercado Pago devuelve la plata y no queda nada vivo, el pedido
//    queda anulado (sale de entregados y de «por cobrar»).
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

describe.skipIf(!dbAvailable)("cobro rígido (spec 212)", () => {
  beforeAll(async () => {
    await s.setup();
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("el pago de un pedido cerrado no se anula: ni una línea, ni el cobro entero, ni a mano", async () => {
    const m = await s.mesa([20_000]);
    const pagoId = await pago(m.orderId, 20_000);
    await cerrar(m.orderId, 20_000);

    const linea = await s.sb.rpc("anular_pago_tx", {
      p_payment_id: pagoId, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId, p_reason: "prueba",
    });
    expect(linea.error?.message).toContain("COBRO_CERRADO_NO_SE_ANULA");

    const entero = await s.sb.rpc("anular_cobro_tx", {
      p_order_id: m.orderId, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId, p_reason: "prueba",
    });
    expect(entero.error?.message).toContain("COBRO_CERRADO_NO_SE_ANULA");

    const aMano = await s.sb.from("payments").update({ payment_status: "refunded" }).eq("id", pagoId);
    expect(aMano.error?.message).toContain("COBRO_CERRADO_NO_SE_ANULA");

    const reabrir = await s.sb.from("orders").update({ lifecycle_status: "open" }).eq("id", m.orderId);
    expect(reabrir.error?.message).toContain("COBRO_CERRADO_NO_SE_ANULA");

    const { data: p } = await s.sb.from("payments").select("payment_status").eq("id", pagoId).single();
    expect(p!.payment_status).toBe("paid");
  });

  it("sí se corrige: cambiar el método de un cobro de un pedido cerrado anda", async () => {
    const m = await s.mesa([15_000]);
    const pagoId = await pago(m.orderId, 15_000);
    await cerrar(m.orderId, 15_000);
    const r = await s.sb.rpc("corregir_pago_tx", {
      p_payment_id: pagoId, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId,
      p_reason: "Era tarjeta", p_patch: { method: "card_manual" },
    });
    expect(r.error).toBeNull();
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
