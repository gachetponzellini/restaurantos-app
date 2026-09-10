import { describe, expect, it } from "vitest";

import {
  buildCierreContent,
  buildCierreLines,
  fechaLarga,
  monto,
  type CierreTicketData,
} from "./cierre-ticket";
import { COLS_COND } from "./ticket";

function data(over: Partial<CierreTicketData> = {}): CierreTicketData {
  return {
    negocio: {
      name: "Restaurante Golf",
      razon_social: "SESER SRL",
      address: "Bv. Wilde y Eva Peron",
      sucursal: "RESTO",
      condicion_iva: "Resp. Inscripto",
      cuit: "30-71323440-7",
    },
    caja_name: "Caja Principal",
    numero: 3969,
    // 10:20 y 15:20 hora AR (UTC-3), como el turno mediodía de la foto.
    apertura: "2026-09-03T13:20:00Z",
    cierre: "2026-09-03T18:20:00Z",
    encargado_name: "Sofía Ramírez",
    movimientos: {
      ingresos: [{ detalle: "Cambio para el turno", total_cents: 1_500_000 }],
      egresos: [{ detalle: "Pago a proveedor", total_cents: 14_000_000 }],
    },
    ventas_por_origen: [
      { detalle: "Salon", total_cents: 96_830_000, cant: 42 },
      { detalle: "Delivery", total_cents: 24_120_000, cant: 12 },
    ],
    ventas_por_metodo: [
      { detalle: "Efectivo", total_cents: 48_620_000, cant: 41 },
      { detalle: "Tarjeta", total_cents: 72_330_000, cant: 13 },
    ],
    resumen: {
      apertura_cents: 0,
      efectivo_cents: 48_620_000,
      ingresos_cents: 1_500_000,
      sangrias_cents: 14_000_000,
      propinas_pagadas_cents: 0,
      esperado_cents: 36_120_000,
      contado_cents: 35_970_000,
      diferencia_cents: -150_000,
      propinas_cents: 9_630_000,
    },
    notas: null,
    ...over,
  };
}

const texto = (d: CierreTicketData) => buildCierreLines(d).map((l) => l.text);

describe("fechaLarga", () => {
  it("copia el formato del papel: «Jueves 3 de Septiembre de 2026»", () => {
    expect(fechaLarga("2026-09-03T18:20:00Z")).toBe("Jueves 3 de Septiembre de 2026");
  });

  it("usa la timezone del local, no la del server", () => {
    // 01:14 AR del jueves 3 es todavía el 3 en AR y ya el 3 en UTC; el caso que
    // importa es el de la madrugada, donde UTC ya pasó de día.
    expect(fechaLarga("2026-09-04T02:00:00Z")).toBe("Jueves 3 de Septiembre de 2026");
  });
});

describe("monto", () => {
  it("va con decimales y separador de miles, como el papel", () => {
    expect(monto(128_450_000)).toBe("1.284.500,00");
    expect(monto(0)).toBe("0,00");
  });

  it("el faltante sale en negativo", () => {
    expect(monto(-150_000)).toBe("-1.500,00");
  });
});

describe("el papel del cierre", () => {
  it("ninguna línea pasa las 42 columnas de la condensada", () => {
    // Es la restricción física: 42 es lo que entra en Font B en 58 mm. Una
    // línea más larga la parte la impresora donde le queda.
    for (const l of texto(data({ notas: "Faltó un billete de mil y monedas del vuelto de la 14, revisado con Diego antes de cerrar." }))) {
      expect(l.length, `«${l}»`).toBeLessThanOrEqual(COLS_COND);
    }
  });

  it("trae la cabecera fiscal del local", () => {
    const t = texto(data());
    expect(t).toContain("Restaurante Golf");
    expect(t).toContain("SESER SRL");
    expect(t).toContain("Bv. Wilde y Eva Peron");
    expect(t).toContain("Sucursal: RESTO");
    expect(t).toContain("IVA: Resp. Inscripto  CUIT: 30-71323440-7");
  });

  it("omite los datos fiscales que no tenemos en vez de inventarlos", () => {
    const t = texto(
      data({
        negocio: { name: "Restaurante Demo", cuit: null, razon_social: null, sucursal: null, condicion_iva: null, address: null },
      }),
    );
    expect(t).toContain("Restaurante Demo");
    expect(t.some((l) => l.includes("Sucursal:"))).toBe(false);
    expect(t.some((l) => l.includes("CUIT:"))).toBe(false);
    expect(t.some((l) => l.includes("IVA:"))).toBe(false);
  });

  it("identifica el cierre por número y por las dos horas", () => {
    const t = texto(data());
    expect(t).toContain("Cierre nº 3969.");
    expect(t).toContain("Apertura: 10:20 - Usuario: Sofía Ramírez");
    expect(t).toContain("  Cierre: 15:20 - Usuario: Sofía Ramírez");
  });

  it("dice la caja, no un turno: no tenemos turnos", () => {
    const t = texto(data());
    expect(t).toContain("Caja: Caja Principal");
    expect(t.some((l) => /turno \d/i.test(l))).toBe(false);
  });

  it("un corte viejo sin número no imprime la línea vacía", () => {
    const t = texto(data({ numero: null }));
    expect(t.some((l) => l.startsWith("Cierre nº"))).toBe(false);
    expect(t).toContain("Apertura: 10:20 - Usuario: Sofía Ramírez");
  });

  it("separa ingresos de egresos, con el motivo de cada uno", () => {
    const t = texto(data()).join("\n");
    expect(t).toContain("INGRESOS");
    expect(t).toContain("Cambio para el turno");
    expect(t).toContain("EGRESOS");
    expect(t).toContain("Pago a proveedor");
  });

  it("un turno sin movimientos lo dice, no deja el bloque mudo", () => {
    const t = texto(data({ movimientos: { ingresos: [], egresos: [] } }));
    expect(t.filter((l) => l.includes("(sin movimientos)"))).toHaveLength(2);
  });

  it("totaliza ventas por origen y por forma de cobro", () => {
    const t = texto(data()).join("\n");
    // 968.300 + 241.200 = 1.209.500 · 42 + 12 = 54
    expect(t).toMatch(/TOTAL\s+1\.209\.500,00\s+54/);
    // 486.200 + 723.300 = 1.209.500 · 41 + 13 = 54
    expect(t).toMatch(/TOTAL\s+1\.209\.500,00\s+54/);
  });

  it("el arqueo cierra: apertura + efectivo + ingresos - sangrías = esperado", () => {
    const d = data();
    const r = d.resumen;
    expect(
      r.apertura_cents + r.efectivo_cents + r.ingresos_cents - r.sangrias_cents,
    ).toBe(r.esperado_cents);

    const t = texto(d).join("\n");
    expect(t).toContain("EFECTIVO ESPERADO");
    expect(t).toContain("CONTADO");
    expect(t).toContain("DIFERENCIA");
  });

  it("el papel dice cuánta propina generó el período", () => {
    const t = texto(data()).join("\n");
    expect(t).toContain("Propinas del periodo");
  });

  // Spec 177 · Parte B — la propina pagada SALE del cajón, así que entra en la
  // cuenta del esperado. Es el renglón que explicaba el faltante de todas las
  // noches en un local que le paga la propina de tarjeta al mozo en efectivo.
  it("la propina pagada es un renglón del arqueo", () => {
    const t = texto(
      data({
        resumen: {
          ...data().resumen,
          propinas_pagadas_cents: 9_630_000,
        },
      }),
    ).join("\n");
    expect(t).toContain("- Propinas pagadas");
  });

  it("sin propina pagada, el renglón no aparece", () => {
    expect(texto(data()).join("\n")).not.toContain("Propinas pagadas");
  });

  it("la reimpresión sale marcada arriba de todo", () => {
    const t = texto(data({ reimpresion: true }));
    expect(t[0]).toBe("*** REIMPRESION ***");
    // Y el papel original no la lleva.
    expect(texto(data())[0]).not.toBe("*** REIMPRESION ***");
  });

  it("las observaciones se cortan por palabra, sin pasarse de ancho", () => {
    const t = texto(
      data({ notas: "Faltó un billete de mil pesos y las monedas del vuelto de la mesa 14" }),
    );
    expect(t).toContain("OBSERVACIONES");
    for (const l of t) expect(l.length).toBeLessThanOrEqual(COLS_COND);
  });
});

describe("buildCierreContent", () => {
  it("emite ESC M 1 (Font B) — es lo que da las 42 columnas", () => {
    const { escpos_b64 } = buildCierreContent(data());
    const bytes = Buffer.from(escpos_b64, "base64").toString("binary");
    expect(bytes).toContain("\x1bM\x01");
  });

  it("no le suma espaciado lateral: con ESC SP 4 las 42 no entran", () => {
    const bytes = Buffer.from(
      buildCierreContent(data()).escpos_b64,
      "base64",
    ).toString("binary");
    expect(bytes).toContain("\x1b \x00");
    expect(bytes).not.toContain("\x1b \x04");
  });

  it("devuelve la impresora a fábrica al terminar (la comparte MaxiRest)", () => {
    const bytes = Buffer.from(
      buildCierreContent(data()).escpos_b64,
      "base64",
    ).toString("binary");
    expect(bytes.endsWith("\x1b@")).toBe(true);
  });

  it("el texto plano trae las mismas líneas, para el transporte windows", () => {
    const { plain } = buildCierreContent(data());
    expect(plain).toContain("Cierre nº 3969.");
    expect(plain).toContain("EFECTIVO ESPERADO");
  });
});
