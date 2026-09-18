import { describe, expect, it } from "vitest";

import { IMPLICIT_SPLIT_ID, implicitSplit } from "./implicit-split";
import type { CuentaState } from "./types";

function cuenta(total: number, paid: number, tip = 0): CuentaState {
  return {
    order: {
      id: "ord-1",
      business_id: "biz-1",
      order_number: 26,
      table_id: "tbl-1",
      tip_cents: tip,
      discount_cents: 0,
      discount_reason: null,
      lifecycle_status: "open",
      status: "delivered",
      total_cents: total,
      closed_at: null,
      total_paid_cents: paid,
    },
    items: [],
    splits: [],
    totals: {
      subtotal_cents: total - tip,
      tip_cents: tip,
      discount_cents: 0,
      total_cents: total,
    },
    last_mozo_id: null,
  } as CuentaState;
}

describe("implicitSplit · la sub-cuenta de una orden sin dividir", () => {
  it("sin pagos: se debe el total", () => {
    const s = implicitSplit(cuenta(1_850_000, 0));
    expect(s.id).toBe(IMPLICIT_SPLIT_ID);
    expect(s.expected_amount_cents).toBe(1_850_000);
    expect(s.paid_amount_cents).toBe(0);
    expect(s.status).toBe("pending");
  });

  // El caso real: cuenta de $18.500, entra una transferencia de $18.000. La
  // pantalla tiene que decir que faltan $500 — no $18.500 — o el cajero carga
  // el pago de nuevo y el server convierte la diferencia en propina.
  it("con un pago parcial, lo pagado sale de la orden (el saldo que ve el server)", () => {
    const s = implicitSplit(cuenta(1_850_000, 1_800_000));
    expect(s.paid_amount_cents).toBe(1_800_000);
    expect(s.expected_amount_cents - s.paid_amount_cents).toBe(50_000);
    expect(s.status).toBe("pending");
  });

  it("saldada: queda paid", () => {
    expect(implicitSplit(cuenta(1_850_000, 1_850_000)).status).toBe("paid");
  });

  it("se lleva toda la propina de la orden (spec 177 · Parte 0)", () => {
    expect(implicitSplit(cuenta(1_100_000, 0, 100_000)).tip_cents).toBe(100_000);
  });

  it("una orden en 0 sin pagos no figura pagada", () => {
    expect(implicitSplit(cuenta(0, 0)).status).toBe("pending");
  });
});

describe("implicitSplit · propina pendiente (#353)", () => {
  it("tras un pago parcial lleva la propina que falta, no la entera", () => {
    const base = implicitSplit({
      order: {
        id: "o", business_id: "b", order_number: 1, table_id: "t",
        tip_cents: 1_000, discount_cents: 0, discount_reason: null,
        lifecycle_status: "open", status: "pending", total_cents: 11_000,
        closed_at: null, total_paid_cents: 5_000, tip_pendiente_cents: 0,
      },
      items: [], splits: [], last_mozo_id: null,
      totals: { subtotal_cents: 10_000, tip_cents: 1_000, discount_cents: 0, total_cents: 11_000 },
    } as unknown as Parameters<typeof implicitSplit>[0]);
    expect(base.tip_cents).toBe(0);
  });
});
