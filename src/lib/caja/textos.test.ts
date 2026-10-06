import { describe, expect, it } from "vitest";

import { veredictoDiferencia } from "./textos";

describe("veredictoDiferencia (spec 209 · R8)", () => {
  it("de menos es Falta", () => {
    expect(veredictoDiferencia(-2_000_00)).toEqual({
      label: "Falta",
      tono: "falta",
      montoCents: 2_000_00,
    });
  });
  it("de más es Sobra", () => {
    expect(veredictoDiferencia(500)).toEqual({ label: "Sobra", tono: "sobra", montoCents: 500 });
  });
  it("cero es Cuadra", () => {
    expect(veredictoDiferencia(0)).toEqual({ label: "Cuadra", tono: "cuadra", montoCents: 0 });
  });
});
