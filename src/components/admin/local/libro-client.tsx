"use client";

import {
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";


import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MOVIMIENTO_LABEL, saleDelCajon } from "@/lib/caja/movimiento-label";
import type { LibroEntry, LibroTotales, PaymentMethod } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import {
  DetalleSheet,
  METHOD_LABEL,
  fecha,
  hora,
  iconoDe,
} from "./detalle-movimiento-sheet";
type FiltrosUI = {
  /** El período lo maneja `FiltroFechas` (spec 153); acá sólo viaja para conservarlo. */
  gran: string;
  fecha: string;
  caja: string;
  tipo: string;
  metodo: string;
  mozo: string;
  q: string;
};

type Props = {
  slug: string;
  cajas: { id: string; name: string }[];
  mozos: { id: string; name: string }[];
  entries: LibroEntry[];
  totales: LibroTotales;
  truncado: boolean;
  filtros: FiltrosUI;
  puedeCorregir: boolean;
  esAdmin: boolean;
};

export function LibroClient({
  slug,
  cajas,
  mozos,
  entries,
  totales,
  truncado,
  filtros,
  puedeCorregir,
  esAdmin,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [detalle, setDetalle] = useState<LibroEntry | null>(null);

  function aplicar(patch: Partial<FiltrosUI>) {
    const next = { ...filtros, ...patch };
    const params = new URLSearchParams();
    params.set("gran", next.gran);
    params.set("fecha", next.fecha);
    if (next.caja) params.set("caja", next.caja);
    if (next.tipo) params.set("tipo", next.tipo);
    if (next.metodo) params.set("metodo", next.metodo);
    if (next.mozo) params.set("mozo", next.mozo);
    if (next.q) params.set("q", next.q);
    startTransition(() => {
      router.push(`/${slug}/admin/caja/movimientos?${params.toString()}`);
    });
  }

  const selectClass =
    "h-10 rounded-lg border border-zinc-200 bg-white px-2.5 text-base text-zinc-800";

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Caja</Label>
          <select
            className={selectClass}
            value={filtros.caja}
            onChange={(e) => aplicar({ caja: e.target.value })}
          >
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Tipo</Label>
          <select
            className={selectClass}
            value={filtros.tipo}
            onChange={(e) => aplicar({ tipo: e.target.value })}
          >
            <option value="">Todo</option>
            <option value="cobro">Cobros</option>
            <option value="sangria">Sangrías</option>
            <option value="ingreso">Ingresos</option>
            <option value="propina">Propinas pagadas</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Método</Label>
          <select
            className={selectClass}
            value={filtros.metodo}
            onChange={(e) => aplicar({ metodo: e.target.value })}
          >
            <option value="">Todos</option>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Mozo</Label>
          <select
            className={selectClass}
            value={filtros.mozo}
            onChange={(e) => aplicar({ mozo: e.target.value })}
          >
            <option value="">Todos</option>
            {mozos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid flex-1 gap-1">
          <Label className="text-xs text-zinc-500">Buscar</Label>
          <Input
            defaultValue={filtros.q}
            placeholder="Mesa, cliente o # de orden"
            className="h-10 text-base"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                aplicar({ q: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Totalizador
          label="Cobrado"
          value={formatCurrency(totales.cobrado_cents)}
          hint={`${totales.cobros_count} ${totales.cobros_count === 1 ? "cobro" : "cobros"}`}
        />
        <Totalizador
          label="Propinas"
          value={formatCurrency(totales.propinas_cents)}
          hint="dentro de lo cobrado"
        />
        <Totalizador
          label="Ingresos"
          value={formatCurrency(totales.ingresos_cents)}
          hint="a la caja"
        />
        {totales.rendiciones_cents > 0 && (
          <Totalizador
            label="Rendiciones"
            value={formatCurrency(totales.rendiciones_cents)}
            hint="entregado por mozos"
          />
        )}
        <Totalizador
          label="Sangrías"
          value={formatCurrency(totales.sangrias_cents)}
          hint="fuera de la caja"
        />
        {/* Spec 177 — sólo si hubo: en un local que todavía no paga propinas
            por el sistema, un totalizador en $0 es una columna vacía. */}
        {totales.propinas_pagadas_cents > 0 && (
          <Totalizador
            label="Propinas pagadas"
            value={formatCurrency(totales.propinas_pagadas_cents)}
            hint="a los mozos"
          />
        )}
      </div>

      {truncado && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          El rango tiene más movimientos de los que entran en una pantalla: se
          muestran los más recientes. Acotá las fechas para verlos todos.
        </p>
      )}

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
        {entries.length === 0 ? (
          <p className="p-10 text-center text-base text-zinc-500">
            No hubo movimientos en este período.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {entries.map((e) => {
              const Icon = iconoDe(e);
              // Gobierna el signo de abajo. Se llamaba `esSangria` aunque ya
              // incluía la propina: el valor era correcto, el nombre no, y un
              // nombre que miente sobre un signo de plata es como nació el #299.
              const sale = e.tipo !== "cobro" && saleDelCajon(e.tipo);
              return (
                <li key={`${e.tipo}-${e.id}`}>
                  <button
                    type="button"
                    onClick={() => setDetalle(e)}
                    className="flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-zinc-50"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
                        e.anulado
                          ? "bg-zinc-100 text-zinc-400"
                          : e.tipo === "propina"
                            ? "bg-amber-50 text-amber-700"
                            : sale
                              ? "bg-rose-50 text-rose-700"
                              : e.tipo === "ingreso"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-zinc-100 text-zinc-700",
                      )}
                    >
                      <Icon className="size-4.5" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-base font-semibold text-zinc-900",
                            e.anulado && "text-zinc-400 line-through",
                          )}
                        >
                          {e.descripcion}
                          <span className="ml-2 text-xs font-normal tabular-nums text-zinc-400">
                            {fecha(e.created_at)} {hora(e.created_at)}
                          </span>
                        </p>
                        <p
                          className={cn(
                            "shrink-0 text-base font-bold tabular-nums",
                            e.anulado
                              ? "text-zinc-400 line-through"
                              : sale
                                ? "text-rose-700"
                                : "text-zinc-900",
                          )}
                        >
                          {sale ? "−" : "+"}
                          {formatCurrency(e.amount_cents)}
                        </p>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm text-zinc-500">
                          {e.tipo === "cobro"
                            ? e.method
                              ? METHOD_LABEL[e.method]
                              : "Cobro"
                            : // issue #299 — decía «Sangría» para el pago de
                              // propina, que el drawer de abajo ya nombraba bien.
                              MOVIMIENTO_LABEL[e.tipo]}
                          <span className="mx-1 text-zinc-300">·</span>
                          {e.caja_name}
                          {e.attributed_mozo_name && (
                            <>
                              <span className="mx-1 text-zinc-300">·</span>
                              {e.attributed_mozo_name}
                            </>
                          )}
                        </p>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {e.tip_cents > 0 && !e.anulado && (
                            <span className="text-sm tabular-nums text-emerald-700">
                              +{formatCurrency(e.tip_cents)} propina
                            </span>
                          )}
                          {e.corregido && (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                              corregido
                            </span>
                          )}
                          {e.anulado && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                              anulado
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DetalleSheet
        entry={detalle}
        slug={slug}
        cajas={cajas}
        mozos={mozos}
        puedeCorregir={puedeCorregir}
        esAdmin={esAdmin}
        onClose={() => setDetalle(null)}
        onDone={() => {
          setDetalle(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function Totalizador({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-zinc-900">
        {value}
      </p>
      <p className="mt-0.5 text-sm text-zinc-500">{hint}</p>
    </div>
  );
}

/**
 * El panel de la línea: detalle **y** corrección en el mismo lugar. Antes la
 * corrección abría un modal encima del panel — dos capas para editar cuatro
 * campos. Acá se edita donde se mira, con la misma estética del detalle.
 */
