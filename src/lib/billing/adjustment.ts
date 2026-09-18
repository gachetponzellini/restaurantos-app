// ============================================
// Recargo / descuento por método de pago.
//
// Configurado por negocio en `payment_method_configs` y persistido en el pago
// (`payments.adjustment_percent` + `adjustment_cents`) para poder auditar
// después con qué regla se cobró.
//
// Vivía copiada tres veces: `cobrar-client.tsx` y `cobrar-desktop-client.tsx`
// (idénticas) y `venta-mostrador.ts` (la misma cuenta en español). Era la
// última regla de dinero sin un solo dueño — spec 062.
// ============================================

/**
 * Aplica `percent` sobre `baseCents` y devuelve el ajuste y el total final.
 *
 * El porcentaje puede ser negativo: es cómo se modela el **descuento** por
 * método (típico: pagar en efectivo sale menos). Con `percent` negativo el
 * `finalCents` queda por debajo de la base, que es justamente el caso que hace
 * falta contemplar en las guardas de cobro — ver `isCashShortPayment`.
 */
export function calculateAdjustment(
  baseCents: number,
  percent: number,
): { adjustmentCents: number; finalCents: number } {
  const adjustmentCents = Math.round((baseCents * percent) / 100);
  return { adjustmentCents, finalCents: baseCents + adjustmentCents };
}

/**
 * El ajuste por método de un cobro, calculado del lado del server (#353).
 *
 * La pantalla lo calculaba sobre lo que falta y lo mandaba tal cual, así que un
 * pago **parcial** con tarjeta (+10 %) llevaba el recargo del total entero: la
 * base del pago (`monto − ajuste`) quedaba por debajo de lo que de verdad
 * saldaba. Acá:
 *
 *  - si el pago cubre lo que falta con su ajuste, el ajuste es el del total
 *    (lo que sobre es vuelto o propina, no recargo);
 *  - si es parcial, el monto ya trae su parte del ajuste adentro:
 *    `monto × pct / (100 + pct)`.
 */
export function ajusteDelCobro(input: {
  amountCents: number;
  remainingCents: number;
  percent: number;
}): number {
  const { amountCents, remainingCents, percent } = input;
  if (!percent) return 0;
  const completo = calculateAdjustment(Math.max(0, remainingCents), percent);
  if (amountCents >= completo.finalCents) return completo.adjustmentCents;
  return Math.round((amountCents * percent) / (100 + percent));
}
