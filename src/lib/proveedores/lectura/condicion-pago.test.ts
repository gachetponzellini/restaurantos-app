import { describe, expect, it } from "vitest";

import { condicionDePagoLeida } from "./condicion-pago";

describe("condicionDePagoLeida — spec 187", () => {
  it("sin texto no propone nada", () => {
    expect(condicionDePagoLeida(null)).toBeNull();
    expect(condicionDePagoLeida("")).toBeNull();
    expect(condicionDePagoLeida("   ")).toBeNull();
  });

  it("un texto que no habla de pago no propone nada", () => {
    // Que quede el default del formulario. Devolver «cuenta corriente» acá haría
    // que la pantalla dijera «lo llenó la foto» sobre algo que la foto no dijo.
    expect(condicionDePagoLeida("Original")).toBeNull();
    expect(condicionDePagoLeida("Gracias por su compra")).toBeNull();
  });

  it("contado y efectivo salen de la Caja Mayor", () => {
    expect(condicionDePagoLeida("CONTADO")).toEqual({ condicion: "contado", metodo: "cash" });
    expect(condicionDePagoLeida("EFECTIVO")).toEqual({ condicion: "contado", metodo: "cash" });
    expect(condicionDePagoLeida("Cond. de venta: CONTADO")).toEqual({
      condicion: "contado",
      metodo: "cash",
    });
  });

  it("la cuenta corriente, escrita como la escribe cada proveedor", () => {
    for (const texto of [
      "CTA CTE",
      "Cta. Cte.",
      "CUENTA CORRIENTE",
      "cuenta corriente 30 dias",
      "A 30 DÍAS",
      "Condición: crédito",
    ]) {
      expect(condicionDePagoLeida(texto), texto).toEqual({
        condicion: "cuenta_corriente",
        metodo: "cash",
      });
    }
  });

  it("el medio se lee del mismo texto", () => {
    expect(condicionDePagoLeida("CONTADO - TRANSFERENCIA")).toEqual({
      condicion: "contado",
      metodo: "transfer",
    });
    expect(condicionDePagoLeida("Pago con tarjeta de débito")).toEqual({
      condicion: "contado",
      metodo: "card_manual",
    });
    expect(condicionDePagoLeida("TRANSFERENCIA BANCARIA")).toEqual({
      condicion: "contado",
      metodo: "transfer",
    });
  });

  /**
   * El caso que decide la regla: el recuadro preimpreso lista las cuatro formas
   * de pago y la real está tildada, así que el texto llega con todas adentro.
   * Ante la duda, cuenta corriente: leer mal un «CTA CTE» como contado precarga
   * una sangría que no pasó.
   */
  it("con las dos nombradas gana la cuenta corriente", () => {
    expect(condicionDePagoLeida("EFECTIVO / CTA CTE / CHEQUE")).toEqual({
      condicion: "cuenta_corriente",
      metodo: "cash",
    });
    expect(condicionDePagoLeida("CONTADO CUENTA CORRIENTE")).toEqual({
      condicion: "cuenta_corriente",
      metodo: "cash",
    });
  });
});
