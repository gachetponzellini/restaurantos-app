"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { RendirMozoModal } from "@/components/admin/local/rendir-mozo-modal";
import { getSaldosCajaTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import type { CajaPayment } from "@/lib/caja/queries";
import { TXT } from "@/lib/caja/textos";
import type { SaldoMozo } from "@/lib/caja/turno-queries";
import type { CajaLiveStats } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * «Efectivo: dónde está» (spec 211 · R1). Del efectivo de la caja: lo que
 * cobró la caja directo (ya está en el cajón), lo que entregaron los mozos (ya
 * está en el cajón), lo que todavía tienen y sus propinas de tarjeta, que se
 * quedan del efectivo. Debajo, cada mozo con su cuenta y su botón Rendir.
 *
 * Los números de los mozos salen de `saldos_mozos` (base), con las cifras del
 * período abierto de la caja; nada se recalcula acá.
 */
export function EfectivoDeLaCaja({
  slug,
  cajaId,
  stats,
  payments,
  active,
  refreshKey,
  onChanged,
}: {
  slug: string;
  cajaId: string;
  stats: CajaLiveStats | null;
  payments: CajaPayment[];
  active: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [saldos, setSaldos] = useState<SaldoMozo[] | null>(null);
  const [rindiendo, setRindiendo] = useState<SaldoMozo | null>(null);
  const seq = useRef(0);
  const desde = stats?.periodo_desde ?? null;

  const cargar = useCallback(async () => {
    if (!desde) return;
    const mio = ++seq.current;
    try {
      const r = await getSaldosCajaTabData(slug, cajaId, desde);
      if (mio === seq.current && r.ok) setSaldos(r.data);
    } catch {
      // Refresh de fondo: se queda con lo último que supo.
    }
  }, [slug, cajaId, desde]);

  useEffect(() => {
    setSaldos(null);
  }, [cajaId]);

  // El modal abierto sigue a la lista viva: si el refresh trae otro saldo, se
  // ve el nuevo (y el servidor rechaza confirmar sobre uno viejo).
  useEffect(() => {
    if (!saldos) return;
    setRindiendo((r) => (r ? (saldos.find((m) => m.mozo_id === r.mozo_id && m.caja_id === r.caja_id) ?? r) : r));
  }, [saldos]);

  useEffect(() => {
    if (!active) return;
    void cargar();
  }, [active, cargar, refreshKey]);

  if (!stats) return null;

  const directo = stats.desglose_esperado.efectivo_cents;
  const lista = saldos ?? [];
  // Cada mozo reparte lo que tuvo en la mano (lo de antes + lo que cobró) en:
  // lo que entregó, lo que todavía tiene (a rendir o deuda) y su propina de
  // tarjeta, que se queda de ese efectivo. Si la caja le pagó parte de la
  // propina, esa parte no salió de su efectivo; si la caja todavía le debe, lo
  // que se quedó es todo lo que tenía. Así los tiles suman exacto.
  const suma = (f: (m: SaldoMozo) => number) => lista.reduce((a, m) => a + f(m), 0);
  const rendido = suma((m) => m.entregado_cents);
  const aRendir = suma((m) => (m.deuda ? 0 : Math.max(0, m.saldo_cents)));
  const deuda = suma((m) => (m.deuda ? Math.max(0, m.saldo_cents) : 0));
  const propinas = suma((m) =>
    Math.max(0, m.anterior_cents + m.efectivo_cents - m.entregado_cents - Math.max(0, m.saldo_cents)),
  );
  const anterior = suma((m) => m.anterior_cents);
  // La propina en efectivo que cobró la caja directo está en el cajón, pero
  // «Cobrado por método» la muestra aparte: se aclara para que los dos
  // números de efectivo no parezcan una cuenta que no cierra.
  const propinaDirecta = payments
    .filter((p) => p.method === "cash" && !p.rinde_mozo_id)
    .reduce((a, p) => a + p.tip_cents, 0);
  const total = directo + rendido + aRendir + propinas + deuda;
  const conAnterior = lista.some((m) => m.anterior_cents !== 0);

  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  const tiles: { label: string; cents: number; sub: string; dot: string; tono?: string; ver?: boolean }[] = [
    { label: "Lo cobró la caja", cents: directo, sub: "Ya está en el cajón", dot: "bg-zinc-800" },
    { label: "Rendido por mozos", cents: rendido, sub: "Ya está en el cajón", dot: "bg-zinc-400" },
    {
      label: "A rendir",
      cents: aRendir,
      sub: aRendir > 0 ? `En manos de ${lista.filter((m) => !m.deuda && m.saldo_cents > 0).map((m) => m.mozo_name.split(" ")[0]).join(", ")}` : "Nadie tiene plata encima",
      dot: "bg-amber-400",
      tono: "bg-amber-50 text-amber-950",
    },
    { label: "Propinas de los mozos", cents: propinas, sub: "Las de tarjeta y QR: se las quedan del efectivo", dot: "bg-violet-400", tono: "bg-violet-50 text-violet-950", ver: propinas > 0 },
    { label: "Quedó como deuda", cents: deuda, sub: "Pasa al turno siguiente", dot: "bg-rose-500", tono: "bg-rose-50 text-rose-950", ver: deuda > 0 },
  ];

  return (
    <section aria-labelledby="efectivo-titulo" className="space-y-4 rounded-2xl bg-card p-5 ring-1 ring-border/70">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="efectivo-titulo" className="text-[0.95rem] font-semibold">Efectivo: dónde está</h3>
        <p className="text-sm text-muted-foreground">
          Efectivo del período{" "}
          <span className="font-semibold tabular-nums text-foreground">{formatCurrency(total)}</span>
          {propinaDirecta > 0 && (
            <span className="block text-xs">Incluye {formatCurrency(propinaDirecta)} de propinas en efectivo que cobró la caja</span>
          )}
          {anterior > 0 && <span className="block text-xs">Incluye {formatCurrency(anterior)} que los mozos traían de antes</span>}
        </p>
      </div>

      <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
        {total > 0 && (
          <>
            <div className="bg-zinc-800" style={{ width: pct(directo) }} />
            <div className="bg-zinc-400" style={{ width: pct(rendido) }} />
            <div className="bg-amber-400" style={{ width: pct(aRendir) }} />
            <div className="bg-violet-400" style={{ width: pct(propinas) }} />
            <div className="bg-rose-500" style={{ width: pct(deuda) }} />
          </>
        )}
      </div>

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2.5">
        {tiles
          .filter((t) => t.ver !== false)
          .map((t) => (
            <div key={t.label} className={cn("rounded-xl px-3.5 py-3", t.tono ?? "bg-muted/40")}>
              <dt className="flex items-center gap-2 text-[0.8rem] opacity-85">
                <span className={cn("size-2 rounded-sm", t.dot)} />
                {t.label}
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{formatCurrency(t.cents)}</dd>
              <dd className="mt-0.5 text-xs opacity-80">{t.sub}</dd>
            </div>
          ))}
      </dl>

      {lista.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="pb-2 text-left text-[0.8rem] text-muted-foreground">
              Efectivo de cada mozo. Su propina de tarjeta y QR se la queda de lo que cobró: entrega el resto.
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-2.5 py-2 font-medium">Mozo</th>
                {conAnterior && <th scope="col" className="px-2.5 py-2 text-right font-medium">Anterior</th>}
                <th scope="col" className="px-2.5 py-2 text-right font-medium">Cobró en efectivo</th>
                <th scope="col" className="px-2.5 py-2 text-right font-medium">{TXT.suPropina}</th>
                <th scope="col" className="px-2.5 py-2 text-right font-medium">{TXT.entrego}</th>
                <th scope="col" className="px-2.5 py-2 text-right font-medium">Le queda</th>
                <th scope="col" className="px-2.5 py-2"><span className="sr-only">Acción</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.mozo_id} className="border-b border-border/60">
                  <td className="px-2.5 py-2.5 font-semibold">{m.mozo_name}</td>
                  {conAnterior && <td className="px-2.5 py-2.5 text-right tabular-nums">{m.anterior_cents ? formatCurrency(m.anterior_cents) : "—"}</td>}
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{formatCurrency(m.efectivo_cents)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-violet-800">
                    {m.propina_tarjeta_cents ? `− ${formatCurrency(m.propina_tarjeta_cents)}` : "—"}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{m.entregado_cents ? formatCurrency(m.entregado_cents) : "—"}</td>
                  <td
                    className={cn(
                      "px-2.5 py-2.5 text-right font-bold tabular-nums",
                      m.deuda ? "text-rose-700" : m.saldo_cents > 0 ? "text-amber-800" : m.saldo_cents < 0 ? "text-violet-800" : "text-muted-foreground",
                    )}
                  >
                    {m.saldo_cents === 0 ? "—" : m.saldo_cents < 0 ? `le debemos ${formatCurrency(-m.saldo_cents)}` : formatCurrency(m.saldo_cents)}
                  </td>
                  <td className="px-2.5 py-2 text-right whitespace-nowrap">
                    {m.resuelto && m.saldo_cents === 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">{TXT.rindio}</span>
                    ) : (
                      <Button size="sm" variant={m.deuda ? "ghost" : "outline"} onClick={() => setRindiendo(m)} aria-label={`Rendir a ${m.mozo_name}`}>
                        {m.deuda ? "Debe · ver" : m.saldo_cents < 0 ? "Darle propina" : "Rendir"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rindiendo && (
        <RendirMozoModal
          open
          onOpenChange={(o) => !o && setRindiendo(null)}
          slug={slug}
          saldo={rindiendo}
          cobros={payments.filter((p) =>
            // Sólo los que rinde él: lo que cobró la caja con su nombre no está en su saldo.
            p.rinde_mozo_id === undefined ? p.attributed_mozo_id === rindiendo.mozo_id : p.rinde_mozo_id === rindiendo.mozo_id,
          )}
          onRendido={() => {
            setRindiendo(null);
            void cargar();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
