import { fila, hora, monto, wrapCond } from "./cierre-ticket";
import {
  COLS_COND,
  RULE_COND,
  renderEscPos,
  renderPlain,
  toAscii,
  type Line,
} from "./ticket";

// ════════════════════════════════════════════════════════════════════════
// El papel de la rendición de un mozo (spec 178).
//
// La hermana chica del cierre (139): misma comandera, mismo papel, misma letra
// condensada a 42 columnas, mismo criterio — se arma del SNAPSHOT de la
// rendición (`mozo_rendiciones` ya lo es) y no de la base viva. Es lo que el
// mozo firma cuando entrega, y desde la 177 también la constancia de que
// recibió su propina.
//
// Todo el texto pasa por `toAscii` ACÁ y no en el render: la térmica sólo
// imprime ASCII, y un nombre con tilde que llega crudo al ESC/POS sale como un
// carácter cualquiera de la página de códigos.
// ════════════════════════════════════════════════════════════════════════

export type RendicionTicketData = {
  negocio_name: string;
  mozo_name: string;
  registrado_por: string | null;
  /** ISO. Cuándo se registró. */
  fecha: string;
  estado: "rendida" | "no_entrego";
  /** Lo cobrado en el período, neto de propina, por método. */
  por_metodo: Partial<Record<string, number>>;
  /** Spec 203 — efectivo por canal. `{}` en las rendiciones viejas. */
  por_canal?: Partial<
    Record<
      "salon" | "takeaway" | "delivery",
      { esperado_cents: number; entregado_cents: number; diferencia_cents: number }
    >
  >;
  expected_cash_cents: number;
  delivered_cash_cents: number;
  difference_cents: number;
  /** Lo que se le pagó de propina en esta rendición (spec 177). */
  propina_pagada_cents: number;
  notes: string | null;
  reimpresion?: boolean;
};

/** Cómo se nombra cada método en el papel. El orden es el de la lista. */
const METODOS: Array<[string, string]> = [
  ["cash", "Efectivo"],
  ["card_manual", "Tarjeta"],
  ["mp_qr", "QR"],
  ["mp_link", "Link de pago"],
  ["transfer", "Transferencia"],
  ["mp_manual", "Mercado Pago"],
  ["cuenta_corriente", "Cuenta corriente"],
  ["other", "Otro"],
];

/** `dd/mm/aaaa · HH:MM` en hora del local. */
function fechaCorta(iso: string): string {
  const d = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
  return `${d} · ${hora(iso)}`;
}

/** La diferencia con signo: el sobrante se lee tan rápido como el faltante. */
function diferencia(cents: number): string {
  return cents > 0 ? `+${monto(cents)}` : monto(cents);
}

export function buildRendicionLines(d: RendicionTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, extra: Partial<Line> = {}) =>
    L.push({ text: toAscii(text), ...extra });

  if (d.reimpresion) {
    push("*** REIMPRESION ***", { align: "center", bold: true });
  }
  push("RENDICION DE TURNO", { align: "center", bold: true });
  push(d.negocio_name.slice(0, COLS_COND), { align: "center" });
  push(RULE_COND);

  push(fila("Mozo:", toAscii(d.mozo_name)));
  push(fila("Fecha:", fechaCorta(d.fecha)));
  if (d.registrado_por) push(fila("Registro:", toAscii(d.registrado_por)));
  push(RULE_COND);

  // ── Lo cobrado, por método ─────────────────────────────────────────────
  // Sólo los que tienen plata: un renglón en 0,00 por cada método que el
  // negocio ofrece es ruido en un papel de 42 columnas.
  push("COBRADO EN EL TURNO", { bold: true });
  let total = 0;
  for (const [key, label] of METODOS) {
    const cents = d.por_metodo[key] ?? 0;
    if (cents <= 0) continue;
    total += cents;
    push(fila(label, monto(cents)));
  }
  push(fila("TOTAL", monto(total)), { bold: true });
  push(RULE_COND);

  // ── El efectivo, que es lo único que se rinde (spec 151) ───────────────
  if (d.estado === "no_entrego") {
    // D6 — la deuda declarada es justamente el caso donde más sirve el papel.
    push("*** NO ENTREGO ***", { align: "center", bold: true });
    push(fila("Debia entregar", monto(d.expected_cash_cents)));
    push(fila("Queda como deuda", monto(d.expected_cash_cents)), { bold: true });
  } else {
    push("EFECTIVO", { bold: true });
    push(fila("Debia entregar", monto(d.expected_cash_cents)));
    push(fila("Entrego", monto(d.delivered_cash_cents)));
    push(fila("DIFERENCIA", diferencia(d.difference_cents)), { bold: true });
  }

  // ── Spec 203 — el efectivo por canal ───────────────────────────────────
  // Sólo si hay algo que partir: una rendición de salón pura queda como antes.
  const canales = (["salon", "takeaway", "delivery"] as const).filter(
    (c) => d.por_canal?.[c],
  );
  if (canales.length > 1 || (canales.length === 1 && canales[0] !== "salon")) {
    const LABEL = { salon: "SALON", takeaway: "TAKEAWAY", delivery: "DELIVERY" };
    for (const c of canales) {
      const x = d.por_canal![c]!;
      push(LABEL[c], { bold: true });
      push(fila("  Debia entregar", monto(x.esperado_cents)));
      if (d.estado !== "no_entrego") {
        push(fila("  Entrego", monto(x.entregado_cents)));
        push(fila("  Diferencia", diferencia(x.diferencia_cents)));
      }
    }
  }
  push(RULE_COND);

  // ── La propina que se le pagó (spec 177) ───────────────────────────────
  if (d.propina_pagada_cents > 0) {
    push(fila("Propina pagada", monto(d.propina_pagada_cents)));
    push(RULE_COND);
  }

  if (d.notes?.trim()) {
    push("OBSERVACIONES", { bold: true });
    // `wrapCond` corta por palabra; una «palabra» más larga que el papel (un
    // pegote sin espacios) pasaría entera, así que se corta a lo bruto después.
    for (const linea of wrapCond(toAscii(d.notes.trim()))) {
      for (let i = 0; i < linea.length; i += COLS_COND) {
        push(linea.slice(i, i + COLS_COND));
      }
    }
    push(RULE_COND);
  }

  push("");
  push("");
  push(fila("Firma mozo:", "".padEnd(20, "_")));
  push("");
  push("");
  push(fila("Firma encargado:", "".padEnd(20, "_")));

  return L;
}

export function buildRendicionContent(d: RendicionTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildRendicionLines(d);
  return {
    // Perfil «cierre» = Font B condensada: es el mismo papel del mostrador.
    escpos_b64: Buffer.from(renderEscPos(lines, "cierre"), "binary").toString("base64"),
    plain: renderPlain(lines),
  };
}
