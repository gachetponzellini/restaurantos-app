import { describe, expect, it } from "vitest";

import { factorDeMerma } from "./factor-de-merma";

describe("factorDeMerma — la merma se pierde sobre lo que se compra", () => {
  it("sin merma no cambia nada", () => {
    expect(factorDeMerma(0)).toBe(1);
    expect(factorDeMerma(null)).toBe(1);
    expect(factorDeMerma(undefined)).toBe(1);
  });

  it("con 20 % hacen falta 250 g para servir 200 g limpios", () => {
    expect(200 * factorDeMerma(20)).toBeCloseTo(250, 6);
  });

  it("con 50 % el insumo cuesta el doble, no una vez y media", () => {
    expect(factorDeMerma(50)).toBeCloseTo(2, 6);
  });

  it("un dato roto no divide por cero ni da negativo", () => {
    expect(Number.isFinite(factorDeMerma(100))).toBe(true);
    expect(factorDeMerma(-10)).toBe(1);
  });
});
