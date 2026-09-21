import { describe, expect, it } from "vitest";

import { vencimientoPreferencia } from "./mp-vencimiento";

// #148 · H-20 — la preferencia de MP vence a los 90 min (y sus cupones
// offline también), así el barrido que cancela a las 2 h nunca cancela algo
// que todavía se pueda pagar. Formato de la doc de MP: ISO con offset -03:00.
describe("vencimientoPreferencia", () => {
  it("vence 90 min después, con offset argentino explícito", () => {
    const v = vencimientoPreferencia(new Date("2026-09-21T15:00:00Z"));
    expect(v).toEqual({
      expires: true,
      expiration_date_from: "2026-09-21T12:00:00.000-03:00",
      expiration_date_to: "2026-09-21T13:30:00.000-03:00",
      date_of_expiration: "2026-09-21T13:30:00.000-03:00",
    });
  });

  it("cruza la medianoche argentina sin correrse de día", () => {
    const v = vencimientoPreferencia(new Date("2026-09-22T02:00:00Z")); // 23:00 AR del 21
    expect(v.expiration_date_to).toBe("2026-09-22T00:30:00.000-03:00");
  });

  it("con un vencimiento explícito (reintento #368) usa ese", () => {
    const v = vencimientoPreferencia(
      new Date("2026-09-21T15:00:00Z"),
      new Date("2026-09-21T15:20:00Z"),
    );
    expect(v.expiration_date_to).toBe("2026-09-21T12:20:00.000-03:00");
    expect(v.date_of_expiration).toBe("2026-09-21T12:20:00.000-03:00");
  });
});
