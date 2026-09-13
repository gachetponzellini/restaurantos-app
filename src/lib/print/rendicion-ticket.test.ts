import { describe, expect, it } from "vitest";

import {
  buildRendicionContent,
  buildRendicionLines,
  type RendicionTicketData,
} from "./rendicion-ticket";
import { COLS_COND } from "./ticket";

function data(over: Partial<RendicionTicketData> = {}): RendicionTicketData {
  return {
    negocio_name: "Restaurante Demo",
    mozo_name: "Pedro Mozo",
    registrado_por: "Sofía Ramírez",
    // 10/09 a las 23:41 hora AR (UTC-3): en UTC ya es el 11.
    fecha: "2026-09-11T02:41:00Z",
    estado: "rendida",
    por_metodo: { cash: 1_850_000, card_manual: 3_850_000, mp_qr: 420_000 },
    expected_cash_cents: 1_850_000,
    delivered_cash_cents: 1_850_000,
    difference_cents: 0,
    propina_pagada_cents: 420_000,
    notes: null,
    reimpresion: false,
    ...over,
  };
}

const texto = (d: RendicionTicketData) => buildRendicionLines(d).map((l) => l.text);

describe("el papel de la rendición (spec 178)", () => {
  it("ninguna línea pasa las 42 columnas de la condensada", () => {
    for (const t of texto(data({ notes: "x".repeat(200) }))) {
      expect(t.length, t).toBeLessThanOrEqual(COLS_COND);
    }
  });

  it("dice de quién es, cuándo, y quién lo registró", () => {
    const t = texto(data()).join("\n");
    expect(t).toContain("RENDICION DE TURNO");
    expect(t).toContain("Pedro Mozo");
    expect(t).toContain("Sofia Ramirez"); // sin tildes: es ESC/POS
    expect(t).toMatch(/10\/09\/2026/);
    expect(t).toMatch(/23:41/);
  });

  it("lista lo cobrado por método con su total, y salta los métodos en cero", () => {
    const t = texto(data()).join("\n");
    expect(t).toContain("COBRADO EN EL TURNO");
    expect(t).toMatch(/Efectivo\s+18\.500,00/);
    expect(t).toMatch(/Tarjeta\s+38\.500,00/);
    expect(t).toMatch(/QR\s+4\.200,00/);
    expect(t).toMatch(/TOTAL\s+61\.200,00/);
    expect(t).not.toMatch(/Transferencia/);
  });

  it("el bloque de efectivo es lo que se rinde: debía, entregó, diferencia", () => {
    const t = texto(data()).join("\n");
    expect(t).toMatch(/Debia entregar\s+18\.500,00/);
    expect(t).toMatch(/Entrego\s+18\.500,00/);
    expect(t).toMatch(/DIFERENCIA\s+0,00/);
  });

  it("el faltante sale en negativo, y el sobrante en positivo", () => {
    const falta = texto(
      data({ delivered_cash_cents: 1_650_000, difference_cents: -200_000 }),
    ).join("\n");
    expect(falta).toMatch(/DIFERENCIA\s+-2\.000,00/);

    const sobra = texto(
      data({ delivered_cash_cents: 1_950_000, difference_cents: 100_000 }),
    ).join("\n");
    expect(sobra).toMatch(/DIFERENCIA\s+\+1\.000,00/);
  });

  // Spec 177 — la rendición paga la propina, y el papel es la constancia de
  // que la recibió. Es plata que salió del cajón.
  it("dice cuánta propina se le pagó", () => {
    expect(texto(data()).join("\n")).toMatch(/Propina pagada\s+4\.200,00/);
  });

  it("sin propina pagada, no imprime el renglón", () => {
    expect(texto(data({ propina_pagada_cents: 0 })).join("\n")).not.toContain(
      "Propina",
    );
  });

  // D6 — la deuda declarada es justamente el caso donde más sirve el papel.
  it("«no entregó» reemplaza el bloque de efectivo por la deuda", () => {
    const t = texto(
      data({
        estado: "no_entrego",
        delivered_cash_cents: 0,
        difference_cents: -1_850_000,
        propina_pagada_cents: 0,
        notes: "Se fue antes de cerrar",
      }),
    ).join("\n");
    expect(t).toContain("*** NO ENTREGO ***");
    expect(t).toMatch(/Queda como deuda\s+18\.500,00/);
    expect(t).not.toMatch(/Entrego\s+/);
    expect(t).not.toContain("DIFERENCIA");
    expect(t).toContain("Se fue antes de cerrar");
  });

  it("las observaciones se cortan por palabra, sin pasarse de ancho", () => {
    const t = texto(
      data({
        notes:
          "Faltante chico que lo cubre mañana según dijo cuando entregó la plata",
      }),
    );
    const idx = t.indexOf("OBSERVACIONES");
    expect(idx).toBeGreaterThan(-1);
    expect(t[idx + 1]!.length).toBeLessThanOrEqual(COLS_COND);
    expect(t.slice(idx + 1).join(" ")).toContain("Faltante chico que lo cubre");
  });

  it("termina con las dos firmas", () => {
    const t = texto(data()).join("\n");
    expect(t).toMatch(/Firma mozo/);
    expect(t).toMatch(/Firma encargado/);
  });

  it("la reimpresión sale marcada arriba de todo", () => {
    expect(texto(data({ reimpresion: true }))[0]).toBe("*** REIMPRESION ***");
    expect(texto(data())[0]).not.toBe("*** REIMPRESION ***");
  });

  it("entrega ESC/POS en base64 y el texto plano", () => {
    const c = buildRendicionContent(data());
    expect(c.plain).toContain("RENDICION DE TURNO");
    const bytes = Buffer.from(c.escpos_b64, "base64").toString("binary");
    expect(bytes.startsWith("\x1b@")).toBe(true);
    expect(bytes).toContain("RENDICION DE TURNO");
  });
});
