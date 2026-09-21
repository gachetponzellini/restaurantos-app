import { describe, expect, it } from "vitest";

import { propinaPorPorcentaje } from "./propina";

// #189 — decisión de Juan (2026-09-21): la propina por porcentaje se calcula
// sobre lo que se cobra DESPUÉS del descuento, no sobre el subtotal de lista.
describe("propinaPorPorcentaje", () => {
  it("$42.000 con 10% de descuento y 10% de propina → $3.780, no $4.200", () => {
    expect(
      propinaPorPorcentaje({ subtotalCents: 4_200_000, descuentoCents: 420_000, porcentaje: 10 }),
    ).toBe(378_000);
  });

  it("sin descuento es el porcentaje del subtotal", () => {
    expect(
      propinaPorPorcentaje({ subtotalCents: 4_200_000, descuentoCents: 0, porcentaje: 10 }),
    ).toBe(420_000);
  });

  it("con descuento total (cortesía) no hay propina", () => {
    expect(
      propinaPorPorcentaje({ subtotalCents: 4_200_000, descuentoCents: 4_200_000, porcentaje: 15 }),
    ).toBe(0);
  });

  it("redondea al centavo", () => {
    expect(
      propinaPorPorcentaje({ subtotalCents: 1_005, descuentoCents: 0, porcentaje: 10 }),
    ).toBe(101); // 100,5 → 101
  });
});
