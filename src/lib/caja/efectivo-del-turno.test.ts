import { describe, expect, it } from "vitest";

import { efectivoDelTurno } from "./efectivo-del-turno";

/**
 * Spec 217 · R1 — dónde está el efectivo del turno. Es la cuenta que hacía
 * `EfectivoDeLaCaja` para una caja, ahora para todas: tiene que sumar exacto,
 * porque es lo que la encargada mira antes de rendir.
 */
const m = (o: Partial<Parameters<typeof efectivoDelTurno>[0][number]> = {}) => ({
  mozo_name: "Ana Paz",
  anterior_cents: 0,
  efectivo_cents: 0,
  entregado_cents: 0,
  saldo_cents: 0,
  deuda: false,
  ...o,
});

describe("efectivoDelTurno", () => {
  it("reparte lo de cada mozo en entregado, a rendir y su propina, y suma lo que cobró la caja", () => {
    const r = efectivoDelTurno(
      [
        // Cobró 106.600; su propina de tarjeta 1.000; entregó 10.000 → tiene 95.600.
        m({ mozo_name: "Lucía Moza", efectivo_cents: 106_600, entregado_cents: 10_000, saldo_cents: 95_600 }),
        m({ mozo_name: "Pedro Mozo", efectivo_cents: 160_000, saldo_cents: 157_800 }),
      ],
      5_000,
    );
    expect(r).toMatchObject({
      directoCents: 5_000,
      rendidoCents: 10_000,
      aRendirCents: 253_400,
      propinasCents: 3_200,
      deudaCents: 0,
      totalCents: 271_600,
      enManosDe: ["Lucía", "Pedro"],
    });
  });

  it("la deuda reconocida va aparte, no como «a rendir»", () => {
    const r = efectivoDelTurno([m({ efectivo_cents: 20_000, saldo_cents: 20_000, deuda: true })], 0);
    expect(r.aRendirCents).toBe(0);
    expect(r.deudaCents).toBe(20_000);
    expect(r.enManosDe).toEqual([]);
  });

  it("si la caja le debe la propina al mozo, lo que se quedó es todo lo que tenía", () => {
    // Sólo tarjeta: cobró 0 en efectivo, la caja le debe 1.000 de propina.
    const r = efectivoDelTurno([m({ efectivo_cents: 0, saldo_cents: -1_000 })], 0);
    expect(r.aRendirCents).toBe(0);
    expect(r.propinasCents).toBe(0);
    expect(r.totalCents).toBe(0);
  });

  it("cuenta lo que los mozos traían de antes", () => {
    const r = efectivoDelTurno([m({ anterior_cents: 3_000, efectivo_cents: 7_000, saldo_cents: 10_000 })], 0);
    expect(r.anteriorCents).toBe(3_000);
    expect(r.aRendirCents).toBe(10_000);
    expect(r.totalCents).toBe(10_000);
  });

  it("sin mozos ni cobros directos, todo en cero", () => {
    expect(efectivoDelTurno([], 0).totalCents).toBe(0);
  });

  it("un mozo con plata en dos cajas se nombra una vez", () => {
    const r = efectivoDelTurno(
      [
        m({ mozo_name: "Pedro Mozo", efectivo_cents: 20_000, saldo_cents: 20_000 }),
        m({ mozo_name: "Pedro Mozo", efectivo_cents: 160_000, saldo_cents: 157_800 }),
        m({ mozo_name: "Diego Mozo", efectivo_cents: 62_500, saldo_cents: 59_650 }),
      ],
      0,
    );
    expect(r.enManosDe).toEqual(["Pedro", "Diego"]);
  });
});

