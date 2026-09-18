"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";

import { CatalogHeaderAction } from "@/components/admin/catalog/ui/header-action";
import { Segmented } from "@/components/admin/catalog/ui/catalog-toolbar";
import { StockBarAddModal } from "@/components/admin/stock/stock-bar-add-modal";
import type { BarStockCandidate } from "@/components/admin/stock/stock-bar-tab";
import { MermaTab } from "@/components/admin/stock/merma-tab";
import { StockList } from "@/components/admin/stock/stock-list";
import { StockMovementModal } from "@/components/admin/stock/stock-movement-modal";
import { StockPickerModal } from "@/components/admin/stock/stock-picker-modal";
import { Button } from "@/components/ui/button";
import type { KitchenStockFull } from "@/lib/ingredients/queries";
import type { MermaReportItem } from "@/lib/ingredients/merma";
import type { StockOverviewItem } from "@/lib/stock/queries";
import {
  bebidasToRows,
  cocinaToRows,
  lowCount,
  type StockRow,
} from "@/lib/stock/stock-rows";

type StockSub = "bebidas" | "cocina" | "bar" | "merma";

/**
 * Tab Stock del catálogo (spec 205 · D12): sub-tabs como `Segmented` con
 * badge de bajo mínimo — Bebidas · Cocina · Bar · Merma del mes — sobre el
 * mismo patrón toolbar → tabla densa → modal que ya usan Productos/Insumos.
 *
 * Firma de props sin cambios: `catalog-shell.tsx` (fuera de alcance de esta
 * spec) sigue llamando a `StockTab` con estos nombres exactos.
 */
export function StockTab({
  slug,
  bebidas,
  cocina,
  bar,
  barCandidates,
  costByProduct,
  merma,
  mermaFrom,
  mermaTo,
}: {
  slug: string;
  bebidas: StockOverviewItem[];
  cocina: KitchenStockFull[];
  bar: StockOverviewItem[];
  barCandidates: BarStockCandidate[];
  costByProduct: Record<string, number>;
  merma: MermaReportItem[];
  mermaFrom: string;
  mermaTo: string;
}) {
  const [sub, setSub] = useState<StockSub>("bebidas");
  const [addingBar, setAddingBar] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<StockRow | null>(null);

  const bebidasRows = useMemo(() => bebidasToRows(bebidas), [bebidas]);
  const cocinaRows = useMemo(() => cocinaToRows(cocina), [cocina]);
  const barRows = useMemo(
    () => bebidasToRows(bar, costByProduct),
    [bar, costByProduct],
  );

  const allRows = useMemo(
    () => [...bebidasRows, ...cocinaRows, ...barRows],
    [bebidasRows, cocinaRows, barRows],
  );

  const lowB = lowCount(bebidasRows);
  const lowC = lowCount(cocinaRows);
  const lowBar = lowCount(barRows);

  return (
    <div className="space-y-4">
      {/* «Ingresar mercadería»: la acción principal de la tab, siempre en el
          header (D6) — elegís de las tres listas y va directo al mismo
          modal de movimiento. */}
      <CatalogHeaderAction>
        <Button
          type="button"
          size="xl"
          className="bg-brand text-brand-foreground hover:bg-brand-hover"
          onClick={() => setPicking(true)}
        >
          <Plus /> Ingresar mercadería
        </Button>
      </CatalogHeaderAction>

      <Segmented<StockSub>
        aria-label="Sección de stock"
        value={sub}
        onChange={setSub}
        options={[
          { value: "bebidas", label: "Bebidas", count: lowB, alert: true },
          { value: "cocina", label: "Cocina", count: lowC, alert: true },
          { value: "bar", label: "Bar", count: lowBar, alert: true },
          { value: "merma", label: "Merma del mes" },
        ]}
      />

      {sub === "bebidas" && (
        <StockList
          rows={bebidasRows}
          slug={slug}
          noun="producto"
          searchPlaceholder="Buscar producto o categoría…"
          secondaryAction={
            <Link
              href={`/${slug}/admin/stock/configurar`}
              className="ml-auto inline-flex h-[38px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Sparkles className="size-4 text-zinc-400" />
              Elegir productos con stock
            </Link>
          }
        />
      )}

      {sub === "cocina" && (
        <StockList
          rows={cocinaRows}
          slug={slug}
          noun="insumo"
          searchPlaceholder="Buscar insumo…"
        />
      )}

      {sub === "bar" && (
        <StockList
          rows={barRows}
          slug={slug}
          noun="producto"
          searchPlaceholder="Buscar producto o categoría…"
          showCost
          secondaryAction={
            <Button
              type="button"
              variant="outline"
              className="ml-auto h-[38px]"
              onClick={() => setAddingBar(true)}
            >
              <Plus className="size-4" /> Agregar producto
            </Button>
          }
        />
      )}

      {sub === "merma" && (
        <MermaTab
          slug={slug}
          initialReport={merma}
          initialFrom={mermaFrom}
          initialTo={mermaTo}
        />
      )}

      <StockBarAddModal
        open={addingBar}
        onOpenChange={setAddingBar}
        slug={slug}
        candidates={barCandidates}
      />

      <StockPickerModal
        open={picking}
        onOpenChange={setPicking}
        rows={allRows}
        onPick={(row) => {
          setPicking(false);
          setPicked(row);
        }}
      />

      <StockMovementModal
        open={!!picked}
        onOpenChange={(open) => !open && setPicked(null)}
        row={picked}
        mode="ingreso"
        slug={slug}
      />
    </div>
  );
}
