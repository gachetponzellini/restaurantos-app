import type { CuentaState, OrderSplit } from "./types";

/** El id de la sub-cuenta implícita — también lo usa `split-merge`. */
export const IMPLICIT_SPLIT_ID = "__implicit__";

/**
 * La sub-cuenta que representa a la orden entera cuando no se dividió.
 *
 * Lo pagado sale de `orders.total_paid_cents`, **el mismo número con el que el
 * server calcula el saldo** (`order.total_cents - order.total_paid_cents` en
 * `registrarPago`). Las dos pantallas de cobro lo hardcodeaban en 0: tras un
 * pago parcial la pantalla seguía diciendo «Falta cobrar» el total, el cajero
 * creía que el pago no había entrado y lo volvía a cargar — y el server, que sí
 * veía el saldo real, tomaba la diferencia como propina (issue: propina
 * fantasma por pago parcial, 2026-09-18).
 */
export function implicitSplit(cuenta: CuentaState): OrderSplit {
  const expected = cuenta.totals.total_cents;
  const paid = Math.max(0, cuenta.order.total_paid_cents ?? 0);
  return {
    id: IMPLICIT_SPLIT_ID,
    order_id: cuenta.order.id,
    business_id: cuenta.order.business_id,
    split_mode: "por_personas",
    split_index: 0,
    expected_amount_cents: expected,
    // Sin división, la sub-cuenta implícita ES la orden: se lleva toda la
    // propina (spec 177 · Parte 0).
    tip_cents: cuenta.order.tip_cents,
    paid_amount_cents: paid,
    status: expected > 0 && paid >= expected ? "paid" : "pending",
    label: null,
  };
}
