import { describe, expect, it } from "vitest";

import { pasosDelCierre } from "./proximo-paso";

const mesa = (label: string, table_id = `t-${label}`) => ({
  order_id: `o-${label}`,
  table_id,
  table_label: label,
  mozo_name: "Ana",
  pendiente_cents: 10_000,
});
const mozo = (mozo_id: string, mozo_name: string) => ({ mozo_id, mozo_name });

describe("pasosDelCierre (spec 209 · R1/R2)", () => {
  it("con una mesa abierta, el próximo paso es cobrarla y nombra la mesa", () => {
    const r = pasosDelCierre({
      barre_salon: true,
      cuentas_abiertas: [mesa("7")],
      deben_rendir: [mozo("m1", "Ana")],
    });
    expect(r.mesas).toEqual({ estado: "pendiente", total: 1 });
    expect(r.rendiciones).toEqual({ estado: "pendiente", pendientes: 1 });
    expect(r.proximo).toEqual({
      kind: "cobrar",
      label: "Cobrar mesa 7",
      tableId: "t-7",
    });
  });

  it("con varias mesas abiertas lo dice en plural y lleva a la primera", () => {
    const r = pasosDelCierre({
      barre_salon: true,
      cuentas_abiertas: [mesa("7"), mesa("12")],
      deben_rendir: [],
    });
    expect(r.proximo).toEqual({
      kind: "cobrar",
      label: "Cobrar 2 mesas abiertas",
      tableId: "t-7",
    });
  });

  it("sin mesas y con un mozo sin rendir, el próximo paso es rendirle", () => {
    const r = pasosDelCierre({
      barre_salon: true,
      cuentas_abiertas: [],
      deben_rendir: [mozo("m1", "Ana")],
    });
    expect(r.mesas.estado).toBe("listo");
    expect(r.proximo).toEqual({ kind: "rendir", label: "Rendir a Ana", mozoId: "m1" });
  });

  it("con varios sin rendir dice cuántos faltan y abre el primero", () => {
    const r = pasosDelCierre({
      barre_salon: true,
      cuentas_abiertas: [],
      deben_rendir: [mozo("m1", "Ana"), mozo("m2", "Diego"), mozo("m3", "Leo")],
    });
    expect(r.proximo).toEqual({
      kind: "rendir",
      label: "Faltan 3 rendiciones",
      mozoId: "m1",
    });
  });

  it("todo resuelto: el próximo paso es contar y cerrar", () => {
    const r = pasosDelCierre({
      barre_salon: true,
      cuentas_abiertas: [],
      deben_rendir: [],
    });
    expect(r.mesas.estado).toBe("listo");
    expect(r.rendiciones.estado).toBe("listo");
    expect(r.proximo).toEqual({ kind: "contar", label: "Contar y cerrar" });
  });

  it("una caja que no barre el salón (el bar) sólo tiene el paso de contar", () => {
    const r = pasosDelCierre({
      barre_salon: false,
      cuentas_abiertas: [mesa("7")],
      deben_rendir: [mozo("m1", "Ana")],
    });
    expect(r.mesas.estado).toBe("no_aplica");
    expect(r.rendiciones.estado).toBe("no_aplica");
    expect(r.proximo.kind).toBe("contar");
  });
});
