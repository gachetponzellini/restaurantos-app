import { describe, expect, it } from "vitest";

import { buildLiquidacionContent, buildLiquidacionLines, type LiquidacionTicketData } from "./liquidacion-ticket";
import { COLS_COND } from "./ticket";

const base = (over: Partial<LiquidacionTicketData> = {}): LiquidacionTicketData => ({
  negocio_name: "Restaurante Demo",
  mozo_name: "Pedro Mozo",
  caja_name: "Caja Principal",
  turno_desde: "2026-10-07T12:15:00Z",
  impreso_at: "2026-10-08T02:40:00Z",
  impreso_por: "Sofía Encargada",
  anterior_cents: 0,
  efectivo_cents: 17_780_000,
  propina_tarjeta_cents: 220_000,
  entregado_cents: 0,
  pagado_cents: 0,
  saldo_cents: 17_560_000,
  no_se_rinden: [{ label: "Tarjeta", cents: 4_300_000 }],
  mesas_sin_cobrar: [],
  ...over,
});
const texto = (d: LiquidacionTicketData) => buildLiquidacionLines(d).map((l) => l.text);

describe("ticket de liquidación del mozo (spec 213)", () => {
  it("dice cuánto tiene que entregar y cómo sale el número", () => {
    const t = texto(base()).join("\n");
    expect(t).toContain("RENDICION DE MOZO");
    expect(t).toContain("Caja Principal");
    expect(t).toMatch(/Cobro en efectivo\s+177\.800,00/);
    expect(t).toMatch(/- Su propina de tarjeta\/QR\s+-2\.200,00/);
    expect(t).toMatch(/TIENE QUE ENTREGAR\s+175\.600,00/);
    expect(t).toMatch(/Entrego:\s+\$ _+/);
    expect(t).toMatch(/Tarjeta\s+43\.000,00/);
  });

  it("sin firmas y sin acentos", () => {
    const t = texto(base()).join("\n");
    expect(t).not.toMatch(/Firma/i);
    expect(t).not.toMatch(/[áéíóúñÁÉÍÓÚÑ]/);
    expect(t).toContain("Sofia Encargada");
  });

  it("por defecto sin el detalle de cobros; con el detalle cuando se pide", () => {
    expect(texto(base()).join("\n")).not.toContain("SUS COBROS EN EFECTIVO");
    const con = texto(
      base({ cobros: [{ label: "Mesa 108", at: "2026-10-07T13:45:00Z", efectivo_cents: 5_550_000, propina_efectivo_cents: 610_500 }] }),
    ).join("\n");
    expect(con).toContain("SUS COBROS EN EFECTIVO");
    expect(con).toMatch(/Mesa 108\s+10:45\s+55\.500,00/);
    expect(con).toContain("Propina en efectivo 6.105,00: ya la tiene");
  });

  it("si la caja le debe, lo dice y pide lo que recibió", () => {
    const t = texto(base({ efectivo_cents: 0, propina_tarjeta_cents: 100_000, saldo_cents: -100_000 })).join("\n");
    expect(t).toMatch(/LA CAJA LE DEBE DE PROPINA\s+1\.000,00/);
    expect(t).toMatch(/Recibio:/);
    expect(t).not.toContain("TIENE QUE ENTREGAR");
  });

  it("muestra lo que traía de antes, lo ya entregado y lo que le pagó la caja sólo si hay", () => {
    const sin = texto(base()).join("\n");
    expect(sin).not.toContain("Traia de antes");
    expect(sin).not.toContain("Ya entrego");
    const con = texto(base({ anterior_cents: 250_000, entregado_cents: 1_000_000, pagado_cents: 50_000 })).join("\n");
    expect(con).toMatch(/Traia de antes\s+2\.500,00/);
    expect(con).toMatch(/- Ya entrego\s+-10\.000,00/);
    expect(con).toMatch(/\+ La caja le pago de propina\s+500,00/);
  });

  it("avisa arriba si tiene mesas sin cobrar", () => {
    const t = texto(base({ mesas_sin_cobrar: ["4", "7"] }));
    expect(t.findIndex((l) => l.includes("OJO: tiene la mesa 4, la mesa 7 sin cobrar"))).toBeLessThan(
      t.findIndex((l) => l.includes("LA CUENTA")),
    );
  });

  it("la reimpresión sale marcada y ninguna línea pasa de 42 columnas", () => {
    const lines = texto(base({ reimpresion: true, cobros: [{ label: "Mesa 102", at: "2026-10-07T11:43:00Z", efectivo_cents: 3_150_000, propina_efectivo_cents: 0 }] }));
    expect(lines[0]).toBe("*** REIMPRESION ***");
    expect(lines.every((l) => l.length <= COLS_COND)).toBe(true);
    expect(buildLiquidacionContent(base()).escpos_b64.length).toBeGreaterThan(0);
  });
});
