import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/currency";
import { traducirErrorDeCaja } from "./mensajes-caja";

describe("traducirErrorDeCaja", () => {
  it("traduce los códigos conocidos a castellano de pantalla", () => {
    expect(traducirErrorDeCaja("NOTES_REQUIRED")).toBe("Escribí qué pasó: hace falta el motivo.");
    expect(traducirErrorDeCaja("AMOUNT_NEGATIVE")).toBe("El monto no puede ser negativo.");
    expect(traducirErrorDeCaja("OPEN_TABLE_ORDERS")).toBe(
      "Hay mesas con la cuenta abierta. Cobralas antes de cerrar.",
    );
    expect(traducirErrorDeCaja("UNRENDERED_MOZOS")).toMatch(/Hay mozos que no rindieron/);
    expect(traducirErrorDeCaja("MODELO_VIEJO")).toBe("El negocio todavía no pasó a la caja nueva.");
  });

  it("toma el dato extra después de los dos puntos", () => {
    expect(traducirErrorDeCaja("MOZO_HAS_OPEN_TABLES:4")).toBe("Tiene mesa 4 sin cobrar. Cobrala antes de rendir.");
    expect(traducirErrorDeCaja("CAJA_SIN_CONTAR:Barra")).toBe("Falta contar: Barra.");
    expect(traducirErrorDeCaja("SALDO_A_FAVOR_DEL_MOZO:150000")).toBe(
      `La caja le debe ${formatCurrency(150_000)} de propina: no tiene que entregar nada.`,
    );
  });

  it("sin dato extra usa el texto de respaldo", () => {
    expect(traducirErrorDeCaja("CAJA_SIN_CONTAR")).toBe("Falta contar: una caja.");
  });

  it("ignora espacios alrededor del código", () => {
    expect(traducirErrorDeCaja("  YA_ANULADA ")).toBe("Esa entrega ya estaba anulada.");
  });

  it("un código desconocido vuelve tal cual, con su extra", () => {
    expect(traducirErrorDeCaja("ALGO_RARO")).toBe("ALGO_RARO");
    expect(traducirErrorDeCaja("ALGO_RARO:42")).toBe("ALGO_RARO:42");
    expect(traducirErrorDeCaja("Fallo de red")).toBe("Fallo de red");
  });
});
