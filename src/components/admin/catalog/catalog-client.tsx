"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ProductDialog } from "@/components/admin/catalog/product-dialog";
import { ProductRow } from "@/components/admin/catalog/product-row";
import { useStickyFilter } from "@/lib/ui/use-sticky-filter";
import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
} from "@/lib/admin/catalog-query";
import type { IngredientOverview } from "@/lib/ingredients/types";

const ALL = "all";
const UNCATEGORIZED = "__uncat__";
const SIN_SECTOR = "__sin_sector__";

/**
 * Estado operativo del producto (spec 065). Es `is_available`: lo que el local
 * prende y apaga durante el servicio ("se acabó el pescado"). `is_active`
 * (producto de baja) y `show_online` (visible en la carta pública) son
 * decisiones de catálogo, no de operación, y no entran acá.
 */
const ESTADOS = [
  { id: ALL, label: "Todos" },
  { id: "disponibles", label: "Disponibles" },
  { id: "no-disponibles", label: "No disponibles" },
] as const;

const ESTADO_IDS = ESTADOS.filter((e) => e.id !== ALL).map((e) => e.id);

export function CatalogClient({
  slug,
  businessId,
  categories,
  stations,
  products,
  ingredients,
}: {
  slug: string;
  businessId: string;
  categories: AdminCategory[];
  stations: AdminStation[];
  products: AdminProduct[];
  ingredients: IngredientOverview[];
}) {
  const hasUncategorized = products.some((p) => !p.category_id);
  const hasSinSector = products.some((p) => !p.station_id);

  // ── Filtros persistidos por máquina + negocio (spec 065, FR-007) ──
  // Un catálogo de cientos de productos no se filtra una vez: se filtra todo el
  // día. Que el filtro se resetee al volver de editar un producto es re-hacer
  // el mismo trabajo cada vez.
  const categoryOptions = useMemo(
    () => [
      ...categories.map((c) => c.id),
      ...(hasUncategorized ? [UNCATEGORIZED] : []),
    ],
    [categories, hasUncategorized],
  );
  const sectorOptions = useMemo(
    () => [
      ...stations.map((s) => s.id),
      ...(hasSinSector ? [SIN_SECTOR] : []),
    ],
    [stations, hasSinSector],
  );

  const [categoryFilter, setCategoryFilter] = useStickyFilter(
    `catalogo_prod_categoria_${businessId}`,
    ALL,
    categoryOptions,
  );
  const [estadoFilter, setEstadoFilter] = useStickyFilter<string>(
    `catalogo_prod_estado_${businessId}`,
    ALL,
    ESTADO_IDS,
  );
  const [sectorFilter, setSectorFilter] = useStickyFilter(
    `catalogo_prod_sector_${businessId}`,
    ALL,
    sectorOptions,
  );

  // La búsqueda NO se persiste (FR-008): una búsqueda guardada de ayer que hoy
  // deja la lista en cero se lee como "se me borró el catálogo".
  const [search, setSearch] = useState("");

  // Edición en modal. Guardamos el id, no el producto: cuando el modal guarda y
  // dispara `router.refresh()`, la lista llega nueva y el modal tiene que
  // mostrar ESA fila, no la copia con la que se abrió.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId
    ? (products.find((p) => p.id === editingId) ?? null)
    : null;

  // Insumos para el buscador de la receta: ya vienen con el catálogo, no hace
  // falta pedirlos de nuevo al abrir.
  const ingredientOptions = useMemo(
    () =>
      ingredients
        .filter((i) => i.isActive)
        .map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    [ingredients],
  );

  const filteredProducts = useMemo(() => {
    let result = products;

    if (categoryFilter === UNCATEGORIZED) {
      result = result.filter((p) => !p.category_id);
    } else if (categoryFilter !== ALL) {
      result = result.filter((p) => p.category_id === categoryFilter);
    }

    if (estadoFilter === "disponibles") {
      result = result.filter((p) => p.is_available);
    } else if (estadoFilter === "no-disponibles") {
      result = result.filter((p) => !p.is_available);
    }

    if (sectorFilter === SIN_SECTOR) {
      result = result.filter((p) => !p.station_id);
    } else if (sectorFilter !== ALL) {
      result = result.filter((p) => p.station_id === sectorFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }

    return result;
  }, [products, categoryFilter, estadoFilter, sectorFilter, search]);

  const hayFiltro =
    categoryFilter !== ALL || estadoFilter !== ALL || sectorFilter !== ALL;

  const limpiar = () => {
    setCategoryFilter(ALL);
    setEstadoFilter(ALL);
    setSectorFilter(ALL);
    setSearch("");
  };

  const chip = (
    id: string,
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border hover:bg-muted",
      )}
    >
      {label}
    </button>
  );

  const categoryChip = (id: string, label: string) =>
    chip(id, label, categoryFilter === id, () =>
      setCategoryFilter(categoryFilter === id ? ALL : id),
    );

  return (
    <>
      {/* Búsqueda */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Buscar producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full border-zinc-200 bg-white pl-9 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute right-2.5 top-1/2 -translate-y-1/2"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Estado operativo */}
        <div className="flex flex-wrap items-center gap-2">
          {ESTADOS.map((e) =>
            chip(e.id, e.label, estadoFilter === e.id, () =>
              setEstadoFilter(e.id),
            ),
          )}
        </div>

        {/* Sector: sólo tiene sentido con más de uno cargado. */}
        {stations.length > 1 && (
          <label className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm">
            <span className="text-muted-foreground">Sector</span>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="cursor-pointer border-0 bg-transparent font-medium outline-none"
            >
              <option value={ALL}>Todos</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {hasSinSector && <option value={SIN_SECTOR}>Sin sector</option>}
            </select>
          </label>
        )}

        {(hayFiltro || search) && (
          <button
            type="button"
            onClick={limpiar}
            className="text-muted-foreground hover:text-foreground text-sm font-medium underline underline-offset-4"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Filtro por categoría — solo lectura, gestión vive en la tab Categorías. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {categoryChip(ALL, "Todas")}
        {categories.map((c) => categoryChip(c.id, c.name))}
        {hasUncategorized && categoryChip(UNCATEGORIZED, "Sin categoría")}
      </div>

      {/* Product list */}
      <ul className="mt-4 grid gap-2">
        {filteredProducts.length === 0 ? (
          <li className="text-muted-foreground py-8 text-center text-sm italic">
            {products.length === 0
              ? "Sin productos."
              : search
                ? `Sin resultados para "${search}".`
                : "Ningún producto entra en los filtros activos."}
          </li>
        ) : (
          filteredProducts.map((p) => (
            <ProductRow
              key={p.id}
              slug={slug}
              product={p}
              onEdit={() => setEditingId(p.id)}
            />
          ))
        )}
      </ul>

      {editing && (
        <ProductDialog
          key={editing.id}
          slug={slug}
          businessId={businessId}
          categories={categories}
          stations={stations}
          product={editing}
          ingredientOptions={ingredientOptions}
          open
          onOpenChange={(o) => {
            if (!o) setEditingId(null);
          }}
        />
      )}
    </>
  );
}
