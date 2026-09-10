import { COLS_COND, RULE_COND, renderEscPos, renderPlain, type Line } from "./ticket";

// ════════════════════════════════════════════════════════════════════════
// El papel del cierre de caja (spec 139 · Parte B).
//
// Copia el LAYOUT del cierre de MaxiRest que usa golf hoy — la foto que mandó
// Juan el 2026-09-03 — en Font B a 42 columnas, misma comandera y mismo papel.
//
// Lo que la foto fija: los bloques, su orden y sus rótulos. Lo que NO fija:
// cómo se ven las filas con datos (el turno fotografiado está vacío) ni la
// mitad de abajo (el papel está cortado después de «RESUMEN»). Eso se resuelve
// acá con nuestro modelo y queda marcado para corregir con una segunda foto.
//
// Todo se arma desde el SNAPSHOT congelado (`caja_cortes.resumen`), no de la
// base viva: el papel dice lo que el encargado vio al cerrar, y una corrección
// posterior (spec 070) no lo puede mover.
// ════════════════════════════════════════════════════════════════════════

export type CierreLinea = { detalle: string; total_cents: number; cant?: number };

export type CierreTicketData = {
  /** Cabecera. Lo que no tenemos se omite en vez de inventarse. */
  negocio: {
    name: string;
    /** ⚠️ No está en `businesses` (issue #134). */
    razon_social?: string | null;
    address?: string | null;
    /** ⚠️ No está en `businesses` (issue #134). */
    sucursal?: string | null;
    /** ⚠️ La condición de IVA no está en `businesses` (issue #134). */
    condicion_iva?: string | null;
    cuit?: string | null;
  };
  caja_name: string;
  /** Correlativo por negocio. `null` en cortes anteriores a la spec. */
  numero: number | null;
  /** ISO. Arranque del turno que este cierre cerró. */
  apertura: string;
  /** ISO. El corte. */
  cierre: string;
  encargado_name: string | null;
  movimientos: { ingresos: CierreLinea[]; egresos: CierreLinea[] };
  ventas_por_origen: CierreLinea[];
  ventas_por_metodo: CierreLinea[];
  resumen: {
    apertura_cents: number;
    efectivo_cents: number;
    ingresos_cents: number;
    sangrias_cents: number;
    /** Lo que salió del cajón para pagarle la propina a los mozos (spec 177). */
    propinas_pagadas_cents: number;
    esperado_cents: number;
    contado_cents: number;
    diferencia_cents: number;
    propinas_cents: number;
  };
  notas?: string | null;
  /** Sale marcado, igual que la cuenta (080) y la factura (084). */
  reimpresion?: boolean;
};

const TZ = "America/Argentina/Buenos_Aires";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DIAS = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
];

/** «Jueves 3 de Septiembre de 2026», como el papel de MaxiRest. */
export function fechaLarga(iso: string, timeZone = TZ): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const d = new Date(
    `${get("year")}-${get("month").padStart(2, "0")}-${get("day").padStart(2, "0")}T12:00:00Z`,
  );
  return `${DIAS[d.getUTCDay()]} ${Number(get("day"))} de ${MESES[Number(get("month")) - 1]} de ${get("year")}`;
}

function hora(iso: string, timeZone = TZ): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Monto sin el símbolo, como el papel: `1.284.500,00`.
 *
 * Con decimales a propósito aunque los montos sean redondos — es lo que
 * muestra el ticket de MaxiRest (`0.00`) y lo que la gente del local espera
 * ver en la columna.
 */
export function monto(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const entero = Math.floor(abs / 100).toLocaleString("es-AR");
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${entero},${dec}`;
}

/** `izq ............ der`, ajustado al ancho condensado. */
function fila(izq: string, der: string, ancho = COLS_COND): string {
  const espacio = ancho - der.length;
  const texto = izq.length > espacio - 1 ? izq.slice(0, Math.max(0, espacio - 2)) : izq;
  return texto.padEnd(Math.max(0, espacio), " ") + der;
}

/** `detalle ....... total  cant` — las dos columnas de la derecha del papel. */
function filaCant(detalle: string, total: string, cant: string): string {
  const der = `${total.padStart(14)}${cant.padStart(7)}`;
  return fila(detalle, der);
}

export function buildCierreLines(d: CierreTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, extra: Partial<Line> = {}) => L.push({ text, ...extra });

  if (d.reimpresion) {
    push("*** REIMPRESION ***", { align: "center", bold: true });
    push("");
  }

  // ── Cabecera ──────────────────────────────────────────────────
  push(d.negocio.name, { align: "center", bold: true });
  // Lo que falta se omite: un dato fiscal inventado en un papel que se archiva
  // es peor que una línea menos (issue #134).
  if (d.negocio.razon_social) push(d.negocio.razon_social, { align: "center" });
  push("");
  if (d.negocio.address) push(d.negocio.address);
  if (d.negocio.sucursal) push(`Sucursal: ${d.negocio.sucursal}`);
  const fiscal = [
    d.negocio.condicion_iva ? `IVA: ${d.negocio.condicion_iva}` : null,
    d.negocio.cuit ? `CUIT: ${d.negocio.cuit}` : null,
  ].filter(Boolean);
  if (fiscal.length > 0) push(fiscal.join("  "));
  push("");

  // ── Identificación del cierre ─────────────────────────────────
  push("TOTALES DEL DIA:", { bold: true });
  push(fechaLarga(d.cierre));
  push("");
  // MaxiRest pone acá «Turno 1 (MEDIODIA)». Nosotros no tenemos turnos —caja
  // continua con cortes, decisión vieja del producto— así que va la caja, que
  // es la unidad real de nuestro cierre.
  push(`Caja: ${d.caja_name}`);
  push("");
  if (d.numero != null) push(`Cierre nº ${d.numero}.`);
  const quien = d.encargado_name ?? "—";
  push(`Apertura: ${hora(d.apertura)} - Usuario: ${quien}`);
  push(`  Cierre: ${hora(d.cierre)} - Usuario: ${quien}`);
  push("");

  // ── Movimientos de caja ───────────────────────────────────────
  push("MOVIMIENTOS DE CAJA", { bold: true });
  push(RULE_COND);
  push(fila("Detalle", "Total"));
  push(RULE_COND);
  push("");
  push("INGRESOS");
  if (d.movimientos.ingresos.length === 0) push("  (sin movimientos)");
  for (const m of d.movimientos.ingresos) push(fila(`  ${m.detalle}`, monto(m.total_cents)));
  push("");
  push("EGRESOS");
  if (d.movimientos.egresos.length === 0) push("  (sin movimientos)");
  for (const m of d.movimientos.egresos) push(fila(`  ${m.detalle}`, monto(m.total_cents)));
  push("");

  // ── Resumen de ventas ─────────────────────────────────────────
  //
  // ⚠️ En MaxiRest la columna «Detalle» de este bloque no se pudo leer: el
  // turno de la foto está vacío. Acá va **por origen** (salón / delivery / take
  // away), que es el desglose que tenemos y el que el encargado ya ve en la
  // pantalla de caja. Si la segunda foto muestra rubros o productos, cambia
  // este bloque y nada más.
  push("RESUMEN DE VENTAS", { bold: true });
  push(RULE_COND);
  push(filaCant("Detalle", "Total", "Cant"));
  push(RULE_COND);
  for (const v of d.ventas_por_origen) {
    push(filaCant(v.detalle, monto(v.total_cents), String(v.cant ?? 0)));
  }
  push(filaCant(
    "TOTAL",
    monto(d.ventas_por_origen.reduce((a, v) => a + v.total_cents, 0)),
    String(d.ventas_por_origen.reduce((a, v) => a + (v.cant ?? 0), 0)),
  ));
  push("");

  // ── Ventas por forma de cobro ─────────────────────────────────
  push("VENTAS POR FORMA DE COBRO", { bold: true });
  push(RULE_COND);
  push(filaCant("Forma de cobro", "Total", "Cant"));
  push(RULE_COND);
  for (const v of d.ventas_por_metodo) {
    push(filaCant(v.detalle, monto(v.total_cents), String(v.cant ?? 0)));
  }
  push(filaCant(
    "TOTAL",
    monto(d.ventas_por_metodo.reduce((a, v) => a + v.total_cents, 0)),
    String(d.ventas_por_metodo.reduce((a, v) => a + (v.cant ?? 0), 0)),
  ));
  push("");

  // ── Resumen (el arqueo) ───────────────────────────────────────
  //
  // El bloque «RESUMEN» quedó cortado en la foto. Va la cuenta del efectivo
  // esperado —la misma que la pantalla del cierre muestra desglosada— porque es
  // lo que justifica la diferencia, que es el número por el que alguien firma.
  const r = d.resumen;
  push("RESUMEN", { bold: true });
  push(RULE_COND);
  push(fila("Apertura", monto(r.apertura_cents)));
  push(fila("+ Efectivo cobrado", monto(r.efectivo_cents)));
  push(fila("+ Ingresos", monto(r.ingresos_cents)));
  push(fila("- Sangrias", monto(r.sangrias_cents)));
  // Spec 177 — la propina sale del cajón, así que entra en la cuenta del
  // esperado. Es el renglón que explicaba el faltante de todas las noches.
  if (r.propinas_pagadas_cents > 0) {
    push(fila("- Propinas pagadas", monto(r.propinas_pagadas_cents)));
  }
  push(RULE_COND);
  push(fila("EFECTIVO ESPERADO", monto(r.esperado_cents)), { bold: true });
  push(fila("CONTADO", monto(r.contado_cents)), { bold: true });
  push(fila("DIFERENCIA", monto(r.diferencia_cents)), { bold: true });
  push(RULE_COND);
  // Lo devengado del período, para contrastarlo con lo que se pagó arriba: si
  // no coinciden, quedó propina sin liquidar (spec 177).
  push(fila("Propinas del periodo", monto(r.propinas_cents)));

  if (d.notas) {
    push("");
    push("OBSERVACIONES", { bold: true });
    for (const linea of wrapCond(d.notas)) push(linea);
  }

  push("");
  push("");
  push(fila("Firma:", "".padEnd(20, "_")));

  return L;
}

/** Corta por palabra al ancho condensado. */
function wrapCond(texto: string): string[] {
  const out: string[] = [];
  let linea = "";
  for (const palabra of texto.split(/\s+/)) {
    if (linea.length === 0) linea = palabra;
    else if (linea.length + 1 + palabra.length <= COLS_COND) linea += ` ${palabra}`;
    else {
      out.push(linea);
      linea = palabra;
    }
  }
  if (linea) out.push(linea);
  return out;
}

export function buildCierreContent(d: CierreTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildCierreLines(d);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines, "cierre"), "binary").toString("base64"),
    plain: renderPlain(lines),
  };
}
