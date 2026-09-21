// Auditoría de reservas · MEDIA — al loguearse, el cliente no pierde lo que
// había elegido (antes volvía a «hoy, 2 personas»).
import { describe, expect, it } from "vitest";

import { parseReservaInicial } from "./reserva-inicial";

describe("parseReservaInicial", () => {
  it("toma fecha, personas y horario válidos", () => {
    expect(
      parseReservaInicial({ date: "2026-09-26", party: "4", slot: "21:00" }, { maxParty: 10 }),
    ).toEqual({ date: "2026-09-26", party: 4, slot: "21:00" });
  });

  it("y el salón elegido (uuid)", () => {
    const id = "8b0c4a8e-7f1a-4a53-9b7a-2f0d3b1c5e11";
    expect(parseReservaInicial({ salon: id }, { maxParty: 10 })).toEqual({ salon: id });
    expect(parseReservaInicial({ salon: "no-es-uuid" }, { maxParty: 10 })).toEqual({});
  });

  it("y el servicio del modo flexible", () => {
    expect(parseReservaInicial({ service: "cena" }, { maxParty: 10 })).toEqual({ service: "cena" });
  });

  it("ignora lo inválido o fuera de rango", () => {
    expect(
      parseReservaInicial(
        { date: "26/09/2026", party: "40", slot: "9pm", service: "x".repeat(200) },
        { maxParty: 10 },
      ),
    ).toEqual({});
  });

  it("con arrays (param repetido) usa el primero", () => {
    expect(parseReservaInicial({ party: ["3", "5"] }, { maxParty: 10 })).toEqual({ party: 3 });
  });
});
