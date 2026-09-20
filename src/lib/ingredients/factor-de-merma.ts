/**
 * Cuánto insumo hay que sacar del depósito por cada unidad LIMPIA que pide la
 * receta (decisión de Juan, 2026-09-20).
 *
 * La merma se pierde sobre lo que se COMPRA, no sobre lo que se sirve: con 20 %
 * de merma, de cada kilo quedan 800 g. Para servir 200 g limpios salen
 * 200 ÷ 0,8 = 250 g. El factor es `1 ÷ (1 − merma)`.
 *
 * Hasta acá el costeo usaba `1 + merma` (1,20 en vez de 1,25), que subestima
 * más cuanto más merma hay: 4 % con 20 %, 25 % con 50 % — justo en el pescado
 * entero y los cortes con hueso, que es donde más duele. Y el stock no aplicaba
 * nada: descontaba los 200 g de la receta cuando del depósito salían 250.
 *
 * La misma cuenta vive en SQL (`fn_factor_merma`, migración 0125) para el
 * descuento de stock y el costo de los insumos compuestos. Si cambia una,
 * cambia la otra.
 *
 * `ingredients.waste_percent` tiene un CHECK `>= 0 and < 100`; el tope de 99
 * es sólo para que un dato roto no divida por cero.
 */
export function factorDeMerma(wastePercent: number | null | undefined): number {
  const w = Math.min(Math.max(Number(wastePercent) || 0, 0), 99);
  return 1 / (1 - w / 100);
}
