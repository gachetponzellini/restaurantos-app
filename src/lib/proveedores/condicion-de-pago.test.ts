import { describe, expect, it } from "vitest";

import { SupplierInvoiceInput } from "@/lib/proveedores/schema";

/**
 * La condición de pago del comprobante — spec 187.
 *
 * Lo que se prueba acá es el CONTRATO, que es donde vive la decisión: el default
 * no cambió (una compra nace debiendo, como hasta ayer) y el contado no puede
 * entrar sobre una nota de crédito.
 */
const base = {
  supplier_id: "3f6c1b2e-7d4a-4a1b-9c2e-8f0a1b2c3d4e",
  invoice_date: "2026-09-15",
  total_cents: 180_000_00,
  document_type: "interno" as const,
};

describe("SupplierInvoiceInput · la condición de pago (spec 187)", () => {
  /**
   * La garantía de que esta spec no le cambia el comportamiento a nadie: los
   * callers viejos —el diálogo de la 158, cualquier test existente— no mandan
   * estos campos y tienen que seguir cargando en cuenta corriente.
   */
  it("sin decir nada, la compra nace debiendo", () => {
    const r = SupplierInvoiceInput.safeParse(base);

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.payment_condition).toBe("cuenta_corriente");
    expect(r.data.payment_method).toBe("cash");
  });

  it("acepta el contado con su medio", () => {
    const r = SupplierInvoiceInput.safeParse({
      ...base,
      payment_condition: "contado",
      payment_method: "transfer",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.payment_condition).toBe("contado");
    expect(r.data.payment_method).toBe("transfer");
  });

  /**
   * D6 · su total es negativo (158·D4) y `SupplierPaymentInput` exige monto
   * positivo. Sin esta guarda el error aparecería adentro del Zod del pago, con
   * el comprobante ya creado y un mensaje que habla de otra pantalla.
   */
  it("una nota de crédito no se paga al contado", () => {
    const r = SupplierInvoiceInput.safeParse({
      ...base,
      document_type: "nota_credito",
      total_cents: -50_000_00,
      payment_condition: "contado",
    });

    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path[0] === "payment_condition");
    expect(issue?.message).toBe("Una nota de crédito no se paga: resta del saldo.");
  });

  it("la nota de crédito en cuenta corriente sigue entrando", () => {
    const r = SupplierInvoiceInput.safeParse({
      ...base,
      document_type: "nota_credito",
      total_cents: -50_000_00,
    });

    expect(r.success).toBe(true);
  });

  it("un medio que no existe no entra", () => {
    const r = SupplierInvoiceInput.safeParse({
      ...base,
      payment_condition: "contado",
      payment_method: "cheque",
    });

    expect(r.success).toBe(false);
  });
});
