import { describe, expect, it } from "vitest";

import { decidirCuentaAlCobrar } from "./cuenta-al-cobrar";

/**
 * Issue #340 — «Cobrar» imprime la cuenta sola, pero sólo la primera vez. Lo
 * que importa: nunca un segundo papel por apretar Cobrar, y nunca un cobro
 * frenado porque la impresora no está.
 */
describe("decidirCuentaAlCobrar", () => {
  it("sin cuenta impresa y con comandera: imprime", () => {
    expect(decidirCuentaAlCobrar({ previos: 0, hayComandera: true })).toBe(
      "imprimir",
    );
  });

  it("con una cuenta ya impresa no vuelve a imprimir", () => {
    expect(decidirCuentaAlCobrar({ previos: 1, hayComandera: true })).toBe(
      "ya_impresa",
    );
    expect(decidirCuentaAlCobrar({ previos: 3, hayComandera: true })).toBe(
      "ya_impresa",
    );
  });

  it("sin comandera de cuentas no imprime (y no es error)", () => {
    expect(decidirCuentaAlCobrar({ previos: 0, hayComandera: false })).toBe(
      "sin_comandera",
    );
  });

  it("ya impresa gana sobre sin comandera: no hay nada que avisar", () => {
    expect(decidirCuentaAlCobrar({ previos: 2, hayComandera: false })).toBe(
      "ya_impresa",
    );
  });

  it("un conteo que no vino (query caída) cuenta como ya impresa", () => {
    // Del lado seguro: un papel de menos se pide con el botón; uno de más sale
    // marcado «reimpresión» y confunde a la mesa.
    expect(decidirCuentaAlCobrar({ previos: null, hayComandera: true })).toBe(
      "ya_impresa",
    );
  });
});
