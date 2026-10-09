"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, Lock, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { IntentLink } from "@/components/ui/intent-link";
import { AnularCuentaCerrada } from "@/components/admin/local/anular-cuenta-cerrada";
import { DesgloseDelCajon } from "@/components/admin/local/desglose-del-cajon";
import { RendirMozoModal } from "@/components/admin/local/rendir-mozo-modal";
import { getEstadoTurnoTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { efectivoDelTurno } from "@/lib/caja/efectivo-del-turno";
import { nombreDeCaja, pasoAbierto, pasosDelTurno, porQueNoSeCuenta } from "@/lib/caja/pasos-del-turno";
import { porCobrar } from "@/lib/caja/por-cobrar";
import type { CajaPayment } from "@/lib/caja/queries";
import { TXT } from "@/lib/caja/textos";
import type { CajaDelTurno, EstadoTurno, SaldoMozo } from "@/lib/caja/turno-queries";
import { cerrarTurno } from "@/lib/caja/turno-actions";
import type { CajaLiveStats } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { TZ_AR } from "@/lib/timezone";
import { cn } from "@/lib/utils";

type Paso = 1 | 2 | 3;

/**
 * «Cierre del turno», el eje de la tab Caja (spec 211 · R6; spec 217). Un turno
 * para todo el local, como en MaxiRest: ① mesas cobradas → ② rendiciones
 * resueltas (en cualquier caja) → ③ cada caja contada → «Cerrar el turno».
 *
 * Spec 217 — cada paso es una pestaña con su contenido: Por cobrar, la única
 * tabla de mozos (con dónde está el efectivo) y el cajón de cada caja con su
 * «Contar». Al entrar se abre el paso que falta; después de una acción vuelve a
 * seguir al que falta. El único primario arriba es «Cerrar el turno».
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
  statsByCaja = {},
  paymentsByCaja = {},
}: {
  slug: string;
  cajaActivaId: string;
  active: boolean;
  refreshKey: number;
  /** Abre el conteo de esa caja (el board cambia de caja si hace falta). */
  onContar: (cajaId: string) => void;
  onChanged: () => void;
  /** Los stats vivos de cada caja (poll del tablero): el cajón y lo cobrado directo. */
  statsByCaja?: Record<string, CajaLiveStats | null>;
  /** Los cobros del período de cada caja: el detalle de la rendición de cada mozo. */
  paymentsByCaja?: Record<string, CajaPayment[]>;
}) {
  const [estado, setEstado] = useState<EstadoTurno | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rindiendo, setRindiendo] = useState<SaldoMozo | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // `null`: sigue al paso que falta. Un número: el que eligió la encargada.
  const [elegido, setElegido] = useState<Paso | null>(null);
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

  // Después de rendir, contar o anular, la franja vuelve a seguir al paso que falta.
  useEffect(() => {
    setElegido(null);
  }, [refreshKey]);

  if (!estado) {
    return (
      <section aria-label="Cierre del turno" aria-busy className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
        {error ? (
          <p className="text-sm text-rose-800">No se pudo cargar el cierre del turno: {error}</p>
        ) : (
          <>
            <div className="h-6 w-44 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-14 animate-pulse rounded-xl bg-muted" />
          </>
        )}
      </section>
    );
  }

  const pasos = pasosDelTurno(estado, cajaActivaId);
  const porCobrarFilas = porCobrar(estado.cuentas_abiertas, estado.cuentas_con_saldo ?? []);
  // Al terminar de cobrar una mesa desde acá, se vuelve acá (no al salón).
  const volverAlCierre = `/${slug}/admin/operacion?tab=caja&caja=${cajaActivaId}`;
  const p = pasos.proximo;
  const abierto: Paso = elegido ?? pasoAbierto(p);
  const variasCajas = estado.cajas.length > 1;

  const despuesDeActuar = () => {
    setElegido(null);
    void cargar();
    onChanged();
  };

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
      despuesDeActuar();
    });

  const pestañas: { n: Paso; titulo: string; detalle: string; listo: boolean }[] = [
    {
      n: 1,
      titulo: "Mesas cobradas",
      detalle:
        pasos.mesas.estado === "pendiente" ? (pasos.mesas.total === 1 ? "Falta 1 mesa" : `Faltan ${pasos.mesas.total} mesas`) : "Todas cobradas",
      listo: pasos.mesas.estado === "listo",
    },
    {
      n: 2,
      titulo: "Rendiciones",
      detalle:
        pasos.rendiciones.estado === "pendiente"
          ? pasos.rendiciones.pendientes === 1
            ? "Falta 1"
            : `Faltan ${pasos.rendiciones.pendientes}`
          : "Todos resueltos",
      listo: pasos.rendiciones.estado === "listo",
    },
    {
      n: 3,
      titulo: variasCajas ? "Contar las cajas" : "Contar la caja",
      detalle: variasCajas
        ? estado.cajas.map((c) => `${c.name} ${c.sin_contar ? "pendiente" : "✓"}`).join(" · ")
        : pasos.cajas.estado === "listo"
          ? "Contada"
          : "Cuando termines lo anterior",
      listo: pasos.cajas.estado === "listo",
    },
  ];

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

        {/* Spec 217 · D5 — el único primario arriba: cobrar, rendir y contar
            tienen su botón en el paso. */}
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

      <div role="tablist" aria-label="Pasos del cierre" className="grid gap-2 sm:grid-cols-3">
        {pestañas.map((t) => {
          const seleccionado = t.n === abierto;
          return (
            <button
              key={t.n}
              type="button"
              role="tab"
              id={`cierre-paso-${t.n}`}
              aria-selected={seleccionado}
              aria-controls="cierre-panel"
              onClick={() => setElegido(t.n)}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition",
                t.listo && !seleccionado && "bg-emerald-50 text-emerald-950 ring-emerald-200 hover:bg-emerald-100/70",
                seleccionado && "bg-card ring-2 ring-foreground",
                !t.listo && !seleccionado && "bg-muted/40 ring-border/70 hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  t.listo ? "bg-emerald-600 text-white" : seleccionado ? "bg-foreground text-background" : "bg-card ring-1 ring-border",
                )}
              >
                {t.listo ? <Check className="size-4" /> : t.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t.titulo}</span>
                <span className="block text-xs opacity-80">{t.detalle}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="cierre-panel" aria-labelledby={`cierre-paso-${abierto}`}>
        {abierto === 1 && (
          <PanelPorCobrar
            slug={slug}
            filas={porCobrarFilas}
            volverAlCierre={volverAlCierre}
            onAnulada={despuesDeActuar}
          />
        )}
        {abierto === 2 && (
          <PanelRendiciones
            // Agrupados por caja, en el orden de las cajas (la principal primero).
            saldos={[...estado.saldos].sort(
              (a, b) =>
                estado.cajas.findIndex((c) => c.id === a.caja_id) - estado.cajas.findIndex((c) => c.id === b.caja_id),
            )}
            variasCajas={variasCajas}
            directoCents={estado.cajas.reduce(
              (a, c) => a + (statsByCaja[c.id]?.desglose_esperado.efectivo_cents ?? 0),
              0,
            )}
            onRendir={setRindiendo}
          />
        )}
        {abierto === 3 && (
          <PanelContar estado={estado} statsByCaja={statsByCaja} onContar={onContar} />
        )}
      </div>

      {rindiendo && (
        <RendirMozoModal
          open
          onOpenChange={(o) => !o && setRindiendo(null)}
          slug={slug}
          saldo={rindiendo}
          cobros={paymentsByCaja[rindiendo.caja_id]?.filter((p) =>
            // Sólo los que rinde él: lo que cobró la caja con su nombre no está en su saldo.
            p.rinde_mozo_id === undefined ? p.attributed_mozo_id === rindiendo.mozo_id : p.rinde_mozo_id === rindiendo.mozo_id,
          )}
          onRendido={() => {
            setRindiendo(null);
            despuesDeActuar();
          }}
        />
      )}
    </section>
  );
}

// ── Paso 1 · Por cobrar ──────────────────────────────────────────

function PanelPorCobrar({
  slug,
  filas,
  volverAlCierre,
  onAnulada,
}: {
  slug: string;
  filas: ReturnType<typeof porCobrar>;
  volverAlCierre: string;
  onAnulada: () => void;
}) {
  if (filas.length === 0) {
    return <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Todas las mesas están cobradas.</p>;
  }
  return (
    <section aria-labelledby="por-cobrar" className="rounded-xl ring-1 ring-border/70">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <h4 id="por-cobrar" className="text-sm font-semibold">
          Por cobrar
          <span className="ml-1.5 font-normal text-muted-foreground">
            · {filas.length} {filas.length === 1 ? "cuenta" : "cuentas"}
          </span>
        </h4>
        <span className="text-sm font-bold tabular-nums">{formatCurrency(filas.reduce((a, f) => a + f.faltaCents, 0))}</span>
      </div>
      <ul className="divide-y divide-border/60">
        {filas.map((f) => (
          <li key={f.orderId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
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
            <span className="flex flex-wrap items-center gap-2">
              <IntentLink
                href={
                  f.destino.kind === "mesa"
                    ? `/${slug}/admin/mesa/${f.destino.tableId}/cobrar?volver=${encodeURIComponent(volverAlCierre)}`
                    : `/${slug}/admin/pedidos/historial?q=${f.destino.orderNumber}`
                }
                className={buttonVariants({ size: "sm" })}
                aria-label={`Cobrar ${f.nombre}, falta ${formatCurrency(f.faltaCents)}`}
              >
                <Receipt className="size-4" /> Cobrar {formatCurrency(f.faltaCents)}
              </IntentLink>
              {f.anulable && (
                <AnularCuentaCerrada slug={slug} orderId={f.orderId} nombre={f.nombre} onAnulada={onAnulada} />
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Paso 2 · Rendiciones ─────────────────────────────────────────

function PanelRendiciones({
  saldos,
  variasCajas,
  directoCents,
  onRendir,
}: {
  saldos: SaldoMozo[];
  variasCajas: boolean;
  directoCents: number;
  onRendir: (m: SaldoMozo) => void;
}) {
  if (saldos.length === 0) {
    return <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Ningún mozo cobró en efectivo en este turno.</p>;
  }
  const e = efectivoDelTurno(saldos, directoCents);
  const conAnterior = saldos.some((m) => m.anterior_cents !== 0);
  const enCajon = e.directoCents + e.rendidoCents;
  const pct = (n: number) => (e.totalCents > 0 ? `${(n / e.totalCents) * 100}%` : "0%");
  const partes = [
    { label: "En el cajón", cents: enCajon, dot: "bg-zinc-700" },
    { label: "En manos de los mozos", cents: e.aRendirCents, dot: "bg-amber-500" },
    { label: "Propinas que se quedan", cents: e.propinasCents, dot: "bg-violet-500" },
    { label: "Quedó como deuda", cents: e.deudaCents, dot: "bg-rose-500" },
  ].filter((x, i) => i < 2 || x.cents > 0);

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Dónde está el efectivo" className="space-y-2.5 rounded-xl bg-muted/40 px-4 py-3">
        <p className="text-sm text-foreground/80">
          Efectivo del turno <span className="font-semibold tabular-nums text-foreground">{formatCurrency(e.totalCents)}</span>
          {e.enManosDe.length > 0 && <span className="text-muted-foreground"> · lo tienen {e.enManosDe.join(", ")}</span>}
        </p>
        <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
          {e.totalCents > 0 && partes.map((x) => <div key={x.label} className={x.dot} style={{ width: pct(x.cents) }} />)}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {partes.map((x) => (
            <div key={x.label} className="flex items-center gap-2">
              <span aria-hidden className={cn("size-2 rounded-sm", x.dot)} />
              <dt className="text-foreground/80">{x.label}</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(x.cents)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-border/70">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">Efectivo de cada mozo y lo que tiene que entregar</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">Mozo</th>
              {conAnterior && <th scope="col" className="px-3 py-2 text-right font-medium">Traía de antes</th>}
              <th scope="col" className="px-3 py-2 text-right font-medium">Cobró en efectivo</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{TXT.suPropina}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{TXT.entrego}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Tiene que entregar</th>
              <th scope="col" className="px-4 py-2"><span className="sr-only">Acción</span></th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((m) => {
              const listo = m.resuelto && m.saldo_cents === 0;
              return (
                <tr key={`${m.mozo_id}-${m.caja_id}`} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{m.mozo_name}</span>
                    {variasCajas && <span className="text-muted-foreground"> · {m.caja_name}</span>}
                    {m.mesas_sin_cobrar.length > 0 && (
                      <span className="block text-xs text-amber-800">
                        {m.mesas_sin_cobrar.length === 1 ? "Tiene 1 mesa sin cobrar" : `Tiene ${m.mesas_sin_cobrar.length} mesas sin cobrar`}
                      </span>
                    )}
                  </td>
                  {conAnterior && (
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.anterior_cents ? formatCurrency(m.anterior_cents) : "—"}</td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(m.efectivo_cents)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-violet-800">
                    {m.propina_tarjeta_cents ? `− ${formatCurrency(m.propina_tarjeta_cents)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.entregado_cents ? formatCurrency(m.entregado_cents) : "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right font-bold tabular-nums",
                      m.deuda ? "text-rose-700" : m.saldo_cents > 0 ? "text-amber-800" : m.saldo_cents < 0 ? "text-violet-800" : "text-muted-foreground",
                    )}
                  >
                    {m.saldo_cents === 0
                      ? "—"
                      : m.saldo_cents < 0
                        ? `la caja le debe ${formatCurrency(-m.saldo_cents)}`
                        : formatCurrency(m.saldo_cents)}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {listo ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">{TXT.rindio}</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={m.deuda ? "ghost" : "default"}
                        onClick={() => onRendir(m)}
                        aria-label={`Rendir a ${m.mozo_name}`}
                      >
                        {m.deuda ? "Debe · ver" : m.saldo_cents < 0 ? "Darle la propina" : "Rendir"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Paso 3 · Contar las cajas ────────────────────────────────────

function PanelContar({
  estado,
  statsByCaja,
  onContar,
}: {
  estado: EstadoTurno;
  statsByCaja: Record<string, CajaLiveStats | null>;
  onContar: (cajaId: string) => void;
}) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
      {estado.cajas.map((c) => (
        <TarjetaDeCaja key={c.id} caja={c} stats={statsByCaja[c.id] ?? null} motivo={porQueNoSeCuenta(c.id, estado)} onContar={onContar} />
      ))}
    </div>
  );
}

function TarjetaDeCaja({
  caja,
  stats,
  motivo,
  onContar,
}: {
  caja: CajaDelTurno;
  stats: CajaLiveStats | null;
  motivo: string | null;
  onContar: (cajaId: string) => void;
}) {
  const nombre = nombreDeCaja(caja.name);
  // «Caja Principal» si el nombre ya lo dice; «Caja Barra» si no.
  const titulo = /^caja\b/i.test(caja.name.trim()) ? caja.name.trim() : `Caja ${caja.name}`;
  const id = `tarjeta-caja-${caja.id}`;
  const hora = caja.ultimo_corte_at
    ? new Date(caja.ultimo_corte_at).toLocaleTimeString("es-AR", { timeZone: TZ_AR, hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-border/70">
      <h4 id={id} className="text-sm font-semibold">{titulo}</h4>
      {caja.sin_contar ? (
        <>
          <div>
            <p className="text-xs text-muted-foreground">{TXT.deberiaHaber}</p>
            {stats ? (
              <p className="text-3xl font-bold tracking-tight tabular-nums">{formatCurrency(stats.expected_cash_cents)}</p>
            ) : (
              <span className="mt-1 inline-block h-8 w-32 animate-pulse rounded-lg bg-muted" />
            )}
          </div>
          {stats && <DesgloseDelCajon desglose={stats.desglose_esperado} />}
          {motivo && <p className="text-sm text-amber-800">{motivo}</p>}
          <Button className="mt-auto w-full" disabled={motivo !== null} onClick={() => onContar(caja.id)}>
            <Lock className="size-4" /> Contar {nombre}
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-emerald-800">
          <Check className="size-4" />
          {hora ? `Contada a las ${hora}` : "Contada en este turno"}
        </p>
      )}
    </section>
  );
}
