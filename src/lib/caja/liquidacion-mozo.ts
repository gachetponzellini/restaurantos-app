import type { PaymentMethod } from "./types";

export type RendicionPaymentInput = {
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
};

export type RendicionResult = {
  /** Lo que tiene que ENTREGAR: efectivo neto de propina (spec 151). */
  efectivo_cents: number;
  /**
   * Lo que tiene ENCIMA: el mismo efectivo, con la propina adentro.
   *
   * Spec 177 · D5 — el cajón pasó a esperar el bruto, así que el reparto del
   * arqueo tiene que restarle al cajón el bruto que el mozo todavía no
   * entregó. Con el neto, el cajón quedaba "esperando" la propina de un
   * billete que el mozo tiene en el bolsillo.
   */
  efectivo_bruto_cents: number;
  tickets_cents: number;
  por_metodo: Record<PaymentMethod, number>;
  total_propinas_cents: number;
};

const EMPTY_BY_METHOD: Record<PaymentMethod, number> = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  cuenta_corriente: 0,
};

export function calcularRendicionMozo(
  payments: RendicionPaymentInput[],
): RendicionResult {
  const por_metodo: Record<PaymentMethod, number> = { ...EMPTY_BY_METHOD };
  let efectivo_cents = 0;
  let efectivo_bruto_cents = 0;
  let tickets_cents = 0;
  let total_propinas_cents = 0;

  for (const p of payments) {
    const neto = p.amount_cents - p.tip_cents;
    por_metodo[p.method] += neto;

    if (p.method === "cash") {
      efectivo_cents += neto;
      efectivo_bruto_cents += p.amount_cents;
    } else {
      tickets_cents += neto;
    }

    total_propinas_cents += p.tip_cents;
  }

  return {
    efectivo_cents,
    efectivo_bruto_cents,
    tickets_cents,
    por_metodo,
    total_propinas_cents,
  };
}


// ── Cobrado por empleado, en el período de la caja ───────────────

export type CobrosDeMozo = {
  mozo_name: string;
  /** Venta neta de propina, igual que todo el resto de la pantalla (spec 098). */
  total_cents: number;
  /** Propinas que se llevó, aparte del total. */
  propinas_cents: number;
  /** Lo que le toca entregar: sólo efectivo, neto de propina (spec 151). */
  a_rendir_cents: number;
  cobros_count: number;
  por_metodo: { method: PaymentMethod; count: number; total_cents: number }[];
};

/**
 * Qué cobró cada empleado en el período, partido por método.
 *
 * Dos cosas que este cálculo **no** hacía y ahora sí:
 *
 *  - **Neto de propina.** Sumaba `amount_cents` pelado, así que este bloque
 *    mostraba números más altos que el resto de la misma pantalla para los
 *    mismos cobros. La venta es `amount − tip` (spec 098) en todos lados.
 *
 *  - **Separa lo que se rinde.** El bloque se llamaba «rendición» y listaba
 *    tarjeta, que es exactamente lo que la spec 151 sacó de la rendición: lo
 *    cobrado por tarjeta no se rinde. Acá se sigue mostrando —es la caja, y
 *    ver lo que cobró cada uno es el punto— pero `a_rendir_cents` dice cuál de
 *    esos números es el que va a pedirse.
 */
export function agruparCobrosPorMozo(
  payments: Array<{
    attributed_mozo_name: string | null;
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
  }>,
): CobrosDeMozo[] {
  const porMozo = new Map<string, CobrosDeMozo>();

  for (const p of payments) {
    const nombre = p.attributed_mozo_name ?? "Sin mozo";
    const neto = p.amount_cents - p.tip_cents;

    let mozo = porMozo.get(nombre);
    if (!mozo) {
      mozo = {
        mozo_name: nombre,
        total_cents: 0,
        propinas_cents: 0,
        a_rendir_cents: 0,
        cobros_count: 0,
        por_metodo: [],
      };
      porMozo.set(nombre, mozo);
    }

    mozo.total_cents += neto;
    mozo.propinas_cents += p.tip_cents;
    mozo.cobros_count += 1;
    if (p.method === "cash") mozo.a_rendir_cents += neto;

    const fila = mozo.por_metodo.find((m) => m.method === p.method);
    if (fila) {
      fila.count += 1;
      fila.total_cents += neto;
    } else {
      mozo.por_metodo.push({ method: p.method, count: 1, total_cents: neto });
    }
  }

  // El que más cobró primero: es a quien más plata hay que pedirle.
  return Array.from(porMozo.values())
    .map((m) => ({
      ...m,
      por_metodo: m.por_metodo.sort((a, b) => b.total_cents - a.total_cents),
    }))
    .sort((a, b) => b.total_cents - a.total_cents);
}
