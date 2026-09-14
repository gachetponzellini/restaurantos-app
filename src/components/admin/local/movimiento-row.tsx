import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";

import { MOVIMIENTO_LABEL, saleDelCajon } from "@/lib/caja/movimiento-label";
import type { CajaMovimiento } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Una sangría o un ingreso, como línea de lista (spec 149).
 *
 * El anulado sigue a la vista pero tachado: no mueve la caja (spec 070) y
 * esconderlo dejaría un agujero inexplicable entre dos números que sí cierran.
 */
export function MovimientoRow({
  movimiento: m,
  timezone,
}: {
  movimiento: CajaMovimiento;
  timezone: string;
}) {
  // issue #299 — el signo ya estaba bien (la propina cae del lado de la salida),
  // pero el rótulo de fallback la llamaba «Sangría».
  const esIngreso = !saleDelCajon(m.kind);
  const anulado = m.cancelled_at != null;
  const Icon = esIngreso ? ArrowUpFromLine : ArrowDownToLine;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
          anulado
            ? "bg-zinc-100 text-zinc-400"
            : esIngreso
              ? "bg-emerald-50 text-emerald-700"
              : "bg-zinc-100 text-zinc-600",
        )}
      >
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium",
            anulado ? "text-zinc-400 line-through" : "text-zinc-900",
          )}
        >
          {m.reason?.trim() || MOVIMIENTO_LABEL[m.kind]}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
          {formatInTimeZone(new Date(m.created_at), timezone, "HH:mm")}
          {anulado ? (
            <span className="ml-1.5 font-medium text-zinc-400">· anulado</span>
          ) : null}
        </p>
      </div>
      <p
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          anulado
            ? "text-zinc-400 line-through"
            : esIngreso
              ? "text-emerald-700"
              : "text-zinc-700",
        )}
      >
        {esIngreso ? "+" : "−"}
        {formatCurrency(m.amount_cents)}
      </p>
    </li>
  );
}
