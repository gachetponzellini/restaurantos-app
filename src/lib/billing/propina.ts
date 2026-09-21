/**
 * La propina que sale de elegir un porcentaje en la cuenta.
 *
 * Se calcula sobre lo que efectivamente se cobra —el subtotal **menos el
 * descuento**—, no sobre el precio de lista (#189, decisión de Juan
 * 2026-09-21). Con $42.000, 10% de descuento y 10% de propina: $3.780.
 */
export function propinaPorPorcentaje(input: {
  subtotalCents: number;
  descuentoCents: number;
  porcentaje: number;
}): number {
  const base = Math.max(0, input.subtotalCents - input.descuentoCents);
  return Math.round((base * input.porcentaje) / 100);
}
