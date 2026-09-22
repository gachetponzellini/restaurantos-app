import { describe, expect, it } from "vitest";

import { isOverdueConfirmed } from "./no-show";

const NOW = new Date("2026-06-15T22:00:00Z");
const GRACE = 30;

describe("isOverdueConfirmed", () => {
  it("confirmed vencida más allá de la gracia → true", () => {
    // starts 20:00Z + 30min = 20:30Z < 22:00Z.
    expect(
      isOverdueConfirmed({ status: "confirmed", starts_at: "2026-06-15T20:00:00Z" }, GRACE, NOW),
    ).toBe(true);
  });

  it("confirmed dentro de la gracia → false", () => {
    // starts 21:45Z + 30min = 22:15Z > 22:00Z.
    expect(
      isOverdueConfirmed({ status: "confirmed", starts_at: "2026-06-15T21:45:00Z" }, GRACE, NOW),
    ).toBe(false);
  });

  it("confirmed futura → false", () => {
    expect(
      isOverdueConfirmed({ status: "confirmed", starts_at: "2026-06-16T20:00:00Z" }, GRACE, NOW),
    ).toBe(false);
  });

  it("borde exacto en el cutoff → false (estricto)", () => {
    // starts 21:30Z + 30min = 22:00Z == now → no se cierra todavía.
    expect(
      isOverdueConfirmed({ status: "confirmed", starts_at: "2026-06-15T21:30:00Z" }, GRACE, NOW),
    ).toBe(false);
  });

  it("gracia 0: vencida apenas pasa el starts_at", () => {
    expect(
      isOverdueConfirmed({ status: "confirmed", starts_at: "2026-06-15T21:59:00Z" }, 0, NOW),
    ).toBe(true);
  });

  it("estados no-confirmed nunca se cierran", () => {
    for (const status of ["seated", "completed", "cancelled", "no_show"] as const) {
      expect(
        isOverdueConfirmed({ status, starts_at: "2026-06-15T20:00:00Z" }, GRACE, NOW),
      ).toBe(false);
    }
  });

  // #148 · H-46 — sentada como walk-in sin actualizar el status.
  it("vencida pero con la mesa ocupada → false (alguien la sentó)", () => {
    expect(
      isOverdueConfirmed(
        { status: "confirmed", starts_at: "2026-06-15T20:00:00Z" },
        GRACE,
        NOW,
        true,
      ),
    ).toBe(false);
  });

  it("mesa ocupada sin pasar el flag (default) se comporta como antes", () => {
    expect(
      isOverdueConfirmed({ status: "confirmed", starts_at: "2026-06-15T20:00:00Z" }, GRACE, NOW),
    ).toBe(true);
  });
});
