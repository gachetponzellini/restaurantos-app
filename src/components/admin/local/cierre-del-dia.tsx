"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Lock, Receipt, UserRound } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { IntentLink } from "@/components/ui/intent-link";
import { RendirModal } from "@/components/admin/local/rendicion-en-caja";
import { getCierreCajaTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import type { CierreCajaData } from "@/lib/caja/queries";
import { pasosDelCierre } from "@/lib/caja/proximo-paso";
import { TXT } from "@/lib/caja/textos";
import type { RendicionMozoPendiente } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Franja «Cierre del día» (spec 209 · R1/R2).
 *
 * Cerrar la caja principal es una secuencia —cobrar las mesas, rendir a los
 * mozos, contar— y antes sólo se veía el último paso. Acá están los tres, con
 * su estado, y **un** botón primario que siempre es el próximo paso. Nunca hay
 * un botón apagado sin decir qué falta.
 *
 * Los datos son los mismos que bloquean en `cerrarCaja`/`cerrar_caja_tx`
 * (`getCierreCajaData`). Se piden al activar la tab, después de cada cambio y
 * cada 60 s —no en el tick de 30 s de los stats: es más pesado y la tab la
 * mira sólo supervisión—.
 */
export function CierreDelDia({
  slug,
  cajaId,
  active,
  refreshKey,
  pendientesConMesas,
  onContar,
  onChanged,
}: {
  slug: string;
  cajaId: string;
  active: boolean;
  /** Sube con cada cambio de plata del board: re-pide el estado. */
  refreshKey: number;
  /**
   * Las rendiciones pendientes del board (`getRendicionesPendientesTodosLosMozos`
   * sin caja), que traen `mesas_sin_cobrar`: el `RendirModal` las necesita
   * para trabar al mozo con una mesa suya abierta.
   */
  pendientesConMesas: RendicionMozoPendiente[];
  onContar: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<CierreCajaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rindiendo, setRindiendo] = useState<RendicionMozoPendiente | null>(null);
  const seq = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++seq.current;
    let res: Awaited<ReturnType<typeof getCierreCajaTabData>>;
    try {
      res = await getCierreCajaTabData(slug, cajaId, { sinReparto: true });
    } catch {
      // Refresh de fondo: sin red se queda con lo último que supo y reintenta
      // en el próximo tick. Si nunca cargó, lo dice.
      if (mio === seq.current) setError("sin conexión");
      return;
    }
    if (mio !== seq.current) return;
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [slug, cajaId]);

  useEffect(() => {
    setData(null);
  }, [cajaId]);

  useEffect(() => {
    if (!active) return;
    void cargar();
    const i = setInterval(() => void cargar(), 60_000);
    return () => clearInterval(i);
  }, [active, cargar, refreshKey]);

  const abrirRendicion = (mozoId: string) => {
    const conMesas = pendientesConMesas.find((p) => p.mozo_id === mozoId);
    const delCierre = data?.deben_rendir.find((p) => p.mozo_id === mozoId);
    const p = conMesas ?? delCierre;
    if (p) setRindiendo(p);
  };

  if (error && !data) {
    return (
      <section className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200">
        No se pudo cargar el estado del cierre: {error}
      </section>
    );
  }

  if (!data) {
    return (
      <section
        aria-label="Cierre del día"
        aria-busy="true"
        className="bg-card ring-border/70 rounded-2xl p-5 ring-1"
      >
        <div className="bg-muted h-6 w-40 animate-pulse rounded" />
        <div className="bg-muted mt-4 h-10 animate-pulse rounded-xl" />
      </section>
    );
  }

  const pasos = pasosDelCierre(data);
  const p = pasos.proximo;

  return (
    <section
      aria-label="Cierre del día"
      className="bg-card ring-border/70 space-y-4 rounded-2xl p-5 ring-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-foreground text-base font-semibold">Cierre del día</h4>
          <p className="text-muted-foreground text-xs">
            {data.barre_salon
              ? "Cobrá las mesas, rendí a los mozos, y después contá."
              : "Esta caja cierra sin tocar el salón: sólo hay que contar."}
          </p>
          {error && (
            <p role="status" className="mt-1 text-xs font-medium text-amber-700">
              Sin conexión: esto puede estar desactualizado.
            </p>
          )}
        </div>

        {p.kind === "cobrar" && (
          <IntentLink
            href={`/${slug}/admin/mesa/${p.tableId}/cobrar`}
            className={buttonVariants({ size: "lg" })}
          >
            <Receipt className="size-4" /> {p.label}
          </IntentLink>
        )}
        {p.kind === "rendir" && (
          <Button size="lg" onClick={() => abrirRendicion(p.mozoId)}>
            <UserRound className="size-4" /> {p.label}
          </Button>
        )}
        {p.kind === "contar" && (
          <Button size="lg" onClick={onContar}>
            <Lock className="size-4" /> {TXT.contarYCerrar}
          </Button>
        )}
      </div>

      {data.barre_salon && (
        <ol className="grid gap-2 sm:grid-cols-3">
          <Paso
            n={1}
            titulo="Mesas cobradas"
            listo={pasos.mesas.estado === "listo"}
            detalle={
              pasos.mesas.estado === "pendiente"
                ? pasos.mesas.total === 1
                  ? "Falta 1 mesa"
                  : `Faltan ${pasos.mesas.total} mesas`
                : "Todas cobradas"
            }
          />
          <Paso
            n={2}
            titulo="Rendiciones"
            listo={pasos.rendiciones.estado === "listo"}
            detalle={
              pasos.rendiciones.estado === "pendiente"
                ? pasos.rendiciones.pendientes === 1
                  ? "Falta 1"
                  : `Faltan ${pasos.rendiciones.pendientes}`
                : "Todos rindieron"
            }
          />
          <Paso
            n={3}
            titulo={TXT.contarYCerrar}
            listo={false}
            actual={p.kind === "contar"}
            detalle={p.kind === "contar" ? "Listo para contar" : "Cuando termines lo anterior"}
          />
        </ol>
      )}

      {data.barre_salon && data.cuentas_abiertas.length > 0 && (
        <ul className="divide-border/60 ring-border/70 divide-y rounded-xl ring-1">
          {data.cuentas_abiertas.map((m) => (
            <li
              key={m.order_id}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">Mesa {m.table_label}</span>
                {m.mozo_name && (
                  <span className="text-muted-foreground"> · {m.mozo_name}</span>
                )}
              </span>
              <IntentLink
                href={`/${slug}/admin/mesa/${m.table_id}/cobrar`}
                className={buttonVariants({ size: "sm", variant: "secondary" })}
                aria-label={`Cobrar mesa ${m.table_label}, ${formatCurrency(m.pendiente_cents)}`}
              >
                Cobrar {formatCurrency(m.pendiente_cents)}
              </IntentLink>
            </li>
          ))}
        </ul>
      )}

      {data.barre_salon &&
        data.cuentas_abiertas.length === 0 &&
        data.deben_rendir.length > 0 && (
          <ul className="divide-border/60 ring-border/70 divide-y rounded-xl ring-1">
            {data.deben_rendir.map((m) => (
              <li
                key={m.mozo_id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate font-medium">{m.mozo_name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {m.efectivo_cents > 0
                      ? `tiene que entregar ${formatCurrency(m.efectivo_cents)}`
                      : "sin efectivo"}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Rendir a ${m.mozo_name}`}
                    onClick={() => abrirRendicion(m.mozo_id)}
                  >
                    Rendir
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

      {data.barre_salon && data.sin_operadores && data.deben_rendir.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Nadie figura como operador de esta caja, así que todos los que cobraron
          tienen que rendir.{" "}
          <IntentLink
            href={`/${slug}/admin/caja`}
            className="font-semibold underline underline-offset-2"
          >
            Asigná la caja
          </IntentLink>{" "}
          a quien la atiende y deja de aparecer en esta lista.
        </p>
      )}

      {data.barre_salon && data.pedidos_abiertos.length > 0 && (
        <p className="text-foreground/70 text-xs">
          {data.pedidos_abiertos.length === 1
            ? "Queda 1 pedido de delivery / take away abierto"
            : `Quedan ${data.pedidos_abiertos.length} pedidos de delivery / take away abiertos`}
          . No frenan el cierre: si se cobran después, entran en el turno nuevo.
        </p>
      )}

      {rindiendo && (
        <RendirModal
          open
          onOpenChange={(o) => !o && setRindiendo(null)}
          pendiente={rindiendo}
          slug={slug}
          onSuccess={() => {
            setRindiendo(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function Paso({
  n,
  titulo,
  detalle,
  listo,
  actual = false,
}: {
  n: number;
  titulo: string;
  detalle: string;
  listo: boolean;
  actual?: boolean;
}) {
  return (
    <li
      aria-current={actual ? "step" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1",
        listo
          ? "bg-emerald-50 text-emerald-950 ring-emerald-200"
          : actual
            ? "bg-primary/5 text-foreground ring-primary/40"
            : "bg-muted/40 text-foreground ring-border/70",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          listo ? "bg-emerald-600 text-white" : "bg-card text-foreground ring-border ring-1",
        )}
      >
        {listo ? <Check className="size-4" /> : n}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs opacity-80">{detalle}</span>
      </span>
    </li>
  );
}
