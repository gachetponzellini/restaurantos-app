import { describe, expect, it } from "vitest";

import { mesasSinCobrarPorMozo, type OrdenDeMesa } from "./mesas-sin-cobrar";

function orden(over: Partial<OrdenDeMesa> & { id: string }): OrdenDeMesa {
  return {
    table_label: "12",
    lifecycle_status: "open",
    status: "delivered",
    total_cents: 10_000,
    total_paid_cents: 0,
    mesa_mozo_id: "rafa",
    orden_mozo_id: null,
    pagos_mozo_ids: [],
    ...over,
  };
}

describe("mesasSinCobrarPorMozo (#351)", () => {
  it("una mesa abierta con consumo y sin cobrar bloquea a su mozo", () => {
    const out = mesasSinCobrarPorMozo([orden({ id: "a" })]);
    expect(out.get("rafa")).toEqual([{ orderId: "a", tableLabel: "12", saldoCents: 10_000 }]);
  });

  it("una mesa abierta vacía (sin consumo) no bloquea", () => {
    const out = mesasSinCobrarPorMozo([orden({ id: "a", total_cents: 0 })]);
    expect(out.size).toBe(0);
  });

  it("una mesa abierta ya pagada entera no bloquea", () => {
    const out = mesasSinCobrarPorMozo([
      orden({ id: "a", total_paid_cents: 10_000 }),
    ]);
    expect(out.size).toBe(0);
  });

  it("una cuenta cerrada con saldo (cobros anulados) bloquea al mozo que la cobró", () => {
    // El caso real: la mesa ya se liberó (sin mozo de mesa) y la orden quedó
    // a nombre de otro; el pago anulado estaba atribuido a este mozo.
    const out = mesasSinCobrarPorMozo([
      orden({
        id: "a",
        lifecycle_status: "closed",
        total_paid_cents: 0,
        mesa_mozo_id: null,
        orden_mozo_id: "otro",
        pagos_mozo_ids: ["rafa"],
      }),
    ]);
    expect(out.get("rafa")?.map((m) => m.orderId)).toEqual(["a"]);
    expect(out.get("otro")?.map((m) => m.orderId)).toEqual(["a"]);
  });

  it("una cerrada y pagada no bloquea, y las canceladas tampoco", () => {
    const out = mesasSinCobrarPorMozo([
      orden({ id: "a", lifecycle_status: "closed", total_paid_cents: 10_000 }),
      orden({ id: "b", status: "cancelled" }),
    ]);
    expect(out.size).toBe(0);
  });

  it("no bloquea a un mozo por la mesa de otro", () => {
    const out = mesasSinCobrarPorMozo([orden({ id: "a", mesa_mozo_id: "diego" })]);
    expect(out.has("rafa")).toBe(false);
    expect(out.get("diego")).toHaveLength(1);
  });
});
