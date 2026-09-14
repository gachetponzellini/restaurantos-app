import { describe, expect, it } from "vitest";

import { calculateExpectedCash } from "./expected-cash";
import { MOVIMIENTO_LABEL, saleDelCajon } from "./movimiento-label";
import type { CajaMovimientoKind } from "./types";

const TODOS: CajaMovimientoKind[] = ["sangria", "ingreso", "propina"];

describe("issue #299 · el pago de propina no es un ingreso", () => {
  it("la propina sale del cajón, igual que la sangría", () => {
    expect(saleDelCajon("propina")).toBe(true);
    expect(saleDelCajon("sangria")).toBe(true);
    expect(saleDelCajon("ingreso")).toBe(false);
  });

  it("se llama «Propina pagada», no «Ingreso» ni «Sangría»", () => {
    expect(MOVIMIENTO_LABEL.propina).toBe("Propina pagada");
    expect(MOVIMIENTO_LABEL.sangria).toBe("Sangría");
    expect(MOVIMIENTO_LABEL.ingreso).toBe("Ingreso");
  });

  it("cada kind tiene rótulo propio: ninguno hereda el de otro", () => {
    const rotulos = TODOS.map((k) => MOVIMIENTO_LABEL[k]);
    expect(new Set(rotulos).size).toBe(TODOS.length);
    for (const r of rotulos) expect(r.trim()).not.toBe("");
  });

  // La razón de ser del helper: el signo que se DIBUJA tiene que coincidir con
  // el que la fórmula del arqueo APLICA. Mientras el board usaba
  // `kind === "sangria"`, la propina se mostraba con `+` y el esperado la
  // restaba — el total daba bien y la línea decía lo contrario.
  it("el signo dibujado coincide con lo que el arqueo le hace al cajón", () => {
    for (const kind of TODOS) {
      const conElMovimiento = calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [{ kind, amount_cents: 10_000 }],
      });
      const bajaElCajon = conElMovimiento < 100_000;

      expect(bajaElCajon).toBe(saleDelCajon(kind));
    }
  });
});
