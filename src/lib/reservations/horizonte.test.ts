import { describe, expect, it } from "vitest";

import {
  dentroDelHorizonte,
  hoyEnZona,
  minutosAhoraEnZona,
  sumarDias,
} from "./horizonte";

const AR = "America/Argentina/Buenos_Aires";

describe("horizonte de reservas (#372)", () => {
  it("hoy es el día del negocio, no el del navegador ni el de UTC", () => {
    // 23:30 del 21 en Argentina = 02:30 del 22 en UTC.
    const now = new Date("2026-09-22T02:30:00Z");
    expect(hoyEnZona(now, AR)).toBe("2026-09-21");
  });

  it("sumarDias cruza meses y años", () => {
    expect(sumarDias("2026-09-21", 30)).toBe("2026-10-21");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("el último día del horizonte entra ENTERO, a cualquier hora (antes se rechazaba)", () => {
    // Hoy 15:00 AR; horizonte 30 días → el 21/10 entra aunque el turno sea 23:00.
    const now = new Date("2026-09-21T18:00:00Z");
    expect(dentroDelHorizonte("2026-10-21", now, 30, AR)).toBe(true);
    expect(dentroDelHorizonte("2026-10-22", now, 30, AR)).toBe(false);
  });

  it("de noche en Argentina no se corre un día (UTC ya es mañana)", () => {
    const now = new Date("2026-09-22T02:30:00Z"); // 21/09 23:30 AR
    expect(dentroDelHorizonte("2026-10-21", now, 30, AR)).toBe(true);
    expect(dentroDelHorizonte("2026-10-22", now, 30, AR)).toBe(false);
  });

  it("los minutos de ahora son los del reloj del negocio", () => {
    const now = new Date("2026-09-22T02:30:00Z");
    expect(minutosAhoraEnZona(now, AR)).toBe(23 * 60 + 30);
  });
});
