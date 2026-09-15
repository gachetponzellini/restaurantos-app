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
    <>
      <PageHeader
        eyebrow="Gestión"
        title="Productos e inventario"
        description="Tu carta, insumos y costos, más el stock de bebidas y cocina. Todo lo que ofrecés y lo que tenés en el local."
        action={
          <div className="flex items-center gap-1">
            {action}
            <AyudaChip slug={slug} tema="catalogo" />
          </div>
        }
      />

      <nav
        aria-label="Secciones del catálogo"
        className="inline-flex rounded-2xl bg-white p-1 ring-1 ring-zinc-200/70"
      >
        <TabButton
          active={active === "productos"}
          onClick={() => setTab("productos")}
          count={counts.productos}
        >
          Productos
        </TabButton>
        <TabButton
          active={active === "categorias"}
          onClick={() => setTab("categorias")}
          count={counts.categorias}
        >
          Categorías
        </TabButton>
        <TabButton
          active={active === "sectores"}
          onClick={() => setTab("sectores")}
          count={counts.sectores}
        >
          Sectores
        </TabButton>
        <TabButton
          active={active === "menu-del-dia"}
          onClick={() => setTab("menu-del-dia")}
          count={counts.menuDelDia}
        >
          Menú del día
        </TabButton>
        <TabButton
          active={active === "insumos"}
          onClick={() => setTab("insumos")}
          count={counts.insumos}
        >
          Insumos
        </TabButton>
        <TabButton
          active={active === "costeo"}
          onClick={() => setTab("costeo")}
          count={counts.costeo}
        >
          Costeo
        </TabButton>
        <TabButton
          active={active === "stock"}
          onClick={() => setTab("stock")}
          count={counts.stock}
        >
          Stock
        </TabButton>
      </nav>

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
    </>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-500 hover:text-zinc-900",
      )}
    >
      {children}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums",
          active ? "bg-white text-zinc-900 ring-1 ring-zinc-200" : "bg-zinc-100 text-zinc-500",
        )}
      >
        {count}
      </span>
    </button>
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
