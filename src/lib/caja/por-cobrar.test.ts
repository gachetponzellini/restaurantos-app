import { describe, expect, it } from "vitest";

import { porCobrar } from "./por-cobrar";
import type { CuentaAbierta } from "./queries";
import type { CuentaConSaldo } from "./types";

const abierta = (o: Partial<CuentaAbierta> & { order_id: string; table_label: string }): CuentaAbierta => ({
  order_number: 1,
  table_id: `t-${o.table_label}`,
  mozo_name: null,
  total_cents: 1_500_000,
  pendiente_cents: 1_500_000,
  ...o,
});
const conSaldo = (o: Partial<CuentaConSaldo> & { orderId: string }): CuentaConSaldo => ({
  orderNumber: 10,
  dailyNumber: 7,
  tableId: null,
  tableLabel: null,
  totalCents: 1_500_000,
  paidCents: 0,
  saldoCents: 1_500_000,
  cerrada: true,
  ...o,
});

describe("porCobrar — un solo listado de lo que falta cobrar", () => {
  it("junta las mesas abiertas y las cuentas cerradas con saldo, sin repetir", () => {
    const filas = porCobrar(
      [
        abierta({ order_id: "o1", table_label: "R04", mozo_name: "Pedro" }),
        abierta({ order_id: "o2", table_label: "R05", mozo_name: "Lucía", total_cents: 2_400_000, pendiente_cents: 1_400_000 }),
      ],
      [
        // La R05 también figura como «con saldo» (pagó una parte): no se repite.
        conSaldo({ orderId: "o2", tableId: "t-R05", tableLabel: "R05", cerrada: false, totalCents: 2_400_000, paidCents: 1_000_000, saldoCents: 1_400_000 }),
        conSaldo({ orderId: "o3", dailyNumber: 208 }),
      ],
    );
    expect(filas.map((f) => f.nombre)).toEqual(["Mesa R04", "Mesa R05", "Pedido #208"]);
    expect(filas.map((f) => f.faltaCents)).toEqual([1_500_000, 1_400_000, 1_500_000]);
  });

  it("lo que frena el cierre va primero y dice por qué", () => {
    const filas = porCobrar(
      [abierta({ order_id: "o1", table_label: "R04" })],
      [conSaldo({ orderId: "o3", dailyNumber: 208 })],
    );
    expect(filas[0]).toMatchObject({ frena: true, detalle: "Mesa abierta" });
    expect(filas[1]).toMatchObject({ frena: false, detalle: "Cerrada con saldo: no frena el cierre" });
  });

  it("una mesa con un pago parcial dice cuánto pagó", () => {
    const [f] = porCobrar(
      [abierta({ order_id: "o2", table_label: "R05", total_cents: 2_400_000, pendiente_cents: 1_400_000 })],
      [],
    );
    expect(f.pagadoCents).toBe(1_000_000);
    expect(f.detalle).toBe("Pagó una parte");
  });

  it("la mesa abierta va a cobrar la mesa; lo cerrado, al pedido", () => {
    const [mesa, pedido] = porCobrar(
      [abierta({ order_id: "o1", table_label: "R04" })],
      [conSaldo({ orderId: "o3", orderNumber: 555 })],
    );
    expect(mesa.destino).toEqual({ kind: "mesa", tableId: "t-R04" });
    expect(pedido.destino).toEqual({ kind: "pedido", orderNumber: 555 });
  });

  it("un pedido sin mesa abierto con un pago parcial no frena el cierre", () => {
    const [f] = porCobrar([], [conSaldo({ orderId: "o9", cerrada: false, paidCents: 500_000, saldoCents: 1_000_000 })]);
    expect(f).toMatchObject({ frena: false, detalle: "Pagó una parte" });
  });

  it("vacío si no falta nada", () => {
    expect(porCobrar([], [])).toEqual([]);
  });

  it("sólo las cuentas cerradas se pueden anular desde acá (spec 215)", () => {
    const filas = porCobrar(
      [abierta({ order_id: "o1", table_label: "R04" })],
      [conSaldo({ orderId: "o2", tableLabel: "14" }), conSaldo({ orderId: "o3", cerrada: false, paidCents: 500_000, saldoCents: 1_000_000 })],
    );
    expect(Object.fromEntries(filas.map((f) => [f.orderId, f.anulable]))).toEqual({ o1: false, o2: true, o3: false });
  });
});
