import { fila, hora, monto } from "./cierre-ticket";
import { COLS_COND, RULE_COND, renderEscPos, renderPlain, toAscii, type Line } from "./ticket";

// ════════════════════════════════════════════════════════════════════════
// La liquidación del mozo (spec 213, #386): el papel que sale al tocar «Rendir»,
// ANTES de cargar lo que entrega. Dice cuánto tiene que entregar y cómo sale el
// número —la misma cuenta que el modal y que «Tu turno» del mozo—, con una
// línea para anotar a mano lo que entregó. Sin firmas (D4), sin acentos (D5:
// `toAscii`, la comandera imprime ASCII) y, por defecto, sin el detalle de
// cada cobro (D3).
//
// Se arma de la FOTO guardada en `print_jobs.payload` al pedirla: una
// reimpresión saca lo mismo que vio la encargada en ese momento.
// ════════════════════════════════════════════════════════════════════════

export type LiquidacionCobro = { label: string; at: string; efectivo_cents: number; propina_efectivo_cents: number };

export type LiquidacionTicketData = {
  negocio_name: string;
  mozo_name: string;
  caja_name: string;
  /** Desde cuándo corre el turno (las cifras de la cuenta son de esa ventana). */
  turno_desde: string | null;
  impreso_at: string;
  impreso_por: string | null;
  anterior_cents: number;
  efectivo_cents: number;
  propina_tarjeta_cents: number;
  entregado_cents: number;
  pagado_cents: number;
  /** Lo que tiene que entregar ahora. Negativo: la caja le debe. */
  saldo_cents: number;
  /** Lo que cobró por posnet/MP: no se rinde, va como referencia. */
  no_se_rinden: { label: string; cents: number }[];
  mesas_sin_cobrar: string[];
  /** Sólo si se pidió con el detalle (D3). */
  cobros?: LiquidacionCobro[];
  reimpresion?: boolean;
};

const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));

export function buildLiquidacionLines(d: LiquidacionTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, extra: Partial<Line> = {}) => L.push({ text: toAscii(text), ...extra });
  const DOBLE = "=".repeat(COLS_COND);

  if (d.reimpresion) push("*** REIMPRESION ***", { align: "center", bold: true });
  push("RENDICION DE MOZO", { align: "center", bold: true });
  push(d.negocio_name.slice(0, COLS_COND), { align: "center" });
  push(RULE_COND);
  push(fila("Mozo:", toAscii(d.mozo_name)));
  push(fila("Caja:", toAscii(d.caja_name)));
  if (d.turno_desde) push(fila("Turno desde:", `${fecha(d.turno_desde)} ${hora(d.turno_desde)}`));
  push(fila("Impreso:", `${fecha(d.impreso_at)} ${hora(d.impreso_at)}${d.impreso_por ? ` ${toAscii(d.impreso_por)}` : ""}`.trim()));
  push(RULE_COND);

  if (d.mesas_sin_cobrar.length > 0) {
    const mesas = d.mesas_sin_cobrar.map((m) => `la mesa ${m}`).join(", ");
    push(`OJO: tiene ${mesas} sin cobrar`, { bold: true });
    push(RULE_COND);
  }

  if (d.cobros && d.cobros.length > 0) {
    push("SUS COBROS EN EFECTIVO", { bold: true });
    for (const c of d.cobros) {
      push(fila(`${toAscii(c.label)}  ${hora(c.at)}`, monto(c.efectivo_cents)));
      if (c.propina_efectivo_cents > 0) push(`  Propina en efectivo ${monto(c.propina_efectivo_cents)}: ya la tiene`);
    }
    push(RULE_COND);
  }

  push("LA CUENTA", { bold: true });
  if (d.anterior_cents !== 0) push(fila("Traia de antes", monto(d.anterior_cents)));
  push(fila("Cobro en efectivo", monto(d.efectivo_cents)));
  if (d.propina_tarjeta_cents > 0) push(fila("- Su propina de tarjeta/QR", `-${monto(d.propina_tarjeta_cents)}`));
  if (d.entregado_cents > 0) push(fila("- Ya entrego", `-${monto(d.entregado_cents)}`));
  if (d.pagado_cents > 0) push(fila("+ La caja le pago de propina", monto(d.pagado_cents)));
  push(DOBLE);
  if (d.saldo_cents < 0) {
    push(fila("LA CAJA LE DEBE DE PROPINA", monto(-d.saldo_cents)), { bold: true });
  } else {
    push(fila("TIENE QUE ENTREGAR", monto(d.saldo_cents)), { bold: true });
  }
  push(DOBLE);

  const otros = d.no_se_rinden.filter((x) => x.cents > 0);
  if (otros.length > 0) {
    push("No se rinden (posnet/MP):");
    for (const o of otros) push(fila(toAscii(o.label), monto(o.cents)));
  }
  push("");
  push(fila(d.saldo_cents < 0 ? "Recibio:" : "Entrego:", "$ ___________________"));
  push("");
  return L;
}

export function buildLiquidacionContent(d: LiquidacionTicketData): { escpos_b64: string; plain: string } {
  const lines = buildLiquidacionLines(d);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines, "cierre"), "binary").toString("base64"),
    plain: renderPlain(lines),
  };
}
