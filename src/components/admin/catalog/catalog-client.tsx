"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ProductPills,
  ProductThumb,
} from "@/components/admin/catalog/product-bits";
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
import type { AdminProduct } from "@/lib/admin/catalog-query";
import { toggleProductAvailability } from "@/lib/catalog/product-actions";
import {
  FOOD_COST_TEXT,
  foodCostPercent,
  foodCostTone,
} from "@/lib/catalog/food-cost";
import { formatCurrency } from "@/lib/currency";
import { useOptimisticAction } from "@/lib/ui/use-optimistic-action";
import { useStickyFilter } from "@/lib/ui/use-sticky-filter";
import { cn } from "@/lib/utils";

const ALL = "all";
const UNCATEGORIZED = "__uncat__";
const SIN_SECTOR = "__sin_sector__";
const SIN_COMANDA = "__sin_comanda__";

/**
 * Estado del producto (spec 065 + spec 205 · D2). «Disponibles/Agotados» es
 * `is_available`, lo que se prende y apaga en el servicio. «Ocultos» junta lo
 * que el cliente no ve: fuera de la carta online o de baja — antes no había
 * forma de listarlos.
 */
type Estado = "all" | "disponibles" | "no-disponibles" | "ocultos";
const ESTADO_IDS: Estado[] = ["disponibles", "no-disponibles", "ocultos"];

/**
 * Tab Productos (spec 205 · D1–D3): tabla densa agrupada por categoría,
 * categorías en una columna lateral, disponibilidad desde la fila y el editor
 * en modal con ‹ › sobre la lista filtrada.
 */
export function CatalogClient() {
  const {
    businessId,
    slug,
    superCategories,
    categories,
    stations,
    products,
    costeo,
  } = useCatalogData();
  const editor = useCatalogEditor();
  const tableRef = useRef<CatalogTableHandle>(null);

  // Disponibilidad optimista: el switch responde en el acto; si la action
  // falla, React descarta el overlay y vuelve a lo que dice el server.
  const avail = useOptimisticAction(
    products,
    (state: AdminProduct[], a: { id: string; on: boolean }) =>
      state.map((p) => (p.id === a.id ? { ...p, is_available: a.on } : p)),
  );
  const list = avail.state;

  const hasUncategorized = list.some((p) => !p.category_id);

  // Orden de la carta: supercategoría → categoría → producto.
  const categoryOrder = useMemo(() => {
    const supIdx = new Map(superCategories.map((s, i) => [s.id, i]));
    const sorted = [...categories].sort(
      (a, b) =>
        (supIdx.get(a.super_category_id ?? "") ?? 999) -
          (supIdx.get(b.super_category_id ?? "") ?? 999) ||
        a.sort_order - b.sort_order,
    );
    return new Map(sorted.map((c, i) => [c.id, i]));
  }, [superCategories, categories]);
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const stationById = useMemo(
    () => new Map(stations.map((s) => [s.id, s])),
    [stations],
  );
  const costById = useMemo(
    () =>
      new Map(
        costeo
          .filter((c) => c.hasRecipe)
          .map((c) => [c.productId, c.foodCostCents]),
      ),
    [costeo],
  );

  /** Sector efectivo: el propio, si no el de la categoría; `null` si no imprime. */
  const sectorOf = (p: AdminProduct): string | null => {
    if (p.sin_comanda) return null;
    return (
      p.station_id ??
      (p.category_id
        ? (categoryById.get(p.category_id)?.station_id ?? null)
        : null)
    );
  };

  // ── Filtros persistidos por máquina + negocio (spec 065, FR-007) ──
  const categoryOptions = useMemo(
    () => [
      ...categories.map((c) => c.id),
      ...(hasUncategorized ? [UNCATEGORIZED] : []),
    ],
    [categories, hasUncategorized],
  );
  const sectorOptions = useMemo(
    () => [...stations.map((s) => s.id), SIN_SECTOR, SIN_COMANDA],
    [stations],
  );
  const [categoryFilter, setCategoryFilter] = useStickyFilter(
    `catalogo_prod_categoria_${businessId}`,
    ALL,
    categoryOptions,
  );
  const [estado, setEstado] = useStickyFilter<string>(
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list
      .filter((p) => {
        if (
          categoryFilter === UNCATEGORIZED
            ? !!p.category_id
            : categoryFilter !== ALL && p.category_id !== categoryFilter
        )
          return false;
        if (estado === "disponibles" && !(p.is_active && p.is_available))
          return false;
        if (estado === "no-disponibles" && !(p.is_active && !p.is_available))
          return false;
        if (estado === "ocultos" && p.is_active && p.show_online) return false;
        if (sectorFilter !== ALL) {
          const s = sectorOf(p);
          if (
            sectorFilter === SIN_COMANDA
              ? !p.sin_comanda
              : sectorFilter === SIN_SECTOR
                ? p.sin_comanda || s !== null
                : s !== sectorFilter
          )
            return false;
        }
        return !q || p.name.toLowerCase().includes(q);
      })
      .sort(
        (a, b) =>
          (categoryOrder.get(a.category_id ?? "") ?? 9999) -
            (categoryOrder.get(b.category_id ?? "") ?? 9999) ||
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name, "es"),
      );
    // sectorOf depende de categoryById, que ya está en las deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    list,
    categoryFilter,
    estado,
    sectorFilter,
    search,
    categoryOrder,
    categoryById,
  ]);

  const activos = list.filter((p) => p.is_active);
  const counts = {
    all: list.length,
    disponibles: activos.filter((p) => p.is_available).length,
    "no-disponibles": activos.filter((p) => !p.is_available).length,
    ocultos: list.filter((p) => !p.is_active || !p.show_online).length,
  };
  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of list)
      m.set(
        p.category_id ?? UNCATEGORIZED,
        (m.get(p.category_id ?? UNCATEGORIZED) ?? 0) + 1,
      );
    return m;
  }, [list]);

  const hayFiltro =
    categoryFilter !== ALL ||
    estado !== ALL ||
    sectorFilter !== ALL ||
    !!search;
  const limpiar = () => {
    setCategoryFilter(ALL);
    setEstado(ALL);
    setSectorFilter(ALL);
    setSearch("");
  };

  const ids = filtered.map((p) => p.id);
  const open = (p: AdminProduct) =>
    editor.open({ kind: "product", id: p.id }, ids);

  const columns: CatalogColumn<AdminProduct>[] = [
    {
      key: "producto",
      header: "Producto",
      width: "minmax(0,1fr)",
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <ProductThumb product={p} />
          <div className="min-w-0">
            <span className="block truncate font-semibold text-zinc-900">
              {p.name}
            </span>
            {p.description && (
              <span className="block truncate text-xs text-zinc-500">
                {p.description}
              </span>
            )}
            <span className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
              <ProductPills
                product={p}
                withModifiers
                losesMoney={(costById.get(p.id) ?? 0) > p.price_cents}
              />
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "comanda",
      header: "Comanda",
      width: "124px",
      hideOnMobile: true,
      cell: (p) => {
        const s = sectorOf(p);
        const extra = (
          p.extra_station_ids ??
          (p.category_id
            ? categoryById.get(p.category_id)?.extra_station_ids
            : null) ??
          []
        )
          .map((id) => stationById.get(id)?.name)
          .filter(Boolean);
        return (
          <span className="block truncate text-[13px] text-zinc-700">
            {s ? (
              <>
                {stationById.get(s)?.name ?? "—"}
                {extra.length > 0 && (
                  <span className="text-zinc-400"> +{extra.join(", ")}</span>
                )}
              </>
            ) : (
              <span className="text-zinc-400">
                {p.sin_comanda ? "Sin comanda" : "Sin sector"}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "precio",
      header: "Precio",
      width: "84px",
      align: "end",
      cell: (p) => (
        <span className="font-semibold text-zinc-900 tabular-nums">
          {formatCurrency(p.price_cents)}
        </span>
      ),
    },
    {
      key: "fc",
      header: "Food cost",
      width: "78px",
      align: "end",
      hideOnMobile: true,
      cell: (p) => {
        const cost = costById.get(p.id);
        const pct = cost == null ? null : foodCostPercent(p.price_cents, cost);
        const tone = foodCostTone(pct);
        return (
          <span
            className={cn(
              "text-[12.5px] tabular-nums",
              pct == null
                ? "text-zinc-400"
                : cn("font-semibold", FOOD_COST_TEXT[tone]),
            )}
          >
            {pct == null ? "sin receta" : `${Math.round(pct)}%`}
          </span>
        );
      },
    },
    {
      key: "disp",
      header: "Disponible",
      width: "76px",
      align: "end",
      cell: (p) => (
        <Switch
          aria-label={`Disponible: ${p.name}`}
          checked={p.is_available}
          disabled={!p.is_active}
          onCheckedChange={(on) =>
            avail.run({ id: p.id, on }, () =>
              toggleProductAvailability(slug, p.id, on),
            )
          }
        />
      ),
    },
  ];

  const railItem = (id: string, label: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setCategoryFilter(id)}
      aria-pressed={categoryFilter === id}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm",
        categoryFilter === id
          ? "bg-white font-semibold text-zinc-900 ring-1 ring-zinc-200"
          : "text-zinc-600 hover:bg-zinc-100",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-zinc-400 tabular-nums">{n}</span>
    </button>
  );

  const grupos = [
    ...superCategories.map((s) => ({
      key: s.id,
      label: s.name,
      cats: categories.filter((c) => c.super_category_id === s.id),
    })),
    {
      key: "__sin_super__",
      label: "Otras",
      cats: categories.filter(
        (c) =>
          !c.super_category_id ||
          !superCategories.some((s) => s.id === c.super_category_id),
      ),
    },
  ].filter((g) => g.cats.length > 0);

  return (
    <>
      <CatalogHeaderAction>
        <Button
          type="button"
          size="xl"
          className="bg-brand text-brand-foreground hover:bg-brand-hover"
          onClick={() =>
            editor.create("product", {
              category_id:
                categoryFilter !== ALL && categoryFilter !== UNCATEGORIZED
                  ? categoryFilter
                  : null,
            })
          }
        >
          <Plus /> Nuevo producto
        </Button>
      </CatalogHeaderAction>

      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside
          aria-label="Categorías"
          className="sticky top-3 max-h-[calc(100dvh-24px)] self-start overflow-y-auto pr-1 text-sm [scrollbar-width:thin] max-lg:hidden"
        >
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
            Categorías
          </p>
          {railItem(ALL, "Todas", list.length)}
          {grupos.map((g) => (
            <div
              key={g.key}
              role="group"
              aria-label={g.label}
              className="mt-2.5 border-t border-zinc-200 pt-2.5"
            >
              {g.cats.map((c) =>
                railItem(c.id, c.name, countByCategory.get(c.id) ?? 0),
              )}
            </div>
          ))}
          {hasUncategorized && (
            <div className="mt-2.5 border-t border-zinc-200 pt-2.5">
              {railItem(
                UNCATEGORIZED,
                "Sin categoría",
                countByCategory.get(UNCATEGORIZED) ?? 0,
              )}
            </div>
          )}
        </aside>

        <div className="min-w-0">
          <CatalogToolbar>
            <CatalogSearch
              value={search}
              onChange={setSearch}
              placeholder="Buscar producto…"
              onArrowDown={() => tableRef.current?.focusFirst()}
            />
            <Segmented<Estado>
              aria-label="Estado"
              value={estado as Estado}
              onChange={setEstado}
              options={[
                { value: "all", label: "Todos", count: counts.all },
                {
                  value: "disponibles",
                  label: "Disponibles",
                  count: counts.disponibles,
                },
                {
                  value: "no-disponibles",
                  label: "Agotados",
                  count: counts["no-disponibles"],
                },
                { value: "ocultos", label: "Ocultos", count: counts.ocultos },
              ]}
            />
            {stations.length > 1 && (
              <select
                aria-label="Sector"
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="h-[38px] rounded-xl border border-zinc-200 bg-white px-2.5 text-sm"
              >
                <option value={ALL}>Todos los sectores</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={SIN_SECTOR}>Sin sector</option>
                <option value={SIN_COMANDA}>Sin comanda</option>
              </select>
            )}
          </CatalogToolbar>

          {/* Categorías en teléfono / tablet: barra que scrollea. */}
          <div className="flex gap-1.5 overflow-x-auto pb-2.5 [scrollbar-width:none] lg:hidden">
            {[
              { id: ALL, name: "Todas" },
              ...categories,
              ...(hasUncategorized
                ? [{ id: UNCATEGORIZED, name: "Sin categoría" }]
                : []),
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryFilter(c.id)}
                aria-pressed={categoryFilter === c.id}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap",
                  categoryFilter === c.id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="flex justify-between gap-3 px-0.5 pb-2 text-xs text-zinc-500">
            <span className="tabular-nums">
              {filtered.length} de {list.length} productos
            </span>
            <span className="max-sm:hidden">Orden: como en la carta</span>
          </div>

          <CatalogTable<AdminProduct>
            ref={tableRef}
            aria-label="Productos"
            rows={filtered}
            columns={columns}
            getKey={(p) => p.id}
            rowLabel={(p) => p.name}
            href={(p) => `/${slug}/admin/catalogo/productos/${p.id}`}
            group={(p) => {
              const c = p.category_id ? categoryById.get(p.category_id) : null;
              return {
                key: c?.id ?? UNCATEGORIZED,
                label: c?.name ?? "Sin categoría",
              };
            }}
            dimmed={(p) => !p.is_active}
            onOpen={open}
            empty={
              list.length === 0 ? (
                "Todavía no hay productos."
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
        </div>
      </div>
    </>
  );
}
