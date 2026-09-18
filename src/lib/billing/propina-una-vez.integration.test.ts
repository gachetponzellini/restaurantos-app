// @vitest-environment node
//
// #353 — la propina de una cuenta se registra UNA vez, por más pagos en que se
// cobre. La asigna la base (lo que falta de propina, acotado al monto), no la
// pantalla: sin dividir, la sub-cuenta implícita mandaba la propina entera en
// cada pago parcial y la rendición la pagaba dos veces del cajón.
//
// Y dos invariantes de borde: no hay cobros de $0, y lo que un pago salda
// (en base) nunca supera lo que falta — un doble cobro concurrente choca acá.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearFixture, dbAvailable } from "./test-helpers/plata-fixture";

const f = crearFixture(`test-propina-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const sumaPropinas = async (orderId: string) =>
  (await f.pagos(orderId))
    .filter((p) => p.payment_status === "paid")
    .reduce((n, p) => n + p.tip_cents, 0);

describe.skipIf(!dbAvailable)("la propina se registra una vez (integration · #353)", () => {
  beforeAll(f.setup, 60_000);
  afterAll(f.teardown, 60_000);

  it("dos pagos parciales sin dividir registran la propina una sola vez", async () => {
    const orderId = await f.orden(1_100_000, 100_000);
    // La pantalla manda la propina entera de la cuenta en cada pago.
    await f.pagarOk(orderId, { amount: 500_000, tip: 100_000, method: "card_manual" });
    await f.pagarOk(orderId, { amount: 600_000, tip: 100_000, method: "card_manual" });
    expect(await sumaPropinas(orderId)).toBe(100_000);
    expect((await f.leerOrden(orderId)).payment_status).toBe("paid");
  });

  it("dentro de una sub-cuenta pagada en dos partes, su propina va una vez", async () => {
    const orderId = await f.orden(1_100_000, 100_000);
    const [s1] = await f.subcuentas(orderId, [550_000, 550_000], [50_000, 50_000]);
    await f.pagarOk(orderId, { amount: 300_000, tip: 50_000, split: s1 });
    await f.pagarOk(orderId, { amount: 250_000, tip: 50_000, split: s1 });
    expect(await sumaPropinas(orderId)).toBe(50_000);
  });

  it("la propina no supera lo que el pago salda", async () => {
    const orderId = await f.orden(1_100_000, 100_000);
    const p = await f.pagarOk(orderId, { amount: 40_000, tip: 100_000, method: "card_manual" });
    expect(p.payment.tip_cents).toBe(40_000);
    // El resto de la propina viaja con el siguiente pago.
    const p2 = await f.pagarOk(orderId, { amount: 1_060_000, tip: 100_000, method: "card_manual" });
    expect(p2.payment.tip_cents).toBe(60_000);
  });

  it("la propina de la cuenta se asigna aunque la pantalla mande cero", async () => {
    const orderId = await f.orden(1_100_000, 100_000);
    const p = await f.pagarOk(orderId, { amount: 1_100_000, tip: 0 });
    expect(p.payment.tip_cents).toBe(100_000);
  });

  it("el excedente se suma a la propina de la cuenta, no la reemplaza", async () => {
    const orderId = await f.orden(1_100_000, 100_000);
    const p = await f.pagarOk(orderId, { amount: 1_200_000, tip: 100_000, extraTip: 100_000, method: "card_manual" });
    expect(p.payment.tip_cents).toBe(200_000);
    expect(p.payment.extra_tip_cents).toBe(100_000);
  });

  it("no hay cobros de $0", async () => {
    const orderId = await f.orden(1_000_000);
    const r = await f.pagar(orderId, { amount: 0 });
    expect(r.error?.message).toContain("AMOUNT_NOT_POSITIVE");
  });

  it("un pago que salda más de lo que falta se rechaza (doble cobro)", async () => {
    const orderId = await f.orden(1_000_000);
    await f.pagarOk(orderId, { amount: 600_000 });
    // La pantalla creía que faltaban $10.000; faltan $4.000.
    const r = await f.pagar(orderId, { amount: 600_000 });
    expect(r.error?.message).toContain("AMOUNT_EXCEEDS_REMAINING");
  });

  it("en una sub-cuenta, tampoco se salda más de lo que le falta", async () => {
    const orderId = await f.orden(1_000_000);
    const [s1] = await f.subcuentas(orderId, [500_000, 500_000]);
    const r = await f.pagar(orderId, { amount: 700_000, split: s1 });
    expect(r.error?.message).toContain("AMOUNT_EXCEEDS_REMAINING");
  });

  it("con recargo, el monto cobrado incluye el ajuste y la base es lo que falta", async () => {
    const orderId = await f.orden(1_000_000);
    const p = await f.pagarOk(orderId, { amount: 1_100_000, adjustment: 100_000, adjustmentPercent: 10, method: "card_manual" });
    expect(p.fully_paid).toBe(true);
  });
});
