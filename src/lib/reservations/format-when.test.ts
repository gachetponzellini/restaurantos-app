import { describe, expect, it } from "vitest";

import {
  formatReservationDay,
  formatReservationSlotWhen,
  formatReservationWhen,
} from "@/lib/reservations/format-when";

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3

describe("formatReservationWhen — H-30", () => {
  it("«mié 7 de oct · 21:00 hs» en la TZ del negocio", () => {
    expect(formatReservationWhen("2026-10-08T00:00:00.000Z", TZ)).toBe(
      "mié 7 de oct · 21:00 hs",
    );
  });

  it("usa el día local, no el UTC (02:30Z del 8 es 23:30 del 7 en AR)", () => {
    expect(formatReservationWhen("2026-10-08T02:30:00.000Z", TZ)).toBe(
      "mié 7 de oct · 23:30 hs",
    );
  });

  it("minúsculas: no capitaliza «de» ni «hs»", () => {
    const s = formatReservationWhen("2026-12-25T15:05:00.000Z", TZ);
    expect(s).toBe("vie 25 de dic · 12:05 hs");
  });

  it("acepta Date y respeta otra timezone", () => {
    expect(
      formatReservationWhen(new Date("2026-10-08T00:00:00.000Z"), "UTC"),
    ).toBe("jue 8 de oct · 00:00 hs");
  });
});

describe("formatReservationDay / formatReservationSlotWhen", () => {
  it("día solo: «mié 7 de oct»", () => {
    expect(formatReservationDay("2026-10-08T00:00:00.000Z", TZ)).toBe(
      "mié 7 de oct",
    );
  });

  it("fecha + slot locales (intent del bot) → mismo formato, en la TZ del negocio", () => {
    expect(formatReservationSlotWhen("2026-10-07", "21:00", TZ)).toBe(
      "mié 7 de oct · 21:00 hs",
    );
  });

  it("el slot de madrugada sigue en el día local del intent", () => {
    expect(formatReservationSlotWhen("2026-10-07", "00:30", TZ)).toBe(
      "mié 7 de oct · 00:30 hs",
    );
  });
});
