import { describe, expect, it } from "vitest";

import {
  OPERACION_TABS,
  tabsVisiblesEnOperacion,
  veTabDeOperacion,
} from "./operacion-tabs";

// Spec 182 — quién ve qué tab de Operación. La lista vive fuera del componente
// porque el server la usa para NO crear la promesa de una tab que el rol no ve
// (D3): mientras estuvo del lado del cliente, el pane quedaba escondido pero el
// dato viajaba igual al navegador.

describe("tabsVisiblesEnOperacion", () => {
  it("admin y encargado ven las ocho", () => {
    expect(tabsVisiblesEnOperacion("admin")).toEqual(OPERACION_TABS);
    expect(tabsVisiblesEnOperacion("encargado")).toEqual(OPERACION_TABS);
  });

  it("la terminal ve el salón, las comandas y el fichaje — nada más", () => {
    expect(tabsVisiblesEnOperacion("terminal")).toEqual([
      "salon",
      "comandas",
      "fichaje",
    ]);
  });

  it("la terminal NO ve Reservas: el libro del día es del encargado (D1)", () => {
    expect(veTabDeOperacion("terminal", "reservas")).toBe(false);
    // Las de hoy sí, pero por la tab Mesas: viajan con el plano.
    expect(veTabDeOperacion("terminal", "salon")).toBe(true);
  });

  it("la terminal NO ve la plata de supervisión", () => {
    for (const tab of ["caja", "cuentas", "rendicion", "pedidos"] as const) {
      expect(veTabDeOperacion("terminal", tab)).toBe(false);
    }
  });
});
