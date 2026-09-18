import { describe, expect, it } from "vitest";

import {
  bebidasToRows,
  cocinaToRows,
  lowCount,
  previewQty,
  shortageRatio,
  sortByShortage,
  stockStatus,
  formatQty,
} from "./stock-rows";

describe("stockStatus (spec 205 · D12)", () => {
  it("sin stock cuando la cantidad es 0 o negativa", () => {
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(-2, 5)).toBe("out");
  });

  it("bajo mínimo cuando hay stock pero no llega al mínimo", () => {
    expect(stockStatus(3, 5)).toBe("low");
  });

  it("OK cuando llega o supera el mínimo", () => {
    expect(stockStatus(5, 5)).toBe("ok");
    expect(stockStatus(10, 5)).toBe("ok");
  });

  it("sin mínimo cargado (0), nunca está bajo mínimo salvo que esté en cero", () => {
    expect(stockStatus(1, 0)).toBe("ok");
    expect(stockStatus(0, 0)).toBe("out");
  });
});

describe("sortByShortage — orden por lo que falta primero (D12)", () => {
  it("ordena de menor a mayor ratio stock/mínimo", () => {
    const rows = [
      { id: "a", qty: 8, min: 10 }, // 0.8
      { id: "b", qty: 1, min: 10 }, // 0.1
      { id: "c", qty: 10, min: 10 }, // 1
    ];
    expect(sortByShortage(rows).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("los ítems sin mínimo y con stock van al final", () => {
    const rows = [
      { id: "sin-min", qty: 50, min: 0 },
      { id: "bajo", qty: 1, min: 10 },
    ];
    expect(sortByShortage(rows).map((r) => r.id)).toEqual(["bajo", "sin-min"]);
  });

  it("sin mínimo pero en cero igual se muestra antes que uno sin problema", () => {
    const rows = [
      { id: "ok-alto", qty: 50, min: 0 },
      { id: "cero-sin-min", qty: 0, min: 0 },
    ];
    expect(sortByShortage(rows).map((r) => r.id)).toEqual([
      "cero-sin-min",
      "ok-alto",
    ]);
  });

  it("no muta el arreglo original", () => {
    const rows = [
      { qty: 8, min: 10 },
      { qty: 1, min: 10 },
    ];
    const original = [...rows];
    sortByShortage(rows);
    expect(rows).toEqual(original);
  });
});

describe("shortageRatio", () => {
  it("es qty/min cuando hay mínimo", () => {
    expect(shortageRatio(4, 8)).toBe(0.5);
  });
});

describe("lowCount — badge de bajo mínimo del sub-tab", () => {
  it("cuenta bajo mínimo y sin stock, no los OK", () => {
    const rows = [
      { qty: 10, min: 5 }, // ok
      { qty: 2, min: 5 }, // low
      { qty: 0, min: 5 }, // out
    ];
    expect(lowCount(rows)).toBe(2);
  });
});

describe("previewQty — «hoy hay X → quedaría Y»", () => {
  it("suma el delta a la cantidad actual", () => {
    expect(previewQty(10, 5)).toBe(15);
    expect(previewQty(10, -3)).toBe(7);
  });
});

describe("bebidasToRows / cocinaToRows — normalización a StockRow", () => {
  it("mapea un StockOverviewItem a fila de producto, con costo opcional", () => {
    const rows = bebidasToRows(
      [
        {
          stockItemId: "si1",
          productId: "p1",
          productName: "Coca-Cola",
          categoryName: "Gaseosas",
          currentQty: 12,
          minQty: 5,
          unit: "u.",
          isLow: false,
          updatedAt: "2026-09-18T00:00:00Z",
        },
      ],
      { p1: 150000 },
    );
    expect(rows).toEqual([
      {
        kind: "product",
        id: "si1",
        productId: "p1",
        name: "Coca-Cola",
        sub: "Gaseosas",
        qty: 12,
        min: 5,
        unit: "u.",
        costCents: 150000,
      },
    ]);
  });

  it("mapea un KitchenStockFull a fila de insumo, con la presentación default", () => {
    const rows = cocinaToRows([
      {
        id: "i1",
        name: "Harina 000",
        unit: "kg",
        stockQuantity: 8,
        stockMinAlert: 10,
        stockStatus: "low",
        wastePercent: 0,
        isActive: true,
        updatedAt: "2026-09-18T00:00:00Z",
        presentations: [{ id: "pr1", name: "Bolsa 25 kg", netQuantity: 25 }],
      },
    ]);
    expect(rows[0]).toMatchObject({
      kind: "ingredient",
      id: "i1",
      name: "Harina 000",
      sub: "Bolsa 25 kg",
      qty: 8,
      min: 10,
      unit: "kg",
    });
  });

  it("sin stockMinAlert cargado, el mínimo efectivo es 0", () => {
    const rows = cocinaToRows([
      {
        id: "i2",
        name: "Sal fina",
        unit: "kg",
        stockQuantity: 3,
        stockMinAlert: null,
        stockStatus: "ok",
        wastePercent: 0,
        isActive: true,
        updatedAt: "2026-09-18T00:00:00Z",
        presentations: [],
      },
    ]);
    expect(rows[0].min).toBe(0);
    expect(rows[0].sub).toBeNull();
  });
});

describe("formatQty", () => {
  it("unidades enteras, con plural", () => {
    expect(formatQty(1, "unidad")).toBe("1 unidad");
    expect(formatQty(10, "unidad")).toBe("10 unidades");
    expect(formatQty(0, "unidad")).toBe("0 unidades");
  });

  it("kilos y litros con dos decimales", () => {
    expect(formatQty(2.125, "kg")).toBe("2.13 kg");
    expect(formatQty(1, "lt")).toBe("1.00 lt");
  });
});
