// @vitest-environment node
//
// #352 — «cuánto se pagó» es UNA regla: la base (monto − ajuste por método),
// y la cuenta está saldada cuando esa base cubre el total, con o sin
// sub-cuentas. Cobrar ya lo hacía así (0076); anular y corregir sumaban el
// bruto y dejaban saldos fantasma.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearFixture, dbAvailable } from "./test-helpers/plata-fixture";

const f = crearFixture(`test-base-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

describe.skipIf(!dbAvailable)("pagado en base (integration · #352)", () => {
  beforeAll(f.setup, 60_000);
  afterAll(f.teardown, 60_000);

  it("anular una línea con recargo deja lo pagado en base, no en bruto", async () => {
    const orderId = await f.orden(1_000_000);
    // Dos tarjetas con +10 %: cada una paga $5.000 de base con $500 de recargo.
    await f.pagarOk(orderId, { amount: 550_000, adjustment: 50_000, adjustmentPercent: 10, method: "card_manual" });
    const p2 = await f.pagarOk(orderId, { amount: 550_000, adjustment: 50_000, adjustmentPercent: 10, method: "card_manual" });
    expect((await f.leerOrden(orderId)).total_paid_cents).toBe(1_000_000);

    expect((await f.anular(p2.payment.id)).error).toBeNull();
    const o = await f.leerOrden(orderId);
    expect(o.total_paid_cents).toBe(500_000);
    expect(o.payment_status).toBe("pending");
  });

  it("corregir un cobro con descuento en una cuenta cerrada no la da por descubierta", async () => {
    const orderId = await f.orden(1_000_000);
    // Efectivo −10 %: se cobran $9.000 por una cuenta de $10.000.
    const p = await f.pagarOk(orderId, { amount: 900_000, adjustment: -100_000, adjustmentPercent: -10, method: "cash" });
    expect(p.fully_paid).toBe(true);
    await f.cerrarOrden(orderId);

    const r = await f.corregir(p.payment.id, { notes: "sólo una nota" });
    expect(r.error).toBeNull();
    expect((await f.leerOrden(orderId)).total_paid_cents).toBe(1_000_000);
  });

  it("la sub-cuenta con recargo queda paga en base tras corregir", async () => {
    const orderId = await f.orden(1_000_000);
    const [s1] = await f.subcuentas(orderId, [500_000, 500_000]);
    const p = await f.pagarOk(orderId, { amount: 550_000, adjustment: 50_000, adjustmentPercent: 10, split: s1, method: "card_manual" });
    expect((await f.leerSubcuenta(s1)).paid_amount_cents).toBe(500_000);

    expect((await f.corregir(p.payment.id, { notes: "x" })).error).toBeNull();
    const s = await f.leerSubcuenta(s1);
    expect(s.paid_amount_cents).toBe(500_000);
    expect(s.status).toBe("paid");
  });

  it("el saldo de una cuenta dividida y cerrada se cobra sin sub-cuenta y queda pagada", async () => {
    const orderId = await f.orden(1_000_000);
    const [s1, s2] = await f.subcuentas(orderId, [500_000, 500_000]);
    await f.pagarOk(orderId, { amount: 500_000, split: s1 });
    const p2 = await f.pagarOk(orderId, { amount: 500_000, split: s2 });
    expect(p2.fully_paid).toBe(true);
    await f.cerrarOrden(orderId);

    expect((await f.anular(p2.payment.id)).error).toBeNull();
    let o = await f.leerOrden(orderId);
    expect(o.payment_status).toBe("pending");
    expect(o.total_paid_cents).toBe(500_000);

    // Desde el pedido se cobra el saldo, sin elegir sub-cuenta.
    const re = await f.pagarOk(orderId, { amount: 500_000 });
    expect(re.fully_paid).toBe(true);
    o = await f.leerOrden(orderId);
    expect(o.payment_status).toBe("paid");
    expect(o.total_paid_cents).toBe(1_000_000);
  });

  it("una cuenta dividida no queda saldada si las sub-cuentas no cubren el total", async () => {
    const orderId = await f.orden(1_000_000);
    // Sub-cuentas que suman $8.000 de una cuenta de $10.000.
    const [s1, s2] = await f.subcuentas(orderId, [400_000, 400_000]);
    await f.pagarOk(orderId, { amount: 400_000, split: s1 });
    const p2 = await f.pagarOk(orderId, { amount: 400_000, split: s2 });
    expect(p2.fully_paid).toBe(false);
    expect((await f.leerOrden(orderId)).total_paid_cents).toBe(800_000);
  });
});
