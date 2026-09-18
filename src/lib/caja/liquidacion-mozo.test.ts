import { describe, expect, it } from "vitest";

import { agruparCobrosPorMozo, calcularRendicionMozo } from "./liquidacion-mozo";

describe("calcularRendicionMozo", () => {
  it("efectivo + tickets, sin contar propina", () => {
    const result = calcularRendicionMozo([
      { method: "cash", amount_cents: 1_150_000, tip_cents: 150_000 },
      { method: "cash", amount_cents: 500_000, tip_cents: 0 },
      { method: "card_manual", amount_cents: 2_000_000, tip_cents: 0 },
      { method: "transfer", amount_cents: 800_000, tip_cents: 0 },
    ]);

    expect(result.efectivo_cents).toBe(1_500_000);
    expect(result.tickets_cents).toBe(2_800_000);
    expect(result.total_propinas_cents).toBe(150_000);
    expect(result.por_metodo.cash).toBe(1_500_000);
    expect(result.por_metodo.card_manual).toBe(2_000_000);
    expect(result.por_metodo.transfer).toBe(800_000);
  });

  it("mozo sin pagos en el período → todo en cero", () => {
    const result = calcularRendicionMozo([]);

    expect(result.efectivo_cents).toBe(0);
    expect(result.tickets_cents).toBe(0);
    expect(result.total_propinas_cents).toBe(0);
    expect(result.por_metodo.cash).toBe(0);
    expect(result.por_metodo.card_manual).toBe(0);
  });

  it("solo tarjeta y transferencia → efectivo cero, tickets suma", () => {
    const result = calcularRendicionMozo([
      { method: "card_manual", amount_cents: 500_000, tip_cents: 0 },
      { method: "mp_qr", amount_cents: 300_000, tip_cents: 0 },
      { method: "transfer", amount_cents: 200_000, tip_cents: 0 },
    ]);

    expect(result.efectivo_cents).toBe(0);
    expect(result.tickets_cents).toBe(1_000_000);
    expect(result.por_metodo.card_manual).toBe(500_000);
    expect(result.por_metodo.mp_qr).toBe(300_000);
    expect(result.por_metodo.transfer).toBe(200_000);
  });

  it("propina en múltiples pagos se excluye de todos los métodos", () => {
    const result = calcularRendicionMozo([
      { method: "cash", amount_cents: 600_000, tip_cents: 100_000 },
      { method: "card_manual", amount_cents: 1_200_000, tip_cents: 200_000 },
    ]);

    expect(result.efectivo_cents).toBe(500_000);
    expect(result.tickets_cents).toBe(1_000_000);
    expect(result.total_propinas_cents).toBe(300_000);
    expect(result.por_metodo.cash).toBe(500_000);
    expect(result.por_metodo.card_manual).toBe(1_000_000);
  });

  it("solo efectivo sin propina", () => {
    const result = calcularRendicionMozo([
      { method: "cash", amount_cents: 300_000, tip_cents: 0 },
      { method: "cash", amount_cents: 700_000, tip_cents: 0 },
    ]);

    expect(result.efectivo_cents).toBe(1_000_000);
    expect(result.tickets_cents).toBe(0);
    expect(result.total_propinas_cents).toBe(0);
  });
});

describe("agruparCobrosPorMozo", () => {
  const pago = (
    mozo: string | null,
    method: "cash" | "card_manual",
    amount: number,
    tip = 0,
  ) => ({
    attributed_mozo_name: mozo,
    method,
    amount_cents: amount,
    tip_cents: tip,
  });

  it("suma NETO de propina, como el resto de la pantalla (spec 098)", () => {
    // Antes sumaba `amount_cents` pelado y este bloque mostraba más plata que
    // el desglose por método de arriba, para los mismos cobros.
    const [m] = agruparCobrosPorMozo([pago("Lucía", "cash", 11_000, 1_000)]);
    expect(m.total_cents).toBe(10_000);
    expect(m.propinas_cents).toBe(1_000);
  });

  it("«a rendir» es sólo el efectivo (spec 151)", () => {
    const [m] = agruparCobrosPorMozo([
      pago("Lucía", "cash", 18_500),
      pago("Lucía", "card_manual", 38_500),
    ]);
    expect(m.total_cents).toBe(57_000);
    expect(m.a_rendir_cents).toBe(18_500);
  });

  it("parte los cobros de cada mozo por método, con su cantidad", () => {
    const [m] = agruparCobrosPorMozo([
      pago("Lucía", "cash", 10_000),
      pago("Lucía", "cash", 8_500),
      pago("Lucía", "card_manual", 38_500),
    ]);
    expect(m.cobros_count).toBe(3);
    expect(m.por_metodo).toEqual([
      { method: "card_manual", count: 1, total_cents: 38_500 },
      { method: "cash", count: 2, total_cents: 18_500 },
    ]);
  });

  it("el cobro sin mozo no se pierde: va a «Sin mozo»", () => {
    const [m] = agruparCobrosPorMozo([pago(null, "cash", 5_000)]);
    expect(m.mozo_name).toBe("Sin mozo");
  });

  it("ordena por lo cobrado: primero a quien más hay que pedirle", () => {
    const ms = agruparCobrosPorMozo([
      pago("Pedro", "cash", 10_000),
      pago("Lucía", "cash", 90_000),
    ]);
    expect(ms.map((m) => m.mozo_name)).toEqual(["Lucía", "Pedro"]);
  });

  it("sin cobros no devuelve nada", () => {
    expect(agruparCobrosPorMozo([])).toEqual([]);
  });
});

describe("propina en efectivo vs. a pagar del cajón (#351)", () => {
  it("separa la propina que ya tiene encima de la que hay que darle", () => {
    const r = calcularRendicionMozo([
      { method: "cash", amount_cents: 11_000, tip_cents: 1_000 },
      { method: "card_manual", amount_cents: 8_500, tip_cents: 1_020 },
    ]);
    expect(r.total_propinas_cents).toBe(2_020);
    expect(r.propina_efectivo_cents).toBe(1_000);
    expect(r.propina_a_entregar_cents).toBe(1_020);
  });
});
