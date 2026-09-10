// ============================================
// Cálculos puros de cuenta + prorrateo de splits (CU-03 R1, R5, R6, R7).
//
// Funciones puras, sin I/O — testeables con casos límite (redondeo, dividir
// entre primos, etc).
// ============================================

import type { CuentaItem, CuentaTotals } from "./types";

export function calculateTotals(input: {
  subtotal_cents: number;
  tip_cents: number;
  discount_cents: number;
}): CuentaTotals {
  const subtotal = input.subtotal_cents;
  const tip = input.tip_cents;
  const discount = input.discount_cents;
  const total = Math.max(0, subtotal - discount + tip);
  return {
    subtotal_cents: subtotal,
    tip_cents: tip,
    discount_cents: discount,
    total_cents: total,
  };
}

export function sumActiveItems(items: CuentaItem[]): number {
  return items
    .filter((it) => it.cancelled_at === null)
    .reduce((acc, it) => acc + it.subtotal_cents, 0);
}

/**
 * Prorratea `total_cents` en `count` partes iguales con redondeo de centavos.
 * Devuelve un array de longitud `count`. La diferencia por redondeo va al
 * primer split (R7 de CU-03: "$33.33 / $33.33 / $33.34" cuando dividís
 * $100.00 en 3).
 *
 * Pre: count >= 1.
 */
export function prorrateEqualSplits(total_cents: number, count: number): number[] {
  if (count < 1) return [];
  if (count === 1) return [total_cents];
  const base = Math.floor(total_cents / count);
  const remainder = total_cents - base * count;
  const out = new Array<number>(count).fill(base);
  out[0] += remainder;
  return out;
}

/**
 * En efectivo no se cobra de menos. Si el cliente da $5.000 sobre una cuenta de
 * $8.000, eso no es "un pago parcial": es que todavía debe plata, y registrarlo
 * como cobro deja la caja diciendo que entró algo que no cerró. De más sí — la
 * diferencia es vuelto.
 *
 * `amount_cents` viaja con el ajuste del método ya aplicado, así que la
 * comparación se hace contra la **base sin ajuste**: con un descuento por
 * efectivo del 10%, pagar $9.000 de una cuenta de $10.000 es pagar completo.
 *
 * Los demás métodos no entran acá: dos tarjetas sobre una misma cuenta, o una
 * transferencia parcial, son casos reales. Para partir un pago en efectivo está
 * dividir la cuenta por monto.
 */
export function isCashShortPayment(input: {
  method: string;
  amount_cents: number;
  adjustment_cents: number;
  remaining_cents: number;
}): boolean {
  if (input.method !== "cash") return false;
  const base = input.amount_cents - input.adjustment_cents;
  return base < input.remaining_cents;
}

/** Qué hacer con lo que se cobró de más — spec 177 · Parte A. */
export type DestinoDelExcedente = "vuelto" | "propina";

/**
 * Los métodos donde el cajero decide el monto, y por lo tanto donde un
 * excedente significa algo.
 *
 * `mp_link` / `mp_qr` quedan afuera porque el importe lo fija la preferencia,
 * no el que está en la caja. `cuenta_corriente` también: ahí no se cobra, se
 * anota una deuda — un fiado con propina no existe.
 */
const METODOS_CON_EXCEDENTE = new Set([
  "cash",
  "card_manual",
  "transfer",
  "other",
]);

/**
 * Qué pasa por default con el excedente, según el método (spec 177 · D2).
 *
 * En efectivo **tipear el billete es la forma normal de calcular el vuelto**:
 * tomar el excedente como propina por default convertiría cada cálculo de
 * vuelto en una propina que nadie quiso dar.
 *
 * En los demás no hay vuelto que dar: si el posnet cobró de más, es porque
 * alguien lo quiso.
 */
export function destinoPorDefecto(method: string): DestinoDelExcedente {
  return method === "cash" ? "vuelto" : "propina";
}

/** Sólo en efectivo se puede devolver plata. */
export function admiteVuelto(method: string): boolean {
  return method === "cash";
}

/**
 * Cómo se parte lo que el cliente entregó — spec 177 · Parte A.
 *
 * Reemplaza a `cashCharge`, que resolvía sólo la mitad del problema:
 *
 *  - **El vuelto no es plata del local.** En efectivo el cajero tipea lo que le
 *    dan —es lo natural, y la pantalla se lo pide mostrando el vuelto— pero lo
 *    que se registra tiene que ser lo que se cobró. Registrando el billete
 *    entero, una cuenta de $42.000 pagada con $50.000 dejaba la caja esperando
 *    $8.000 que ya volvieron al bolsillo del cliente: arqueo con faltante
 *    fantasma, rendición inflada y `total_paid_cents` por encima del total de
 *    la orden (issue #188).
 *
 *  - **Y el excedente que NO vuelve al bolsillo es del mozo, no del negocio.**
 *    Los métodos que no son efectivo pasaban derecho: el posnet cobraba $50.000
 *    sobre una cuenta de $42.000 y esos $8.000 entraban como **venta**. Nadie
 *    los podía atribuir a nadie y el arqueo los contaba como facturación.
 *
 * `amount_cents` viaja con el ajuste del método ya aplicado, igual que en
 * `isCashShortPayment`, así que el tope es `remaining_cents + adjustment_cents`.
 *
 * De menos no se arregla acá: eso lo rechaza `isCashShortPayment` antes.
 */
export function repartoDelCobro(input: {
  method: string;
  amount_cents: number;
  adjustment_cents: number;
  remaining_cents: number;
  destino: DestinoDelExcedente;
}): { chargeCents: number; changeCents: number; extraTipCents: number } {
  const sinExcedente = {
    chargeCents: input.amount_cents,
    changeCents: 0,
    extraTipCents: 0,
  };
  if (!METODOS_CON_EXCEDENTE.has(input.method)) return sinExcedente;

  const tope = input.remaining_cents + input.adjustment_cents;
  if (input.amount_cents <= tope) return sinExcedente;

  const excedente = input.amount_cents - tope;

  // El vuelto sólo existe donde hay plata física que devolver. Pedirlo en
  // tarjeta es pedir algo que no se puede hacer, así que ahí el excedente es
  // propina aunque el caller diga otra cosa.
  if (input.destino === "vuelto" && admiteVuelto(input.method)) {
    return { chargeCents: tope, changeCents: excedente, extraTipCents: 0 };
  }
  return {
    chargeCents: input.amount_cents,
    changeCents: 0,
    extraTipCents: excedente,
  };
}

/**
 * Cuánta propina le toca a cada sub-cuenta — spec 177 · Parte 0.
 *
 * El bug que cierra: las dos pantallas de cobro le pasaban `orders.tip_cents`
 * **entero** a cada tarjeta de split (`cobrar-desktop-client.tsx:342` →
 * `:629`, y su espejo en la del mozo), así que cada pago registraba la propina
 * completa de la orden. Una cuenta de $10.000 con $1.000 de propina dividida
 * en 3 dejaba **$3.000 de propina** asentados: la venta bajaba $2.000 en el
 * arqueo y el mozo aparecía con el triple en la liquidación.
 *
 * El reparto es **proporcional a lo que cada sub-cuenta cubre**, y eso vale
 * para los cuatro modos de división por la misma razón: los tres primeros
 * prorratean sobre el total (que ya trae la propina adentro), así que
 * `expected_i / Σexpected` es exactamente la porción de propina que le tocó; y
 * en «por monto» —donde los importes los tipea una persona— repartir en
 * proporción a lo que cada uno pone es la regla que cualquiera esperaría.
 *
 * El último absorbe el residuo del redondeo, igual que `expectedBySplitItems`:
 * la suma tiene que dar la propina de la orden, exacta, o el arqueo hereda la
 * diferencia.
 *
 * Se guarda en `order_splits.tip_cents` al crear la división (migración 0099)
 * y NO se re-deriva al cobrar: un excedente tomado como propina (Parte A) sube
 * `orders.tip_cents`, y recalcular acá le esparciría esa propina a las
 * sub-cuentas que todavía no pagaron.
 */
export function prorratearPropina(
  tip_cents: number,
  expecteds: number[],
): number[] {
  if (expecteds.length === 0) return [];
  const total = expecteds.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acum = 0;
  for (let i = 0; i < expecteds.length; i++) {
    if (i === expecteds.length - 1) {
      out.push(tip_cents - acum);
      break;
    }
    // Σexpected en cero: no hay proporción que calcular. Todo al último, que
    // es el que absorbe — así la suma sigue cerrando en vez de dar NaN.
    const parte = total === 0 ? 0 : Math.round((expecteds[i] * tip_cents) / total);
    out.push(parte);
    acum += parte;
  }
  return out;
}

/**
 * Cuántos **pesos** se le piden a Mercado Pago por un cobro (issue #286).
 *
 * Existe como función y no como una división suelta porque el error que
 * arregla es invisible al leer: `amount_cents` es lo que falta cobrar y eso
 * **ya incluye la propina** (`total = subtotal + tip + fee − discount`,
 * `recomputeOrderTotals`), así que sumarle `tip_cents` la cobra dos veces. Una
 * cuenta de $10.000 con $1.000 de propina generaba un link por **$12.000**.
 *
 * `tip_cents` no es un parámetro: no entra en la cuenta, y esa es toda la
 * regla. Si algún día hace falta, que sea un cambio explícito y con un test que
 * lo diga.
 */
export function importeDePreferenciaMp(amount_cents: number): number {
  return amount_cents / 100;
}

export type ExpectedByAmountsResult =
  | { ok: true; expecteds: number[] }
  | { ok: false; error: string };

/**
 * Dividir por monto: el mozo carga cuánto pone cada uno ("yo pongo $10.000")
 * y el **resto queda como última sub-cuenta**. Es cómo se divide de verdad en
 * la mesa — nadie calcula su parte exacta, alguien pone un número y otro paga
 * lo que falta.
 *
 * Por eso los montos cargados NO tienen que sumar el total: si suman menos, el
 * remanente es un split más. Si suman exacto, esos son todos los splits (y
 * tienen que ser al menos 2). Si suman de más, es un error del que carga —
 * nunca se crea una cuenta que espera más plata de la que se debe.
 *
 * A diferencia de `prorrateEqualSplits`, acá no hay redondeo que repartir: los
 * montos son los que el usuario tipeó y el resto absorbe la diferencia por
 * construcción.
 */
export function expectedByAmounts(
  total_cents: number,
  amounts: number[],
): ExpectedByAmountsResult {
  if (total_cents <= 0) {
    return { ok: false, error: "No hay nada para dividir." };
  }
  if (amounts.length === 0) {
    return { ok: false, error: "Cargá al menos un monto." };
  }
  if (amounts.some((a) => !Number.isInteger(a))) {
    return { ok: false, error: "Los montos tienen que estar en centavos enteros." };
  }
  if (amounts.some((a) => a <= 0)) {
    return { ok: false, error: "Todos los montos tienen que ser mayores a cero." };
  }

  const sum = amounts.reduce((acc, a) => acc + a, 0);
  if (sum > total_cents) {
    return {
      ok: false,
      error: `Los montos suman más que el total de la cuenta (se pasan por ${sum - total_cents} centavos).`,
    };
  }

  const rest = total_cents - sum;
  const expecteds = rest > 0 ? [...amounts, rest] : [...amounts];
  if (expecteds.length < 2) {
    return {
      ok: false,
      error: "Se necesitan al menos 2 sub-cuentas para dividir.",
    };
  }
  return { ok: true, expecteds };
}

/**
 * Agrupa items activos por seat_number. null = sin asignar.
 */
export function groupItemsBySeat(items: CuentaItem[]): Map<number | null, CuentaItem[]> {
  const map = new Map<number | null, CuentaItem[]>();
  for (const it of items) {
    if (it.cancelled_at !== null) continue;
    const key = it.seat_number ?? null;
    const bucket = map.get(key) ?? [];
    bucket.push(it);
    map.set(key, bucket);
  }
  return map;
}

/**
 * Dividir por items: dado un mapping {split_index → orderItemIds}, calcula
 * el `expected_amount_cents` para cada split.
 *
 * Aplica propina y descuento prorrateando proporcional al subtotal de cada
 * split (R5 de CU-03). Si subtotal global = 0 (todos cancelados), prorratea
 * por igual.
 *
 * Por R6, cada `order_item` debería estar en exactamente 1 split — eso lo
 * valida la action al construir el mapping. Esta función solo hace los
 * números, asumiendo el mapping bien formado.
 */
export function expectedBySplitItems(input: {
  items: CuentaItem[];
  mapping: Map<number, string[]>;
  tip_cents: number;
  discount_cents: number;
}): Array<{ split_index: number; expected_amount_cents: number }> {
  const itemById = new Map(input.items.map((it) => [it.id, it]));

  // Subtotal por split.
  const subtotalsByIndex = new Map<number, number>();
  let subtotalGlobal = 0;
  for (const [idx, ids] of input.mapping.entries()) {
    let sub = 0;
    for (const id of ids) {
      const it = itemById.get(id);
      if (!it || it.cancelled_at !== null) continue;
      sub += it.subtotal_cents;
    }
    subtotalsByIndex.set(idx, sub);
    subtotalGlobal += sub;
  }

  const indices = Array.from(input.mapping.keys()).sort((a, b) => a - b);
  const out: Array<{ split_index: number; expected_amount_cents: number }> = [];

  if (subtotalGlobal === 0) {
    // Edge case: todos los splits con subtotal 0. Prorrateamos
    // tip-discount por igual (en la práctica UI no permite confirmar un
    // mapping así, pero el helper es robusto).
    const adj = input.tip_cents - input.discount_cents;
    const equal = prorrateEqualSplits(Math.max(0, adj), indices.length);
    indices.forEach((idx, i) => {
      out.push({ split_index: idx, expected_amount_cents: equal[i] });
    });
    return out;
  }

  // Prorrateo proporcional con redondeo de centavos: el último split
  // absorbe el residuo para que la suma cierre exacta al total.
  const tipsRaw: number[] = [];
  const discountsRaw: number[] = [];
  let acumTip = 0;
  let acumDisc = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const sub = subtotalsByIndex.get(idx) ?? 0;
    if (i === indices.length - 1) {
      tipsRaw.push(input.tip_cents - acumTip);
      discountsRaw.push(input.discount_cents - acumDisc);
    } else {
      const t = Math.round((sub * input.tip_cents) / subtotalGlobal);
      const d = Math.round((sub * input.discount_cents) / subtotalGlobal);
      tipsRaw.push(t);
      discountsRaw.push(d);
      acumTip += t;
      acumDisc += d;
    }
  }

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const sub = subtotalsByIndex.get(idx) ?? 0;
    const expected = Math.max(0, sub + tipsRaw[i] - discountsRaw[i]);
    out.push({ split_index: idx, expected_amount_cents: expected });
  }
  return out;
}
