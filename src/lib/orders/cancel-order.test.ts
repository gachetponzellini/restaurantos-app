import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./totals-recompute", () => ({ recomputeOrderTotals: vi.fn(async () => {}) }));

import { cancelarOrden } from "./cancel-order";

/**
 * Spec 215 — `cancelarOrden({ desdeCerrada })`. Lo que se fija es qué filtra la
 * escritura de la orden (la guarda optimista contra un cobro que entra entre
 * medio) y que las comandas de una mesa ya terminada no saquen «ANULADA».
 */

type Llamada = { table: string; op: string; payload?: Record<string, unknown>; filtros: [string, string, unknown][] };
let llamadas: Llamada[];

function fakeService() {
  return {
    rpc: vi.fn(async () => ({ error: null })),
    from(table: string) {
      const llamada: Llamada = { table, op: "select", filtros: [] };
      llamadas.push(llamada);
      const builder = {
        update(payload: Record<string, unknown>) {
          llamada.op = "update";
          llamada.payload = payload;
          return builder;
        },
        eq(col: string, v: unknown) {
          llamada.filtros.push(["eq", col, v]);
          return builder;
        },
        neq(col: string, v: unknown) {
          llamada.filtros.push(["neq", col, v]);
          return builder;
        },
        in(col: string, v: unknown) {
          llamada.filtros.push(["in", col, v]);
          return builder;
        },
        is(col: string, v: unknown) {
          llamada.filtros.push(["is", col, v]);
          return builder;
        },
        select: async () => ({ data: table === "orders" ? [{ id: "o1" }] : [{ id: "x" }] }),
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const base = { orderId: "o1", businessId: "b1", motivo: "Facturada por fuera", actorUserId: "u1", nowIso: "2026-10-08T20:00:00Z" };

beforeEach(() => {
  llamadas = [];
});

describe("cancelarOrden", () => {
  it("por defecto sólo cancela una orden abierta y avisa a cocina", async () => {
    await cancelarOrden(fakeService(), base);
    const orden = llamadas.find((l) => l.table === "orders")!;
    expect(orden.filtros).toContainEqual(["eq", "lifecycle_status", "open"]);
    const comandas = llamadas.find((l) => l.table === "comandas")!;
    expect(comandas.payload).toHaveProperty("reprint_requested_at", base.nowIso);
  });

  it("desdeCerrada: acepta una orden cerrada, pero sólo si no tiene nada pagado", async () => {
    await cancelarOrden(fakeService(), { ...base, desdeCerrada: true });
    const orden = llamadas.find((l) => l.table === "orders")!;
    expect(orden.filtros).toContainEqual(["in", "lifecycle_status", ["open", "closed"]]);
    // Guarda optimista: un cobro que entra entre el control y esta escritura
    // la deja sin efecto (spec 092: no se anula por encima de plata).
    expect(orden.filtros).toContainEqual(["eq", "total_paid_cents", 0]);
    expect(orden.filtros).not.toContainEqual(["eq", "lifecycle_status", "open"]);
  });

  it("desdeCerrada: las comandas activas se cancelan sin ticket «ANULADA»", async () => {
    await cancelarOrden(fakeService(), { ...base, desdeCerrada: true });
    const comandas = llamadas.find((l) => l.table === "comandas")!;
    expect(comandas.payload).toHaveProperty("cancelled_at", base.nowIso);
    expect(comandas.payload).not.toHaveProperty("reprint_requested_at");
  });

  it("la factura de sandbox de la orden queda cancelada (spec 215 · D4)", async () => {
    // Sandbox no frena la anulación (no es fiscal), pero no puede quedar
    // autorizada sobre una venta que ya no existe: inflaría lo facturado.
    await cancelarOrden(fakeService(), base);
    const factura = llamadas.find((l) => l.table === "invoices")!;
    expect(factura.op).toBe("update");
    expect(factura.payload).toMatchObject({ status: "cancelled", cancelled_reason: base.motivo, cancelled_by: base.actorUserId });
    expect(factura.filtros).toContainEqual(["eq", "order_id", "o1"]);
    expect(factura.filtros).toContainEqual(["eq", "provider", "sandbox"]);
    expect(factura.filtros).toContainEqual(["in", "status", ["pending", "authorized"]]);
  });

  it("si la orden no se canceló, no toca nada más", async () => {
    const svc = fakeService();
    const from = svc.from.bind(svc);
    svc.from = (t: string) => {
      const b = from(t);
      if (t === "orders") b.select = async () => ({ data: [] });
      return b;
    };
    const r = await cancelarOrden(svc, { ...base, desdeCerrada: true });
    expect(r.cancelled).toBe(false);
    expect(llamadas.map((l) => l.table)).toEqual(["orders"]);
  });
});
