import { describe, expect, it } from "vitest";

import {
  admiteCobro,
  esCuentaCerradaConSaldo,
  puedeAnularCuentaCerrada,
  saldoCents,
  tieneSaldoPendiente,
  type OrdenParaSaldo,
} from "./saldo-pendiente";

const orden = (over: Partial<OrdenParaSaldo> = {}): OrdenParaSaldo => ({
  lifecycle_status: "open",
  status: "preparing",
  total_cents: 1_850_000,
  total_paid_cents: 0,
  ...over,
});

describe("saldo pendiente (#339)", () => {
  it("el saldo nunca es negativo", () => {
    expect(saldoCents(orden({ total_paid_cents: 2_000_000 }))).toBe(0);
    expect(saldoCents(orden({ total_paid_cents: 1_800_000 }))).toBe(50_000);
  });

  it("abierta sin pagos: no es un saldo pendiente, es una mesa sentada", () => {
    expect(tieneSaldoPendiente(orden())).toBe(false);
  });

  it("abierta con cobro parcial: sí", () => {
    expect(tieneSaldoPendiente(orden({ total_paid_cents: 1_800_000 }))).toBe(true);
  });

  it("abierta y saldada: no", () => {
    expect(tieneSaldoPendiente(orden({ total_paid_cents: 1_850_000 }))).toBe(false);
  });

  // El caso real: se anularon las dos líneas de una cuenta ya cerrada.
  it("cerrada con todo anulado: saldo pendiente y cobrable", () => {
    const o = orden({ lifecycle_status: "closed", status: "delivered" });
    expect(esCuentaCerradaConSaldo(o)).toBe(true);
    expect(tieneSaldoPendiente(o)).toBe(true);
    expect(admiteCobro(o)).toBe(true);
  });

  it("cerrada y saldada: no se vuelve a cobrar", () => {
    const o = orden({
      lifecycle_status: "closed",
      status: "delivered",
      total_paid_cents: 1_850_000,
    });
    expect(tieneSaldoPendiente(o)).toBe(false);
    expect(admiteCobro(o)).toBe(false);
  });

  it("cancelada: nunca, aunque le falte plata", () => {
    for (const lifecycle_status of ["open", "closed", "cancelled"] as const) {
      const o = orden({ lifecycle_status, status: "cancelled", total_paid_cents: 100 });
      expect(tieneSaldoPendiente(o)).toBe(false);
      expect(admiteCobro(o)).toBe(false);
    }
  });

  it("cerrada en $0 (mesa sin consumo): no es un saldo", () => {
    expect(
      esCuentaCerradaConSaldo(orden({ lifecycle_status: "closed", total_cents: 0 })),
    ).toBe(false);
  });

  it("abierta: se cobra como siempre", () => {
    expect(admiteCobro(orden())).toBe(true);
  });
});

describe("puedeAnularCuentaCerrada (spec 215)", () => {
  // Mesa 14 de KCC: el cobro se anuló porque la venta se facturó por fuera.
  // La cuenta quedó cerrada con saldo y no había forma de darla de baja.
  it("una cuenta cerrada con saldo se puede anular", () => {
    expect(puedeAnularCuentaCerrada(orden({ lifecycle_status: "closed", status: "delivered" }))).toBeNull();
  });

  it("una cerrada y saldada también (la plata la frena otra guarda)", () => {
    expect(
      puedeAnularCuentaCerrada(orden({ lifecycle_status: "closed", status: "delivered", total_paid_cents: 1_850_000 })),
    ).toBeNull();
  });

  it("una abierta no: eso es «Anular mesa» desde el salón", () => {
    expect(puedeAnularCuentaCerrada(orden())).toMatch(/abierta/i);
  });

  it("una ya cancelada no", () => {
    expect(puedeAnularCuentaCerrada(orden({ lifecycle_status: "cancelled", status: "cancelled" }))).toMatch(/anulada/i);
  });
});
