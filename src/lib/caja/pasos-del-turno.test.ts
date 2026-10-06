import { describe, expect, it } from "vitest";

import { pasosDelTurno } from "./pasos-del-turno";

const mesa = (label: string) => ({ order_id: `o-${label}`, table_id: `t-${label}`, table_label: label });
const saldo = (o: { mozo: string; caja?: string; saldo: number; resuelto?: boolean }) => ({
  mozo_id: o.mozo, mozo_name: o.mozo, caja_id: o.caja ?? "c1", caja_name: o.caja === "c2" ? "Bar" : "Principal",
  saldo_cents: o.saldo, resuelto: o.resuelto ?? o.saldo === 0,
});
const caja = (id: string, sin_contar: boolean) => ({ id, name: id === "c2" ? "Bar" : "Principal", sin_contar });

describe("pasosDelTurno (spec 211 · R6)", () => {
  it("con una mesa abierta, lo primero es cobrarla", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [mesa("7")], saldos: [saldo({ mozo: "Ana", saldo: 100 })], cajas: [caja("c1", true)] });
    expect(r.proximo).toEqual({ kind: "cobrar", label: "Cobrar mesa 7", tableId: "t-7" });
    expect(r.mesas).toEqual({ estado: "pendiente", total: 1 });
  });

  it("sin mesas, rinde el mozo con saldo pendiente (de cualquier caja)", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [], saldos: [saldo({ mozo: "Ana", saldo: 100 }), saldo({ mozo: "Leo", saldo: 0 })], cajas: [caja("c1", true)] });
    expect(r.proximo).toEqual({ kind: "rendir", label: "Rendir a Ana", mozoId: "Ana", cajaId: "c1" });
    expect(r.rendiciones).toEqual({ estado: "pendiente", pendientes: 1 });
  });

  it("varios pendientes: dice cuántos y abre el primero", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [], saldos: [saldo({ mozo: "Ana", saldo: 100 }), saldo({ mozo: "Leo", caja: "c2", saldo: 50 })], cajas: [caja("c1", true)] });
    expect(r.proximo.label).toBe("Faltan 2 rendiciones");
  });

  it("si la caja le debe al mozo (saldo negativo), también está pendiente", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [], saldos: [saldo({ mozo: "Ana", saldo: -3_000 })], cajas: [caja("c1", true)] });
    expect(r.proximo).toEqual({ kind: "rendir", label: "Darle la propina a Ana", mozoId: "Ana", cajaId: "c1" });
  });

  it("la deuda reconocida («no entregó») no frena", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [], saldos: [saldo({ mozo: "Ana", saldo: 100, resuelto: true })], cajas: [caja("c1", true)] });
    expect(r.rendiciones.estado).toBe("listo");
    expect(r.proximo).toEqual({ kind: "contar", label: "Contar la caja Principal", cajaId: "c1" });
  });

  it("contar: primero la caja que se está mirando, después las otras", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [], saldos: [], cajas: [caja("c1", true), caja("c2", true)] }, "c2");
    expect(r.proximo).toEqual({ kind: "contar", label: "Contar la caja Bar", cajaId: "c2" });
    expect(r.cajas).toEqual({ estado: "pendiente", faltan: ["Principal", "Bar"] });
  });

  it("todo resuelto y contado: cerrar el turno", () => {
    const r = pasosDelTurno({ cuentas_abiertas: [], saldos: [saldo({ mozo: "Ana", saldo: 0 })], cajas: [caja("c1", false), caja("c2", false)] });
    expect(r.proximo).toEqual({ kind: "turno", label: "Cerrar el turno" });
    expect(r.cajas.estado).toBe("listo");
  });
});
