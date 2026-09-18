"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { BookUser, Search } from "lucide-react";

import { Surface } from "@/components/admin/shell/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CuentasData } from "@/app/[business_slug]/admin/(authed)/operacion/data";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { CobrarSaldoModal } from "./cobrar-saldo-modal";

type Props = {
  slug: string;
  data: CuentasData;
  /** Sólo encargado y admin cobran un saldo (spec 141 · D7). */
  puedeCobrar: boolean;
};

/**
 * La tab «Cuentas corrientes» — spec 141 · US3.
 *
 * Reemplaza el plano «Pedidos de Mostrador», que era el workaround para lo mismo
 * y no podía funcionar: la mesa guarda quién consume AHORA, y una deuda tiene que
 * sobrevivir al cierre de la mesa.
 *
 * Dos columnas, como Salón y Caja: la lista a la izquierda, la lectura a la
 * derecha.
 */
export function CuentasCorrientesTab({ slug, data, puedeCobrar }: Props) {
  const [q, setQ] = useState("");
  const [cobrando, setCobrando] = useState<string | null>(null);

  const conDeuda = useMemo(
    () => data.deudores.filter((d) => d.saldo_cents !== 0),
    [data.deudores],
  );

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return conDeuda;
    return conDeuda.filter(
      (d) =>
        (d.name ?? "").toLowerCase().includes(term) || d.phone.includes(term),
    );
  }, [conDeuda, q]);

  // El vacío importa más que de costumbre: golf-jcr arranca en cero y va a estar
  // así un tiempo. Dice qué es la tab y cómo se empieza, no un ícono gris.
  if (conDeuda.length === 0) {
    return (
      <Surface padding="default">
        <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <BookUser className="size-7 text-muted-foreground/70" />
          </div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Nadie debe nada
            </h3>
            {/* El texto decía «habilitale la cuenta corriente en su ficha»,
                que es el viaje que la D2 revisada sacó: fiarle a alguien le
                abre la cuenta, desde el cobro y sin salir de ahí. Mandar al
                encargado a Clientes primero es exactamente lo que hacía que en
                hora pico el fiado quedara sin registrar. */}
            <p className="mt-1 text-sm text-foreground/70">
              Acá aparece quién se llevó algo sin pagar. Se fía desde el cobro,
              eligiendo «Cuenta corriente»: no hace falta habilitar a nadie
              antes.
              {data.habilitados > 0 && (
                <>
                  {" "}
                  Ya hay <strong>{data.habilitados}</strong> cliente
                  {data.habilitados === 1 ? "" : "s"} con cuenta.
                </>
              )}
            </p>
          </div>
          <Link
            href={`/${slug}/admin/clientes`}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Ir a Clientes
          </Link>
        </div>
      </Surface>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Surface padding="default">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre o teléfono"
              className="pl-9"
            />
          </div>
        </div>

        <ul className="divide-y divide-border/60">
          {visibles.map((d) => (
            <li
              key={d.customer_id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {d.name ?? d.phone}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.dias_sin_pagar == null
                    ? "sin consumos"
                    : d.dias_sin_pagar === 0
                      ? "hoy"
                      : `hace ${d.dias_sin_pagar} día${d.dias_sin_pagar === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    // Saldo a favor: existe cuando se anula un consumo ya
                    // cobrado. Se muestra, no se esconde.
                    d.saldo_cents < 0 ? "text-emerald-700" : "text-foreground",
                  )}
                >
                  {formatCurrency(Math.abs(d.saldo_cents))}
                  {d.saldo_cents < 0 && (
                    <span className="ml-1 text-xs font-normal">a favor</span>
                  )}
                </span>
                {puedeCobrar && d.saldo_cents > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setCobrando(d.customer_id)}
                  >
                    Registrar pago
                  </Button>
                )}
              </div>
            </li>
          ))}
          {visibles.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">
              Nadie con ese nombre.
            </li>
          )}
        </ul>
      </Surface>

      <Surface padding="default">
        <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Total fiado
        </p>
        <p className="mt-1 text-3xl font-semibold text-foreground tabular-nums">
          {formatCurrency(data.total_fiado_cents)}
        </p>
        <p className="mt-1 text-sm text-foreground/70">
          {data.cuantos_deben} cliente{data.cuantos_deben === 1 ? "" : "s"}
        </p>

        {/* El corte por antigüedad: es la única lectura que dispara una llamada. */}
        <div className="mt-5 space-y-2">
          {(
            [
              ["al_dia", "Al día"],
              ["mas_30", "+30 días"],
              ["mas_60", "+60 días"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span
                className={cn(
                  "text-foreground/70",
                  k === "mas_60" &&
                    data.por_tramo[k] > 0 &&
                    "font-semibold text-rose-700",
                )}
              >
                {label}
              </span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(data.por_tramo[k])}
              </span>
            </div>
          ))}
        </div>
      </Surface>

      {cobrando && (
        <CobrarSaldoModal
          slug={slug}
          cajas={data.cajas}
          deudor={data.deudores.find((d) => d.customer_id === cobrando)!}
          onClose={() => setCobrando(null)}
        />
      )}
    </div>
  );
}

/**
 * El envoltorio que resuelve la promesa del server, como los otros paneles de
 * la barra. Va acá y no en el shell para que el shell no importe `use`.
 */
export function CuentasPanel({
  promise,
  slug,
  puedeCobrar,
}: {
  promise: Promise<CuentasData>;
  slug: string;
  puedeCobrar: boolean;
}) {
  const data = use(promise);
  return (
    <CuentasCorrientesTab slug={slug} data={data} puedeCobrar={puedeCobrar} />
  );
}
