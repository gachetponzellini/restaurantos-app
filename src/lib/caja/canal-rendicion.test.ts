import { describe, expect, it } from "vitest";

import {
  calcularRendicionPorCanal,
  canalDelCobro,
  liquidarPorCanal,
  type CobroConCanal,
} from "./canal-rendicion";

describe("canalDelCobro (spec 203 · D2)", () => {
  it("con mesa es salón, aunque el tipo diga otra cosa", () => {
    expect(canalDelCobro({ table_id: "t1", delivery_type: "dine_in" })).toBe("salon");
  });
  it("sin mesa: delivery es delivery", () => {
    expect(canalDelCobro({ table_id: null, delivery_type: "delivery" })).toBe("delivery");
  });
  it("sin mesa: pickup y mostrador son takeaway", () => {
    expect(canalDelCobro({ table_id: null, delivery_type: "pickup" })).toBe("takeaway");
    expect(canalDelCobro({ table_id: null, delivery_type: "dine_in" })).toBe("takeaway");
  });
});

const cobro = (
  canal: CobroConCanal["canal"],
  method: CobroConCanal["method"],
  amount_cents: number,
  tip_cents = 0,
): CobroConCanal => ({ canal, method, amount_cents, tip_cents });

describe("calcularRendicionPorCanal (spec 203 · D3)", () => {
  const cobros = [
    cobro("salon", "cash", 10_000_00),
    cobro("takeaway", "cash", 3_000_00),
    cobro("takeaway", "card_manual", 2_000_00),
    cobro("delivery", "cash", 5_000_00, 500_00),
  ];

  it("el encargado rinde sólo takeaway y delivery", () => {
    const r = calcularRendicionPorCanal(cobros, "encargado");
    expect(r.por_canal.salon).toBeUndefined();
    expect(r.por_canal.takeaway?.efectivo_cents).toBe(3_000_00);
    expect(r.por_canal.takeaway?.por_metodo.card_manual).toBe(2_000_00);
    expect(r.por_canal.delivery?.efectivo_cents).toBe(4_500_00);
    expect(r.efectivo_cents).toBe(7_500_00);
    expect(r.pagos_count).toBe(3);
  });

  it("el encargado que sólo cobró en el salón no tiene nada que rendir", () => {
    const r = calcularRendicionPorCanal([cobro("salon", "cash", 1_000_00)], "admin");
    expect(r.pagos_count).toBe(0);
    expect(r.por_canal).toEqual({});
  });

  it("el mozo rinde todo, partido por canal", () => {
    const r = calcularRendicionPorCanal(cobros, "mozo");
    expect(r.por_canal.salon?.efectivo_cents).toBe(10_000_00);
    expect(r.efectivo_cents).toBe(17_500_00);
    expect(r.pagos_count).toBe(4);
  });
});

describe("liquidarPorCanal (spec 203 · D4)", () => {
  const pendiente = {
    takeaway: { efectivo_cents: 3_000_00 },
    delivery: { efectivo_cents: 4_500_00 },
  };

  it("cada canal tiene su diferencia y el total es la suma", () => {
    const l = liquidarPorCanal(pendiente, { takeaway: 3_000_00, delivery: 4_000_00 });
    expect(l.por_canal.takeaway?.diferencia_cents).toBe(0);
    expect(l.por_canal.delivery?.diferencia_cents).toBe(-500_00);
    expect(l.expected_cash_cents).toBe(7_500_00);
    expect(l.delivered_cash_cents).toBe(7_000_00);
    expect(l.difference_cents).toBe(-500_00);
  });

  it("un canal sin monto cuenta como $0 entregado", () => {
    const l = liquidarPorCanal(pendiente, { takeaway: 3_000_00 });
    expect(l.por_canal.delivery?.entregado_cents).toBe(0);
    expect(l.difference_cents).toBe(-4_500_00);
  });

  it("no entregó pone todo en $0", () => {
    const l = liquidarPorCanal(pendiente, { takeaway: 3_000_00 }, true);
    expect(l.delivered_cash_cents).toBe(0);
  });
});
