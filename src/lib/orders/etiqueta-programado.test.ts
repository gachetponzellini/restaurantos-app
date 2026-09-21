import { describe, expect, it } from "vitest";

import { etiquetaProgramado } from "./etiqueta-programado";

const TZ = "America/Argentina/Buenos_Aires";
const ahora = new Date("2026-09-21T15:00:00Z"); // lun 12:00 AR

describe("etiquetaProgramado", () => {
  it("hoy: sólo la hora, en hora del local", () => {
    expect(etiquetaProgramado("2026-09-22T00:30:00Z", TZ, ahora)).toBe("21:30"); // lun 21:30 AR
  });
  it("otro día: día y hora", () => {
    expect(etiquetaProgramado("2026-09-27T00:30:00Z", TZ, ahora)).toBe("sáb 26 · 21:30");
  });
  it("sin programar: null", () => {
    expect(etiquetaProgramado(null, TZ, ahora)).toBeNull();
  });
});
