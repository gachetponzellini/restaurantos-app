"use client";

import { useMemo, useRef, useState } from "react";

import {
  CatalogTable,
  type CatalogColumn,
  type CatalogTableHandle,
} from "@/components/admin/catalog/ui/catalog-table";
import {
  CatalogSearch,
  CatalogToolbar,
} from "@/components/admin/catalog/ui/catalog-toolbar";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import { useCatalogEditor } from "@/components/admin/catalog/ui/editor-host";
import type { ProductCosteo } from "@/lib/ingredients/types";
import {
  FOOD_COST_BAR,
  FOOD_COST_TEXT,
  foodCostPercent,
  foodCostTone,
} from "@/lib/catalog/food-cost";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/** Fila con el food cost ya calculado (spec 205 · D11). */
type Row = ProductCosteo & { pct: number | null };

type KpiId = "todos" | "loss" | "high" | "sin";

/**
 * Tab Costeo (spec 205 · D11): los KPIs son filtros — tocarlos filtra la
 * tabla en vez de sólo informar. La tabla queda ordenada de peor a mejor food
 * cost, y cada fila abre el `ProductEditor` directo en «Precio y costo»
 * (D6 · editores enlazados) recorriendo la lista filtrada con ‹ ›.
 */
export function CosteoTab() {
  const { costeo } = useCatalogData();
  const editor = useCatalogEditor();
  const tableRef = useRef<CatalogTableHandle>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [kpi, setKpi] = useState<KpiId>("todos");

  const rows: Row[] = useMemo(
    () =>
      costeo.map((c) => ({
        ...c,
        pct: c.hasRecipe
          ? foodCostPercent(c.priceCents, c.foodCostCents)
          : null,
      })),
    [costeo],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of costeo) if (c.categoryName) set.add(c.categoryName);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [costeo]);

  const withRecipe = rows.filter((r) => r.hasRecipe);
  const avgMargin =
    withRecipe.length > 0
      ? withRecipe.reduce((s, r) => s + r.marginPercent, 0) / withRecipe.length
      : 0;
  const pierdenPlata = withRecipe.filter((r) => r.marginCents < 0);
  // Mismo corte que `foodCostTone === "bad"` (>50%): un plato ahí ya pide
  // revisar precio o receta, aunque todavía deje margen positivo.
  const foodCostAlto = withRecipe.filter(
    (r) => r.pct != null && foodCostTone(r.pct) === "bad",
  );
  const sinReceta = rows.filter((r) => !r.hasRecipe);

  const kpiBase =
    kpi === "loss"
      ? pierdenPlata
      : kpi === "high"
        ? foodCostAlto
        : kpi === "sin"
          ? sinReceta
          : rows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (
      kpiBase
        .filter((r) => {
          if (categoryFilter !== "all" && r.categoryName !== categoryFilter)
            return false;
          return !q || r.productName.toLowerCase().includes(q);
        })
        // De peor a mejor: primero lo que no tiene receta ni forma de calcularse
        // no entra acá salvo que el filtro sea justamente «Sin receta» (donde no
        // hay % que ordenar); el resto, food cost más alto primero.
        .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
    );
  }, [kpiBase, search, categoryFilter]);

  const ids = filtered.map((r) => r.productId);
  const open = (r: Row) =>
    editor.open({ kind: "product", id: r.productId, section: "precio" }, ids);

  const columns: CatalogColumn<Row>[] = [
    {
      key: "producto",
      header: "Producto",
      width: "minmax(0,1fr)",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-zinc-900">
            {r.productName}
          </span>
          {r.categoryName && (
            <span className="block truncate text-xs text-zinc-500">
              {r.categoryName}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "precio",
      header: "Precio",
      width: "88px",
      align: "end",
      cell: (r) => (
        <span className="font-semibold text-zinc-900 tabular-nums">
          {formatCurrency(r.priceCents)}
        </span>
      ),
    },
    {
      key: "costo",
      header: "Costo",
      width: "88px",
      align: "end",
      hideOnMobile: true,
      cell: (r) => (
        <span className="text-[12.5px] text-zinc-600 tabular-nums">
          {r.hasRecipe ? formatCurrency(r.foodCostCents) : "—"}
        </span>
      ),
    },
    {
      key: "fc",
      header: "Food cost",
      width: "150px",
      hideOnMobile: true,
      cell: (r) => {
        if (r.pct == null)
          return <span className="text-xs text-zinc-400">sin receta</span>;
        const tone = foodCostTone(r.pct);
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={cn("h-full rounded-full", FOOD_COST_BAR[tone])}
                style={{ width: `${Math.min(100, r.pct)}%` }}
              />
            </div>
            <span
              className={cn(
                "text-[12.5px] font-semibold tabular-nums",
                FOOD_COST_TEXT[tone],
              )}
            >
              {Math.round(r.pct)}%
            </span>
          </div>
        );
      },
    },
    {
      key: "margen",
      header: "Margen $",
      width: "96px",
      align: "end",
      cell: (r) =>
        r.hasRecipe ? (
          <span
            className={cn(
              "font-semibold tabular-nums",
              r.marginCents < 0 ? "text-rose-700" : "text-zinc-900",
            )}
          >
            {formatCurrency(r.marginCents)}
          </span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
  ];

  const hayFiltro = kpi !== "todos" || categoryFilter !== "all" || !!search;
  const limpiar = () => {
    setKpi("todos");
    setCategoryFilter("all");
    setSearch("");
  };

  return (
    <>
      <div className="mb-3 grid gap-2.5 sm:grid-cols-4">
        <Kpi
          on={kpi === "todos"}
          onClick={() => setKpi("todos")}
          label="Margen promedio"
          value={`${avgMargin.toFixed(1)}%`}
          detail={`${withRecipe.length} con receta`}
        />
        <Kpi
          on={kpi === "loss"}
          onClick={() => setKpi("loss")}
          label="Pierden plata"
          value={String(pierdenPlata.length)}
          detail="el costo supera el precio"
          alert={pierdenPlata.length > 0}
        />
        <Kpi
          on={kpi === "high"}
          onClick={() => setKpi("high")}
          label="Food cost > 50%"
          value={String(foodCostAlto.length)}
          detail="revisar precio o receta"
          alert={foodCostAlto.length > 0}
        />
        <Kpi
          on={kpi === "sin"}
          onClick={() => setKpi("sin")}
          label="Sin receta"
          value={String(sinReceta.length)}
          detail="no se puede calcular"
        />
      </div>

      <CatalogToolbar>
        <CatalogSearch
          value={search}
          onChange={setSearch}
          placeholder="Buscar producto…"
          onArrowDown={() => tableRef.current?.focusFirst()}
        />
        {categories.length > 1 && (
          <select
            aria-label="Categoría"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-[38px] rounded-xl border border-zinc-200 bg-white px-2.5 text-sm"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </CatalogToolbar>

      <div className="flex justify-between gap-3 px-0.5 pb-2 text-xs text-zinc-500">
        <span className="tabular-nums">
          {filtered.length} de {rows.length} productos
        </span>
        <span className="max-sm:hidden">
          Ordenado de peor a mejor food cost
        </span>
      </div>

      <CatalogTable<Row>
        ref={tableRef}
        aria-label="Costeo"
        rows={filtered}
        columns={columns}
        getKey={(r) => r.productId}
        rowLabel={(r) => r.productName}
        onOpen={open}
        empty={
          rows.length === 0 ? (
            "Todavía no hay productos activos."
          ) : (
            <>
              {search
                ? `Sin resultados para «${search}».`
                : "Ningún producto entra en los filtros."}{" "}
              {hayFiltro && (
                <button
                  type="button"
                  onClick={limpiar}
                  className="font-medium text-zinc-900 underline underline-offset-4"
                >
                  Limpiar filtros
                </button>
              )}
            </>
          )
        }
      />
    </>
  );
}

function Kpi({
  on,
  onClick,
  label,
  value,
  detail,
  alert = false,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  value: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-3.5 py-2.5 text-left transition-colors",
        on
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200/80 bg-white hover:bg-zinc-50",
      )}
    >
      <span
        className={cn(
          "block text-[11px] font-semibold tracking-[0.06em] uppercase",
          on ? "text-white/70" : "text-zinc-500",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "block text-xl font-bold tabular-nums",
          on ? "text-white" : alert ? "text-rose-700" : "text-zinc-900",
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          "block text-[12px]",
          on ? "text-white/70" : "text-zinc-500",
        )}
      >
        {detail}
      </span>
    </button>
  );
}
