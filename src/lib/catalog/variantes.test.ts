import { describe, expect, it } from "vitest";

import {
  estaAgotado,
  etiquetaDePrecio,
  filasDeCarta,
  grupoVariante,
  rangoDePrecio,
} from "./variantes";

const m = (name: string, delta: number, is_available = true) => ({
  id: name,
  name,
  price_delta_cents: delta,
  is_available,
  sort_order: 0,
});

const pizza = {
  name: "Pizza",
  price_cents: 1600000,
  is_available: true,
  modifier_groups: [
    { is_variant: false, modifiers: [m("Extra queso", 150000)] },
    {
      is_variant: true,
      modifiers: [
        m("Muzarella", 0),
        m("Napolitana", 200000),
        m("Especial", 600000),
        m("Veggie", 600000),
      ],
    },
  ],
};

const milanesa = {
  name: "Milanesa",
  price_cents: 1200000,
  is_available: true,
  modifier_groups: [
    { is_variant: false, modifiers: [m("Napolitana", 300000)] },
  ],
};

describe("grupoVariante", () => {
  it("devuelve el grupo marcado", () => {
    expect(grupoVariante(pizza)?.modifiers).toHaveLength(4);
  });
  it("null si ningún grupo es variante (los adicionales comunes no cuentan)", () => {
    expect(grupoVariante(milanesa)).toBeNull();
  });
  it("tolera grupos sin el campo (datos viejos)", () => {
    expect(grupoVariante({ modifier_groups: [{ modifiers: [] }] })).toBeNull();
  });
});

describe("rangoDePrecio", () => {
  it("sin variante es el precio del producto", () => {
    expect(rangoDePrecio(milanesa)).toEqual({ min: 1200000, max: 1200000 });
  });
  it("con variante sale de base + delta de los gustos", () => {
    expect(rangoDePrecio(pizza)).toEqual({ min: 1600000, max: 2200000 });
  });
  it("ignora los gustos apagados", () => {
    const sinMuzza = {
      ...pizza,
      modifier_groups: [
        {
          is_variant: true,
          modifiers: [m("Muzarella", 0, false), m("Napolitana", 200000)],
        },
      ],
    };
    expect(rangoDePrecio(sinMuzza)).toEqual({ min: 1800000, max: 1800000 });
  });
  it("con todos los gustos apagados cae al precio base", () => {
    const nada = {
      ...pizza,
      modifier_groups: [
        { is_variant: true, modifiers: [m("Muzarella", 0, false)] },
      ],
    };
    expect(rangoDePrecio(nada)).toEqual({ min: 1600000, max: 1600000 });
  });
});

describe("etiquetaDePrecio", () => {
  const fmt = (c: number) => `$${c / 100}`;
  it("«desde» cuando los gustos tienen precios distintos", () => {
    expect(etiquetaDePrecio(pizza, fmt)).toBe("desde $16000");
  });
  it("el precio solo cuando es uno", () => {
    expect(etiquetaDePrecio(milanesa, fmt)).toBe("$12000");
  });
});

describe("filasDeCarta", () => {
  it("sin variante, una fila con el producto", () => {
    expect(filasDeCarta(milanesa)).toEqual([
      { key: "Milanesa", name: "Milanesa", price_cents: 1200000 },
    ]);
  });
  it("con variante, una fila por gusto disponible con precio final", () => {
    const filas = filasDeCarta({
      ...pizza,
      modifier_groups: [
        {
          is_variant: true,
          modifiers: [
            m("Muzarella", 0),
            m("Napolitana", 200000),
            m("Fugazza", 100000, false),
          ],
        },
      ],
    });
    expect(filas).toEqual([
      { key: "Muzarella", name: "Pizza Muzarella", price_cents: 1600000 },
      { key: "Napolitana", name: "Pizza Napolitana", price_cents: 1800000 },
    ]);
  });
});

describe("estaAgotado", () => {
  it("apagado el producto, agotado", () => {
    expect(estaAgotado({ ...pizza, is_available: false })).toBe(true);
  });
  it("con todos los gustos apagados, agotado aunque el producto esté prendido", () => {
    const nada = {
      ...pizza,
      modifier_groups: [
        { is_variant: true, modifiers: [m("Muzarella", 0, false)] },
      ],
    };
    expect(estaAgotado(nada)).toBe(true);
  });
  it("con un gusto prendido, disponible", () => {
    expect(estaAgotado(pizza)).toBe(false);
  });
  it("sin variante sólo mira el producto (los adicionales apagados no agotan)", () => {
    const sinExtras = {
      ...milanesa,
      modifier_groups: [
        { is_variant: false, modifiers: [m("Napolitana", 1, false)] },
      ],
    };
    expect(estaAgotado(sinExtras)).toBe(false);
  });
});
