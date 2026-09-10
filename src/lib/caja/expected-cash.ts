import type { CajaMovimientoKind, PaymentMethod } from "./types";

export type ExpectedCashInput = {
  last_closing_cash_cents: number;
  payments: Array<{
    method: PaymentMethod;
    amount_cents: number;
    /** Cuánto de `amount_cents` es propina (spec 098). */
    tip_cents?: number;
  }>;
  movimientos: Array<{
    kind: CajaMovimientoKind;
    amount_cents: number;
    /** Anulado (spec 070): sigue en el libro, pero no mueve la caja. */
    cancelled_at?: string | null;
  }>;
};

/**
 * Efectivo que **el negocio** tiene que tener en el cajón.
 *
 * > lo que entró − lo que salió.
 *
 * ## La propina (spec 098 · H-09, reimplementada por la spec 177 · D5)
 *
 * La propina no es plata del negocio: se cobra por el sistema para poder
 * liquidársela al mozo. Hasta la 177, eso se implementaba **descontándola de
 * los pagos en efectivo** acá mismo, o sea asumiendo que el negocio se la
 * pagaba al mozo por fuera del cajón. Esa fórmula fallaba en los dos bordes:
 *
 *  - **Propina de tarjeta pagada del cajón** (que es lo que hace KCC): no se
 *    descontaba nunca —nunca entró como efectivo— pero la plata sí salía. El
 *    arqueo cerraba con **faltante todas las noches** y sin una línea que lo
 *    explicara.
 *  - **Propina en efectivo cobrada por la caja**: se descontaba en el acto,
 *    pero el billete se queda en el cajón hasta que alguien se lo da al mozo.
 *    Sobrante hasta ese momento.
 *
 * Ahora el cajón espera lo que entró y la propina sale por donde sale de
 * verdad: un movimiento `propina`, con el mozo adentro. La misma cuenta cubre
 * los dos casos físicos, porque el pago se registra igual tanto si el billete
 * pasó por el cajón como si el mozo ya lo tenía encima: `+bruto − propina` es
 * el neto que efectivamente llega al cajón.
 */
export function calculateExpectedCash(input: ExpectedCashInput): number {
  // Bruto: la propina que viene adentro de un pago en efectivo ESTÁ en el
  // cajón hasta que se paga. Ver el bloque de arriba.
  const cashPayments = input.payments
    .filter((p) => p.method === "cash")
    .reduce((acc, p) => acc + p.amount_cents, 0);

  const movimientos = input.movimientos.filter((m) => !m.cancelled_at);

  const ingresos = movimientos
    .filter((m) => m.kind === "ingreso")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  // Las dos salidas del cajón. Van separadas y no en un solo `kind` porque el
  // reparto del cierre y el libro necesitan distinguir «se lo llevó el dueño»
  // de «se le pagó al personal» (spec 177 · D6).
  const sangrias = movimientos
    .filter((m) => m.kind === "sangria")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  const propinas = movimientos
    .filter((m) => m.kind === "propina")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  return (
    input.last_closing_cash_cents + cashPayments + ingresos - sangrias - propinas
  );
}

export type MovimientoConCorte = {
  kind: CajaMovimientoKind;
  amount_cents: number;
  cancelled_at?: string | null;
  /** Spec 130 · Escrito por el cierre: es el retiro del cajón, no del turno. */
  corte_id?: string | null;
};

/**
 * Separa el retiro del cierre de los movimientos del turno que empieza.
 *
 * El retiro vive en el período nuevo por un milisegundo de diferencia con el
 * corte (0052), y eso está bien para la plata: apertura = lo contado, sangría
 * por lo mismo, caja en $0. Está mal para lo que se lee: el encargado ve
 * «$262.000 del corte anterior» arriba y la sangría que lo vacía abajo, y
 * entiende que el sistema le pide un saldo anterior que ya no está en el cajón.
 *
 * Netear el retiro contra la apertura mueve el mismo sumando del otro lado de
 * la cuenta: `apertura + Σmov` no cambia — hay un test que lo fija— pero el
 * turno arranca en $0 y la lista de movimientos empieza vacía, que es lo que
 * pasó de verdad.
 *
 * Los anulados (spec 070) no mueven la caja: siguen en el libro y acá suman 0.
 */
export function separarRetiroDelCierre<T extends MovimientoConCorte>(
  arrastreBrutoCents: number,
  movimientos: T[],
): { apertura_cents: number; retiro_cierre_cents: number; del_turno: T[] } {
  const delCierre = movimientos.filter((m) => m.corte_id != null);
  const del_turno = movimientos.filter((m) => m.corte_id == null);

  // Firmado como lo firma el arqueo: el ingreso suma al cajón, la sangría resta.
  const neto = delCierre
    .filter((m) => !m.cancelled_at)
    .reduce(
      (acc, m) => acc + (m.kind === "ingreso" ? m.amount_cents : -m.amount_cents),
      0,
    );

  return {
    apertura_cents: arrastreBrutoCents + neto,
    // `0 - neto` y no `-neto`: sin retiro el neto es 0 y `-0` no es `0`.
    retiro_cierre_cents: 0 - neto,
    del_turno,
  };
}
