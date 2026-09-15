import type { DOCUMENT_TYPES } from "./schema";

/**
 * El IVA del comprobante de compra — spec 188.
 *
 * Todo acá es puro y se testea sin base ni modelo, que es la única forma de
 * poder discutir un número de plata línea por línea.
 *
 * **La decisión que ordena el archivo (188·D1): el costo de la receta es el
 * NETO, y esta spec no lo cambia.** El negocio es responsable inscripto —emite
 * factura A con IVA discriminado—, así que el IVA de compras es crédito fiscal:
 * no es costo, se recupera. Y lo que no discrimina IVA (ticket, factura B, C de
 * monotributista, compra sin comprobante) no da crédito, así que ahí el IVA está
 * adentro del precio y sí es costo.
 *
 * En los dos casos el costo termina siendo **el número que dice el papel**, que
 * es lo que el sistema ya hacía copiándolo. Lo que faltaba era saber cuál de los
 * dos es, para poder mostrar el otro sin escribirlo.
 */

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** En qué base está el precio impreso del renglón. */
export type PriceBase = "neto" | "final";

/** Las alícuotas de ARCA. El CHECK de la 0110 espeja esta lista. */
export const TASAS_IVA = [0, 2.5, 5, 10.5, 21, 27] as const;

/** La que usa casi todo: gastronomía, bebidas, limpieza, descartables. */
export const TASA_POR_DEFECTO = 21;

/**
 * Sólo la factura A discrimina IVA en el renglón.
 *
 * La C del monotributista **no es una excepción olvidada**: por definición no
 * discrimina, así que su precio es final. El remito y el interno tampoco traen
 * IVA separado. Un `default` que devolviera `neto` para lo desconocido le
 * restaría un 21% a un costo real.
 *
 * La autoridad de esta regla es la RPC `registrar_items_comprobante_tx`, que
 * lee el `document_type` de la fila del comprobante y escribe `price_base` sin
 * preguntarle al caller (0110). Esta copia es para la pantalla.
 */
export function baseDelComprobante(tipo: DocumentType | string | null): PriceBase {
  return tipo === "factura_a" ? "neto" : "final";
}

/** Redondeo al centavo, explícito: `Math.round` sobre centavos, nunca sobre pesos. */
const centavos = (n: number) => Math.round(n);

/**
 * El precio con IVA — el «precio final» que pidió Rocío.
 *
 * Es para MOSTRAR (188·D5). Ningún camino escribe este número en
 * `unit_cost_cents` ni en `ingredient_presentations.cost_cents`.
 */
export function aFinalCents(cents: number, tasa: number | null, base: PriceBase): number {
  if (base === "final") return cents;
  return centavos(cents * (1 + (tasa ?? TASA_POR_DEFECTO) / 100));
}

/**
 * Cuánto IVA tiene ese precio, en pesos — spec 188.
 *
 * Es el número que Rocío pidió ver: «le pone IVA a cada uno». Se deriva de los
 * otros dos para que no haya una tercera definición del IVA dando vueltas —
 * sobre un precio final es lo que ya está adentro, sobre uno neto es lo que
 * falta, y en los dos casos el redondeo es el mismo.
 */
export function ivaDeCents(cents: number, tasa: number | null, base: PriceBase): number {
  return base === "neto"
    ? aFinalCents(cents, tasa, base) - cents
    : cents - aNetoCents(cents, tasa, base);
}

/** El precio sin IVA. Simétrico del anterior: divide donde el otro multiplica. */
export function aNetoCents(cents: number, tasa: number | null, base: PriceBase): number {
  if (base === "neto") return cents;
  return centavos(cents / (1 + (tasa ?? TASA_POR_DEFECTO) / 100));
}

/**
 * La tasa que se deduce del pie: `IVA / neto`.
 *
 * Se redondea a la alícuota de ARCA más cercana **si está a menos de medio
 * punto**, y si no devuelve null. No es prolijidad: un comprobante con dos tasas
 * mezcladas (21% y 10,5% en la misma factura de almacén) da un promedio que no
 * es ninguna de las dos, y mostrar «IVA 16,3%» sobre cada renglón sería inventar
 * una alícuota que no existe.
 */
export function tasaDelPie(netoCents: number | null, ivaCents: number | null): number | null {
  if (!netoCents || ivaCents === null || ivaCents === undefined) return null;
  if (netoCents === 0) return null;
  const pct = (ivaCents / netoCents) * 100;
  let mejor: number | null = null;
  let dist = Infinity;
  for (const t of TASAS_IVA) {
    const d = Math.abs(pct - t);
    if (d < dist) {
      dist = d;
      mejor = t;
    }
  }
  return dist <= 0.5 ? mejor : null;
}

export type Desglose = {
  netoCents: number | null;
  ivaCents: number | null;
  percepcionesCents: number | null;
  totalCents: number;
};

export type ConciliacionPie =
  /** Falta alguno de los tres: no hay con qué comparar. */
  | { estado: "incompleto"; diferenciaCents: 0 }
  /** `neto + IVA + percepciones` da el total, dentro del peso de redondeo. */
  | { estado: "cuadra"; diferenciaCents: number }
  /** No da. Se muestra y se carga igual (188·D4). */
  | { estado: "no_cuadra"; diferenciaCents: number };

/**
 * Un peso de tolerancia: es el redondeo del papel, no el margen de error de
 * nadie. El proveedor que imprime un neto redondeado al centavo y un total
 * redondeado al peso está bien.
 */
const TOLERANCIA_CENTS = 100;

/**
 * ¿El pie cierra contra el total? — 188·D4.
 *
 * Misma política que la 165·D2 con `Σ renglones ≠ total`: **se muestra la
 * diferencia y se carga igual**. Un CHECK que lo exigiera haría imposible
 * cargar la mitad de los comprobantes reales (impuestos internos, un redondeo,
 * una percepción que no modelamos), y un formulario que lo exigiera haría que se
 * tipee cualquier cosa para poder guardar.
 */
export function conciliarPie(d: Desglose): ConciliacionPie {
  if (d.netoCents === null || d.ivaCents === null) {
    return { estado: "incompleto", diferenciaCents: 0 };
  }
  const suma = d.netoCents + d.ivaCents + (d.percepcionesCents ?? 0);
  const diferencia = d.totalCents - suma;
  return Math.abs(diferencia) <= TOLERANCIA_CENTS
    ? { estado: "cuadra", diferenciaCents: diferencia }
    : { estado: "no_cuadra", diferenciaCents: diferencia };
}

/**
 * La tasa de un renglón: la impresa si estaba, si no la del comprobante.
 *
 * La heredada **nunca escribe plata** (188·D5): alimenta el «$17.500/kg + IVA
 * 21% = $21.175 final» de la pantalla y nada más. Un renglón al 10,5% que se
 * mostró al 21% es un cartel equivocado; si además escribiera el costo, sería
 * una receta equivocada.
 */
export function tasaDeRenglon(
  tasaImpresa: number | null,
  tasaDelComprobante: number | null,
): number | null {
  if (tasaImpresa !== null && TASAS_IVA.includes(tasaImpresa as (typeof TASAS_IVA)[number])) {
    return tasaImpresa;
  }
  return tasaDelComprobante;
}

/**
 * De lo que dice el papel a una alícuota, o null.
 *
 * El modelo copia «21%», «21,00», «10,5» o «IVA 21%» tal cual (172·D1). Lo que
 * no sea una de las seis de ARCA no se fuerza a la más parecida: un «2,1» mal
 * leído no puede convertirse en 21.
 */
export function parseTasa(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const limpio = raw.replace(/[^\d,.]/g, "").replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return TASAS_IVA.includes(n as (typeof TASAS_IVA)[number]) ? n : null;
}
