import { describe, expect, it } from "vitest";

import type { PaymentMethod } from "@/lib/caja/types";

import { buildShiftSummary, type ShiftSummaryData } from "./shift-summary";

const EMPTY_METODO: Record<PaymentMethod, number> = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  mp_manual: 0,  cuenta_corriente: 0,
};

function baseData(overrides: Partial<ShiftSummaryData> = {}): ShiftSummaryData {
  return {
    businessName: "Golf",
    timezone: "America/Argentina/Buenos_Aires",
    rangeLabel: "sábado 28/06/2026",
    recaudacion: {
      total_cents: 150_000,
      propinas_cents: 12_000,
      por_metodo: { ...EMPTY_METODO, cash: 100_000, card_manual: 50_000 },
      cobros_count: 8,
    },
    afip: {
      totalCents: 90_000,
      count: 5,
      countA: 2,
      countB: 3,
      countFailed: 1,
      countPending: 0,
    },
    operacion: {
      orderCount: 20,
      revenueCents: 150_000,
      averageTicketCents: 7_500,
      deliveryCount: 4,
      pickupCount: 6,
      dineInCount: 10,
      cancelledCount: 2,
    },
    cortes: [
      {
        caja_name: "Caja principal",
        encargado_name: "Martín",
        difference_cents: -500,
        closing_cash_cents: 99_500,
        expected_cash_cents: 100_000,
        at: "2026-06-28T23:30:00-03:00",
      },
    ],
    porMozo: [
      {
        mozo_name: "Lucía",
        ventas_cents: 80_000,
        propinas_cents: 7_000,
        cobros_count: 5,
      },
    ],
    anulaciones: [
      {
        kind: "item",
        label: "Milanesa napolitana",
        reason: "Se cayó al piso",
        responsable: "Martín",
        at: "2026-06-28T21:15:00-03:00",
      },
    ],
    ...overrides,
  };
}

describe("buildShiftSummary", () => {
  it("arma todos los bloques con montos en ARS", () => {
    const s = buildShiftSummary(baseData());

    expect(s.businessName).toBe("Golf");
    expect(s.rangeLabel).toBe("sábado 28/06/2026");
    expect(s.recaudacion.total).toContain("1.500"); // $1.500 (150.000 cents)
    expect(s.recaudacion.propinas).toContain("120");
    expect(s.recaudacion.cobros).toBe(8);
    expect(s.facturacion.comprobantes).toBe(5);
    expect(s.facturacion.desglose).toBe("A: 2 · B: 3");
    expect(s.facturacion.fallidos).toBe(1);
    expect(s.operacion.pedidos).toBe(20);
    expect(s.operacion.delivery).toBe(4);
    expect(s.operacion.pickup).toBe(6);
    expect(s.operacion.mesas).toBe(10);
    expect(s.operacion.cancelados).toBe(2);
    expect(s.hasData).toBe(true);
  });

  it("desglosa la recaudación solo por los métodos con monto, en orden", () => {
    const s = buildShiftSummary(baseData());
    expect(s.recaudacion.porMetodo.map((m) => m.label)).toEqual([
      "Efectivo",
      "Tarjeta",
    ]);
    expect(s.recaudacion.porMetodo[0].value).toContain("1.000");
  });

  it("formatea cortes (diferencia + encargado + hora) y suma la diferencia total", () => {
    const s = buildShiftSummary(
      baseData({
        cortes: [
          {
            caja_name: "Caja principal",
            encargado_name: "Martín",
            difference_cents: -500,
            closing_cash_cents: 0,
            expected_cash_cents: 0,
            at: "2026-06-28T23:30:00-03:00",
          },
          {
            caja_name: "Caja bar",
            encargado_name: null,
            difference_cents: 300,
            closing_cash_cents: 0,
            expected_cash_cents: 0,
            at: "2026-06-28T23:45:00-03:00",
          },
        ],
      }),
    );
    expect(s.caja.cortes).toHaveLength(2);
    expect(s.caja.cortes[0].hora).toBe("23:30");
    expect(s.caja.cortes[1].encargado).toBe("—"); // null → "—"
    expect(s.caja.diferenciaTotal).toContain("2"); // -500 + 300 = -200 → -$2
  });

  it("lista anulaciones con motivo + responsable; null → '—'", () => {
    const s = buildShiftSummary(
      baseData({
        anulaciones: [
          {
            kind: "item",
            label: "Milanesa",
            reason: "Se cayó",
            responsable: "Martín",
            at: "2026-06-28T21:15:00-03:00",
          },
          {
            kind: "mesa",
            label: "Mesa 5",
            reason: null,
            responsable: null, // anulación vieja sin cancelled_by
            at: "2026-06-28T20:00:00-03:00",
          },
        ],
      }),
    );
    expect(s.anulaciones[0]).toMatchObject({
      detalle: "Milanesa",
      motivo: "Se cayó",
      responsable: "Martín",
      hora: "21:15",
    });
    expect(s.anulaciones[1]).toMatchObject({
      detalle: "Mesa 5",
      motivo: "—",
      responsable: "—",
    });
  });

  it("marca hasData=false cuando el día no tuvo movimiento", () => {
    const s = buildShiftSummary(
      baseData({
        recaudacion: {
          total_cents: 0,
          propinas_cents: 0,
          por_metodo: { ...EMPTY_METODO },
          cobros_count: 0,
        },
        afip: {
          totalCents: 0,
          count: 0,
          countA: 0,
          countB: 0,
          countFailed: 0,
          countPending: 0,
        },
        operacion: {
          orderCount: 0,
          revenueCents: 0,
          averageTicketCents: 0,
          deliveryCount: 0,
          pickupCount: 0,
          dineInCount: 0,
          cancelledCount: 0,
        },
        cortes: [],
        porMozo: [],
        anulaciones: [],
      }),
    );
    expect(s.hasData).toBe(false);
    expect(s.recaudacion.porMetodo).toEqual([]);
    expect(s.anulaciones).toEqual([]);
  });
  it("lista las correcciones de caja del turno con el cambio legible (spec 070)", () => {
    const s = buildShiftSummary(
      baseData({
        correcciones: [
          {
            entity: "payment",
            field: "method",
            from_value: "cash",
            to_value: "card_manual",
            from_label: null,
            to_label: null,
            reason: "lo pagó con débito",
            responsable: "Martín",
            at: "2026-06-28T21:14:00-03:00",
          },
          {
            entity: "payment",
            field: "amount_cents",
            from_value: "1500000",
            to_value: "150000",
            from_label: null,
            to_label: null,
            reason: "un cero de más",
            responsable: null,
            at: "2026-06-28T21:20:00-03:00",
          },
          {
            entity: "payment",
            field: "attributed_mozo_id",
            from_value: "u-1",
            to_value: "u-2",
            from_label: "Ana",
            to_label: "Bruno",
            reason: "la mesa la atendió Bruno",
            responsable: "Martín",
            at: "2026-06-28T21:25:00-03:00",
          },
        ],
      }),
    );

    expect(s.correcciones[0]).toMatchObject({
      detalle: "Cobro · método",
      cambio: "Efectivo → Tarjeta",
      responsable: "Martín",
    });
    // `formatCurrency` usa espacio duro después del $: se compara sin él para
    // que el test no dependa de un carácter invisible.
    expect(s.correcciones[1].cambio.replace(/\u00a0/g, " ")).toBe(
      "$ 15.000 → $ 1.500",
    );
    expect(s.correcciones[1].responsable).toBe("—");
    expect(s.correcciones[2].cambio).toBe("Ana → Bruno");
  });

  it("sin correcciones, la lista queda vacía (el mail no muestra la sección)", () => {
    expect(buildShiftSummary(baseData()).correcciones).toEqual([]);
  });

  it("lista las invitaciones con lo que valían de carta (migración 0126)", () => {
    // Una mesa cerrada sin cobro no es venta ni anulación: es el único lugar
    // donde el dueño ve cuánto se regaló, por qué y quién lo decidió.
    const base = buildShiftSummary({
      businessName: "Demo",
      timezone: "America/Argentina/Buenos_Aires",
      rangeLabel: "hoy",
      recaudacion: { total_cents: 0, fiado_cents: 0, propinas_cents: 0, por_metodo: {} as never, cobros_count: 0 },
      afip: { totalCents: 0, count: 0, countA: 0, countB: 0, countFailed: 0, countPending: 0 },
      operacion: { orderCount: 0, revenueCents: 0, averageTicketCents: 0, deliveryCount: 0, pickupCount: 0, dineInCount: 0, cancelledCount: 0 },
      cortes: [],
      porMozo: [],
      anulaciones: [],
      invitaciones: [
        { label: "Mesa 5", reason: "Cumpleaños del dueño", responsable: "Sofía", valor_cents: 4_500_000, at: "2026-09-20T23:10:00.000Z" },
        { label: "Mesa 9", reason: " ", responsable: null, valor_cents: 1_000_000, at: "2026-09-20T23:40:00.000Z" },
      ],
    });
    expect(base.invitaciones).toHaveLength(2);
    expect(base.invitaciones[0]).toMatchObject({ detalle: "Mesa 5", motivo: "Cumpleaños del dueño", responsable: "Sofía" });
    expect(base.invitaciones[1]).toMatchObject({ motivo: "—", responsable: "—" });
    expect(base.invitacionesTotal.replace(/\u00a0/g, " ")).toContain("55.000");
  });

  it("sin invitaciones no hay total que mostrar", () => {
    const s = buildShiftSummary({
      businessName: "Demo",
      timezone: "America/Argentina/Buenos_Aires",
      rangeLabel: "hoy",
      recaudacion: { total_cents: 0, fiado_cents: 0, propinas_cents: 0, por_metodo: {} as never, cobros_count: 0 },
      afip: { totalCents: 0, count: 0, countA: 0, countB: 0, countFailed: 0, countPending: 0 },
      operacion: { orderCount: 0, revenueCents: 0, averageTicketCents: 0, deliveryCount: 0, pickupCount: 0, dineInCount: 0, cancelledCount: 0 },
      cortes: [],
      porMozo: [],
      anulaciones: [],
    });
    expect(s.invitaciones).toEqual([]);
    expect(s.invitacionesTotal).toBe("");
  });
});
