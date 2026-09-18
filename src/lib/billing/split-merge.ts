import { IMPLICIT_SPLIT_ID } from "./implicit-split";
import type { OrderSplit } from "./types";

/**
 * Merge de cobro (spec 41, US1). Lógica pura y testeable para reflejar en el
 * cliente un pago que el server YA persistió, sin `router.refresh()`.
 *
 * Regla dura (spec 21): plata NUNCA optimista. Este merge se aplica **después**
 * del `ok` de `registrarPago`, sumando el `amount_cents` que devolvió el server
 * — nunca una estimación local. Todo es por `id` (dedup del pago + replace del
 * split), jamás push/increment ciego.
 */

/** Subconjunto de `Payment` que el merge necesita (lo devuelve `registrarPago`). */
export type PaymentMergeInput = {
  id: string;
  split_id: string | null;
  amount_cents: number;
};

/** Lo que devuelve `registrarPago` en su rama de éxito. */
export type RegistrarPagoResult = {
  payment: PaymentMergeInput;
  splitDone: boolean;
  orderClosed: boolean;
  /**
   * Qué pasó con el comprobante que se eligió al cobrar (spec 156 · D1). El
   * merge no lo usa; la pantalla sí, para avisar si no salió.
   */
  comprobante?: { outcome: string; error?: string };
};

export type CobroMergeState = {
  splits: OrderSplit[];
  /** Ids de pagos ya aplicados — dedup para no sumar dos veces. */
  appliedPaymentIds: string[];
  /** La orden quedó cerrada (según el server). Dispara cierre/redirect. */
  closed: boolean;
};

/**
 * Aplica un pago persistido al estado local de cobro.
 *
 * - **Dedup por `payment.id`**: si el pago ya se aplicó, no se vuelve a sumar
 *   (evita sobrecobro en pantalla ante un merge repetido). `closed` igual se
 *   propaga si el server lo indica.
 * - **Solo montos del server**: suma `payment.amount_cents`; marca `paid` solo
 *   si `splitDone`.
 * - **Cierre por el server**: `closed` se prende con `orderClosed` (nunca por
 *   una suma calculada en el cliente) y es sticky.
 */
export function applyPayment(
  state: CobroMergeState,
  result: RegistrarPagoResult,
  hasImplicitSplit: boolean,
): CobroMergeState {
  const { payment, splitDone, orderClosed } = result;

  if (state.appliedPaymentIds.includes(payment.id)) {
    return { ...state, closed: state.closed || orderClosed };
  }

  const targetId = hasImplicitSplit ? IMPLICIT_SPLIT_ID : payment.split_id;

  let matched = false;
  const splits = state.splits.map((s) => {
    if (s.id !== targetId) return s;
    matched = true;
    return {
      ...s,
      paid_amount_cents: s.paid_amount_cents + payment.amount_cents,
      status: splitDone ? ("paid" as const) : s.status,
    };
  });

  return {
    splits: matched ? splits : state.splits,
    appliedPaymentIds: [...state.appliedPaymentIds, payment.id],
    closed: state.closed || orderClosed,
  };
}
