import { describe, it, expect } from "vitest";
import {
  aceptaPedidoInmediato,
  computeIsOpen,
  type BusinessHour,
} from "./business-hours";

const TZ = "America/Argentina/Buenos_Aires";

// Hours: Monday (1) to Sunday (0), 11:00-23:00
const hours: BusinessHour[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  day_of_week: d,
  opens_at: "11:00:00",
  closes_at: "23:00:00",
}));

describe("computeIsOpen", () => {
  it("returns true mid-day in Buenos Aires", () => {
    // 2026-04-15 15:00 ART = 2026-04-15 18:00 UTC
    const now = new Date("2026-04-15T18:00:00Z");
    expect(computeIsOpen(hours, TZ, now)).toBe(true);
  });

  it("returns false before open", () => {
    // 2026-04-15 08:00 ART = 2026-04-15 11:00 UTC
    const now = new Date("2026-04-15T11:00:00Z");
    expect(computeIsOpen(hours, TZ, now)).toBe(false);
  });

  it("returns false after close", () => {
    // 2026-04-15 23:30 ART = 2026-04-16 02:30 UTC
    const now = new Date("2026-04-16T02:30:00Z");
    expect(computeIsOpen(hours, TZ, now)).toBe(false);
  });

  it("returns true exactly at opens_at", () => {
    // 2026-04-15 11:00:00 ART = 2026-04-15 14:00:00 UTC
    const now = new Date("2026-04-15T14:00:00Z");
    expect(computeIsOpen(hours, TZ, now)).toBe(true);
  });

  it("returns false exactly at closes_at", () => {
    // 2026-04-15 23:00:00 ART = 2026-04-16 02:00:00 UTC
    const now = new Date("2026-04-16T02:00:00Z");
    expect(computeIsOpen(hours, TZ, now)).toBe(false);
  });

  it("returns false on a day with no hours row", () => {
    const mondayOnly: BusinessHour[] = [
      { day_of_week: 1, opens_at: "11:00:00", closes_at: "23:00:00" },
    ];
    // Wednesday noon
    const now = new Date("2026-04-15T15:00:00Z");
    expect(computeIsOpen(mondayOnly, TZ, now)).toBe(false);
  });

  it("returns true when any of multiple ranges match (lunch+dinner)", () => {
    const split: BusinessHour[] = [
      { day_of_week: 3, opens_at: "12:00:00", closes_at: "15:00:00" },
      { day_of_week: 3, opens_at: "20:00:00", closes_at: "23:30:00" },
    ];
    // 2026-04-15 (Wed) 21:00 ART = 2026-04-16 00:00 UTC
    const now = new Date("2026-04-16T00:00:00Z");
    expect(computeIsOpen(split, TZ, now)).toBe(true);
  });

  it("returns true when closes_at is midnight (00:00)", () => {
    const midnightClose: BusinessHour[] = [
      { day_of_week: 3, opens_at: "18:00:00", closes_at: "00:00:00" },
    ];
    // 2026-04-15 (Wed) 21:00 ART = 2026-04-16 00:00 UTC
    const now = new Date("2026-04-16T00:00:00Z");
    expect(computeIsOpen(midnightClose, TZ, now)).toBe(true);
  });

  it("returns false before open when closes_at is midnight", () => {
    const midnightClose: BusinessHour[] = [
      { day_of_week: 3, opens_at: "18:00:00", closes_at: "00:00:00" },
    ];
    // 2026-04-15 (Wed) 15:00 ART = 2026-04-15 18:00 UTC
    const now = new Date("2026-04-15T18:00:00Z");
    expect(computeIsOpen(midnightClose, TZ, now)).toBe(false);
  });
});

// Auditoría de pedidos · ALTA — el server ahora rechaza pedidos inmediatos con
// el local cerrado, así que el cálculo tiene que acertar con los horarios que
// cruzan la medianoche (demo: sábado 20:00–01:00).
describe("computeIsOpen · horarios que cruzan la medianoche", () => {
  const TZ = "America/Argentina/Buenos_Aires";
  const sabado2000a0100 = [{ day_of_week: 6, opens_at: "20:00:00", closes_at: "01:00:00" }];

  it("sábado 23:00 AR está abierto", () => {
    expect(computeIsOpen(sabado2000a0100, TZ, new Date("2026-09-27T02:00:00Z"))).toBe(true);
  });

  it("domingo 00:30 AR sigue abierto (el turno del sábado)", () => {
    expect(computeIsOpen(sabado2000a0100, TZ, new Date("2026-09-27T03:30:00Z"))).toBe(true);
  });

  it("domingo 01:30 AR ya cerró", () => {
    expect(computeIsOpen(sabado2000a0100, TZ, new Date("2026-09-27T04:30:00Z"))).toBe(false);
  });

  it("sábado 19:00 AR todavía no abrió", () => {
    expect(computeIsOpen(sabado2000a0100, TZ, new Date("2026-09-26T22:00:00Z"))).toBe(false);
  });
});

describe("aceptaPedidoInmediato (auditoría de pedidos · ALTA)", () => {
  const TZ = "America/Argentina/Buenos_Aires";
  const horario = [{ day_of_week: 1, opens_at: "11:00:00", closes_at: "00:00:00" }];

  it("con el local abierto, sí", () => {
    expect(aceptaPedidoInmediato(horario, TZ, new Date("2026-09-21T15:00:00Z"))).toBe(true); // lun 12:00
  });

  it("a las 3 de la mañana, no", () => {
    expect(aceptaPedidoInmediato(horario, TZ, new Date("2026-09-22T06:00:00Z"))).toBe(false); // mar 03:00
  });

  it("un local sin horarios cargados no se bloquea (sería rechazar todo)", () => {
    expect(aceptaPedidoInmediato([], TZ, new Date("2026-09-22T06:00:00Z"))).toBe(true);
  });
});
