import { describe, expect, it } from "vitest";

import { resolveStation, resolveStations } from "./routing";

describe("resolveStation", () => {
  it("usa el override del producto si está presente", () => {
    const result = resolveStation(
      { station_id: "prod-station", category: { station_id: "cat-station" } },
      "global",
    );
    expect(result).toBe("prod-station");
  });

  it("cae en la station de la categoría si el producto no la tiene", () => {
    const result = resolveStation(
      { station_id: null, category: { station_id: "cat-station" } },
      "global",
    );
    expect(result).toBe("cat-station");
  });

  it("usa el fallback global si ni producto ni categoría tienen station", () => {
    const result = resolveStation(
      { station_id: null, category: { station_id: null } },
      "global",
    );
    expect(result).toBe("global");
  });

  it("devuelve null si no hay producto, categoría ni fallback", () => {
    const result = resolveStation({ station_id: null, category: null });
    expect(result).toBeNull();
  });

  it("trata category null como si la categoría no tuviera station", () => {
    const result = resolveStation(
      { station_id: null, category: null },
      "global",
    );
    expect(result).toBe("global");
  });
});

// ── Spec 180 · varias comanderas por producto ────────────────────────────
//
// MaxiRest deja elegir hasta tres comanderas por artículo; cocina «sale con
// todo» porque es la 2ª de cada plato. La 1ª es el sector principal (el que
// cocina) y las otras reciben su propia comanda.
describe("resolveStations (spec 180)", () => {
  const cat = { station_id: "cocina", extra_station_ids: [] as string[] };

  it("sin extras, es la lista de un solo elemento: el sector de siempre", () => {
    expect(
      resolveStations({ station_id: "parrilla", extra_station_ids: [], sin_comanda: false, category: cat }),
    ).toEqual(["parrilla"]);
  });

  it("la 1ª va primero y después las extras, en su orden", () => {
    expect(
      resolveStations({
        station_id: "fritera",
        extra_station_ids: ["cocina", "parrilla"],
        sin_comanda: false,
        category: cat,
      }),
    ).toEqual(["fritera", "cocina", "parrilla"]);
  });

  it("las extras heredan de la categoría cuando el producto no dice nada", () => {
    expect(
      resolveStations({
        station_id: "fritera",
        extra_station_ids: null,
        sin_comanda: false,
        category: { station_id: "parrilla", extra_station_ids: ["cocina"] },
      }),
    ).toEqual(["fritera", "cocina"]);
  });

  it("`[]` en el producto es «ninguna extra», no «hereda»", () => {
    expect(
      resolveStations({
        station_id: "fritera",
        extra_station_ids: [],
        sin_comanda: false,
        category: { station_id: "parrilla", extra_station_ids: ["cocina"] },
      }),
    ).toEqual(["fritera"]);
  });

  it("una extra igual a la principal no duplica la comanda", () => {
    expect(
      resolveStations({
        station_id: "cocina",
        extra_station_ids: ["cocina", "parrilla"],
        sin_comanda: false,
        category: cat,
      }),
    ).toEqual(["cocina", "parrilla"]);
  });

  it("sin principal pero con extras, la primera extra pasa a ser la principal", () => {
    // Un producto de categoría sin sector al que sólo le pusieron «también en
    // cocina»: cocina es donde se cocina.
    expect(
      resolveStations({
        station_id: null,
        extra_station_ids: ["cocina"],
        sin_comanda: false,
        category: { station_id: null, extra_station_ids: [] },
      }),
    ).toEqual(["cocina"]);
  });

  it("«no imprime comanda» gana a todo: la Heineken, y los postres que la categoría mandaba a cocina", () => {
    expect(
      resolveStations({
        station_id: null,
        extra_station_ids: null,
        sin_comanda: true,
        category: { station_id: "cocina", extra_station_ids: ["parrilla"] },
      }),
    ).toEqual([]);
  });

  it("resolveStation sigue siendo la primera de la lista (compat)", () => {
    expect(
      resolveStation({
        station_id: null,
        extra_station_ids: ["parrilla"],
        sin_comanda: false,
        category: { station_id: "cocina", extra_station_ids: [] },
      }),
    ).toBe("cocina");
    expect(
      resolveStation({ station_id: null, sin_comanda: true, category: cat }),
    ).toBeNull();
  });
});
