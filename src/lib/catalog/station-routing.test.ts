import { describe, expect, it } from "vitest";

import {
  categoriesByDefaultStation,
  categoriesByExtraStation,
  countProductsByEffectiveStation,
  effectiveStationId,
  productsWithOwnStation,
} from "./station-routing";

/**
 * Ruteo de comandas por sector (spec 205 · D9): «N productos imprimen acá» no
 * vivía en ningún lado antes de esta spec. Estos son los casos que separan un
 * sector con productos reales de uno vacío.
 */

const categories = [
  { id: "cat-carnes", station_id: "par", extra_station_ids: [] as string[] },
  { id: "cat-bebidas", station_id: null, extra_station_ids: ["par"] },
  { id: "cat-postres", station_id: "coc", extra_station_ids: [] as string[] },
];
const categoryById = new Map(categories.map((c) => [c.id, c]));

describe("effectiveStationId", () => {
  it("usa el sector propio del producto si lo tiene", () => {
    const p = {
      station_id: "coc",
      category_id: "cat-carnes",
      sin_comanda: false,
    };
    expect(effectiveStationId(p, categoryById)).toBe("coc");
  });

  it("si no tiene sector propio, hereda el de la categoría", () => {
    const p = {
      station_id: null,
      category_id: "cat-carnes",
      sin_comanda: false,
    };
    expect(effectiveStationId(p, categoryById)).toBe("par");
  });

  it("sin categoría ni sector propio, no imprime en ningún lado", () => {
    const p = { station_id: null, category_id: null, sin_comanda: false };
    expect(effectiveStationId(p, categoryById)).toBeNull();
  });

  it("`sin_comanda` gana siempre, aunque tenga sector propio", () => {
    const p = {
      station_id: "coc",
      category_id: "cat-carnes",
      sin_comanda: true,
    };
    expect(effectiveStationId(p, categoryById)).toBeNull();
  });
});

describe("countProductsByEffectiveStation", () => {
  it("cuenta por sector efectivo, no por el de la categoría a secas", () => {
    const products = [
      { station_id: null, category_id: "cat-carnes", sin_comanda: false }, // → par (hereda)
      { station_id: "coc", category_id: "cat-carnes", sin_comanda: false }, // → coc (propio, pisa)
      { station_id: null, category_id: "cat-postres", sin_comanda: false }, // → coc
      { station_id: null, category_id: "cat-bebidas", sin_comanda: false }, // sin default → ninguno
      { station_id: null, category_id: null, sin_comanda: true }, // sin comanda
    ];
    const counts = countProductsByEffectiveStation(products, categories);
    expect(counts.get("par")).toBe(1);
    expect(counts.get("coc")).toBe(2);
  });
});

describe("categoriesByDefaultStation / categoriesByExtraStation", () => {
  it("separa el sector default del de 2ª/3ª comandera", () => {
    const byDefault = categoriesByDefaultStation(categories);
    expect(byDefault.get("par")?.map((c) => c.id)).toEqual(["cat-carnes"]);
    expect(byDefault.get("coc")?.map((c) => c.id)).toEqual(["cat-postres"]);

    const byExtra = categoriesByExtraStation(categories);
    expect(byExtra.get("par")?.map((c) => c.id)).toEqual(["cat-bebidas"]);
    expect(byExtra.get("coc")).toBeUndefined();
  });
});

describe("productsWithOwnStation", () => {
  const categories = [
    { id: "cat-pastas", station_id: "coc" },
    { id: "cat-sin", station_id: null },
  ];

  it("sólo lista los que pisan el sector de su categoría", () => {
    const products = [
      { id: "p1", category_id: "cat-pastas", station_id: "par", sin_comanda: false },
      { id: "p2", category_id: "cat-pastas", station_id: null, sin_comanda: false },
      { id: "p3", category_id: "cat-sin", station_id: "coc", sin_comanda: false },
    ];
    const own = productsWithOwnStation(products, categories);
    expect(own.get("par")?.map((p) => p.id)).toEqual(["p1"]);
    expect(own.get("coc")?.map((p) => p.id)).toEqual(["p3"]);
    expect([...own.values()].flat()).toHaveLength(2);
  });

  it("repetir el sector de la categoría no es pisarlo (catálogo importado de MaxiRest)", () => {
    const products = [
      { id: "p1", category_id: "cat-pastas", station_id: "coc", sin_comanda: false },
    ];
    expect(productsWithOwnStation(products, categories).size).toBe(0);
  });

  it("lo que no imprime comanda no cuenta", () => {
    const products = [
      { id: "p1", category_id: "cat-pastas", station_id: "par", sin_comanda: true },
    ];
    expect(productsWithOwnStation(products, categories).size).toBe(0);
  });
});
