"use client";

import { useMemo, useState, type ReactNode } from "react";
import { History, PackageMinus, PackagePlus } from "lucide-react";

import { Pill } from "@/components/admin/catalog/product-bits";
import {
  CatalogTable,
  type CatalogColumn,
} from "@/components/admin/catalog/ui/catalog-table";
import {
  CatalogSearch,
  CatalogToolbar,
  Segmented,
} from "@/components/admin/catalog/ui/catalog-toolbar";
import { StockHistoryPanel } from "@/components/admin/stock/stock-history-panel";
import { StockMovementModal } from "@/components/admin/stock/stock-movement-modal";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import {
  sortByShortage,
  stockStatus,
  type StockRow,
  formatQty,
} from "@/lib/stock/stock-rows";
import { cn } from "@/lib/utils";

const STATUS_PILL = { ok: "ok", low: "warn", out: "bad" } as const;
const STATUS_LABEL = {
  ok: "OK",
  low: "Bajo mínimo",
  out: "Sin stock",
} as const;
const BAR_COLOR = {
  ok: "bg-emerald-500",
  low: "bg-amber-500",
  out: "bg-rose-500",
} as const;

/**
 * Tabla densa de una sub-tab de Stock (spec 205 · D12): Bebidas, Cocina y Bar
 * comparten esta misma lista — ordenada por lo que falta primero (ratio
 * stock/mínimo) — sobre `CatalogTable`/`CatalogToolbar` de la Fase 0.
 *
 * La fila clickeable abre **Ingresar** directo: es la acción de todos los
 * días («llegó la distribuidora»), Ajustar e Historial quedan como iconitos
 * aparte. Distinto del resto del catálogo, donde la fila abre un editor —
 * acá no hay campos que editar, sólo movimientos.
 */
export function StockList({
  rows,
  slug,
  noun,
  searchPlaceholder,
  secondaryAction,
  showCost = false,
}: {
  rows: StockRow[];
  slug: string;
  noun: "producto" | "insumo";
  searchPlaceholder: string;
  secondaryAction?: ReactNode;
  showCost?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState<"todos" | "bajo">("todos");
  const [movement, setMovement] = useState<{
    row: StockRow;
    mode: "ingreso" | "ajuste";
  } | null>(null);
  const [history, setHistory] = useState<StockRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (estado === "bajo" && stockStatus(r.qty, r.min) === "ok") return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.sub ?? "").toLowerCase().includes(q)
      );
    });
    return sortByShortage(list);
  }, [rows, search, estado]);

  const lowN = useMemo(
    () => rows.filter((r) => stockStatus(r.qty, r.min) !== "ok").length,
    [rows],
  );

  const columns: CatalogColumn<StockRow>[] = [
    {
      key: "item",
      header: noun === "insumo" ? "Insumo" : "Producto",
      width: "minmax(0,1fr)",
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-zinc-900">
            {r.name}
          </span>
          {r.sub && (
            <span className="block truncate text-xs text-zinc-500">
              {r.sub}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      width: "116px",
      hideOnMobile: true,
      cell: (r) => {
        const st = stockStatus(r.qty, r.min);
        return <Pill tone={STATUS_PILL[st]}>{STATUS_LABEL[st]}</Pill>;
      },
    },
    ...(showCost
      ? [
          {
            key: "costo",
            header: "Costo",
            width: "84px",
            align: "end" as const,
            hideOnMobile: true,
            cell: (r: StockRow) =>
              r.kind === "product" && r.costCents != null ? (
                <span className="text-[13px] text-zinc-700 tabular-nums">
                  {formatCurrency(r.costCents)}
                </span>
              ) : (
                <span className="text-[13px] text-zinc-400 italic">—</span>
              ),
          },
        ]
      : []),
    {
      key: "nivel",
      header: "Stock vs. mínimo",
      width: "190px",
      hideOnMobile: true,
      cell: (r) => {
        const st = stockStatus(r.qty, r.min);
        const pct =
          r.min > 0
            ? Math.min(100, (r.qty / (r.min * 3)) * 100)
            : r.qty > 0
              ? 100
              : 0;
        return (
          <div className="min-w-0">
            <p className="text-xs tabular-nums">
              <b className="text-zinc-900">{formatQty(r.qty, r.unit)}</b>{" "}
              <span className="text-zinc-400">
                / mín. {formatQty(r.min, r.unit)}
              </span>
            </p>
            <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-zinc-100">
              <div
                className={cn("h-full rounded-full", BAR_COLOR[st])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "acciones",
      header: "Acciones",
      width: "132px",
      align: "end",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setMovement({ row: r, mode: "ingreso" });
            }}
          >
            <PackagePlus /> <span className="max-md:hidden">Ingresar</span>
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Ajustar: ${r.name}`}
            title="Ajustar"
            onClick={(e) => {
              e.stopPropagation();
              setMovement({ row: r, mode: "ajuste" });
            }}
          >
            <PackageMinus />
          </Button>
          {r.kind === "product" && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Historial: ${r.name}`}
              title="Historial"
              onClick={(e) => {
                e.stopPropagation();
                setHistory(r);
              }}
            >
              <History />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="min-w-0">
      <CatalogToolbar>
        <CatalogSearch
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder}
        />
        <Segmented<"todos" | "bajo">
          aria-label="Estado del stock"
          value={estado}
          onChange={setEstado}
          options={[
            { value: "todos", label: "Todos", count: rows.length },
            { value: "bajo", label: "Bajo mínimo", count: lowN, alert: true },
          ]}
        />
        {secondaryAction}
      </CatalogToolbar>

      <div className="flex justify-between gap-3 px-0.5 pb-2 text-xs text-zinc-500">
        <span className="tabular-nums">
          {filtered.length} {noun === "insumo" ? "insumos" : "productos"} · lo
          que falta primero
        </span>
        <span className="max-sm:hidden">
          Ingresar suma · Ajustar corrige con motivo
        </span>
      </div>

      <CatalogTable<StockRow>
        aria-label={noun === "insumo" ? "Insumos" : "Productos con stock"}
        rows={filtered}
        columns={columns}
        getKey={(r) => `${r.kind}-${r.id}`}
        rowLabel={(r) => r.name}
        onOpen={(r) => setMovement({ row: r, mode: "ingreso" })}
        chevron={false}
        empty={
          rows.length === 0
            ? `Todavía no hay ${noun === "insumo" ? "insumos" : "productos"} con stock trackeado.`
            : `Sin resultados${search ? ` para «${search}»` : ""}.`
        }
      />

      <StockMovementModal
        open={!!movement}
        onOpenChange={(open) => !open && setMovement(null)}
        row={movement?.row ?? null}
        mode={movement?.mode ?? "ingreso"}
        slug={slug}
      />

      {history && history.kind === "product" && (
        <StockHistoryPanel
          open={!!history}
          onOpenChange={(open) => !open && setHistory(null)}
          stockItemId={history.id}
          productName={history.name}
          currentQty={history.qty}
          unit={history.unit}
        />
      )}
    </div>
  );
}
