"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SuperCategoryAvatar } from "@/components/super-categories/visual";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import { useCatalogEditor } from "@/components/admin/catalog/ui/editor-host";
import { CatalogHeaderAction } from "@/components/admin/catalog/ui/header-action";
import {
  CatalogSearch,
  CatalogToolbar,
} from "@/components/admin/catalog/ui/catalog-toolbar";
import type {
  AdminCategory,
  AdminStation,
  AdminSuperCategory,
} from "@/lib/admin/catalog-query";
import { reorderCategories } from "@/lib/catalog/category-actions";
import { reorderSuperCategories } from "@/lib/catalog/super-category-actions";
import { cn } from "@/lib/utils";

const ORPHAN_KEY = "__orphan__";

/**
 * Tab Categorías (spec 205 · D7): las supercategorías son headers de grupo
 * (click abre su editor); las categorías son filas (click abre el editor de
 * categoría). El reordenamiento drag & drop se mantiene acá con @dnd-kit —
 * la spec lo saca de alcance para el resto del catálogo, pero esta tab es
 * donde vive `sort_order` de la carta, así que sigue existiendo tal como
 * estaba en el `CategoryDialog`/`SuperCategoryDialog` que reemplazamos.
 */
export function CategoriasTab() {
  const { slug, superCategories, categories, stations, products } =
    useCatalogData();
  const editor = useCatalogEditor();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  // Copia local optimista del orden — igual que antes: feedback inmediato del
  // drag&drop, se resincroniza cuando vuelve el server.
  const [superOrder, setSuperOrder] = useState<AdminSuperCategory[]>(() =>
    superCategories.slice().sort((a, b) => a.sort_order - b.sort_order),
  );
  const [categoryOrders, setCategoryOrders] = useState<
    Record<string, AdminCategory[]>
  >(() => groupAndSort(categories));

  useEffect(() => {
    setSuperOrder(
      superCategories.slice().sort((a, b) => a.sort_order - b.sort_order),
    );
  }, [superCategories]);
  useEffect(() => {
    setCategoryOrders(groupAndSort(categories));
  }, [categories]);

  const productCountByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      if (!p.category_id) continue;
      m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    }
    return m;
  }, [products]);
  const stationById = useMemo(
    () => new Map(stations.map((s) => [s.id, s])),
    [stations],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleSuperDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = superOrder.findIndex((s) => s.id === active.id);
    const newIdx = superOrder.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const newOrder = arrayMove(superOrder, oldIdx, newIdx);
    const previous = superOrder;
    setSuperOrder(newOrder);

    startTransition(async () => {
      const r = await reorderSuperCategories(
        slug,
        newOrder.map((s) => s.id),
      );
      if (!r.ok) {
        setSuperOrder(previous);
        toast.error(r.error);
      } else {
        router.refresh();
      }
    });
  };

  const handleCategoriesDragEnd = (
    superCategoryId: string | null,
    event: DragEndEvent,
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const key = superCategoryId ?? ORPHAN_KEY;
    const list = categoryOrders[key] ?? [];
    const oldIdx = list.findIndex((c) => c.id === active.id);
    const newIdx = list.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const newList = arrayMove(list, oldIdx, newIdx);
    const previous = categoryOrders;
    setCategoryOrders({ ...categoryOrders, [key]: newList });

    startTransition(async () => {
      const r = await reorderCategories(
        slug,
        superCategoryId,
        newList.map((c) => c.id),
      );
      if (!r.ok) {
        setCategoryOrders(previous);
        toast.error(r.error);
      } else {
        router.refresh();
      }
    });
  };

  // Buscador: sólo filtra qué se ve. Como el reorder busca por id (no por
  // posición en la lista filtrada), esconder filas es seguro para el drag&drop
  // — arrastrar sigue moviendo la fila dentro del orden real completo.
  const q = search.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);

  const groups = superOrder
    .map((sc) => ({
      sc,
      cats: (categoryOrders[sc.id] ?? []).filter(
        (c) => matches(c.name) || matches(sc.name),
      ),
    }))
    .filter((g) => !q || g.cats.length > 0 || matches(g.sc.name));

  const orphanCategories = (categoryOrders[ORPHAN_KEY] ?? []).filter((c) =>
    matches(c.name),
  );


  // ‹ › del editor recorre todas las categorías que se ven, en el orden de la
  // lista, no sólo las de su supercategoría.
  const visibleCategoryIds = [
    ...groups.flatMap((g) => g.cats.map((c) => c.id)),
    ...orphanCategories.map((c) => c.id),
  ];
  return (
    <>
      <CatalogHeaderAction>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() =>
              editor.create("superCategory", { sort_order: superOrder.length })
            }
          >
            <Plus /> Nueva supercategoría
          </Button>
          <Button
            type="button"
            size="xl"
            className="bg-brand text-brand-foreground hover:bg-brand-hover"
            onClick={() =>
              editor.create("category", { sort_order: categories.length })
            }
          >
            <Plus /> Nueva categoría
          </Button>
        </div>
      </CatalogHeaderAction>

      <CatalogToolbar>
        <CatalogSearch
          value={search}
          onChange={setSearch}
          placeholder="Buscar categoría…"
        />
      </CatalogToolbar>

      <p className="mb-2.5 px-0.5 text-xs text-zinc-500">
        Las supercategorías son las pestañas de la carta. Tocá una para
        editarla; arrastrá del{" "}
        <GripVertical className="-mt-0.5 inline h-3 w-3" /> para reordenar.
      </p>

      {groups.length === 0 && orphanCategories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-zinc-700">
            {q ? `Sin resultados para «${search}».` : "Sin categorías todavía."}
          </p>
        </div>
      ) : (
        <div className="overflow-clip rounded-2xl border border-zinc-200/80 bg-white text-sm">
          {/* id fijo: el que genera @dnd-kit cambia entre server y cliente y
              rompe la hidratación (aria-describedby). */}
          <DndContext
            id="categorias-super"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSuperDragEnd}
          >
            <SortableContext
              items={groups.map((g) => g.sc.id)}
              strategy={verticalListSortingStrategy}
            >
              {groups.map(({ sc, cats }) => (
                <SortableSuperGroup
                  key={sc.id}
                  sc={sc}
                  cats={cats}
                  stationById={stationById}
                  productCountByCategory={productCountByCategory}
                  sensors={sensors}
                  pending={pending}
                  onOpenSuper={() =>
                    editor.open(
                      { kind: "superCategory", id: sc.id },
                      groups.map((g) => g.sc.id),
                    )
                  }
                  onOpenCategory={(id) =>
                    editor.open({ kind: "category", id }, visibleCategoryIds)
                  }
                  onCategoriesDragEnd={(e) => handleCategoriesDragEnd(sc.id, e)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {orphanCategories.length > 0 && (
            <div>
              <div className="sticky top-[var(--catalog-sticky-top,0px)] z-[1] flex items-center justify-between gap-3 border-t border-b border-zinc-200/80 bg-zinc-100/95 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-800 backdrop-blur-sm">
                <span>Sin asignar</span>
                <span className="text-xs font-medium text-zinc-500 tabular-nums">
                  {orphanCategories.length}
                </span>
              </div>
              <DndContext
                id="categorias-sin-asignar"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleCategoriesDragEnd(null, e)}
              >
                <SortableContext
                  items={orphanCategories.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {orphanCategories.map((cat) => (
                    <SortableCategoryRow
                      key={cat.id}
                      category={cat}
                      productCount={productCountByCategory.get(cat.id) ?? 0}
                      stationById={stationById}
                      pending={pending}
                      onOpen={() =>
                        editor.open(
                          { kind: "category", id: cat.id },
                          visibleCategoryIds,
                        )
                      }
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

export function groupAndSort(
  categories: AdminCategory[],
): Record<string, AdminCategory[]> {
  const out: Record<string, AdminCategory[]> = {};
  for (const c of categories) {
    const key = c.super_category_id ?? ORPHAN_KEY;
    if (!out[key]) out[key] = [];
    out[key]!.push(c);
  }
  for (const key of Object.keys(out)) {
    out[key]!.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Grupo: header de supercategoría (arrastrable, clickeable) + sus categorías
// ─────────────────────────────────────────────────────────────────────────

function SortableSuperGroup({
  sc,
  cats,
  stationById,
  productCountByCategory,
  sensors,
  pending,
  onOpenSuper,
  onOpenCategory,
  onCategoriesDragEnd,
}: {
  sc: AdminSuperCategory;
  cats: AdminCategory[];
  stationById: Map<string, AdminStation>;
  productCountByCategory: Map<string, number>;
  sensors: ReturnType<typeof useSensors>;
  pending: boolean;
  onOpenSuper: () => void;
  onOpenCategory: (id: string) => void;
  onCategoriesDragEnd: (event: DragEndEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sc.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const totalProducts = cats.reduce(
    (sum, c) => sum + (productCountByCategory.get(c.id) ?? 0),
    0,
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-zinc-200/80 last:border-b-0",
        isDragging && "relative shadow-lg",
      )}
    >
      <div className="sticky top-[var(--catalog-sticky-top,0px)] z-[1] flex items-center gap-2 border-b border-zinc-200/80 bg-zinc-100/95 px-3.5 py-1.5 backdrop-blur-sm">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={pending}
          aria-label={`Arrastrar ${sc.name} para reordenar`}
          className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/70 active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onOpenSuper}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          <SuperCategoryAvatar icon={sc.icon} color={sc.color} size="sm" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-zinc-800">
            {sc.name}
          </span>
          <span className="shrink-0 text-xs font-medium text-zinc-500 tabular-nums">
            {cats.length} {cats.length === 1 ? "categoría" : "categorías"} ·{" "}
            {totalProducts} {totalProducts === 1 ? "producto" : "productos"}
          </span>
          <ChevronRight className="size-4 shrink-0 text-zinc-400" />
        </button>
      </div>

      {cats.length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-zinc-400">
          Sin categorías en esta supercategoría todavía.
        </div>
      ) : (
        <DndContext
          id={`categorias-${sc.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onCategoriesDragEnd}
        >
          <SortableContext
            items={cats.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {cats.map((cat) => (
              <SortableCategoryRow
                key={cat.id}
                category={cat}
                productCount={productCountByCategory.get(cat.id) ?? 0}
                stationById={stationById}
                pending={pending}
                onOpen={() => onOpenCategory(cat.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Fila: categoría (arrastrable, clickeable)
// ─────────────────────────────────────────────────────────────────────────

function SortableCategoryRow({
  category,
  productCount,
  stationById,
  pending,
  onOpen,
}: {
  category: AdminCategory;
  productCount: number;
  stationById: Map<string, AdminStation>;
  pending: boolean;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const stationName = category.station_id
    ? (stationById.get(category.station_id)?.name ?? "—")
    : null;
  const extra = (category.extra_station_ids ?? [])
    .map((id) => stationById.get(id)?.name)
    .filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="row"
      aria-label={category.name}
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "grid min-h-[48px] cursor-pointer items-center gap-3 border-b border-zinc-100 px-3.5 py-2 transition-colors outline-none last:border-b-0 hover:bg-zinc-50",
        "focus-visible:bg-brand-soft focus-visible:shadow-[inset_3px_0_0_var(--brand)]",
        "grid-cols-[20px_minmax(0,1fr)_64px_16px] md:grid-cols-[20px_minmax(0,1fr)_84px_170px_16px]",
        isDragging && "relative shadow-md ring-1 ring-emerald-300",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={pending}
        aria-label={`Arrastrar ${category.name} para reordenar`}
        className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="min-w-0">
        <span className="block truncate font-semibold text-zinc-900">
          {category.name}
        </span>
        <span className="block truncate font-mono text-[11px] text-zinc-400">
          /{category.slug}
        </span>
      </div>
      <span className="justify-self-end text-[13px] text-zinc-700 tabular-nums">
        {productCount}
      </span>
      <span className="hidden truncate text-[13px] text-zinc-700 md:block">
        {stationName ? (
          <>
            {stationName}
            {extra.length > 0 && (
              <span className="text-zinc-400"> +{extra.join(", ")}</span>
            )}
          </>
        ) : (
          <span className="text-zinc-400">No imprime</span>
        )}
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 justify-self-end text-zinc-300"
      />
    </div>
  );
}
