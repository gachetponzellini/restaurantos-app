import { describe, expect, it } from "vitest";

import {
  aFinalCents,
  aNetoCents,
  ivaDeCents,
  baseDelComprobante,
  conciliarPie,
  parseTasa,
  tasaDelPie,
  tasaDeRenglon,
} from "./iva";

describe("baseDelComprobante — spec 188·D2", () => {
  it("sólo la factura A discrimina IVA en el renglón", () => {
    expect(baseDelComprobante("factura_a")).toBe("neto");
  });

  it("todo lo demás trae el IVA adentro del precio", () => {
    for (const tipo of ["factura_b", "factura_c", "ticket", "remito", "interno", "nota_credito"]) {
      expect(baseDelComprobante(tipo), tipo).toBe("final");
    }
  });

  /**
   * La C del monotributista no es una excepción olvidada: por definición no
   * discrimina IVA. Un default que devolviera `neto` para lo desconocido le
   * restaría un 21% a un costo real.
   */
  it("lo desconocido es final, nunca neto", () => {
    expect(baseDelComprobante(null)).toBe("final");
    expect(baseDelComprobante("lo_que_sea")).toBe("final");
  });
});

describe("el precio final — lo que Rocío pidió ver", () => {
  /** El caso de oro de la 172: el entrecot de la carnicería, a $17.500 el kg. */
  it("sobre una factura A le suma el IVA", () => {
    expect(aFinalCents(17_500_00, 21, "neto")).toBe(21_175_00);
  });

  it("sobre un ticket no le suma nada: ya lo tiene adentro", () => {
    expect(aFinalCents(17_500_00, 21, "final")).toBe(17_500_00);
  });

  it("al 10,5%", () => {
    expect(aFinalCents(1_000_00, 10.5, "neto")).toBe(1_105_00);
  });

  it("sin tasa conocida asume 21, que es la de casi todo", () => {
    expect(aFinalCents(1_000_00, null, "neto")).toBe(1_210_00);
  });

  it("el neto es simétrico", () => {
    expect(aNetoCents(21_175_00, 21, "final")).toBe(17_500_00);
    expect(aNetoCents(17_500_00, 21, "neto")).toBe(17_500_00);
  });

  it("redondea al centavo y no arrastra flotantes", () => {
    // 1.234,56 + 21% = 1.493,8176 → 1.493,82
    expect(aFinalCents(1_234_56, 21, "neto")).toBe(1_493_82);
  });
});

describe("ivaDeCents — el número que pidió Rocío", () => {
  it("sobre un precio neto es lo que falta", () => {
    expect(ivaDeCents(17_500_00, 21, "neto")).toBe(3_675_00);
    expect(ivaDeCents(1_000_00, 10.5, "neto")).toBe(105_00);
  });

  it("sobre un precio final es lo que ya está adentro", () => {
    expect(ivaDeCents(21_175_00, 21, "final")).toBe(3_675_00);
  });

  /**
   * La línea entera de la nota de la carnicería: 82,6 kg × $17.500. Es el
   * número que se compara contra el pie del papel, así que tiene que cerrar al
   * centavo con `aFinalCents`.
   */
  it("cierra con el precio final, al centavo", () => {
    const neto = 1_445_500_00;
    expect(ivaDeCents(neto, 21, "neto")).toBe(303_555_00);
    expect(neto + ivaDeCents(neto, 21, "neto")).toBe(aFinalCents(neto, 21, "neto"));
  });

  it("sin tasa asume 21, como el resto", () => {
    expect(ivaDeCents(1_000_00, null, "neto")).toBe(210_00);
  });

  it("al 0% no hay IVA", () => {
    expect(ivaDeCents(1_000_00, 0, "neto")).toBe(0);
  });
});

describe("tasaDelPie", () => {
  it("deduce el 21 de una factura A real", () => {
    // El pie: neto 2.045.661,16 · IVA 429.588,84 · total 2.475.250
    expect(tasaDelPie(204_566_116, 42_958_884)).toBe(21);
  });

  it("deduce el 10,5", () => {
    expect(tasaDelPie(1_000_00, 105_00)).toBe(10.5);
  });

  it("el IVA en cero es una alícuota, no un dato faltante", () => {
    expect(tasaDelPie(1_000_00, 0)).toBe(0);
  });

  /**
   * Un comprobante con dos tasas mezcladas da un promedio que no es ninguna de
   * las dos. Mostrar «IVA 16,3%» sobre cada renglón sería inventar una alícuota.
   */
  it("si el promedio no es una alícuota de ARCA, no inventa ninguna", () => {
    expect(tasaDelPie(1_000_00, 163_00)).toBeNull();
  });

  it("sin neto no hay tasa", () => {
    expect(tasaDelPie(null, 210_00)).toBeNull();
    expect(tasaDelPie(0, 210_00)).toBeNull();
    expect(tasaDelPie(1_000_00, null)).toBeNull();
  });
});

describe("conciliarPie — spec 188·D4", () => {
  it("cuadra cuando neto + IVA + percepciones da el total", () => {
    const r = conciliarPie({
      netoCents: 204_566_116,
      ivaCents: 42_958_884,
      percepcionesCents: null,
      totalCents: 247_525_000,
    });
    expect(r.estado).toBe("cuadra");
  });

  it("el peso de redondeo del papel no es un error", () => {
    const r = conciliarPie({
      netoCents: 100_000,
      ivaCents: 21_000,
      percepcionesCents: null,
      totalCents: 121_050,
    });
    expect(r.estado).toBe("cuadra");
  });

  it("las percepciones entran en la cuenta", () => {
    const r = conciliarPie({
      netoCents: 100_000,
      ivaCents: 21_000,
      percepcionesCents: 3_000,
      totalCents: 124_000,
    });
    expect(r.estado).toBe("cuadra");
  });

  /** Se muestra la diferencia y se carga igual: nunca frena el guardado. */
  it("cuando no cierra, dice por cuánto", () => {
    const r = conciliarPie({
      netoCents: 100_000,
      ivaCents: 21_000,
      percepcionesCents: null,
      totalCents: 130_000,
    });
    expect(r.estado).toBe("no_cuadra");
    expect(r.diferenciaCents).toBe(9_000);
  });

  it("sin los dos números no compara nada", () => {
    expect(
      conciliarPie({
        netoCents: null,
        ivaCents: null,
        percepcionesCents: null,
        totalCents: 100_000,
      }).estado,
    ).toBe("incompleto");
  });
});

describe("tasaDeRenglon — spec 188·D5", () => {
  it("la impresa gana sobre la del comprobante", () => {
    expect(tasaDeRenglon(10.5, 21)).toBe(10.5);
  });

  it("sin tasa impresa hereda la del comprobante", () => {
    expect(tasaDeRenglon(null, 21)).toBe(21);
  });

  it("una tasa que no es de ARCA no se usa: hereda", () => {
    expect(tasaDeRenglon(17, 21)).toBe(21);
  });

  it("si no hay ninguna, no hay ninguna", () => {
    expect(tasaDeRenglon(null, null)).toBeNull();
  });
});

describe("parseTasa", () => {
  it("lee las formas en que lo imprime el papel", () => {
    expect(parseTasa("21")).toBe(21);
    expect(parseTasa("21%")).toBe(21);
    expect(parseTasa("21,00")).toBe(21);
    expect(parseTasa("IVA 10,5%")).toBe(10.5);
    expect(parseTasa("10.50")).toBe(10.5);
  });

  /** Un «2,1» mal leído no puede convertirse en 21. */
  it("lo que no es una alícuota de ARCA no se fuerza a la más parecida", () => {
    expect(parseTasa("2,1")).toBeNull();
    expect(parseTasa("19")).toBeNull();
    expect(parseTasa("")).toBeNull();
    expect(parseTasa(null)).toBeNull();
    expect(parseTasa("s/d")).toBeNull();
  });
});
