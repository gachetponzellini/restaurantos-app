// #368 — el cliente que cerró Mercado Pago sin pagar puede volver a intentarlo.
import { describe, expect, it } from "vitest";

import { evaluarReintentoPago } from "./reintentar-pago";

const creado = new Date("2026-09-21T15:00:00Z");
const min = (m: number) => new Date(creado.getTime() + m * 60_000);

const pedido = (over: Record<string, unknown> = {}) => ({
  payment_method: "mp",
  payment_status: "pending",
  status: "pending",
  lifecycle_status: "open",
  created_at: creado.toISOString(),
  ...over,
});

describe("evaluarReintentoPago", () => {
  it("un MP impago recién creado se puede pagar; el link vence a los 90 min", () => {
    const r = evaluarReintentoPago(pedido(), min(5));
    expect(r).toEqual({ puede: true, venceEl: min(95) });
  });

  it("cerca del corte, el link vence a los 110 min del pedido (10 antes del barrido)", () => {
    const r = evaluarReintentoPago(pedido(), min(60));
    expect(r).toEqual({ puede: true, venceEl: min(110) });
  });

  it("con menos de 5 min por delante, ya no se ofrece: venció", () => {
    expect(evaluarReintentoPago(pedido(), min(106))).toEqual({ puede: false, motivo: "vencido" });
  });

  it("un pago fallido también se puede reintentar", () => {
    expect(evaluarReintentoPago(pedido({ payment_status: "failed" }), min(10)).puede).toBe(true);
  });

  it("pagado, en efectivo, cancelado o ya aceptado: no se ofrece", () => {
    expect(evaluarReintentoPago(pedido({ payment_status: "paid" }), min(10))).toEqual({ puede: false, motivo: "pagado" });
    expect(evaluarReintentoPago(pedido({ payment_method: "cash" }), min(10))).toEqual({ puede: false, motivo: "no_mp" });
    expect(evaluarReintentoPago(pedido({ status: "cancelled", lifecycle_status: "cancelled" }), min(10))).toEqual({ puede: false, motivo: "cancelado" });
    expect(evaluarReintentoPago(pedido({ status: "confirmed" }), min(10))).toEqual({ puede: false, motivo: "no_disponible" });
  });
});
