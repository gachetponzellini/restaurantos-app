import { describe, expect, it } from "vitest";

import { elegirMozoAtribuido } from "./atribucion-mozo";

/**
 * Spec 140 · D5 — de quién es la plata de una mesa.
 *
 * El orden importa y es lo único que prueba este archivo: si se vuelve a dar
 * vuelta, una terminal compartida se queda con la recaudación de todo el turno
 * y la rendición de cada mozo da $0.
 */
describe("elegirMozoAtribuido", () => {
  const LUCIA = "11111111-1111-1111-1111-111111111111";
  const TERMINAL = "22222222-2222-2222-2222-222222222222";

  it("manda el mozo de la mesa, aunque los items los haya cargado otro", () => {
    expect(
      elegirMozoAtribuido({ mesaMozoId: LUCIA, lastLoadedBy: TERMINAL }),
    ).toBe(LUCIA);
  });

  it("sin mozo en la mesa cae al que cargó: mostrador y delivery no tienen mesa", () => {
    expect(
      elegirMozoAtribuido({ mesaMozoId: null, lastLoadedBy: TERMINAL }),
    ).toBe(TERMINAL);
  });

  it("sin mesa y sin items no atribuye a nadie", () => {
    expect(elegirMozoAtribuido({ mesaMozoId: null, lastLoadedBy: null })).toBe(
      null,
    );
  });

  it("con la mesa asignada no mira siquiera al que cargó", () => {
    expect(elegirMozoAtribuido({ mesaMozoId: LUCIA, lastLoadedBy: null })).toBe(
      LUCIA,
    );
  });

  // Spec 203 · D1
  describe("sin mesa: es de quien cobra", () => {
    const SOFIA = "33333333-3333-3333-3333-333333333333";

    it("takeaway/delivery van al usuario logueado que cobra, no al que cargó", () => {
      expect(
        elegirMozoAtribuido({
          mesaMozoId: null,
          lastLoadedBy: LUCIA,
          tieneMesa: false,
          operadoPor: SOFIA,
        }),
      ).toBe(SOFIA);
    });

    it("un pedido online sin ítems cargados por staff igual queda del que cobra", () => {
      expect(
        elegirMozoAtribuido({
          mesaMozoId: null,
          lastLoadedBy: null,
          tieneMesa: false,
          operadoPor: SOFIA,
        }),
      ).toBe(SOFIA);
    });

    it("sin usuario que cobre cae en el que cargó", () => {
      expect(
        elegirMozoAtribuido({
          mesaMozoId: null,
          lastLoadedBy: LUCIA,
          tieneMesa: false,
          operadoPor: null,
        }),
      ).toBe(LUCIA);
    });

    it("con mesa, el que cobra no cambia nada", () => {
      expect(
        elegirMozoAtribuido({
          mesaMozoId: LUCIA,
          lastLoadedBy: TERMINAL,
          tieneMesa: true,
          operadoPor: SOFIA,
        }),
      ).toBe(LUCIA);
    });
  });
});
