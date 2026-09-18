"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarRange, Info, TrendingDown } from "lucide-react";
import { toast } from "sonner";

import { AmountCard } from "@/components/ui/amount-card";
import { fetchMermaReport } from "@/lib/ingredients/actions";
import type { MermaReportItem } from "@/lib/ingredients/merma";
import type { IngredientUnit } from "@/lib/ingredients/types";

function fmtQty(qty: number, unit: IngredientUnit): string {
  const n = unit === "un" ? qty.toFixed(0) : qty.toFixed(2);
  return `${n} ${unit}`;
}

/**
 * Merma del mes (spec 205 · D12): mismo reporte estimativo de siempre
 * (`fetchMermaReport`, período `mermaFrom`/`mermaTo` del negocio en
 * timezone AR), con dos KPIs arriba — total del período y mayor pérdida —
 * usando `AmountCard` de la 204 en vez de números sueltos.
 */
export function MermaTab({
  slug,
  initialReport,
  initialFrom,
  initialTo,
}: {
  slug: string;
  initialReport: MermaReportItem[];
  initialFrom: string;
  initialTo: string;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [report, setReport] = useState(initialReport);
  const [pending, startTransition] = useTransition();

  function applyRange() {
    if (from > to) {
      toast.error("La fecha de inicio no puede ser posterior a la de fin.");
      return;
    }
    startTransition(async () => {
      const r = await fetchMermaReport(slug, from, to);
      if (r.ok) setReport(r.data);
      else toast.error(r.error);
    });
  }

  // El reporte no valoriza en plata (es cantidad por insumo, unidades
  // distintas entre sí — no se pueden sumar kg + lt + un en un solo total).
  // Los dos KPIs se quedan en lo que el dato sí sabe decir.
  const conMerma = useMemo(
    () => report.filter((r) => r.mermaEstimadaQty > 0),
    [report],
  );
  const mayorPerdida = useMemo(
    () =>
      [...report].sort((a, b) => b.mermaEstimadaQty - a.mermaEstimadaQty)[0] ??
      null,
    [report],
  );

  return (
    <div className="space-y-4">
      {/* Filtros de período */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            Desde
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm transition outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            Hasta
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="block h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm transition outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <button
          type="button"
          onClick={applyRange}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
        >
          <CalendarRange className="size-4" />
          {pending ? "Calculando…" : "Aplicar"}
        </button>
      </div>

      {/* KPIs del período (spec 205 · D12) */}
      <div className="grid grid-cols-2 gap-3">
        <AmountCard
          label="Insumos con merma"
          value={conMerma.length}
          hint={`de ${report.length} en el período`}
        />
        <AmountCard
          label="Mayor pérdida"
          value={mayorPerdida ? mayorPerdida.ingredientName : "—"}
          hint={
            mayorPerdida
              ? fmtQty(
                  mayorPerdida.mermaEstimadaQty,
                  mayorPerdida.ingredientUnit,
                )
              : "sin movimientos"
          }
          tone={
            mayorPerdida && mayorPerdida.mermaEstimadaQty > 0
              ? "warning"
              : "default"
          }
        />
      </div>

      {/* Aclaración: reporte estimativo */}
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Reporte <strong>estimativo</strong>: cruza lo que entró (compras)
          contra lo que salió (ventas + merma cargada) y estima la merma teórica
          según el <em>% de merma</em> de cada insumo. No es un inventario
          contable.
        </p>
      </div>

      {/* Tabla */}
      {report.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 py-16 text-center text-zinc-400">
          <TrendingDown className="size-10 opacity-40" />
          <p className="text-sm">
            No hay movimientos de insumos en este período.
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/70 text-left text-xs font-medium tracking-wider text-zinc-500 uppercase">
                <th className="px-4 py-3">Insumo</th>
                <th className="px-4 py-3 text-right">% merma</th>
                <th className="px-4 py-3 text-right">Entró</th>
                <th className="px-4 py-3 text-right">Salió</th>
                <th className="px-4 py-3 text-right">Merma estimada</th>
                <th className="px-4 py-3 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {report.map((item) => (
                <tr
                  key={item.ingredientId}
                  className="transition hover:bg-zinc-50/50"
                >
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    {item.ingredientName}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500 tabular-nums">
                    {item.wastePercent}%
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-700 tabular-nums">
                    {fmtQty(item.enteredQty, item.ingredientUnit)}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">
                    {fmtQty(item.exitedQty, item.ingredientUnit)}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-700 tabular-nums">
                    {fmtQty(item.mermaEstimadaQty, item.ingredientUnit)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">
                    {fmtQty(item.diffQty, item.ingredientUnit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
