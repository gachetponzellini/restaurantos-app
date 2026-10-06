import { describe, expect, it } from "vitest";

import { faltanteParaMinimoEnvio } from "./minimo-envio";

// QA #382 · H-13 — el pedido mínimo es sólo del envío a domicilio. La fuente de
// verdad es `persistOrder` (`delivery_type === "delivery"`): el retiro no tiene
// mínimo. El carrito dejaba de ofrecer «Ir a pagar» igual.
describe("faltanteParaMinimoEnvio (H-13)", () => {
  it("retiro: nunca falta nada, aunque el subtotal no llegue", () => {
    expect(
      faltanteParaMinimoEnvio({
        deliveryType: "pickup",
        subtotalCents: 3_000,
        minOrderCents: 5_000,
      }),
    ).toBe(0);
  });

  it("envío por debajo del mínimo: devuelve lo que falta", () => {
    expect(
      faltanteParaMinimoEnvio({
        deliveryType: "delivery",
        subtotalCents: 3_000,
        minOrderCents: 5_000,
      }),
    ).toBe(2_000);
  });

  it("envío justo en el mínimo o por encima: no falta nada", () => {
    for (const subtotalCents of [5_000, 8_000]) {
      expect(
        faltanteParaMinimoEnvio({
          deliveryType: "delivery",
          subtotalCents,
          minOrderCents: 5_000,
        }),
      ).toBe(0);
    }
  });

  it("sin mínimo configurado: no falta nada", () => {
    expect(
      faltanteParaMinimoEnvio({
        deliveryType: "delivery",
        subtotalCents: 100,
        minOrderCents: 0,
      }),
    ).toBe(0);
  });

  it("mismo criterio que el server: el modo programado/dine_in no tiene mínimo", () => {
    expect(
      faltanteParaMinimoEnvio({
        deliveryType: "dine_in",
        subtotalCents: 100,
        minOrderCents: 5_000,
      }),
    ).toBe(0);
  });
});
