import type { KitchenStockFull } from "@/lib/ingredients/queries";
import type { IngredientUnit } from "@/lib/ingredients/types";
import type { StockOverviewItem } from "@/lib/stock/queries";

/**
 * Fila común de la tabla de Stock (spec 205 · D12). Bebidas y Bar salen de
 * `stock_items` (por producto); Cocina sale de `ingredients`. Distinto
 * origen, misma fila — el mismo patrón que ya usan Productos/Insumos/Costeo
 * en el resto del catálogo (D6).
 */
export type StockRow =
  | {
      kind: "product";
      /** `stockItemId`: lo que pide el historial (`/api/stock/history`). */
      id: string;
      productId: string;
      name: string;
      /** Categoría del producto. */
      sub: string | null;
      qty: number;
      min: number;
      unit: string;
      /** Food cost del producto (centavos), sólo cuando lo pasan (tab Bar). */
      costCents?: number;
    }
  | {
      kind: "ingredient";
      /** `ingredient.id`. */
      id: string;
      name: string;
      /** Presentación default, para saber en qué entra. */
      sub: string | null;
      qty: number;
      min: number;
      unit: IngredientUnit;
      ingredient: KitchenStockFull;
    };

export type StockLevel = "ok" | "low" | "out";

/** Sin stock (≤0) · bajo mínimo (< mínimo, si hay uno cargado) · OK. */
export function stockStatus(qty: number, min: number): StockLevel {
  if (qty <= 0) return "out";
  if (min > 0 && qty < min) return "low";
  return "ok";
}

/**
 * Ratio stock/mínimo: la base para ordenar «lo que falta primero» (D12).
 * Sin mínimo cargado, un insumo con stock nunca puede "faltar" por
 * definición — va al final; pero si encima está en cero, igual importa
 * mostrarlo antes que el resto.
 */
export function shortageRatio(qty: number, min: number): number {
  if (min > 0) return qty / min;
  return qty <= 0 ? 0 : Infinity;
}

export function sortByShortage<T extends { qty: number; min: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => shortageRatio(a.qty, a.min) - shortageRatio(b.qty, b.min),
  );
}

/** Cuántas filas están bajo mínimo o sin stock (badge del sub-tab). */
export function lowCount(
  rows: readonly { qty: number; min: number }[],
): number {
  return rows.filter((r) => stockStatus(r.qty, r.min) !== "ok").length;
}

/** «Hoy hay X → quedaría Y»: el preview del movimiento. */
export function previewQty(current: number, delta: number): number {
  return current + delta;
}

export function bebidasToRows(
  items: StockOverviewItem[],
  costByProduct?: Record<string, number>,
): StockRow[] {
  return items.map((i) => ({
    kind: "product",
    id: i.stockItemId,
    productId: i.productId,
    name: i.productName,
    sub: i.categoryName,
    qty: i.currentQty,
    min: i.minQty,
    unit: i.unit,
    costCents: costByProduct?.[i.productId],
  }));
}

export function cocinaToRows(items: KitchenStockFull[]): StockRow[] {
  return items.map((i) => ({
    kind: "ingredient",
    id: i.id,
    name: i.name,
    sub: i.presentations[0]?.name ?? null,
    qty: i.stockQuantity,
    // `stockMinAlert` es opcional en insumos: sin cargar, no hay "bajo mínimo".
    min: i.stockMinAlert ?? 0,
    unit: i.unit,
    ingredient: i,
  }));
}

const DECIMAL_UNITS = new Set(["kg", "lt", "g", "ml"]);

/** «1 unidad», «10 unidades», «2.13 kg» (spec 205 · D12). */
export function formatQty(n: number, unit: string): string {
  if (DECIMAL_UNITS.has(unit)) return `${n.toFixed(2)} ${unit}`;
  const q = Math.round(n);
  const u = unit === "unidad" && q !== 1 ? "unidades" : unit;
  return `${q} ${u}`;
}
