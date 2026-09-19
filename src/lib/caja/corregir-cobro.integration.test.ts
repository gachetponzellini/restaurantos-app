// @vitest-environment node
//
// #356 — corregir un cobro deja la plata coherente:
//   · «Mercado Pago» sólo registro (#350) se corrige como cualquier manual;
//   · cambiar el método recalcula el recargo/descuento sobre la base;
//   · bajar la propina por debajo del excedente lo devuelve a la cuenta en vez
//     de chocar con un check y tirar un error crudo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearFixture, dbAvailable } from "@/lib/billing/test-helpers/plata-fixture";

const f = crearFixture(`test-corregir-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const pago = async (id: string) => {
  const { data } = await f.sb
    .from("payments")
    .select("method, amount_cents, adjustment_cents, adjustment_percent, tip_cents, extra_tip_cents")
    .eq("id", id)
    .single();
  return data as {
    method: string;
    amount_cents: number;
    adjustment_cents: number;
    adjustment_percent: number;
    tip_cents: number;
    extra_tip_cents: number;
  };
};

describe.skipIf(!dbAvailable)("corregir un cobro (integration · #356)", () => {
  beforeAll(async () => {
    await f.setup();
    await f.sb.from("payment_method_configs").insert({
      business_id: f.ctx.businessId,
      method: "card_manual",
      adjustment_percent: 10,
      is_active: true,
    });
  }, 60_000);
  afterAll(f.teardown, 60_000);

  it("un cobro «Mercado Pago» sólo registro se corrige a efectivo y vuelve", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, { amount: 1_000_000, method: "mp_manual" });
    expect((await f.corregir(p.payment.id, { method: "cash" })).error).toBeNull();
    expect((await pago(p.payment.id)).method).toBe("cash");
    expect((await f.corregir(p.payment.id, { method: "mp_manual" })).error).toBeNull();
    expect((await pago(p.payment.id)).method).toBe("mp_manual");
  });

  it("tarjeta con recargo corregida a efectivo pierde el recargo", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, {
      amount: 1_100_000, adjustment: 100_000, adjustmentPercent: 10, method: "card_manual",
    });
    await f.cerrarOrden(orderId);

    expect((await f.corregir(p.payment.id, { method: "cash" })).error).toBeNull();
    const x = await pago(p.payment.id);
    expect(x.amount_cents).toBe(1_000_000);
    expect(x.adjustment_cents).toBe(0);
    expect(Number(x.adjustment_percent)).toBe(0);
    expect((await f.leerOrden(orderId)).total_paid_cents).toBe(1_000_000);
  });

  it("efectivo corregido a tarjeta toma el recargo de la tarjeta", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, { amount: 1_000_000, method: "cash" });
    expect((await f.corregir(p.payment.id, { method: "card_manual" })).error).toBeNull();
    const x = await pago(p.payment.id);
    expect(x.amount_cents).toBe(1_100_000);
    expect(x.adjustment_cents).toBe(100_000);
    expect((await f.leerOrden(orderId)).total_paid_cents).toBe(1_000_000);
  });

  it("cambiar método y monto a la vez: el ajuste sale del monto nuevo", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, { amount: 500_000, method: "cash" });
    // Fue con tarjeta y fueron $5.500 (base $5.000 + 10 %).
    expect(
      (await f.corregir(p.payment.id, { method: "card_manual", amount_cents: 550_000 })).error,
    ).toBeNull();
    const x = await pago(p.payment.id);
    expect(x.adjustment_cents).toBe(50_000);
    expect((await f.leerOrden(orderId)).total_paid_cents).toBe(500_000);
  });

  it("bajar propina y monto juntos por debajo del excedente lo devuelve a la cuenta", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, { amount: 1_200_000, extraTip: 200_000, method: "transfer" });
    expect((await f.leerOrden(orderId)).total_cents).toBe(1_200_000);

    // La propina fue $500, no $2.000: entraron $10.500.
    const r = await f.corregir(p.payment.id, { tip_cents: 50_000, amount_cents: 1_050_000 });
    expect(r.error).toBeNull();
    const x = await pago(p.payment.id);
    expect(x.tip_cents).toBe(50_000);
    expect(x.extra_tip_cents).toBe(50_000);
    const o = await f.leerOrden(orderId);
    expect(o.tip_cents).toBe(50_000);
    expect(o.total_cents).toBe(1_050_000);
    expect(o.total_paid_cents).toBe(1_050_000);
  });

  it("bajar sólo la propina dejaría el total bajo lo cobrado: se rechaza con motivo", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, { amount: 1_200_000, extraTip: 200_000, method: "transfer" });
    const r = await f.corregir(p.payment.id, { tip_cents: 50_000 });
    expect(r.error?.message).toContain("TOTAL_BELOW_PAID");
    expect((await pago(p.payment.id)).tip_cents).toBe(200_000);
  });
});
