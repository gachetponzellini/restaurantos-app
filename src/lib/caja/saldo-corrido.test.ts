import { describe, expect, it } from "vitest";

import { conSaldoCorrido, efectoEnCajon, pasaFiltro, type LineaDeCaja } from "./saldo-corrido";

const cobro = (over: Partial<Extract<LineaDeCaja, { tipo: "cobro" }>> = {}): LineaDeCaja => ({
  tipo: "cobro",
  id: over.id ?? "p1",
  createdAt: over.createdAt ?? "2026-10-06T20:00:00Z",
  method: over.method ?? "cash",
  amount_cents: over.amount_cents ?? 10_000,
  rinde_mozo_id: over.rinde_mozo_id ?? null,
});
const mov = (kind: "sangria" | "ingreso" | "rendicion" | "propina", amount: number, at: string, cancelada = false): LineaDeCaja => ({
  tipo: "movimiento",
  id: `${kind}-${at}`,
  createdAt: at,
  kind,
  amount_cents: amount,
  cancelled: cancelada,
});

describe("efectoEnCajon — lo mismo que suma efectivo_esperado_caja", () => {
  it("el efectivo que cobró la caja entra; el de un mozo no (lo tiene él); tarjeta no mueve", () => {
    expect(efectoEnCajon(cobro())).toBe(10_000);
    expect(efectoEnCajon(cobro({ rinde_mozo_id: "pedro" }))).toBe(0);
    expect(efectoEnCajon(cobro({ method: "card_manual" }))).toBe(0);
  });

  it("ingreso y rendición suman; sangría y propina pagada restan; lo anulado no cuenta", () => {
    expect(efectoEnCajon(mov("ingreso", 500, "t"))).toBe(500);
    expect(efectoEnCajon(mov("rendicion", 30_000, "t"))).toBe(30_000);
    expect(efectoEnCajon(mov("sangria", 1_000, "t"))).toBe(-1_000);
    expect(efectoEnCajon(mov("propina", 2_000, "t"))).toBe(-2_000);
    expect(efectoEnCajon(mov("sangria", 1_000, "t", true))).toBe(0);
  });
});

describe("conSaldoCorrido", () => {
  it("la línea más nueva deja el cajón en «Debería haber»; hacia atrás se descuenta", () => {
    // Más nueva primero, como la lista.
    const lineas = [
      mov("rendicion", 30_000, "2026-10-06T22:00:00Z"),
      cobro({ id: "card", method: "card_manual", createdAt: "2026-10-06T21:30:00Z" }),
      mov("sangria", 5_000, "2026-10-06T21:00:00Z"),
      cobro({ id: "caja", amount_cents: 20_000, createdAt: "2026-10-06T20:00:00Z" }),
    ];
    const r = conSaldoCorrido(lineas, 95_000);
    expect(r.map((x) => x.saldoDespues)).toEqual([95_000, 65_000, 65_000, 70_000]);
    expect(r.map((x) => x.efecto)).toEqual([30_000, 0, -5_000, 20_000]);
  });

  it("sin líneas, nada", () => {
    expect(conSaldoCorrido([], 50_000)).toEqual([]);
  });
});

describe("pasaFiltro", () => {
  const l = {
    efectivoCaja: cobro(),
    efectivoMozo: cobro({ rinde_mozo_id: "pedro" }),
    tarjeta: cobro({ method: "mp_qr" }),
    sangria: mov("sangria", 1, "t"),
    rendicion: mov("rendicion", 1, "t"),
    propina: mov("propina", 1, "t"),
  };
  it("«Mueven el cajón» deja sólo lo que cambia el efectivo del cajón", () => {
    expect(pasaFiltro(l.efectivoCaja, "cajon")).toBe(true);
    expect(pasaFiltro(l.efectivoMozo, "cajon")).toBe(false);
    expect(pasaFiltro(l.tarjeta, "cajon")).toBe(false);
    expect(pasaFiltro(l.sangria, "cajon")).toBe(true);
  });
  it("cobros, sangrías e ingresos, y mozos", () => {
    expect(pasaFiltro(l.tarjeta, "cobros")).toBe(true);
    expect(pasaFiltro(l.sangria, "cobros")).toBe(false);
    expect(pasaFiltro(l.sangria, "caja")).toBe(true);
    expect(pasaFiltro(l.rendicion, "caja")).toBe(false);
    expect(pasaFiltro(l.rendicion, "mozos")).toBe(true);
    expect(pasaFiltro(l.propina, "mozos")).toBe(true);
    expect(pasaFiltro(l.efectivoMozo, "todo")).toBe(true);
  });
});
