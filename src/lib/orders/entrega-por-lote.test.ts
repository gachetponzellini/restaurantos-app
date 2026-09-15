import { describe, expect, it } from "vitest";

import { copyDeEntrega, lugarDeEntrega } from "./entrega-por-lote";

describe("copyDeEntrega", () => {
  it("kcc reparte adentro del barrio: pide el lote y lo avisa", () => {
    const c = copyDeEntrega("kcc");
    expect(c.porLote).toBe(true);
    expect(c.label).toBe("Nro de lote");
    expect(c.aviso).toMatch(/dentro del barrio/i);
    expect(c.pidePisoDepto).toBe(false);
  });

  it("un lote de dos dígitos es válido — la dirección de calle no", () => {
    expect("12".length).toBeGreaterThanOrEqual(copyDeEntrega("kcc").minChars);
    expect("12".length).toBeLessThan(copyDeEntrega("golf-jcr").minChars);
  });

  it("el resto de los negocios sigue pidiendo la dirección de siempre", () => {
    const c = copyDeEntrega("demo");
    expect(c.porLote).toBe(false);
    expect(c.label).toBe("Dirección");
    expect(c.aviso).toBeNull();
    expect(c.pidePisoDepto).toBe(true);
  });
});

describe("lugarDeEntrega", () => {
  it("el número suelto se lee como lote en las pantallas del local", () => {
    expect(lugarDeEntrega("kcc", "124")).toBe("Lote 124");
  });

  it("no repite el prefijo si el cliente ya lo escribió", () => {
    expect(lugarDeEntrega("kcc", "Lote 124")).toBe("Lote 124");
    expect(lugarDeEntrega("kcc", "lote 124 bis")).toBe("lote 124 bis");
  });

  it("la dirección de calle se muestra tal cual", () => {
    expect(lugarDeEntrega("demo", "Av. del Golf 123")).toBe("Av. del Golf 123");
  });
});
