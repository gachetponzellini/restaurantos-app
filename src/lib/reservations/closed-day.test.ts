import { describe, expect, it } from "vitest";

import { isClosedDay } from "@/lib/reservations/closed-day";

// H-18 — el lunes 2026-10-12 el local cierra.
const schedule = {
  "1": { open: false, slots: [] },
  "2": { open: true, slots: ["21:00"] },
};

describe("isClosedDay", () => {
  it("true cuando schedule[dow].open === false", () => {
    expect(isClosedDay(schedule, "2026-10-12")).toBe(true); // lunes
  });
  it("false cuando el día está abierto", () => {
    expect(isClosedDay(schedule, "2026-10-13")).toBe(false); // martes
  });
  it("false cuando el día no está configurado (no inventa cierres)", () => {
    expect(isClosedDay(schedule, "2026-10-14")).toBe(false);
    expect(isClosedDay({}, "2026-10-12")).toBe(false);
  });
  it("false con una fecha inválida", () => {
    expect(isClosedDay(schedule, "no-es-fecha")).toBe(false);
  });
});
