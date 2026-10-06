"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Lock } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

import type { CorteDelHistorial } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { TXT } from "@/lib/caja/textos";
import { duracionDelTurno } from "@/lib/caja/formato-cierre";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  timezone: string;
  cajas: { id: string; name: string }[];
  cortes: CorteDelHistorial[];
  /** `""` = todas. */
  cajaId: string;
  /** El período elegido, para conservarlo al cambiar de caja (spec 153). */
  filtroUrl: { gran: string; fecha: string };
};

export function CierresClient({
  slug,
  timezone,
  cajas,
  cortes,
  cajaId,
  filtroUrl,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  /** El período lo maneja `FiltroFechas`; acá sólo cambia la caja. */
  function elegirCaja(id: string) {
    const params = new URLSearchParams(filtroUrl);
    if (id) params.set("caja", id);
    startTransition(() => {
      router.push(`/${slug}/admin/caja/cierres?${params.toString()}`);
    });
  }

  const diferenciaAcumulada = cortes.reduce(
    (acc, c) => acc + c.difference_cents,
    0,
  );
  const retirado = cortes.reduce((acc, c) => acc + c.closing_cash_cents, 0);
  const cerraronJusto = cortes.filter((c) => c.difference_cents === 0).length;

  return (
    <div className="space-y-4">
      {cajas.length > 1 && (
        <div className="flex gap-1 self-start overflow-x-auto rounded-2xl bg-white p-1.5 ring-1 ring-zinc-200/70">
          {[{ id: "", name: "Todas" }, ...cajas].map((c) => (
            <button
              key={c.id || "todas"}
              type="button"
              onClick={() => elegirCaja(c.id)}
              aria-pressed={c.id === cajaId}
              className={cn(
                "shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold transition active:scale-[0.97]",
                c.id === cajaId
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-700 hover:bg-zinc-100",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Cierres"
          value={String(cortes.length)}
          hint={
            cortes.length === 0
              ? "Ninguno en el rango"
              : `${cerraronJusto} cerró${cerraronJusto === 1 ? "" : "n"} justo`
          }
        />
        <Tile
          label="Diferencia acumulada"
          value={`${diferenciaAcumulada > 0 ? "+" : ""}${formatCurrency(diferenciaAcumulada)}`}
          hint="Suma de sobrantes y faltantes"
        />
        <Tile
          label="Efectivo contado"
          value={formatCurrency(retirado)}
          hint="Lo que había en los cajones al cerrar"
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
        {cortes.length === 0 ? (
          <p className="p-10 text-center text-base text-zinc-500">
            No hay cierres en este rango.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {cortes.map((corte) => (
              <li key={corte.id}>
                <Link
                  href={`/${slug}/admin/caja/cierres/${corte.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 transition hover:bg-zinc-50 sm:grid-cols-[minmax(0,18rem)_repeat(3,minmax(0,1fr))_minmax(0,10rem)_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600">
                      <Lock className="size-4" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {corte.numero != null && (
                          <span className="tabular-nums text-zinc-400">
                            Nº {corte.numero}{" · "}
                          </span>
                        )}
                        {corte.caja_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs tabular-nums text-zinc-500">
                        {formatInTimeZone(
                          new Date(corte.created_at),
                          timezone,
                          "EEE d/M · HH:mm",
                          { locale: es },
                        )}
                        <span className="mx-1 text-zinc-300">·</span>
                        {corte.es_primer_corte
                          ? "primer cierre de la caja"
                          : `turno de ${duracionDelTurno(corte.periodo_desde, corte.created_at)}`}
                      </p>
                    </div>
                  </div>

                  <Monto label={TXT.deberiaHaber} cents={corte.expected_cash_cents} tenue />
                  <Monto label="Contado" cents={corte.closing_cash_cents} />

                  <div className="flex items-center justify-end sm:justify-end">
                    <Diferencia cents={corte.difference_cents} />
                  </div>

                  <p className="hidden truncate text-sm text-zinc-600 sm:block">
                    {corte.encargado_name ?? "—"}
                  </p>

                  <ChevronRight className="size-4 shrink-0 text-zinc-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({
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

function Monto({
  label,
  cents,
  tenue = false,
}: {
  label: string;
  cents: number;
  tenue?: boolean;
}) {
  return (
    <p
      className={cn(
        "hidden text-right text-sm tabular-nums sm:block",
        tenue ? "text-zinc-600" : "font-semibold text-zinc-900",
      )}
    >
      <span className="sr-only">{label}: </span>
      {formatCurrency(cents)}
    </p>
  );
}

/**
 * El dato que se escanea. Verde cerró justo, rojo faltó, ámbar sobró: un
 * sobrante no es lo mismo que un faltante y no tiene que leerse igual de mal.
 */
export function Diferencia({ cents }: { cents: number }) {
  const tono =
    cents === 0
      ? "bg-emerald-50 text-emerald-700"
      : cents < 0
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-800";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums",
        tono,
      )}
    >
      {cents > 0 ? "+" : ""}
      {formatCurrency(cents)}
    </span>
  );
}
