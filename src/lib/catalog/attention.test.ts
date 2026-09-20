import { describe, expect, it } from "vitest";

import { catalogAttention } from "./attention";

const costeo = (marginCents: number, hasRecipe = true) => ({
  productId: "p",
  productName: "p",
  categoryName: null,
  priceCents: 1000,
  foodCostCents: 1000 - marginCents,
  marginPercent: 0,
  marginCents,
  hasRecipe,
  lineasSinCosto: 0,
});

const bebida = (isLow: boolean) => ({
  stockItemId: "s",
  productId: "p",
  productName: "p",
  categoryName: null,
  currentQty: 0,
  minQty: 0,
  unit: "u",
  isLow,
  updatedAt: "",
});

const insumo = (stockStatus: "ok" | "low" | "out", isActive = true) =>
  ({ stockStatus, isActive }) as never;

describe("catalogAttention — badges de las tabs (spec 205 · D6)", () => {
  it("costeo cuenta sólo los platos con receta que pierden plata", () => {
    const r = catalogAttention({
      costeo: [
        costeo(-100),
        costeo(-1),
        costeo(0),
        costeo(500),
        costeo(-50, false),
      ],
      stockBebidas: [],
      stockBar: [],
      ingredients: [],
    });
    expect(r.costeo).toBe(2);
  });

  it("insumos cuenta los activos bajo mínimo o sin stock", () => {
    const r = catalogAttention({
      costeo: [],
      stockBebidas: [],
      stockBar: [],
      ingredients: [
        insumo("ok"),
        insumo("low"),
        insumo("out"),
        insumo("low", false),
      ],
    });
    expect(r.insumos).toBe(2);
  });

  it("stock suma bebidas + bar bajos + insumos de cocina", () => {
    const r = catalogAttention({
      costeo: [],
      stockBebidas: [bebida(true), bebida(false), bebida(true)],
      stockBar: [bebida(true)],
      ingredients: [insumo("out")],
    });
    expect(r.stock).toBe(4);
  });

  it("sin nada que atender, todo en cero", () => {
    expect(
      catalogAttention({
        costeo: [],
        stockBebidas: [],
        stockBar: [],
        ingredients: [],
      }),
    ).toEqual({ costeo: 0, insumos: 0, stock: 0 });
  });
});
