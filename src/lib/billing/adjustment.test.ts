import { describe, expect, it } from "vitest";

import { ajusteDelCobro, calculateAdjustment } from "./adjustment";

describe("calculateAdjustment", () => {
  it("sin ajuste devuelve la base intacta", () => {
    expect(calculateAdjustment(10_000, 0)).toEqual({
      adjustmentCents: 0,
      finalCents: 10_000,
    });
  });

  it("recargo suma sobre la base", () => {
    expect(calculateAdjustment(10_000, 10)).toEqual({
      adjustmentCents: 1_000,
      finalCents: 11_000,
    });
  });

  it("descuento (porcentaje negativo) resta", () => {
    expect(calculateAdjustment(10_000, -10)).toEqual({
      adjustmentCents: -1_000,
      finalCents: 9_000,
    });
  });

  it("redondea el ajuste al centavo", () => {
    // 3333 * 15% = 499.95 → 500
    expect(calculateAdjustment(3_333, 15).adjustmentCents).toBe(500);
    // 3333 * 5% = 166.65 → 167
    expect(calculateAdjustment(3_333, 5).adjustmentCents).toBe(167);
  });

  it("acepta porcentajes fraccionarios (numeric(5,2) en la config)", () => {
    expect(calculateAdjustment(10_000, 2.5)).toEqual({
      adjustmentCents: 250,
      finalCents: 10_250,
    });
  });

  it("base 0 no genera ajuste", () => {
    expect(calculateAdjustment(0, 21)).toEqual({
      adjustmentCents: 0,
      finalCents: 0,
    });
  });

  it("el final siempre es base + ajuste", () => {
    for (const [base, pct] of [
      [10_000, 10],
      [7_777, -3],
      [1, 50],
      [999_999, 21],
    ] as Array<[number, number]>) {
      const r = calculateAdjustment(base, pct);
      expect(r.finalCents).toBe(base + r.adjustmentCents);
    }
  });
});

describe("ajusteDelCobro (#353 — el server no confía en el ajuste de la pantalla)", () => {
  it("sin porcentaje no hay ajuste", () => {
    expect(ajusteDelCobro({ amountCents: 5_000, remainingCents: 10_000, percent: 0 })).toBe(0);
  });

  it("el pago completo con recargo lleva el ajuste sobre lo que falta", () => {
    expect(ajusteDelCobro({ amountCents: 11_000, remainingCents: 10_000, percent: 10 })).toBe(1_000);
  });

  it("de más (vuelto o propina) no infla el ajuste", () => {
    expect(ajusteDelCobro({ amountCents: 20_000, remainingCents: 10_000, percent: 10 })).toBe(1_000);
  });

  it("un pago parcial lleva la parte proporcional del recargo, no la del total", () => {
    // $5.500 con +10 % son $5.000 de base y $500 de recargo.
    expect(ajusteDelCobro({ amountCents: 5_500, remainingCents: 10_000, percent: 10 })).toBe(500);
  });

  it("con descuento el pago completo es lo que falta menos el descuento", () => {
    expect(ajusteDelCobro({ amountCents: 9_000, remainingCents: 10_000, percent: -10 })).toBe(-1_000);
  });

  it("con descuento, un parcial descuenta su proporción", () => {
    // $4.500 con −10 % saldan $5.000.
    expect(ajusteDelCobro({ amountCents: 4_500, remainingCents: 10_000, percent: -10 })).toBe(-500);
  });
});
