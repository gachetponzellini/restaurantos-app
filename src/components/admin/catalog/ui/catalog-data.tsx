"use client";

import { createContext, useContext, type ReactNode } from "react";

import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
  AdminSuperCategory,
} from "@/lib/admin/catalog-query";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import type { KitchenStockFull } from "@/lib/ingredients/queries";
import type {
  IngredientOverview,
  ProductCosteo,
} from "@/lib/ingredients/types";
import type { StockOverviewItem } from "@/lib/stock/queries";

/**
 * Lo que la página del catálogo trae del server, al alcance de cualquier tab o
 * editor (spec 205 · D6). Los editores enlazados necesitan datos de otras
 * tabs: el de un insumo lista los productos que lo usan, el de un sector las
 * categorías que rutean ahí.
 */
export type CatalogData = {
  slug: string;
  businessId: string;
  superCategories: AdminSuperCategory[];
  categories: AdminCategory[];
  stations: AdminStation[];
  products: AdminProduct[];
  menus: AdminDailyMenu[];
  todayDow: number;
  ingredients: IngredientOverview[];
  costeo: ProductCosteo[];
  stockBebidas: StockOverviewItem[];
  stockCocina: KitchenStockFull[];
  stockBar: StockOverviewItem[];
};

const Ctx = createContext<CatalogData | null>(null);

export function CatalogDataProvider({
  value,
  children,
}: {
  value: CatalogData;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalogData(): CatalogData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCatalogData fuera del catálogo");
  return v;
}
