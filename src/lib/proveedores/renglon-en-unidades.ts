/**
 * El renglón en la unidad del insumo — spec 198·D5.
 *
 * *«Nosotros seleccionamos cómo se cuenta, si por kilos o por litros, y después
 * ponemos la cantidad. No hay un paquete por defecto, porque no siempre viene lo
 * mismo.»* — Rocío, 2026-09-16.
 *
 * El renglón se GUARDA en envases (165·D5): es lo que la RPC sabe propagar al
 * costo del insumo, y ese contrato no se toca. Lo que cambia es cómo se CARGA:
 * en kilos o litros, y el código hace la cuenta — la misma que `aPropuesta` ya
 * hacía para el lector.
 *
 *     Manteca, envase «Pan 200 g» (net_quantity 0,2 kg)
 *       se tipea        2,9 kg a $7.250 el kg
 *       viaja           units = 2,9 / 0,2 = 14,5 envases
 *                       unit_cost_cents = 7.250 × 0,2 = $1.450 el envase
 *       subtotal        14,5 × 1.450 = $21.025 == 2,9 × 7.250
 */

export type ModoCarga = "unidad" | "envase";

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * De lo que se tipeó a lo que se guarda.
 *
 * Sin envase (`netQuantity` ausente o 0) la cantidad YA es unidad base y el precio
 * es por unidad base: la RPC toma `units` como base y no actualiza el costo — la
 * rama que ya existía, y que la pantalla sigue avisando.
 */
export function aEnvases(
  modo: ModoCarga,
  cantidad: number,
  precioCents: number,
  netQuantity: number | null | undefined,
): { units: number; unitCostCents: number } {
  const neto = netQuantity ?? 0;
  if (modo === "envase" || !(neto > 0)) {
    return { units: redondear3(cantidad), unitCostCents: Math.round(precioCents) };
  }
  return {
    units: redondear3(cantidad / neto),
    unitCostCents: Math.round(precioCents * neto),
  };
}

/**
 * De lo guardado a lo que se muestra. Es la inversa de `aEnvases`, salvo el
 * redondeo a tres decimales de los envases — por eso la pantalla muestra lo que
 * se TIPEÓ mientras se edita, y esto sólo cuando el campo no tiene el foco.
 */
export function aUnidades(
  modo: ModoCarga,
  units: number,
  unitCostCents: number,
  netQuantity: number | null | undefined,
): { cantidad: number; precioCents: number } {
  const neto = netQuantity ?? 0;
  if (modo === "envase" || !(neto > 0)) {
    return { cantidad: units, precioCents: unitCostCents };
  }
  return {
    cantidad: redondear3(units * neto),
    precioCents: Math.round(unitCostCents / neto),
  };
}

/** Lo que vale el renglón. Es el número que se compara con la línea impresa (198·D6). */
export function subtotalCents(units: number, unitCostCents: number): number {
  return Math.round(units * unitCostCents);
}
