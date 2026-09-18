import type {
  IngredientOverview,
  ProductCosteo,
} from "@/lib/ingredients/types";
import type { StockOverviewItem } from "@/lib/stock/queries";

/**
 * Cuántas cosas de cada tab del catálogo piden atención (spec 205 · D6). Es el
 * badge rojo al lado del nombre de la tab: que el encargado se entere de que un
 * plato pierde plata o de que falta Coca sin tener que entrar a mirar.
 *
 * Sale de los mismos datos que ya trae la página; no hay query nueva.
 */
export function catalogAttention({
  costeo,
  stockBebidas,
  stockBar,
  ingredients,
}: {
  costeo: readonly ProductCosteo[];
  stockBebidas: readonly StockOverviewItem[];
  stockBar: readonly StockOverviewItem[];
  ingredients: readonly Pick<IngredientOverview, "stockStatus" | "isActive">[];
}): { costeo: number; insumos: number; stock: number } {
  // Platos que pierden plata: el costo de la receta supera el precio.
  const pierden = costeo.filter((c) => c.hasRecipe && c.marginCents < 0).length;
  // Insumos activos bajo mínimo o sin stock (el stock de cocina son los mismos).
  const insumos = ingredients.filter(
    (i) => i.isActive && i.stockStatus !== "ok",
  ).length;
  const bajos = [...stockBebidas, ...stockBar].filter((s) => s.isLow).length;
  return { costeo: pierden, insumos, stock: bajos + insumos };
}
