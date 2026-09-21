import { describe, expect, it } from "vitest";

import { formatDate, formatMonthName, formatTime } from "./format-utils";

// El formato (12 o 24 h) depende del ICU del runtime; lo que se prueba es la
// hora, no el formato.
const hora = (s: string) => s.replace(/\s+/g, " ").trim();

// Issue #157: la hora de un timestamp sale en hora argentina aunque quien
// renderiza esté en UTC (el server de Vercel) o en otra zona.
describe("formatTime", () => {
  it("23:15 UTC es 20:15 en Buenos Aires, sin importar la zona del proceso", () => {
    expect(hora(formatTime("2026-09-21T23:15:00Z"))).toMatch(/^(20:15|08:15 p\. ?m\.)$/);
  });

  it("cruza la medianoche UTC sin correrse de día", () => {
    expect(hora(formatTime("2026-09-22T01:05:00Z"))).toMatch(/^(22:05|10:05 p\. ?m\.)$/);
  });
});

describe("formatDate / formatMonthName", () => {
  it("un fichaje de las 22:30 AR del 30/9 es del 30/9, no del 1/10", () => {
    expect(formatDate("2026-10-01T01:30:00Z")).toMatch(/^30\/0?9$/);
  });

  it("el inicio de mes AR (03:00 UTC del día 1) es de ese mes", () => {
    expect(formatMonthName("2026-10-01T03:00:00Z")).toMatch(/octubre/i);
    expect(formatMonthName("2026-10-01T02:59:00Z")).toMatch(/septiembre|setiembre/i);
  });
});
