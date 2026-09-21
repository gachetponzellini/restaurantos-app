// Auditoría de pedidos · MEDIA — con el reintento (#368) una orden puede tener
// varios pagos de MP. Un «rechazado» tardío del intento 1 no puede pisar el
// «aprobado» del intento 2.
import { describe, expect, it } from "vitest";

import { estadoDePagoAEscribir } from "./estado-de-pago";

describe("estadoDePagoAEscribir", () => {
  it("una orden pagada no baja a fallida por un rechazo tardío de otro intento", () => {
    expect(
      estadoDePagoAEscribir({ actual: "paid", actualPaymentId: "2" }, { siguiente: "failed", paymentId: "1" }),
    ).toBeNull();
  });

  it("ni vuelve a pending", () => {
    expect(
      estadoDePagoAEscribir({ actual: "paid", actualPaymentId: "2" }, { siguiente: "pending", paymentId: "1" }),
    ).toBeNull();
  });

  it("el reembolso del MISMO pago sí la baja", () => {
    expect(
      estadoDePagoAEscribir({ actual: "paid", actualPaymentId: "2" }, { siguiente: "refunded", paymentId: "2" }),
    ).toBe("refunded");
  });

  it("el reembolso de OTRO pago no la baja (sigue pagada por el otro)", () => {
    expect(
      estadoDePagoAEscribir({ actual: "paid", actualPaymentId: "2" }, { siguiente: "refunded", paymentId: "1" }),
    ).toBeNull();
  });

  it("sin pago previo, cualquier transición se escribe", () => {
    expect(
      estadoDePagoAEscribir({ actual: "pending", actualPaymentId: null }, { siguiente: "failed", paymentId: "1" }),
    ).toBe("failed");
    expect(
      estadoDePagoAEscribir({ actual: "failed", actualPaymentId: "1" }, { siguiente: "paid", paymentId: "2" }),
    ).toBe("paid");
  });
});
