// Render de la cuenta que se le da al cliente — spec 080.
//
// El papel de siempre: "¿me traés la cuenta?". Es lo que la mesa mira ANTES de
// pagar, para revisar que esté todo bien. No es la factura de ARCA — ese es el
// comprobante fiscal, se emite al cobrar y es otro papel; conviven.
//
// Comparte los primitivos de `ticket.ts` con la comanda de cocina y el control
// de pedido (spec 063), así que las tres salen con el mismo espaciado en la
// misma térmica.

import {
  COLS_80 as COLS,
  COMPACT_SPACING,
  itemConImporte,
  renderEscPos,
  renderPlain,
  RULE_80 as RULE,
  TIMEZONE,
  toAscii,
  wrap,
  type Line,
} from "./ticket";

export type CuentaTicketItem = {
  product_name: string;
  quantity: number;
  /** Precio de la línea (unitario × cantidad), en centavos. */
  line_total_cents: number;
  /**
   * ⚠️ NO IMPRIMIR. `order_items.notes` es la aclaración que el mozo le deja a
   * la COCINA («sin sal», «bien cocido», «para la señora del fondo»), y este
   * papel se lo lleva el cliente: ahí esas notas son ruido en el mejor caso y
   * una nota sobre él mismo en el peor. Salió del ticket el 2026-09-03, por
   * pedido de la encargada de golf. El campo se conserva sólo para que un
   * caller que todavía lo mande siga compilando; el renderer lo ignora.
   */
  notes?: string | null;
};

export type CuentaTicketData = {
  print_job_id: string;
  business_name: string;
  business_address?: string | null;
  business_phone?: string | null;
  table_label: string;
  floor_plan_name?: string | null;
  /** `orders.daily_number`: el número del pedido del día, el mismo que canta
   * la comanda de cocina. Arranca en 1 cada jornada (corte 6 AM). */
  daily_number: number | string;
  emitted_at: string;
  subtotal_cents: number;
  discount_cents: number;
  discount_reason?: string | null;
  tip_cents: number;
  total_cents: number;
  /** `orders.total_paid_cents`: lo que la mesa ya pagó (cobro parcial). */
  total_paid_cents: number;
  /** True desde la segunda impresión de la misma cuenta. */
  reprint?: boolean;
  items?: CuentaTicketItem[] | null;
};

/** Centavos → "110500.00". Sin símbolo de moneda: la térmica es ASCII. */
function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/** "28/07 21:40" en el TZ del local, 24h. Mismo formato que el control. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hh = pick("hour") === "24" ? "00" : pick("hour");
  return `${pick("day")}/${pick("month")} ${hh}:${pick("minute")}`;
}

/**
 * `label` a la izquierda y `value` a la derecha dentro del ancho útil. Si no
 * entran juntos, el valor baja de renglón pegado a la derecha — mejor eso que
 * una línea desbordada que la impresora parte donde quiera.
 */
function row(label: string, value: string, cols = COLS.sm): string {
  const l = toAscii(label);
  const v = toAscii(value);
  const gap = cols - l.length - v.length;
  if (gap >= 1) return l + " ".repeat(gap) + v;
  return l + "\n" + v.padStart(cols);
}

/** Arma la cuenta como líneas con formato. */
export function buildCuentaTicketLines(c: CuentaTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, opts: Omit<Line, "text"> = {}) => {
    for (const part of toAscii(text).split("\n"))
      L.push({ text: part, ...opts });
  };

  if (c.reprint) {
    push("*** REIMPRESION ***", { bold: true, align: "center" });
    push(RULE);
  }

  // ── Cabecera del negocio ──────────────────────────────────────────────────
  push(String(c.business_name).toUpperCase(), { bold: true, align: "center" });
  if (c.business_address)
    for (const l of wrap(c.business_address, COLS.sm))
      push(l, { align: "center" });
  if (c.business_phone) push(c.business_phone, { align: "center" });
  push(RULE);

  // ── De qué mesa ───────────────────────────────────────────────────────────
  push("CUENTA", { align: "center" });
  push(`MESA ${c.table_label}`, { size: "tall", bold: true, align: "center" });
  if (c.floor_plan_name) push(c.floor_plan_name, { align: "center" });
  push(row(`Pedido #${c.daily_number}`, stamp(c.emitted_at)));
  push(RULE);

  // ── Lo consumido ──────────────────────────────────────────────────────────
  // Spec 200: importe en el mismo renglón e interlineado compacto — la cuenta
  // no tiene doble alto en la lista, así que los 64 pt eran aire puro.
  const items = c.items ?? [];
  for (const it of items) {
    for (const l of itemConImporte(
      `${it.quantity}x ${it.product_name}`,
      money(it.line_total_cents),
      COLS.sm,
    ))
      push(l, { bold: true, spacing: COMPACT_SPACING });
    // La nota del ítem NO va: `order_items.notes` es lo que el mozo escribe
    // PARA LA COCINA («sin sal», «bien cocido», «para la señora del fondo»).
    // Este papel se lo lleva el cliente, y ahí esas aclaraciones son ruido en
    // el mejor caso y una nota sobre él mismo en el peor. Va en la comanda,
    // que es para quien cocina. Pedido de la encargada de golf (2026-09-03).
  }
  if (items.length === 0) push("(sin consumo)");
  push(RULE);

  // ── La plata ──────────────────────────────────────────────────────────────
  // Spec 200: sin descuento ni propina, el subtotal es el total repetido.
  if (c.discount_cents > 0 || c.tip_cents > 0)
    push(row("Subtotal:", money(c.subtotal_cents)));
  if (c.discount_cents > 0) {
    push(row("Descuento:", `-${money(c.discount_cents)}`));
    // El motivo del descuento va en el papel: si el cliente pregunta por qué el
    // número no es el de la carta, la respuesta está impresa.
    if (c.discount_reason)
      for (const l of wrap(`(${c.discount_reason})`, COLS.sm)) push(l);
  }
  if (c.tip_cents > 0) push(row("Propina:", money(c.tip_cents)));
  push(row("TOTAL:", money(c.total_cents)), { size: "tall", bold: true });

  // ── Cobro parcial ─────────────────────────────────────────────────────────
  // Si alguien de la mesa ya puso plata, lo que importa es cuánto FALTA.
  if (c.total_paid_cents > 0) {
    push(RULE);
    push(row("Pagado:", money(c.total_paid_cents)));
    push(
      row("RESTA:", money(Math.max(0, c.total_cents - c.total_paid_cents))),
      { size: "tall", bold: true },
    );
  }

  push(RULE);
  // Centradas y ya cortadas a mano: `wrap` no alinea, y una línea más larga que
  // el ancho útil la parte la impresora donde le pinta.
  if (c.tip_cents === 0) {
    push("La propina no esta incluida", { align: "center" });
  }
  push("DOCUMENTO NO VALIDO COMO FACTURA", { align: "center" });
  push("Gracias!", { align: "center" });

  return L;
}

/**
 * Contenido pre-renderizado para el agente relay (mismo contrato que
 * `buildComandaContent` / `buildControlTicketContent`).
 *
 * SEGURIDAD: asume que los textos de origen externo (nombres de producto,
 * notas, motivo del descuento) ya vienen saneados de bytes de control por el
 * caller (`sanitizeTicketText` en el endpoint del print-agent).
 */
export function buildCuentaTicketContent(c: CuentaTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildCuentaTicketLines(c);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
