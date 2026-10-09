import type { CajaLiveStats } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

/**
 * De dónde sale lo que tiene que haber en el cajón (spec 211 · R1; spec 217 ·
 * D4: vive en el paso «Contar las cajas»). Los números salen de
 * `desglose_esperado_caja` (base): el total es exactamente el que firma el
 * cierre. Se muestran sólo las líneas con plata, más el arranque.
 */
export function DesgloseDelCajon({ desglose: d }: { desglose: CajaLiveStats["desglose_esperado"] }) {
  type Linea = { label: string; sub?: string; cents: number; signo: "+" | "−" | "" };
  const todas: Linea[] = [
    { label: d.apertura_cents ? "Fondo que quedó del cierre anterior" : "Arranca en", cents: d.apertura_cents, signo: "" },
    { label: "Cobrado por la caja", sub: "Efectivo que no tiene que rendir ningún mozo", cents: d.efectivo_cents, signo: "+" },
    { label: "Rendiciones de los mozos", cents: d.rendiciones_cents ?? 0, signo: "+" },
    { label: "Ingresos", cents: d.ingresos_cents, signo: "+" },
    { label: "Sangrías", cents: d.sangrias_cents, signo: "−" },
    { label: "Propinas que se pagaron del cajón", cents: d.propinas_pagadas_cents, signo: "−" },
  ];
  const lineas = todas.filter((l, i) => i === 0 || l.cents !== 0);

  return (
    <dl className="divide-y divide-border/60 text-sm">
      {lineas.map((l) => (
        <div key={l.label} className="flex items-baseline justify-between gap-3 py-1.5">
          <dt className="text-foreground/80">
            {l.signo && `${l.signo} `}
            {l.label}
            {l.sub && <span className="block text-xs text-muted-foreground">{l.sub}</span>}
          </dt>
          <dd className="font-semibold tabular-nums">{formatCurrency(l.cents)}</dd>
        </div>
      ))}
    </dl>
  );
}
