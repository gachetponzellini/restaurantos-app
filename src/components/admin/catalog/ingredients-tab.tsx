"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/admin/catalog/product-bits";
import { IngredientImportDialog } from "@/components/admin/catalog/ingredient-import-dialog";
import {
  CatalogTable,
  type CatalogColumn,
  type CatalogTableHandle,
} from "@/components/admin/catalog/ui/catalog-table";
import {
  CatalogSearch,
  CatalogToolbar,
  Segmented,
} from "@/components/admin/catalog/ui/catalog-toolbar";
import { CatalogHeaderAction } from "@/components/admin/catalog/ui/header-action";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import { useCatalogEditor } from "@/components/admin/catalog/ui/editor-host";
import type { IngredientOverview } from "@/lib/ingredients/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Filtro principal (spec 205 · D10): «Bajo mínimo» junta low + out (lo que
 * hoy `attention.ts` cuenta para el badge de la tab); «Sin usar» es lo que
 * antes no se podía ver: insumos que nadie carga en ninguna receta.
 */
type Disponibilidad = "all" | "bajo" | "sinusar";
const DISPONIBILIDAD_IDS: Disponibilidad[] = ["bajo", "sinusar"];

type Activo = "all" | "active" | "inactive";
const ACTIVO_IDS: Activo[] = ["active", "inactive"];

/** Miniatura de insumo: la unidad, no una foto (no hay imagen de insumos). */
function UnitThumb({ unit }: { unit: string }) {
  let h = 0;
  for (const c of unit) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="grid size-[34px] shrink-0 place-items-center rounded-lg text-[10px] font-bold tracking-wide"
      style={{
        background: `hsl(${h} 45% 92%)`,
        color: `hsl(${h} 35% 35%)`,
      }}
    >
      {unit.toUpperCase()}
    </span>
  );
}

const STOCK_BAR: Record<IngredientOverview["stockStatus"], string> = {
  ok: "bg-emerald-500",
  low: "bg-amber-500",
  out: "bg-rose-500",
};

/**
 * Tab Insumos (spec 205 · D10): tabla densa sobre `CatalogTable`, mismo patrón
 * que Productos. Reemplaza al `IngredientDialog` por `IngredientEditor` sobre
 * `EntityEditor`; presentaciones, sub-receta, historial de precio e importar
 * CSV siguen siendo las mismas piezas de siempre (D5).
 */
export function IngredientsTab() {
  const { slug, ingredients } = useCatalogData();
  const editor = useCatalogEditor();
  const tableRef = useRef<CatalogTableHandle>(null);
  const [search, setSearch] = useState("");
  const [disponibilidad, setDisponibilidad] = useState<Disponibilidad>("all");
  const [activo, setActivo] = useState<Activo>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients
      .filter((i) => {
        if (disponibilidad === "bajo" && i.stockStatus === "ok") return false;
        if (disponibilidad === "sinusar" && i.recipeCount > 0) return false;
        if (activo === "active" && !i.isActive) return false;
        if (activo === "inactive" && i.isActive) return false;
        return !q || i.name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [ingredients, search, disponibilidad, activo]);

  const counts = {
    all: ingredients.length,
    bajo: ingredients.filter((i) => i.stockStatus !== "ok").length,
    sinusar: ingredients.filter((i) => i.recipeCount === 0).length,
    active: ingredients.filter((i) => i.isActive).length,
    inactive: ingredients.filter((i) => !i.isActive).length,
  };

  // Valor total en stock: es una foto del inventario completo, no del filtro
  // (si filtrás por «Bajo mínimo» seguís queriendo saber cuánto hay en total).
  const valorEnStock = useMemo(
    () =>
      ingredients.reduce((sum, i) => {
        const costPerUnit =
          i.defaultPresentation && i.defaultPresentation.netQuantity > 0
            ? i.defaultPresentation.costCents /
              i.defaultPresentation.netQuantity
            : 0;
        return sum + i.stockQuantity * costPerUnit;
      }, 0),
    [ingredients],
  );

  const ids = filtered.map((i) => i.id);
  const open = (i: IngredientOverview) =>
    editor.open({ kind: "ingredient", id: i.id }, ids);

  const columns: CatalogColumn<IngredientOverview>[] = [
    {
      key: "insumo",
      header: "Insumo",
      width: "minmax(0,1fr)",
      cell: (i) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <UnitThumb unit={i.unit} />
          <div className="min-w-0">
            <span className="block truncate font-semibold text-zinc-900">
              {i.name}
            </span>
            {i.presentationCount > 0 && (
              <span className="block truncate text-xs text-zinc-500">
                {i.defaultPresentation?.name ?? "Sin presentación por defecto"}
                {i.presentationCount > 1 && ` +${i.presentationCount - 1} más`}
              </span>
            )}
            <span className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
              {!i.isActive && <Pill tone="off">Inactivo</Pill>}
              {i.stockStatus === "out" && <Pill tone="bad">Sin stock</Pill>}
              {i.stockStatus === "low" && <Pill tone="warn">Bajo mínimo</Pill>}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "stock",
      header: "Stock vs. mínimo",
      width: "150px",
      hideOnMobile: true,
      cell: (i) => {
        const min = i.stockMinAlert;
        const pct =
          min && min > 0
            ? Math.min(100, (i.stockQuantity / (min * 3)) * 100)
            : 100;
        return (
          <div className="space-y-1">
            <p className="text-[12.5px] tabular-nums">
              <span className="font-semibold text-zinc-900">
                {i.stockQuantity.toFixed(i.unit === "un" ? 0 : 2)} {i.unit}
              </span>{" "}
              {min != null && (
                <span className="text-zinc-400">
                  / mín. {min.toFixed(i.unit === "un" ? 0 : 2)} {i.unit}
                </span>
              )}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className={cn("h-full rounded-full", STOCK_BAR[i.stockStatus])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "costo",
      header: "Costo",
      width: "96px",
      align: "end",
      hideOnMobile: true,
      cell: (i) => {
        const costPerUnit =
          i.defaultPresentation && i.defaultPresentation.netQuantity > 0
            ? i.defaultPresentation.costCents /
              i.defaultPresentation.netQuantity
            : null;
        return (
          <span className="text-[12.5px] tabular-nums">
            {costPerUnit == null ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <>
                <span className="font-semibold text-zinc-900">
                  {formatCurrency(costPerUnit)}
                </span>
                <span className="text-zinc-400">/{i.unit}</span>
              </>
            )}
          </span>
        );
      },
    },
    {
      key: "merma",
      header: "Merma",
      width: "68px",
      align: "end",
      hideOnMobile: true,
      cell: (i) => (
        <span className="text-[12.5px] text-zinc-600 tabular-nums">
          {i.wastePercent > 0 ? `${i.wastePercent}%` : "—"}
        </span>
      ),
    },
    {
      key: "recetas",
      header: "Usado en",
      width: "90px",
      align: "end",
      hideOnMobile: true,
      cell: (i) => (
        <span className="text-[12.5px] text-zinc-600 tabular-nums">
          {i.recipeCount} {i.recipeCount === 1 ? "receta" : "recetas"}
        </span>
      ),
    },
  ];

  const hayFiltro = disponibilidad !== "all" || activo !== "all" || !!search;
  const limpiar = () => {
    setDisponibilidad("all");
    setActivo("all");
    setSearch("");
  };

  return (
    <>
      <CatalogHeaderAction>
        <IngredientImportDialog slug={slug} />
        <Button
          type="button"
          size="xl"
          className="bg-brand text-brand-foreground hover:bg-brand-hover"
          onClick={() => editor.create("ingredient")}
        >
          <Plus /> Nuevo insumo
        </Button>
      </CatalogHeaderAction>

      <CatalogToolbar>
        <CatalogSearch
          value={search}
          onChange={setSearch}
          placeholder="Buscar insumo…"
          onArrowDown={() => tableRef.current?.focusFirst()}
        />
        <Segmented<Disponibilidad>
          aria-label="Disponibilidad"
          value={disponibilidad}
          onChange={setDisponibilidad}
          options={[
            { value: "all", label: "Todos", count: counts.all },
            {
              value: "bajo",
              label: "Bajo mínimo",
              count: counts.bajo,
              alert: true,
            },
            { value: "sinusar", label: "Sin usar", count: counts.sinusar },
          ]}
        />
        <Segmented<Activo>
          aria-label="Activo"
          value={activo}
          onChange={setActivo}
          options={[
            { value: "all", label: "Todos" },
            { value: "active", label: "Activos", count: counts.active },
            { value: "inactive", label: "Inactivos", count: counts.inactive },
          ]}
        />
      </CatalogToolbar>

      <div className="flex justify-between gap-3 px-0.5 pb-2 text-xs text-zinc-500">
        <span className="tabular-nums">
          {filtered.length} de {ingredients.length} insumos · valor en stock{" "}
          {formatCurrency(valorEnStock)}
        </span>
      </div>

      <CatalogTable<IngredientOverview>
        ref={tableRef}
        aria-label="Insumos"
        rows={filtered}
        columns={columns}
        getKey={(i) => i.id}
        rowLabel={(i) => i.name}
        dimmed={(i) => !i.isActive}
        onOpen={open}
        empty={
          ingredients.length === 0 ? (
            "Todavía no hay insumos."
          ) : (
            <>
              {search
                ? `Sin resultados para «${search}».`
                : "Ningún insumo entra en los filtros."}{" "}
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
