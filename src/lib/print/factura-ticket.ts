// Render de la factura impresa — spec 084.
//
// El tercer papel de la familia (comanda de control → cuenta → factura), pero
// con una diferencia grande: **es un comprobante fiscal**. El contenido no se
// elige, lo manda la normativa, y los datos salen de `invoices` tal como los
// autorizó ARCA. Acá no se calcula nada: se transcribe.
//
// Se renderiza en vez de imprimir `invoices.pdf_url` porque una térmica ESC/POS
// no imprime PDFs — recibe bytes de texto y comandos.
//
// ⚠️ GAP CONOCIDO (issue #134): faltan tres datos del emisor que la normativa
// exige y que hoy no guardamos en ningún lado — ingresos brutos, inicio de
// actividades y domicilio comercial fiscal. Este ticket imprime todo lo que sí
// tenemos; NO es todavía un comprobante completo. No se resolvió acá porque son
// datos fiscales reales que hay que pedirle al cliente, y un placeholder en un
// comprobante es peor que no imprimirlo.

import { CONDICION_IVA_LABEL } from "@/lib/afip/condicion-iva";
import type {
  CondicionIvaReceptor,
  TipoComprobante,
} from "@/lib/afip/types";

import {
  COLS,
  renderEscPos,
  renderPlain,
  RULE,
  toAscii,
  wrap,
  type Line,
} from "./ticket";
import { formatFechaAR } from "@/lib/timezone";

export type FacturaTicketData = {
  print_job_id: string;
  /** Razón social del emisor. */
  business_name: string;
  business_address?: string | null;
  business_cuit?: string | null;
  tipo_comprobante: TipoComprobante;
  punto_venta: number;
  numero: number | null;
  emitted_at: string;
  cae?: string | null;
  cae_vencimiento?: string | null;
  cuit_receptor?: string | null;
  razon_social_receptor?: string | null;
  condicion_iva_receptor?: CondicionIvaReceptor | null;
  neto_cents: number;
  iva_cents: number;
  iva_rate: number;
  total_cents: number;
  /** URL del QR de ARCA (RG 4892). Sin esto el comprobante no es escaneable. */
  qr_url?: string | null;
  reprint?: boolean;
};

/**
 * Código de comprobante de ARCA. Va impreso porque es lo que identifica el tipo
 * ante el organismo — «FACTURA B» es la etiqueta legible, «006» es el código.
 */
const CODIGO_COMPROBANTE: Record<TipoComprobante, string> = {
  factura_a: "001",
  factura_b: "006",
  nota_credito_a: "003",
  nota_credito_b: "008",
};

const TIPO_TITULO: Record<TipoComprobante, string> = {
  factura_a: "FACTURA A",
  factura_b: "FACTURA B",
  nota_credito_a: "NOTA DE CREDITO A",
  nota_credito_b: "NOTA DE CREDITO B",
};

/** Las A discriminan IVA; las B lo llevan incluido en el total. */
function discriminaIva(tipo: TipoComprobante): boolean {
  return tipo === "factura_a" || tipo === "nota_credito_a";
}

function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/** "0003-00001234" — el formato de ARCA: 4 dígitos de PV, 8 de número. */
function comprobanteNumero(pv: number, numero: number | null): string {
  const n = numero == null ? "".padStart(8, "0") : String(numero).padStart(8, "0");
  return `${String(pv).padStart(4, "0")}-${n}`;
}

/** "04/08/2026" en el TZ del local. Una fecha fiscal no se muestra en UTC. */
// Fechas sin hora (`cae_vencimiento`, columna `date`) y timestamps: ver
// `formatFechaAR` — la versión anterior corría un día las primeras.
function fecha(iso: string): string {
  return formatFechaAR(iso);
}

function row(label: string, value: string, cols = COLS.sm): string {
  const l = toAscii(label);
  const v = toAscii(value);
  const gap = cols - l.length - v.length;
  if (gap >= 1) return l + " ".repeat(gap) + v;
  return l + "\n" + v.padStart(cols);
}

/** Arma el comprobante como líneas con formato. */
export function buildFacturaTicketLines(c: FacturaTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, opts: Omit<Line, "text"> = {}) => {
    for (const part of toAscii(text).split("\n")) L.push({ text: part, ...opts });
  };

  if (c.reprint) {
    // No es un comprobante nuevo: mismo número, mismo CAE. Que quede escrito
    // evita que alguien crea que se emitió dos veces.
    push("*** REIMPRESION ***", { bold: true, align: "center" });
    push("copia del mismo", { align: "center" });
    push("comprobante", { align: "center" });
    push(RULE);
  }

  // ── Emisor ────────────────────────────────────────────────────────────────
  push(String(c.business_name).toUpperCase(), { bold: true, align: "center" });
  if (c.business_cuit) push(`CUIT: ${c.business_cuit}`, { align: "center" });
  if (c.business_address)
    for (const l of wrap(c.business_address, COLS.sm)) push(l, { align: "center" });
  push(RULE);

  // ── Qué comprobante es ────────────────────────────────────────────────────
  push(TIPO_TITULO[c.tipo_comprobante], {
    size: "tall",
    bold: true,
    align: "center",
  });
  push(`Cod. ${CODIGO_COMPROBANTE[c.tipo_comprobante]}`, { align: "center" });
  push(comprobanteNumero(c.punto_venta, c.numero), {
    bold: true,
    align: "center",
  });
  push(row("Fecha:", fecha(c.emitted_at)));
  push(RULE);

  // ── Receptor ──────────────────────────────────────────────────────────────
  // En una B a consumidor final puede no haber datos; en ese caso se imprime
  // así, que es lo correcto.
  if (c.razon_social_receptor || c.cuit_receptor) {
    if (c.cuit_receptor) push(row("CUIT:", c.cuit_receptor));
    if (c.razon_social_receptor)
      for (const l of wrap(c.razon_social_receptor, COLS.sm)) push(l);
  } else {
    push("Consumidor Final");
  }
  if (c.condicion_iva_receptor) {
    for (const l of wrap(
      `Cond. IVA: ${CONDICION_IVA_LABEL[c.condicion_iva_receptor]}`,
      COLS.sm,
    ))
      push(l);
  }
  push(RULE);

  // ── Importes ──────────────────────────────────────────────────────────────
  if (discriminaIva(c.tipo_comprobante)) {
    push(row("Neto:", money(c.neto_cents)));
    push(row(`IVA ${c.iva_rate}%:`, money(c.iva_cents)));
  }
  push(row("TOTAL:", money(c.total_cents)), { size: "tall", bold: true });
  push(RULE);

  // ── Autorización de ARCA ──────────────────────────────────────────────────
  // Sin CAE el comprobante no vale, así que si falta se dice en vez de dejar
  // un renglón vacío que parezca un dato.
  push(row("CAE:", c.cae ?? "(sin CAE)"));
  if (c.cae_vencimiento) push(row("Vto CAE:", fecha(c.cae_vencimiento)));

  // ── QR de ARCA (RG 4892) ──────────────────────────────────────────────────
  // Como QR nativo de la impresora, no como URL en texto: tiene que ser
  // escaneable para cumplir.
  if (c.qr_url) {
    push(RULE);
    L.push({ text: c.qr_url, qr: c.qr_url, align: "center" });
  }

  return L;
}

/**
 * Contenido pre-renderizado para el agente relay (mismo contrato que los otros
 * dos tickets). El QR viaja como comandos ESC/POS dentro de estos bytes, así
 * que el agente instalado en el local no necesita ningún cambio.
 */
export function buildFacturaTicketContent(c: FacturaTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildFacturaTicketLines(c);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
