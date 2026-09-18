"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { CatalogClient } from "@/components/admin/catalog/catalog-client";
import { CategoriasTab } from "@/components/admin/catalog/categorias-tab";
import { CosteoTab } from "@/components/admin/catalog/costeo-tab";
import { IngredientsTab } from "@/components/admin/catalog/ingredients-tab";
import { SectoresTab } from "@/components/admin/catalog/sectores-tab";
import { DailyMenuList } from "@/components/admin/daily-menus/daily-menu-list";
import { BrandButton } from "@/components/admin/shell/brand-button";
import { AyudaChip } from "@/components/admin/ayuda-chip";
import { PageHeader } from "@/components/admin/shell/page-shell";
import type { BarStockCandidate } from "@/components/admin/stock/stock-bar-tab";
import { StockTab } from "@/components/admin/stock/stock-tab";
import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
  AdminSuperCategory,
} from "@/lib/admin/catalog-query";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import type { KitchenStockFull } from "@/lib/ingredients/queries";
import type { MermaReportItem } from "@/lib/ingredients/merma";
import type { IngredientOverview, ProductCosteo } from "@/lib/ingredients/types";
import type { StockOverviewItem } from "@/lib/stock/queries";
import { cn } from "@/lib/utils";
import { catalogAttention } from "@/lib/catalog/attention";
import {
  CatalogHeaderActionProvider,
  CatalogHeaderActionSlot,
} from "@/components/admin/catalog/ui/header-action";

type Tab =
  | "productos"
  | "categorias"
  | "sectores"
  | "menu-del-dia"
  | "insumos"
  | "costeo"
  | "stock";

function isTab(value: string | null | undefined): value is Tab {
  return (
    value === "productos" ||
    value === "categorias" ||
    value === "sectores" ||
    value === "menu-del-dia" ||
    value === "insumos" ||
    value === "costeo" ||
    value === "stock"
  );
}

function TabsInner({
  slug,
  businessId,
  superCategories,
  stations,
  categories,
  products,
  menus,
  todayDow,
  ingredients,
  costeo,
  stockBebidas,
  stockCocina,
  stockBar,
  barCandidates,
  merma,
  mermaFrom,
  mermaTo,
}: {
  slug: string;
  businessId: string;
  superCategories: AdminSuperCategory[];
  stations: AdminStation[];
  categories: AdminCategory[];
  products: AdminProduct[];
  menus: AdminDailyMenu[];
  todayDow: number;
  ingredients: IngredientOverview[];
  costeo: ProductCosteo[];
  stockBebidas: StockOverviewItem[];
  stockCocina: KitchenStockFull[];
  stockBar: StockOverviewItem[];
  barCandidates: BarStockCandidate[];
  merma: MermaReportItem[];
  mermaFrom: string;
  mermaTo: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const active: Tab = isTab(raw) ? raw : "productos";

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "productos") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : `?`, { scroll: false });
  };

  const counts = useMemo(
    () => ({
      productos: products.length,
      categorias: superCategories.length + categories.length,
      sectores: stations.length,
      menuDelDia: menus.length,
      insumos: ingredients.length,
      costeo: costeo.filter((c) => c.hasRecipe).length,
      stock: stockBebidas.length + stockCocina.length + stockBar.length,
    }),
    [
      products.length,
      categories.length,
      superCategories.length,
      stations.length,
      menus.length,
      ingredients.length,
      costeo,
      stockBebidas.length,
      stockCocina.length,
      stockBar.length,
    ],
  );

  const attention = useMemo(
    () =>
      catalogAttention({
        costeo,
        stockBebidas,
        stockBar,
        ingredients,
      }),
    [costeo, stockBebidas, stockBar, ingredients],
  );

  // Costo de mercadería por producto (centavos), sólo productos con receta.
  const costByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of costeo) {
      if (c.hasRecipe) map[c.productId] = c.foodCostCents;
    }
    return map;
  }, [costeo]);

  const action =
    active === "productos" ? (
      <BrandButton
        href={`/${slug}/admin/catalogo/productos/nuevo`}
        size="md"
        leadingIcon={<Plus />}
      >
        Nuevo producto
      </BrandButton>
    ) : active === "menu-del-dia" ? (
      <BrandButton
        href={`/${slug}/admin/menu-del-dia/nuevo`}
        size="md"
        leadingIcon={<Plus />}
      >
        Nuevo menú del día
      </BrandButton>
    ) : null;

  return (
    <CatalogHeaderActionProvider>
      <PageHeader
        eyebrow="Gestión"
        title="Productos e inventario"
        description="Tu carta, insumos y costos, más el stock de bebidas y cocina. Todo lo que ofrecés y lo que tenés en el local."
        action={
          <div className="flex items-center gap-2">
            <CatalogHeaderActionSlot />
            {action}
            <AyudaChip slug={slug} tema="catalogo" />
          </div>
        }
      />

      <CatalogTabs
        active={active}
        onChange={setTab}
        counts={counts}
        attention={attention}
      />

      <div>
        {active === "productos" && (
          <CatalogClient
            slug={slug}
            businessId={businessId}
            categories={categories}
            stations={stations}
            products={products}
            ingredients={ingredients}
          />
        )}
        {active === "categorias" && (
          <CategoriasTab
            slug={slug}
            superCategories={superCategories}
            stations={stations}
            categories={categories}
            products={products}
          />
        )}
        {active === "sectores" && (
          <SectoresTab
            slug={slug}
            stations={stations}
            categories={categories}
            products={products}
          />
        )}
        {active === "menu-del-dia" && (
          <DailyMenuList slug={slug} menus={menus} todayDow={todayDow} />
        )}
        {active === "insumos" && (
          <IngredientsTab slug={slug} ingredients={ingredients} />
        )}
        {active === "costeo" && <CosteoTab items={costeo} />}
        {active === "stock" && (
          <StockTab
            slug={slug}
            bebidas={stockBebidas}
            cocina={stockCocina}
            bar={stockBar}
            barCandidates={barCandidates}
            costByProduct={costByProduct}
            merma={merma}
            mermaFrom={mermaFrom}
            mermaTo={mermaTo}
          />
        )}
      </div>
    </CatalogHeaderActionProvider>
  );
}

/**
 * Tabs agrupadas por familia (spec 205 · D6): Carta · Cocina · Costos e
 * inventario. El badge rojo marca lo que pide atención (platos que pierden
 * plata, stock bajo mínimo).
 */
const TAB_GROUPS: {
  label: string;
  tabs: { id: Tab; label: string; count: keyof Counts; alert?: keyof Attention }[];
}[] = [
  {
    label: "Carta",
    tabs: [
      { id: "productos", label: "Productos", count: "productos" },
      { id: "categorias", label: "Categorías", count: "categorias" },
      { id: "menu-del-dia", label: "Menú del día", count: "menuDelDia" },
    ],
  },
  {
    label: "Cocina",
    tabs: [{ id: "sectores", label: "Sectores", count: "sectores" }],
  },
  {
    label: "Costos e inventario",
    tabs: [
      { id: "insumos", label: "Insumos", count: "insumos", alert: "insumos" },
      { id: "costeo", label: "Costeo", count: "costeo", alert: "costeo" },
      { id: "stock", label: "Stock", count: "stock", alert: "stock" },
    ],
  },
];

type Counts = Record<
  | "productos"
  | "categorias"
  | "sectores"
  | "menuDelDia"
  | "insumos"
  | "costeo"
  | "stock",
  number
>;
type Attention = ReturnType<typeof catalogAttention>;

const ALERT_TITLE: Record<keyof Attention, string> = {
  costeo: "platos que pierden plata",
  insumos: "insumos bajo mínimo",
  stock: "productos o insumos bajo mínimo",
};

function CatalogTabs({
  active,
  onChange,
  counts,
  attention,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: Counts;
  attention: Attention;
}) {
  return (
    <nav
      aria-label="Secciones del catálogo"
      className="flex items-end overflow-x-auto border-b border-zinc-200 [scrollbar-width:none]"
    >
      {TAB_GROUPS.map((g, gi) => (
        <div key={g.label} className="flex items-end">
          {gi > 0 && (
            <span aria-hidden className="mx-2 mb-2.5 h-[22px] w-px bg-zinc-200" />
          )}
          <div role="group" aria-label={g.label} className="flex flex-col">
            <span
              aria-hidden
              className="px-3 text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap text-zinc-400 uppercase max-md:hidden"
            >
              {g.label}
            </span>
            <div className="flex">
              {g.tabs.map((t) => {
                const on = active === t.id;
                const alert = t.alert ? attention[t.alert] : 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange(t.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "-mb-px flex items-center gap-1.5 border-b-2 px-3 pt-2 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                      on
                        ? "border-zinc-900 text-zinc-900"
                        : "border-transparent text-zinc-500 hover:text-zinc-900",
                    )}
                  >
                    {t.label}
                    <span className="text-[11px] text-zinc-400 tabular-nums">
                      {counts[t.count]}
                    </span>
                    {alert > 0 && t.alert && (
                      <span
                        title={`${alert} ${ALERT_TITLE[t.alert]}`}
                        className="rounded-full bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700 tabular-nums"
                      >
                        {alert}
                        <span className="sr-only"> {ALERT_TITLE[t.alert]}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </nav>
  );
}

export function CatalogShell(props: {
  slug: string;
  businessId: string;
  superCategories: AdminSuperCategory[];
  stations: AdminStation[];
  categories: AdminCategory[];
  products: AdminProduct[];
  menus: AdminDailyMenu[];
  todayDow: number;
  ingredients: IngredientOverview[];
  costeo: ProductCosteo[];
  stockBebidas: StockOverviewItem[];
  stockCocina: KitchenStockFull[];
  stockBar: StockOverviewItem[];
  barCandidates: BarStockCandidate[];
  merma: MermaReportItem[];
  mermaFrom: string;
  mermaTo: string;
}) {
  return (
    <Suspense fallback={null}>
      <TabsInner {...props} />
    </Suspense>
  );
}
