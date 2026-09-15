// Render del "control de pedido" — spec 063.
//
// El otro papel que sale al marchar un delivery o un retiro. La comanda de
// cocina va sin precios, partida por sector y sin cliente; ésta es al revés:
// el pedido entero, con plata y destino, para el que reparte. El horario de
// entrega no va: lo dice la nota «ENTREGAR x» de la comanda.
//
// Reusa los primitivos de `ticket.ts` (ASCII, wrap, ESC/POS, ancho de columna)
// para que los dos tickets salgan con el mismo espaciado en la misma térmica.
// Lo único propio es qué se imprime y con qué jerarquía.
//
// Referencia de formato: el «Control de Pedido» de MaxiRest del Restaurant del
// Golf, que es lo que el local viene usando.

import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";
import {
  COLS,
  COMPACT_SPACING,
  renderEscPos,
  renderPlain,
  RULE,
  TIMEZONE,
  toAscii,
  wrap,
  type Line,
} from "./ticket";

export type ControlTicketItem = {
  product_name: string;
  quantity: number;
  /** Precio de la línea (unitario × cantidad), en centavos. */
  line_total_cents: number;
  modifiers?: ReadonlyArray<string | null | undefined> | null;
  /**
   * ⚠️ NO IMPRIMIR — ver la nota igual en `CuentaTicketItem`. Es la aclaración
   * del mozo para la cocina, y este papel lo ve el cliente que retira. NO
   * confundir con `delivery_notes`, que es la nota del CLIENTE sobre la entrega
   * («tocar timbre») y ésa sí se imprime: la necesita el repartidor.
   */
  notes?: string | null;
};

export type ControlTicketData = {
  control_ticket_id: string;
  business_name: string;
  business_address?: string | null;
  business_phone?: string | null;
  /** `orders.daily_number`: el número del pedido del día, el mismo que canta
   * la comanda de cocina. Arranca en 1 cada jornada (corte 6 AM). */
  daily_number: number | string;
  delivery_type: "delivery" | "pickup";
  emitted_at: string;
  /**
   * `orders.scheduled_at` — la hora DEL PEDIDO: cuándo el cliente lo retira o
   * lo recibe. Vuelve al papel con la spec 127. Lo que la había sacado era que
   * la misma hora estuviera en los dos papeles y se contradijeran apenas el
   * encargado corregía una; ahora cada papel lleva la suya y son datos
   * distintos: la comanda dice para cuándo tiene que estar LISTO (`kitchen_at`)
   * y esto dice para cuándo se ENTREGA, que es lo que necesita el que reparte.
   */
  scheduled_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  /** El slug decide si el papel dice «Direccion» o «Lote» (#319). */
  business_slug?: string | null;
  delivery_address?: string | null;
  delivery_notes?: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  payment_method?: string | null;
  /** `orders.payment_status`. `paid` ⇒ el repartidor no cobra nada. */
  payment_status?: string | null;
  reprint?: boolean;
  items?: ControlTicketItem[] | null;
};

/** Centavos → "110500.00". Sin símbolo de moneda: la térmica es ASCII. */
function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * "28/07 19:16" en el TZ del local, hora de 24h.
 *
 * Se arma desde `formatToParts` y no desde `format`: con un skeleton de
 * día+mes, `es-AR` ignora el `2-digit` del mes y devuelve "28/7, 20:30". Las
 * partes sí respetan el ancho pedido, y de paso evitan el separador variable.
 */
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
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // `hour12:false` puede emitir "24" a medianoche en algunos entornos.
  const hh = pick("hour") === "24" ? "00" : pick("hour");
  return `${pick("day")}/${pick("month")} ${hh}:${pick("minute")}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Efectivo",
  mp: "Mercado Pago",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
};

/**
 * Alinea `label` a la izquierda y `value` a la derecha dentro del ancho útil.
 * Si no entran juntos, el valor se va al renglón de abajo pegado a la derecha
 * (mejor eso que una línea desbordada que la impresora parte donde quiere).
 */
function row(label: string, value: string, cols = COLS.sm): string {
  const l = toAscii(label);
  const v = toAscii(value);
  const gap = cols - l.length - v.length;
  if (gap >= 1) return l + " ".repeat(gap) + v;
  return l + "\n" + v.padStart(cols);
}

/** Arma el control de pedido como líneas con formato. */
export function buildControlTicketLines(c: ControlTicketData): Line[] {
  const L: Line[] = [];
  // El piso del ticket es doble alto (`tall`) y lo operativo sube a doble alto
  // + doble ancho (`xl`): el repartidor lo lee de parado, con el papel en la
  // mano y a contraluz. La excepción es la LISTA DE ÍTEMS, que baja a cuerpo
  // normal — ver el comentario donde se arma.
  const push = (text: string, opts: Omit<Line, "text"> = {}) => {
    // `row()` puede devolver dos renglones; los separamos para no mandar un
    // "\n" crudo dentro de una línea ESC/POS.
    for (const part of toAscii(text).split("\n"))
      L.push({ text: part, size: "tall", ...opts });
  };
  /** Aviso centrado en el tamaño más grande, cortado a `COLS.xl`. */
  const banner = (text: string, opts: Omit<Line, "text" | "size"> = {}) => {
    for (const l of wrap(text, COLS.xl))
      push(l, { size: "xl", bold: true, align: "center", ...opts });
  };

  const isDelivery = c.delivery_type === "delivery";

  if (c.reprint) {
    banner("REIMPRESION");
    push(RULE, { size: "sm" });
  }

  // ── Cabecera del negocio ──────────────────────────────────────────────────
  push(String(c.business_name).toUpperCase(), { bold: true, align: "center" });
  if (c.business_address)
    for (const l of wrap(c.business_address, COLS.sm))
      push(l, { align: "center" });
  if (c.business_phone) push(c.business_phone, { align: "center" });
  push(RULE, { size: "sm" });

  // ── Qué es y de qué pedido ────────────────────────────────────────────────
  push("Control de Pedido", { align: "center" });
  banner(`${isDelivery ? "DELIVERY" : "RETIRO"} #${c.daily_number}`);
  push(RULE, { size: "sm" });

  // ── Cuándo ────────────────────────────────────────────────────────────────
  // La hora del pedido primero y en grande: es el dato con el que trabaja el
  // que entrega. La de cocina no va acá — ésa es de la comanda (spec 127).
  if (c.scheduled_at) {
    const cuando = stamp(c.scheduled_at);
    if (cuando) push(`ENTREGAR: ${cuando}`, { size: "tall", bold: true });
  }
  push(`Emitido: ${stamp(c.emitted_at)}`);
  if (isDelivery) push("Repartidor: ____________");
  push(RULE, { size: "sm" });

  // ── Ítems con precio ──────────────────────────────────────────────────────
  // La lista es lo único que crece con el tamaño del pedido, así que es donde
  // se gana papel. Va en cuerpo normal Y con interlineado compacto: el `size`
  // solo NO ahorra nada — el avance del papel lo fija `ESC 3`, que se emite una
  // vez por documento en 64 pt para que el doble alto no se pise. Bajar el
  // tamaño sin bajar el interlineado deja la letra chica flotando en el mismo
  // renglón alto, que es peor legibilidad a cambio de cero.
  //
  // Lo operativo —destino, hora, A COBRAR, dirección— conserva tamaño y
  // espaciado: es lo que el repartidor lee de parado. Pedido de la encargada de
  // golf (2026-09-03): «el fin de semana que tenemos mesas muy grandes es como
  // desperdicio de papel».
  const compacto = { size: "sm", spacing: COMPACT_SPACING } as const;
  const items = c.items ?? [];
  for (const it of items) {
    for (const l of wrap(`${it.quantity}x ${it.product_name}`, COLS.sm))
      push(l, { ...compacto, bold: true });
    // Sin sangría: `wrap` corta por palabra y se come los espacios de la
    // izquierda, así que el prefijo tiene que ser un carácter visible.
    if (it.modifiers && it.modifiers.length)
      for (const l of wrap(`+ ${it.modifiers.join(", ")}`, COLS.sm))
        push(l, { ...compacto });
    // La nota del ítem NO va, por lo mismo que en la cuenta: es la aclaración
    // del mozo para la cocina, y este papel lo ve el cliente que retira.
    push(row("", money(it.line_total_cents)), { ...compacto });
  }
  if (items.length === 0) push("(sin items)");
  push(RULE, { size: "sm" });

  // ── Plata ─────────────────────────────────────────────────────────────────
  push(row("Subtotal:", money(c.subtotal_cents)));
  if (c.delivery_fee_cents > 0)
    push(row("Envio:", money(c.delivery_fee_cents)));
  if (c.discount_cents > 0)
    push(row("Descuento:", `-${money(c.discount_cents)}`));
  push(row("TOTAL:", money(c.total_cents)), { size: "tall", bold: true });
  push(RULE, { size: "sm" });

  // ── Lo que más importa: cuánto cobrar ─────────────────────────────────────
  // Cobrar de más o de menos es plata del local, así que el estado del pago va
  // en el tamaño más grande del ticket y sin ambigüedad.
  if (c.payment_status === "paid") {
    banner("PAGADO");
    banner("NO COBRAR");
  } else {
    // A doble ancho no entran etiqueta y monto en el mismo renglón: van uno
    // debajo del otro, centrados, que es como se lee de un vistazo.
    banner("A COBRAR:");
    banner(money(c.total_cents));
    if (c.payment_method)
      push(`Metodo: ${PAYMENT_LABELS[c.payment_method] ?? c.payment_method}`);
  }
  push(RULE, { size: "sm" });

  // ── A dónde y para quién ──────────────────────────────────────────────────
  if (c.customer_name)
    for (const l of wrap(`Cliente: ${c.customer_name}`, COLS.sm)) push(l);
  if (c.customer_phone) push(`Tel: ${c.customer_phone}`);
  if (isDelivery && c.delivery_address)
    for (const l of wrap(
      `${copyDeEntrega(c.business_slug ?? "").labelTicket}: ${c.delivery_address}`,
      COLS.sm,
    ))
      push(l, { bold: true });
  if (c.delivery_notes)
    for (const l of wrap(`Obs: ${c.delivery_notes}`, COLS.sm))
      push(l, { bold: true });

  push(RULE, { size: "sm" });
  push("DOCUMENTO NO VALIDO", { align: "center" });
  push("COMO FACTURA", { align: "center" });

  return L;
}

/**
 * Contenido pre-renderizado para el agente relay (spec 051, mismo contrato que
 * `buildComandaContent`): ESC/POS en base64 desde latin1 + texto plano.
 *
 * SEGURIDAD: como en `ticket.ts`, este módulo asume que los campos de texto de
 * origen externo (nombre del cliente, dirección, observaciones, nombres de
 * producto) ya vienen saneados de bytes de control por el caller
 * (`sanitizeTicketText` en el endpoint del print-agent).
 */
export function buildControlTicketContent(c: ControlTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildControlTicketLines(c);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
