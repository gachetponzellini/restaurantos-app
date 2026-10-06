import { describe, expect, it, vi } from "vitest";

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

  it("un error desconocido o técnico no llega crudo a la pantalla", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const generico = "No se pudo completar. Reintentá en un momento.";
    expect(traducirErrorDeCaja("ALGO_RARO")).toBe(generico);
    expect(traducirErrorDeCaja('invalid input syntax for type bigint: "x"')).toBe(generico);
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it("el dato extra puede traer sus propios dos puntos", () => {
    expect(traducirErrorDeCaja("CAJA_SIN_CONTAR:Barra: planta alta")).toBe("Falta contar: Barra: planta alta.");
  });

  it("los códigos de 0143", () => {
    expect(traducirErrorDeCaja("MOVIMIENTO_DE_MOZO")).toMatch(/anulala desde la rendición/);
    expect(traducirErrorDeCaja("MOZO_WRONG_BUSINESS")).toMatch(/no es del equipo/);
  });
});
