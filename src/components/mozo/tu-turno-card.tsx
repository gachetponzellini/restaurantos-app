"use client";

import { useEffect, useState } from "react";

import { getMiTurno, type MiTurno } from "@/lib/caja/turno-actions";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * «Tu turno» en el celular del mozo (spec 211 · R7): cuánto tiene que entregar
 * y cómo sale el número. Es lo mismo que ve el encargado al rendirlo, así la
 * cuenta no se discute en el mostrador. Se carga aparte: no frena el salón.
 */
export function TuTurnoCard({ slug }: { slug: string }) {
  const [turno, setTurno] = useState<MiTurno | null>(null);
  const [error, setError] = useState(false);

  // Se refresca solo: cuando el encargado le registra la entrega, el celular
  // lo muestra sin recargar (al volver a la app y cada dos minutos).
  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      getMiTurno(slug)
        .then((r) => {
          if (!vivo) return;
          if (r.ok) {
            setTurno(r.data);
            setError(false);
          } else setError(true);
        })
        .catch(() => vivo && setError(true));
    void cargar();
    const i = setInterval(() => void cargar(), 120_000);
    const alVolver = () => document.visibilityState === "visible" && void cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      clearInterval(i);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [slug]);

  if (error && !turno) {
    return (
      <section aria-labelledby="tu-turno" className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
        <h2 id="tu-turno" className="text-sm font-semibold text-zinc-900">Tu turno</h2>
        <p className="mt-1 text-sm text-zinc-600">No pudimos cargar tu cuenta del turno. Probá de nuevo en un rato.</p>
      </section>
    );
  }
  if (!turno) {
    return <section aria-busy className="h-32 animate-pulse rounded-3xl bg-zinc-100" />;
  }

  const mesas = turno.mesas_sin_cobrar;
  // Una caja donde no tiene nada (sólo cobró con tarjeta, sin propina) no es
  // «entregá $0»: es nada para entregar.
  const cajas = turno.cajas.filter((c) => c.saldo_cents !== 0 || c.entregado_cents > 0 || c.pagado_cents > 0 || c.deuda);
  if (cajas.length === 0) {
    return (
      <div className="space-y-3">
        <section aria-labelledby="tu-turno" className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
          <h2 id="tu-turno" className="text-sm font-semibold text-zinc-900">Tu turno</h2>
          <p className="mt-1 text-sm text-zinc-600">No tenés nada para entregar en caja.</p>
        </section>
        {mesas.length > 0 && <MesasSinCobrar mesas={mesas} />}
      </div>
    );
  }

  const variasCajas = cajas.length > 1;
  return (
    <div className="space-y-3">
      {cajas.map((c) => {
        const debe = c.saldo_cents;
        const rendido = debe === 0 && (c.entregado_cents > 0 || c.pagado_cents > 0);
        return (
          <section
            key={c.caja_name}
            aria-label={`Tu turno${variasCajas ? ` · ${c.caja_name}` : ""}`}
            className={cn(
              "rounded-3xl p-5",
              rendido ? "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200" : c.deuda ? "bg-rose-50 text-rose-950 ring-1 ring-rose-200" : "bg-zinc-900 text-white",
            )}
          >
            <p className="text-sm font-semibold opacity-85">Tu turno{variasCajas ? ` · ${c.caja_name}` : ""}</p>
            <p className="mt-2 text-sm">
              {rendido ? "Rendiste. No debés nada." : c.deuda ? "Quedó pendiente de entregar" : debe < 0 ? "Te dan en caja de propina" : "Tenés que entregar en caja"}
            </p>
            {!rendido && <p className="text-4xl font-extrabold tabular-nums">{formatCurrency(Math.abs(debe))}</p>}
            {!rendido && debe > 0 && c.propina_tarjeta_cents > 0 && (
              <p className="mt-1 text-sm opacity-85">En efectivo · ya descontada tu propina de tarjeta</p>
            )}
          </section>
        );
      })}

      <section aria-labelledby="como-sale" className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
        <h2 id="como-sale" className="text-sm font-semibold text-zinc-900">Cómo sale el número</h2>
        {cajas.map((c) => (
          <dl key={c.caja_name} className="mt-2 space-y-1.5 text-sm">
            {variasCajas && <p className="text-xs font-semibold text-zinc-500">{c.caja_name}</p>}
            {c.anterior_cents !== 0 && <Fila label="Traías de antes" cents={c.anterior_cents} />}
            <Fila label="Cobraste en efectivo" cents={c.efectivo_cents} />
            {c.propina_tarjeta_cents > 0 && <Fila label="Tu propina de tarjeta y QR (te la quedás)" cents={-c.propina_tarjeta_cents} tono="text-violet-700" />}
            {c.entregado_cents > 0 && <Fila label="Ya entregaste" cents={-c.entregado_cents} />}
            {c.pagado_cents > 0 && <Fila label="Te dieron de propina en caja" cents={c.pagado_cents} />}
            <div className="flex justify-between border-t border-zinc-200 pt-1.5 font-semibold">
              <dt>{c.saldo_cents < 0 ? "Te dan en caja" : "Entregás"}</dt>
              <dd className="tabular-nums">{formatCurrency(Math.abs(c.saldo_cents))}</dd>
            </div>
            {c.propina_efectivo_cents > 0 && (
              <p className="text-xs text-zinc-500">La propina en efectivo ({formatCurrency(c.propina_efectivo_cents)}) ya la tenés: no entra en la cuenta.</p>
            )}
          </dl>
        ))}
      </section>

      <MesasSinCobrar mesas={mesas} />
    </div>
  );
}

function Fila({ label, cents, tono }: { label: string; cents: number; tono?: string }) {
  return (
    <div className={cn("flex justify-between gap-3", tono)}>
      <dt className={tono ? undefined : "text-zinc-700"}>{label}</dt>
      <dd className="tabular-nums">{cents < 0 ? `− ${formatCurrency(-cents)}` : formatCurrency(cents)}</dd>
    </div>
  );
}

function MesasSinCobrar({ mesas }: { mesas: string[] }) {
  return (
    <section
      aria-labelledby="mesas-sin-cobrar"
      className={cn("rounded-3xl p-5 ring-1", mesas.length ? "bg-amber-50 text-amber-950 ring-amber-200" : "bg-white text-zinc-700 ring-zinc-200")}
    >
      <h2 id="mesas-sin-cobrar" className="text-sm font-semibold">
        {mesas.length ? `Tenés ${mesas.map((m) => `la mesa ${m}`).join(", ")} sin cobrar` : "Mesas sin cobrar"}
      </h2>
      <p className="mt-1 text-sm">
        {mesas.length ? "Cobrala antes de ir a rendir: si no, vas a tener que rendir dos veces." : "Ninguna. Podés ir a rendir."}
      </p>
    </section>
  );
}
