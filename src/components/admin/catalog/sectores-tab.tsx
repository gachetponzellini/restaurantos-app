"use client";

import { useEffect, useState, useTransition } from "react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChefHat, GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";

import { Pill, Thumb } from "@/components/admin/catalog/product-bits";
import { CatalogHeaderAction } from "@/components/admin/catalog/ui/header-action";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import { useCatalogEditor } from "@/components/admin/catalog/ui/editor-host";
import type { AdminStation } from "@/lib/admin/catalog-query";
import { reorderStations } from "@/lib/catalog/station-actions";
import {
  categoriesByDefaultStation,
  categoriesByExtraStation,
  countProductsByEffectiveStation,
  productsWithOwnStation,
} from "@/lib/catalog/station-routing";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Tab Sectores (spec 205 · D9): grilla de tarjetas —son pocos, 4-6— en vez de
 * la lista con drawer de antes. Cada tarjeta es la vista de solo-lectura del
 * ruteo que antes no existía en ningún lado: cuántos productos imprimen acá,
 * qué categorías rutean, si es 2ª comanda de alguna, si algún producto pisa el
 * sector con uno propio. Se sigue pudiendo reordenar (arrastrando del grip).
 */
export function SectoresTab() {
  const { slug, stations, categories, products } = useCatalogData();
  const router = useRouter();
  const editor = useCatalogEditor();
  const [pending, startTransition] = useTransition();

  const [order, setOrder] = useState<AdminStation[]>(() =>
    stations.slice().sort((a, b) => a.sort_order - b.sort_order),
  );
  useEffect(() => {
    setOrder(stations.slice().sort((a, b) => a.sort_order - b.sort_order));
  }, [stations]);

  // Ruteo: sector efectivo de cada producto, categorías por sector (default y
  // 2ª/3ª) y productos que lo pisan con uno propio (lógica pura, testeada en
  // `lib/catalog/station-routing.ts`).
  const countByStation = countProductsByEffectiveStation(products, categories);
  const catsByStation = categoriesByDefaultStation(categories);
  const extraCatsByStation = categoriesByExtraStation(categories);
  const ownProductsByStationMap = productsWithOwnStation(products, categories);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = order.findIndex((s) => s.id === active.id);
    const newIdx = order.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const newOrder = arrayMove(order, oldIdx, newIdx);
    const previous = order;
    setOrder(newOrder);

    startTransition(async () => {
      const r = await reorderStations(
        slug,
        newOrder.map((s) => s.id),
      );
      if (!r.ok) {
        setOrder(previous);
        toast.error(r.error);
      } else {
        router.refresh();
      }
    });
  };

  const ids = order.map((s) => s.id);

  return (
    <>
      <CatalogHeaderAction>
        <Button
          type="button"
          size="xl"
          className="bg-brand text-brand-foreground hover:bg-brand-hover"
          onClick={() => editor.create("station", { sort_order: order.length })}
        >
          <Plus /> Nuevo sector
        </Button>
      </CatalogHeaderAction>

      <p className="mb-3 text-xs text-zinc-500">
        Cada sector recibe su propia comanda impresa. Se define por categoría;
        un producto puede pisarlo desde su ficha. Arrastrá del{" "}
        <GripVertical className="-mt-0.5 inline size-3" /> para reordenar.
      </p>

      {order.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
          <ChefHat className="mx-auto size-6 text-zinc-400" />
          <p className="mt-2 text-sm font-semibold text-zinc-700">
            Sin sectores todavía
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Tocá «Nuevo sector» para crear el primero.
          </p>
        </div>
      ) : (
        <DndContext
          id="sectores"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {order.map((s) => (
                <StationCard
                  key={s.id}
                  station={s}
                  count={countByStation.get(s.id) ?? 0}
                  categorias={catsByStation.get(s.id) ?? []}
                  extraDe={extraCatsByStation.get(s.id) ?? []}
                  propios={ownProductsByStationMap.get(s.id)?.length ?? 0}
                  pending={pending}
                  onOpen={() => editor.open({ kind: "station", id: s.id }, ids)}
                />
              ))}
              <button
                type="button"
                onClick={() =>
                  editor.create("station", { sort_order: order.length })
                }
                className="flex min-h-[168px] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700"
              >
                <Plus className="size-5" />
                <span className="text-sm font-medium">Nuevo sector</span>
              </button>
            </div>
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}

function StationCard({
  station,
  count,
  categorias,
  extraDe,
  propios,
  pending,
  onOpen,
}: {
  station: AdminStation;
  count: number;
  categorias: { id: string; name: string }[];
  extraDe: { id: string; name: string }[];
  propios: number;
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
  } = useSortable({ id: station.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-2xl border border-zinc-200/80 bg-white p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,.03)]",
        isDragging && "ring-2 ring-zinc-900/10",
        !station.is_active && "opacity-55",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={pending}
        aria-label={`Arrastrar ${station.name} para reordenar`}
        className="absolute top-3 right-3 rounded-md p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-2.5 text-left"
      >
        <div className="flex items-center gap-2.5 pr-6">
          <Thumb src={null} label={station.name} seed={station.id} size={34} />
          <h3 className="truncate text-[15px] font-semibold text-zinc-900">
            {station.name}
          </h3>
        </div>

        <p className="tabular-nums">
          <span className="text-xl font-bold text-zinc-900">{count}</span>{" "}
          <span className="text-sm text-zinc-500">
            {count === 1 ? "producto imprime acá" : "productos imprimen acá"}
          </span>
        </p>

        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
            Por categoría
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {categorias.length > 0 ? (
              categorias.map((c) => (
                <Pill key={c.id} tone="off">
                  {c.name}
                </Pill>
              ))
            ) : (
              <span className="text-xs text-zinc-400">—</span>
            )}
          </div>
        </div>

        {extraDe.length > 0 && (
          <Pill tone="info">
            2ª comanda de {extraDe.map((c) => c.name).join(", ")}
          </Pill>
        )}
        {propios > 0 && (
          <Pill tone="warn">
            {propios} {propios === 1 ? "producto" : "productos"} con sector
            propio
          </Pill>
        )}
        {!station.is_active && <Pill tone="off">Inactivo</Pill>}
      </button>
    </div>
  );
}
