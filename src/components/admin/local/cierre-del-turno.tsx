"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, Lock, Receipt, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { IntentLink } from "@/components/ui/intent-link";
import { RendirMozoModal } from "@/components/admin/local/rendir-mozo-modal";
import { getEstadoTurnoTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { pasosDelTurno } from "@/lib/caja/pasos-del-turno";
import { porCobrar } from "@/lib/caja/por-cobrar";
import type { EstadoTurno, SaldoMozo } from "@/lib/caja/turno-queries";
import { cerrarTurno } from "@/lib/caja/turno-actions";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Franja «Cierre del turno» (spec 211 · R6). Un turno para todo el local, como
 * en MaxiRest: ① mesas cobradas → ② rendiciones resueltas (en cualquier caja)
 * → ③ cada caja contada → «Cerrar el turno». Un solo primario, que siempre es
 * el próximo paso; nunca un botón apagado sin decir qué falta.
 *
 * Los datos son los mismos que validan `cerrar_caja_tx` y `cerrar_turno_tx`.
 */
export function CierreDelTurno({
  slug,
  cajaActivaId,
  active,
  refreshKey,
  onContar,
  onChanged,
}: {
  slug: string;
  cajaActivaId: string;
  active: boolean;
  refreshKey: number;
  /** Abre el conteo de esa caja (el board cambia de caja si hace falta). */
  onContar: (cajaId: string) => void;
  onChanged: () => void;
}) {
  const [estado, setEstado] = useState<EstadoTurno | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rindiendo, setRindiendo] = useState<SaldoMozo | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [cerrando, startTransition] = useTransition();
  const seq = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++seq.current;
    try {
      const r = await getEstadoTurnoTabData(slug);
      if (mio !== seq.current) return;
      if (r.ok) {
        setEstado(r.data);
        setError(null);
      } else setError(r.error);
    } catch {
      if (mio === seq.current) setError("sin conexión");
    }
  }, [slug]);

  // El modal abierto sigue al estado vivo (el poll de 60 s o un refresh).
  useEffect(() => {
    if (!estado) return;
    setRindiendo((r) => (r ? (estado.saldos.find((m) => m.mozo_id === r.mozo_id && m.caja_id === r.caja_id) ?? r) : r));
  }, [estado]);

  useEffect(() => {
    if (!active) return;
    void cargar();
    const i = setInterval(() => void cargar(), 60_000);
    return () => clearInterval(i);
  }, [active, cargar, refreshKey]);

  if (!estado) {
    return (
      <section aria-label="Cierre del turno" aria-busy className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
        {error ? (
          <p className="text-sm text-rose-800">No se pudo cargar el cierre del turno: {error}</p>
        ) : (
          <>
            <div className="h-6 w-44 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-10 animate-pulse rounded-xl bg-muted" />
          </>
        )}
      </section>
    );
  }

  const pasos = pasosDelTurno(estado, cajaActivaId);
  const porCobrarFilas = porCobrar(estado.cuentas_abiertas, estado.cuentas_con_saldo ?? []);
  const p = pasos.proximo;
  const pendientes = estado.saldos.filter((s) => !s.resuelto);
  const variasCajas = estado.cajas.length > 1;

  const ejecutarCierre = () =>
    startTransition(async () => {
      const r = await cerrarTurno({ slug });
      setConfirmando(false);
      if (!r.ok) {
        toast.error(r.error);
        void cargar();
        return;
      }
      toast.success(
        `Turno cerrado.${r.data.mesasLiberadas > 0 ? ` Se liberaron ${r.data.mesasLiberadas} mesas.` : ""} Arranca el turno siguiente.`,
      );
      void cargar();
      onChanged();
    });

  const abrirRendicion = (mozoId: string, cajaId: string) => {
    const s = estado.saldos.find((x) => x.mozo_id === mozoId && x.caja_id === cajaId);
    if (s) setRindiendo(s);
  };

  const paso = (n: number, titulo: string, detalle: string, listo: boolean, actual: boolean) => (
    <li
      key={n}
      aria-current={actual ? "step" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1",
        listo ? "bg-emerald-50 text-emerald-950 ring-emerald-200" : actual ? "bg-card ring-foreground/70" : "bg-muted/40 ring-border/70",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          listo ? "bg-emerald-600 text-white" : actual ? "bg-foreground text-background" : "bg-card ring-1 ring-border",
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

  return (
    <section aria-labelledby="turno-titulo" className="space-y-4 rounded-2xl bg-card p-5 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="turno-titulo" className="text-base font-semibold">Cierre del turno</h3>
          <p className="text-xs text-muted-foreground">
            Uno para todo el local: cobrá las mesas, rendí a los mozos y contá {variasCajas ? "cada caja" : "la caja"}.
          </p>
          {error && <p role="status" className="mt-1 text-xs font-medium text-amber-700">Sin conexión: esto puede estar desactualizado.</p>}
        </div>

        {p.kind === "cobrar" && (
          <IntentLink href={`/${slug}/admin/mesa/${p.tableId}/cobrar`} className={buttonVariants({ size: "lg" })}>
            <Receipt className="size-4" /> {p.label}
          </IntentLink>
        )}
        {p.kind === "rendir" && (
          <Button size="lg" onClick={() => abrirRendicion(p.mozoId, p.cajaId)}>
            <UserRound className="size-4" /> {p.label}
          </Button>
        )}
        {p.kind === "contar" && (
          <Button size="lg" onClick={() => onContar(p.cajaId)}>
            <Lock className="size-4" /> {p.label}
          </Button>
        )}
        {p.kind === "turno" &&
          (confirmando ? (
            <span className="flex flex-wrap items-center gap-2">
              <Button size="lg" disabled={cerrando} onClick={ejecutarCierre}>
                {cerrando ? "Cerrando…" : "Sí, cerrar el turno"}
              </Button>
              <Button variant="link" onClick={() => setConfirmando(false)}>Cancelar</Button>
            </span>
          ) : (
            <Button size="lg" onClick={() => setConfirmando(true)}>
              <Lock className="size-4" /> Cerrar el turno
            </Button>
          ))}
      </div>

      {confirmando && (
        <p className="rounded-lg bg-muted/60 p-3 text-sm">
          Al cerrar el turno se liberan las mesas, se limpia la distribución de mozos y arranca el turno siguiente. Las cajas ya están contadas.
        </p>
      )}

      <ol className="grid gap-2 sm:grid-cols-3">
        {paso(
          1,
          "Mesas cobradas",
          pasos.mesas.estado === "pendiente" ? (pasos.mesas.total === 1 ? "Falta 1 mesa" : `Faltan ${pasos.mesas.total} mesas`) : "Todas cobradas",
          pasos.mesas.estado === "listo",
          p.kind === "cobrar",
        )}
        {paso(
          2,
          "Rendiciones",
          pasos.rendiciones.estado === "pendiente" ? (pasos.rendiciones.pendientes === 1 ? "Falta 1" : `Faltan ${pasos.rendiciones.pendientes}`) : "Todos resueltos",
          pasos.rendiciones.estado === "listo",
          p.kind === "rendir",
        )}
        {paso(
          3,
          variasCajas ? "Contar las cajas" : "Contar la caja",
          variasCajas
            ? estado.cajas.map((c) => `${c.name} ${c.sin_contar ? "pendiente" : "✓"}`).join(" · ")
            : pasos.cajas.estado === "listo" ? "Contada" : "Cuando termines lo anterior",
          pasos.cajas.estado === "listo",
          p.kind === "contar",
        )}
      </ol>

      {porCobrarFilas.length > 0 && (
        <section aria-labelledby="por-cobrar" className="rounded-xl ring-1 ring-border/70">
          <div className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-2.5">
            <h4 id="por-cobrar" className="text-sm font-semibold">
              Por cobrar
              <span className="ml-1.5 font-normal text-muted-foreground">
                · {porCobrarFilas.length} {porCobrarFilas.length === 1 ? "cuenta" : "cuentas"}
              </span>
            </h4>
            <span className="text-sm font-bold tabular-nums">
              {formatCurrency(porCobrarFilas.reduce((a, f) => a + f.faltaCents, 0))}
            </span>
          </div>
          <ul className="divide-y divide-border/60">
            {porCobrarFilas.map((f) => (
              <li key={f.orderId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">
                    <span className="font-medium">{f.nombre}</span>
                    {f.mozo && <span className="text-muted-foreground"> · {f.mozo}</span>}
                  </span>
                  <span className={cn("block text-xs", f.frena ? "text-amber-800" : "text-muted-foreground")}>
                    {f.detalle}
                    {f.pagadoCents > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        · cobrado {formatCurrency(f.pagadoCents)} de {formatCurrency(f.totalCents)}
                      </span>
                    )}
                  </span>
                </span>
                <IntentLink
                  href={
                    f.destino.kind === "mesa"
                      ? `/${slug}/admin/mesa/${f.destino.tableId}/cobrar`
                      : `/${slug}/admin/pedidos/historial?q=${f.destino.orderNumber}`
                  }
                  className={buttonVariants({ size: "sm", variant: f.frena ? "secondary" : "outline" })}
                  aria-label={`Cobrar ${f.nombre}, falta ${formatCurrency(f.faltaCents)}`}
                >
                  Cobrar {formatCurrency(f.faltaCents)}
                </IntentLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {estado.cuentas_abiertas.length === 0 && pendientes.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-xl ring-1 ring-border/70">
          {pendientes.map((m) => (
            <li key={`${m.mozo_id}-${m.caja_id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate font-medium">
                {m.mozo_name}
                {variasCajas && <span className="font-normal text-muted-foreground"> · {m.caja_name}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {m.saldo_cents < 0 ? `la caja le debe ${formatCurrency(-m.saldo_cents)}` : `tiene que entregar ${formatCurrency(m.saldo_cents)}`}
                </span>
                <Button size="sm" variant="secondary" aria-label={`Rendir a ${m.mozo_name}`} onClick={() => setRindiendo(m)}>
                  Rendir
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {rindiendo && (
        <RendirMozoModal
          open
          onOpenChange={(o) => !o && setRindiendo(null)}
          slug={slug}
          saldo={rindiendo}
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
