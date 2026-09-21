import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateShort,
  formatMonthName,
  formatTime,
  relativeDate,
} from "./format-utils";

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

// «Hoy / Ayer» se cuenta en días de calendario argentinos, no en bloques de 24 h
// desde el fichaje (antes: 23:50 visto a las 00:10 decía «Hoy»).
describe("relativeDate", () => {
  const ahora = new Date("2026-09-21T03:10:00Z"); // 00:10 AR del 21/9

  it("un fichaje de las 23:50 de ayer, visto a las 00:10, es de «Ayer»", () => {
    expect(relativeDate("2026-09-21T02:50:00Z", ahora)).toBe("Ayer"); // 23:50 AR del 20
  });

  it("uno de las 00:05 de hoy es de «Hoy»", () => {
    expect(relativeDate("2026-09-21T03:05:00Z", ahora)).toBe("Hoy");
  });

  it("a los 3 días calendario dice «Hace 3d»", () => {
    expect(relativeDate("2026-09-18T23:00:00Z", ahora)).toBe("Hace 3d"); // 20:00 AR del 18
  });

  it("de una semana para atrás muestra la fecha, en día argentino", () => {
    expect(relativeDate("2026-09-01T02:00:00Z", ahora)).toMatch(/^31/); // 23:00 AR del 31/8
  });
});

describe("formatDateShort", () => {
  it("una fecha sin hora es ese día, en cualquier zona", () => {
    expect(formatDateShort("2026-09-21")).toMatch(/^21/);
  });

  it("un timestamp se muestra en día argentino", () => {
    expect(formatDateShort("2026-09-21T02:50:00Z")).toMatch(/^20/); // 23:50 AR del 20
  });
});
