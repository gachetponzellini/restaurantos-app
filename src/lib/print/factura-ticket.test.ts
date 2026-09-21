import { describe, expect, it } from "vitest";

import {
  buildFacturaTicketContent,
  buildFacturaTicketLines,
  type FacturaTicketData,
} from "./factura-ticket";

// Spec 084 — el comprobante fiscal impreso. A diferencia de los otros dos
// tickets, acá el contenido no se elige: lo manda la normativa y los datos
// vienen de `invoices` tal como los autorizó ARCA.

function base(over: Partial<FacturaTicketData> = {}): FacturaTicketData {
  return {
    print_job_id: "pj1",
    business_name: "Restaurant del Golf",
    business_address: "Bv. Wilde y Eva Perón",
    business_cuit: "30-12345678-9",
    tipo_comprobante: "factura_b",
    punto_venta: 3,
    numero: 1234,
    emitted_at: "2026-08-04T18:30:00-03:00",
    cae: "75123456789012",
    cae_vencimiento: "2026-08-14T00:00:00-03:00",
    cuit_receptor: null,
    razon_social_receptor: null,
    condicion_iva_receptor: null,
    neto_cents: 9090909,
    iva_cents: 1909091,
    iva_rate: 21,
    total_cents: 11000000,
    qr_url: "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoi",
    ...over,
  };
}

function text(data: FacturaTicketData): string {
  return buildFacturaTicketLines(data)
    .map((l) => l.text)
    .join("\n");
}

describe("buildFacturaTicketLines", () => {
  it("identifica el comprobante: tipo, código de ARCA y número", () => {
    const t = text(base());
    expect(t).toContain("FACTURA B");
    // El código es lo que identifica el tipo ante el organismo.
    expect(t).toContain("Cod. 006");
    // Formato de ARCA: 4 dígitos de punto de venta, 8 de número.
    expect(t).toContain("0003-00001234");
    expect(t).toContain("04/08/2026");
  });

  it("una A discrimina IVA; una B no", () => {
    const b = text(base());
    expect(b).not.toContain("Neto:");
    expect(b).not.toContain("IVA 21%:");

    const a = text(base({ tipo_comprobante: "factura_a" }));
    expect(a).toContain("FACTURA A");
    expect(a).toContain("Cod. 001");
    expect(a).toContain("Neto:");
    expect(a).toContain("90909.09");
    expect(a).toContain("IVA 21%:");
    expect(a).toContain("19090.91");
  });

  it("lleva el CAE y su vencimiento", () => {
    const t = text(base());
    expect(t).toContain("CAE:");
    expect(t).toContain("75123456789012");
    expect(t).toContain("Vto CAE:");
    expect(t).toContain("14/08/2026");
  });

  it("el vencimiento del CAE es el día que dice ARCA, no el anterior (columna date)", () => {
    // `invoices.cae_vencimiento` es `date`: llega "YYYY-MM-DD", sin hora.
    const t = text(base({ cae_vencimiento: "2026-09-26" } as Partial<FacturaTicketData>));
    expect(t).toContain("26/09/2026");
    expect(t).not.toContain("25/09/2026");
  });

  it("sin CAE lo dice en vez de dejar un renglón que parezca un dato", () => {
    expect(text(base({ cae: null }))).toContain("(sin CAE)");
  });

  it("el receptor sale cuando lo hay; si no, «Consumidor Final»", () => {
    expect(text(base())).toContain("Consumidor Final");

    const t = text(
      base({
        cuit_receptor: "20-11111111-2",
        razon_social_receptor: "Acme SA",
        condicion_iva_receptor: 1,
      }),
    );
    expect(t).toContain("20-11111111-2");
    expect(t).toContain("Acme SA");
    expect(t).toContain("Cond. IVA:");
    expect(t).not.toContain("Consumidor Final");
  });

  it("el QR va como línea de tipo qr, no como texto suelto", () => {
    // Si sale como texto, el comprobante no cumple: el QR de ARCA tiene que ser
    // escaneable (RG 4892).
    const qr = buildFacturaTicketLines(base()).find((l) => l.qr);
    expect(qr?.qr).toBe(base().qr_url);
    expect(qr?.align).toBe("center");
  });

  it("una reimpresión aclara que es copia del MISMO comprobante", () => {
    // Nadie tiene que poder creer que se emitió dos veces: mismo número, mismo
    // CAE.
    const t = text(base({ reprint: true }));
    expect(t).toContain("REIMPRESION");
    expect(t).toContain("copia del mismo");
    expect(t).toContain("0003-00001234");
    expect(t).toContain("75123456789012");
  });

  it("el emisor sale con razón social y CUIT", () => {
    const t = text(base());
    expect(t).toContain("RESTAURANT DEL GOLF");
    expect(t).toContain("CUIT: 30-12345678-9");
  });

  it("las notas de crédito usan su título y su código", () => {
    expect(text(base({ tipo_comprobante: "nota_credito_b" }))).toContain(
      "NOTA DE CREDITO B",
    );
    expect(text(base({ tipo_comprobante: "nota_credito_a" }))).toContain(
      "Cod. 003",
    );
  });
});

describe("buildFacturaTicketContent · bytes del QR", () => {
  it("el stream ESC/POS lleva los comandos nativos de QR con la URL", () => {
    const { escpos_b64 } = buildFacturaTicketContent(base());
    const raw = Buffer.from(escpos_b64, "base64").toString("latin1");

    // `GS ( k` con fn 80 ('P') = almacenar datos del símbolo.
    expect(raw).toContain("\x1d(k");
    expect(raw).toContain("1P0" + base().qr_url);
    // fn 81 ('Q') = imprimirlo. Sin esto se carga el QR y no sale nada.
    expect(raw).toContain("1Q0");
  });

  it("el largo del bloque de datos es el del payload + 3 (little-endian)", () => {
    // Es el bug clásico de ESC/POS: si pL/pH no cuadran, la impresora se come
    // parte del stream y sale basura.
    const url = "https://x/y";
    const { escpos_b64 } = buildFacturaTicketContent(base({ qr_url: url }));
    const raw = Buffer.from(escpos_b64, "base64").toString("latin1");
    const at = raw.indexOf("1P0" + url);
    const pL = raw.charCodeAt(at - 2);
    const pH = raw.charCodeAt(at - 1);
    expect(pL + pH * 256).toBe(url.length + 3);
  });

  it("sin qr_url no se emite ninguna secuencia de QR", () => {
    const { escpos_b64 } = buildFacturaTicketContent(base({ qr_url: null }));
    const raw = Buffer.from(escpos_b64, "base64").toString("latin1");
    expect(raw).not.toContain("\x1d(k");
  });

  it("en texto plano el QR cae a su URL (no se pierde el dato)", () => {
    const { plain } = buildFacturaTicketContent(base());
    expect(plain).toContain(base().qr_url);
  });
});
