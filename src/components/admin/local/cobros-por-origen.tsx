"use client";

import {
  METHOD_COLOR,
  METHOD_LABEL,
  methodIcon,
} from "@/components/admin/local/caja-metricas";
import type { PaymentMethod, VentaOrigen } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { MoreHorizontal, Package, Truck, UtensilsCrossed } from "lucide-react";

/**
 * Cobros por origen, con el desglose de métodos adentro de cada uno
 * (pedido de Juan, 2026-09-03).
 *
 * Antes había dos listas sueltas —una por origen, otra por método— y no se
 * podían leer juntas: la pantalla decía «Salón $206.500» y «Efectivo $228.500»
 * sin ninguna forma de saber **cuánto del salón fue en efectivo**. Y eso es
 * justo lo que explica el arqueo: un delivery cobrado con tarjeta no pone un
 * peso en el cajón; uno en efectivo sí.
 *
 * La barra es apilada y los montos van igual, escritos: el gráfico da la
 * proporción de un vistazo, el número es el que se usa para cuadrar.
 */

const ORIGEN_META: Record<
  VentaOrigen,
  { label: string; Icon: typeof UtensilsCrossed }
> = {
  salon: { label: "Salón", Icon: UtensilsCrossed },
  delivery: { label: "Delivery", Icon: Truck },
  takeaway: { label: "Take away", Icon: Package },
  otro: { label: "Otro", Icon: MoreHorizontal },
};

const ORIGEN_ORDER: VentaOrigen[] = ["salon", "delivery", "takeaway", "otro"];

const METHOD_ORDER: PaymentMethod[] = [
  "cash",
  "mp_qr",
  "mp_link",
  "card_manual",
  "transfer",
  "other",
];


export function CobrosPorOrigen({
  porOrigen,
  porOrigenYMetodo,
}: {
  porOrigen: Record<VentaOrigen, number>;
  porOrigenYMetodo: Record<VentaOrigen, Record<PaymentMethod, number>>;
}) {
  const total = ORIGEN_ORDER.reduce((s, k) => s + (porOrigen[k] ?? 0), 0);
  // `otro` sólo aparece si tiene plata: es el balde de `delivery_type` viejos o
  // desconocidos y en un local sano está siempre en cero.
  const origenes = ORIGEN_ORDER.filter(
    (k) => k !== "otro" || (porOrigen[k] ?? 0) > 0,
  );

  return (
    <ul className="mt-4 space-y-4">
      {origenes.map((origen) => {
        const { label, Icon } = ORIGEN_META[origen];
        const monto = porOrigen[origen] ?? 0;
        const pct = total > 0 ? (monto / total) * 100 : 0;
        const metodos = METHOD_ORDER.map((m) => ({
          key: m,
          monto: porOrigenYMetodo[origen]?.[m] ?? 0,
        })).filter((m) => m.monto > 0);

        return (
          <li
            key={origen}
            className="rounded-xl bg-muted/50 p-3.5 ring-1 ring-border/70"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-baseline gap-2 text-sm">
                <Icon className="size-3.5 shrink-0 translate-y-px text-muted-foreground/70" />
                <span className="font-medium text-foreground/80">{label}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-base font-bold tracking-tight text-foreground tabular-nums">
                  {formatCurrency(monto)}
                </span>
                <span className="text-xs font-medium tabular-nums text-muted-foreground/70">
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>

            {monto > 0 ? (
              <>
                {/* Barra apilada: cada segmento es un método, con el mismo
                    color en todos los orígenes. */}
                <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-border">
                  {metodos.map((m) => (
                    <div
                      key={m.key}
                      style={{
                        width: `${(m.monto / monto) * 100}%`,
                        background: METHOD_COLOR[m.key],
                      }}
                      title={`${METHOD_LABEL[m.key]}: ${formatCurrency(m.monto)}`}
                    />
                  ))}
                </div>

                <ul className="mt-2.5 space-y-1">
                  {metodos.map((m) => {
                    const Ic = methodIcon(m.key);
                    return (
                      <li
                        key={m.key}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="inline-flex items-baseline gap-1.5 text-foreground/70">
                          <span
                            className="inline-block size-2 shrink-0 translate-y-px rounded-full"
                            style={{ background: METHOD_COLOR[m.key] }}
                          />
                          <Ic className="size-3 shrink-0 translate-y-px text-muted-foreground/70" />
                          {METHOD_LABEL[m.key]}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground/90">
                          {formatCurrency(m.monto)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground/70">Sin cobros</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
