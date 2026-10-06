import { describe, expect, it } from "vitest";

import { canCancelReservation } from "@/lib/reservations/cancel-window";

// H-14 — misma regla que `cancelOwnReservation`: se puede cancelar online sólo
// hasta `starts_at - lead_time_min`, y sólo si está pending/confirmed.
const STARTS = "2026-10-07T00:00:00.000Z"; // 21:00 AR
const at = (iso: string) => new Date(iso);

describe("canCancelReservation", () => {
  it("permite con anticipación mayor al lead time", () => {
    expect(
      canCancelReservation({
        status: "confirmed",
        startsAt: STARTS,
        leadTimeMin: 60,
        now: at("2026-10-06T22:00:00.000Z"), // 2 h antes
      }),
    ).toBe(true);
  });

  it("no permite dentro de la ventana de lead time (50 min antes con 60)", () => {
    expect(
      canCancelReservation({
        status: "confirmed",
        startsAt: STARTS,
        leadTimeMin: 60,
        now: at("2026-10-06T23:10:00.000Z"),
      }),
    ).toBe(false);
  });

  it("permite justo en el límite (el server rechaza sólo si now > cutoff)", () => {
    expect(
      canCancelReservation({
        status: "pending",
        startsAt: STARTS,
        leadTimeMin: 60,
        now: at("2026-10-06T23:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("con lead time 0 permite hasta la hora de inicio", () => {
    const base = { status: "confirmed" as const, startsAt: STARTS, leadTimeMin: 0 };
    expect(canCancelReservation({ ...base, now: at("2026-10-06T23:59:00.000Z") })).toBe(true);
    expect(canCancelReservation({ ...base, now: at("2026-10-07T00:01:00.000Z") })).toBe(false);
  });

  it.each(["seated", "completed", "no_show", "cancelled", "rejected", "expired"] as const)(
    "nunca con estado %s",
    (status) => {
      expect(
        canCancelReservation({
          status,
          startsAt: STARTS,
          leadTimeMin: 60,
          now: at("2026-10-01T00:00:00.000Z"),
        }),
      ).toBe(false);
    },
  );
});
