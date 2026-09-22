import { describe, expect, it } from "vitest";

import { itemsDePreferenciaPedido, montoCobradoCoincide } from "./items-preferencia";

const linea = (over: Partial<Parameters<typeof itemsDePreferenciaPedido>[0]["lineas"][number]> = {}) => ({
  id: "p1",
  titulo: "Milanesa",
  cantidad: 1,
  unitarioCents: 1_000_000,
  ...over,
});

const totalPesos = (items: { quantity: number; unit_price: number }[]) =>
  Math.round(items.reduce((a, i) => a + i.quantity * i.unit_price * 100, 0));

describe("itemsDePreferenciaPedido (#372)", () => {
  it("sin descuento: una línea por plato + el envío, y suma exacto el total", () => {
    const items = itemsDePreferenciaPedido({
      lineas: [linea({ cantidad: 2 }), linea({ id: "p2", titulo: "Flan", unitarioCents: 350_000 })],
      envioCents: 150_000,
      descuentoCents: 0,
      totalCents: 2_500_000,
      numeroPedido: 12,
    });
    expect(items.map((i) => i.title)).toEqual(["Milanesa", "Flan", "Envío"]);
    expect(totalPesos(items)).toBe(2_500_000);
  });

  it("precios con centavos: no redondea por línea (antes 3 × $1.234,50 cobraba $3.705)", () => {
    const items = itemsDePreferenciaPedido({
      lineas: [linea({ cantidad: 3, unitarioCents: 123_450 })],
      envioCents: 0,
      descuentoCents: 0,
      totalCents: 370_350,
      numeroPedido: 1,
    });
    expect(totalPesos(items)).toBe(370_350);
    expect(items[0].unit_price).toBe(1234.5);
  });

  it("con descuento: una sola línea por el total, nunca un precio negativo", () => {
    const items = itemsDePreferenciaPedido({
      lineas: [linea()],
      envioCents: 0,
      descuentoCents: 100_000,
      totalCents: 900_000,
      numeroPedido: 7,
    });
    expect(items).toEqual([
      { id: "pedido", title: "Pedido #7", quantity: 1, unit_price: 9000 },
    ]);
  });

  it("si las líneas no suman el total, manda el total (lo que se cobra es la orden)", () => {
    const items = itemsDePreferenciaPedido({
      lineas: [linea()],
      envioCents: 0,
      descuentoCents: 0,
      totalCents: 1_050_000,
      numeroPedido: 3,
    });
    expect(items).toHaveLength(1);
    expect(totalPesos(items)).toBe(1_050_000);
  });

  it("ninguna línea va con precio cero o negativo", () => {
    const items = itemsDePreferenciaPedido({
      lineas: [linea(), linea({ id: "g", titulo: "Regalo", unitarioCents: 0 })],
      envioCents: 0,
      descuentoCents: 0,
      totalCents: 1_000_000,
      numeroPedido: 4,
    });
    expect(items.every((i) => i.unit_price > 0)).toBe(true);
    expect(totalPesos(items)).toBe(1_000_000);
  });
});

describe("montoCobradoCoincide (#372)", () => {
  it("compara pesos de MP contra centavos de la orden", () => {
    expect(montoCobradoCoincide(9000, 900_000)).toBe(true);
    expect(montoCobradoCoincide(1234.5, 123_450)).toBe(true);
    expect(montoCobradoCoincide(9001, 900_000)).toBe(false);
  });
  it("sin monto informado no se puede decir que no coincide", () => {
    expect(montoCobradoCoincide(null, 900_000)).toBe(true);
  });
});
