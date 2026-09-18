/**
 * Food cost del catálogo (spec 205): cuánto del precio se va en mercadería.
 *
 * Los cortes son los mismos que usa la receta de un producto (margen ≥65%
 * bien, ≥50% ojo), expresados como food cost. Antes la tabla de Costeo pintaba
 * con otros cortes y el mismo plato salía verde en un lado y amarillo en otro.
 */

export type FoodCostTone = "ok" | "warn" | "bad" | "none";

export function foodCostPercent(
  priceCents: number,
  costCents: number,
): number | null {
  if (priceCents <= 0) return null;
  return (costCents / priceCents) * 100;
}

export function foodCostTone(percent: number | null): FoodCostTone {
  if (percent == null) return "none";
  if (percent <= 35) return "ok";
  if (percent <= 50) return "warn";
  return "bad";
}

export const FOOD_COST_TEXT: Record<FoodCostTone, string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-700",
  none: "text-zinc-400",
};

export const FOOD_COST_BAR: Record<FoodCostTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  none: "bg-zinc-300",
};
