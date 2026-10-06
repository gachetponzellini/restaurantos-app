/**
 * Pedido mínimo del envío a domicilio (H-13 · QA #382).
 *
 * El mínimo aplica **sólo** a `delivery`: `persistOrder` lo exige únicamente en
 * ese modo y el retiro no tiene mínimo. Esta función es la misma regla para la
 * UI (carrito: aviso informativo; checkout: bloquea el confirmar en envío), así
 * el cliente no ve un mínimo que el server no va a pedir.
 *
 * Devuelve cuántos centavos faltan (0 = no falta nada o no aplica).
 */
export function faltanteParaMinimoEnvio({
  deliveryType,
  subtotalCents,
  minOrderCents,
}: {
  deliveryType: "delivery" | "pickup" | "dine_in";
  subtotalCents: number;
  minOrderCents: number;
}): number {
  if (deliveryType !== "delivery") return 0;
  if (!(minOrderCents > 0)) return 0;
  return Math.max(0, minOrderCents - subtotalCents);
}
