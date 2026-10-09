"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Lock, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { IntentLink } from "@/components/ui/intent-link";
import { AnularCuentaCerrada } from "@/components/admin/local/anular-cuenta-cerrada";
import { DesgloseDelCajon } from "@/components/admin/local/desglose-del-cajon";
import { ImprimirRendicionBoton } from "@/components/admin/local/imprimir-rendicion-boton";
import { RendirMozoModal } from "@/components/admin/local/rendir-mozo-modal";
import { getEstadoTurnoTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { efectivoDelTurno } from "@/lib/caja/efectivo-del-turno";
import { nombreDeCaja, pasoAbierto, pasosDelTurno, porQueNoSeCuenta, turnoSinActividad } from "@/lib/caja/pasos-del-turno";
import { porCobrar } from "@/lib/caja/por-cobrar";
import { rendicionDelTurno, type RendicionParaFila } from "@/lib/caja/rendiciones-del-turno";
import type { CajaPayment } from "@/lib/caja/queries";
import { TXT } from "@/lib/caja/textos";
import type { CajaDelTurno, EstadoTurno, SaldoMozo } from "@/lib/caja/turno-queries";
import { cerrarTurno } from "@/lib/caja/turno-actions";
import type { CajaLiveStats } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { TZ_AR } from "@/lib/timezone";
import { cn } from "@/lib/utils";

type Paso = 1 | 2 | 3;

type RendicionDelTurno = RendicionParaFila & { delivered_cash_cents: number; ya_impresa?: boolean };

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
  rendiciones = [],
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
  /** Las últimas rendiciones: el «Reimprimir» de cada mozo que ya rindió. */
  rendiciones?: RendicionDelTurno[];
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

  if (turnoSinActividad(estado)) {
    const desde = new Date(estado.abierto_at as string).toLocaleTimeString("es-AR", {
      timeZone: TZ_AR,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return (
      <section aria-labelledby="turno-titulo" className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-border/70">
        <h3 id="turno-titulo" className="text-lg font-semibold tracking-tight">Cierre del turno</h3>
        <div className="flex items-start gap-3 rounded-xl bg-muted/40 px-4 py-3.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <Check className="size-4" aria-hidden />
          </span>
          <div className="text-sm">
            <p className="font-semibold">Turno abierto desde las {desde}</p>
            <p className="mt-0.5 text-muted-foreground">
              Todavía no hay nada para cerrar. El turno anterior quedó cerrado y {estado.cajas.length > 1 ? "las cajas arrancan" : "la caja arranca"} con
              lo que se dejó de fondo. Cuando se cobren mesas, acá vas a ver qué falta.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="turno-titulo" className="space-y-4 rounded-2xl bg-card p-5 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="turno-titulo" className="text-lg font-semibold tracking-tight">Cierre del turno</h3>
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
            slug={slug}
            rendiciones={rendiciones}
            desde={estado.abierto_at}
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
    <section aria-labelledby="por-cobrar" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="por-cobrar" className="text-sm font-semibold">
          Por cobrar <span className="font-normal tabular-nums text-muted-foreground">· {filas.length}</span>
        </h4>
        <p className="text-sm text-muted-foreground">
          Falta en total <span className="font-semibold tabular-nums text-foreground">{formatCurrency(filas.reduce((a, f) => a + f.faltaCents, 0))}</span>
        </p>
      </div>
      <ul className="space-y-2">
        {filas.map((f) => (
          <li key={f.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-4 py-3 ring-1 ring-border/70">
            <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
              {/* La mesa, como se la nombra en el salón: el ancla para encontrarla. */}
              <span
                aria-hidden
                className={cn(
                  "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-1.5 text-xs font-bold tabular-nums",
                  f.frena ? "bg-amber-100 text-amber-900" : "bg-muted text-foreground/80",
                )}
              >
                {f.nombre.startsWith("Mesa ") ? f.nombre.slice(5) : "#"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm">
                  <span className="font-semibold">{f.nombre}</span>
                  {f.mozo && <span className="text-muted-foreground"> · {f.mozo}</span>}
                </p>
                <p className={cn("text-xs tabular-nums", f.frena ? "text-amber-800" : "text-muted-foreground")}>
                  {f.detalle}
                  {f.pagadoCents > 0 && ` · cobrado ${formatCurrency(f.pagadoCents)} de ${formatCurrency(f.totalCents)}`}
                </p>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Falta cobrar</p>
                <p className="text-xl font-bold tracking-tight tabular-nums">{formatCurrency(f.faltaCents)}</p>
              </div>
              <IntentLink
                href={
                  f.destino.kind === "mesa"
                    ? `/${slug}/admin/mesa/${f.destino.tableId}/cobrar?volver=${encodeURIComponent(volverAlCierre)}`
                    : `/${slug}/admin/pedidos/historial?q=${f.destino.orderNumber}`
                }
                className={cn(buttonVariants(), "min-w-28")}
                aria-label={`Cobrar ${f.nombre}, falta ${formatCurrency(f.faltaCents)}`}
              >
                <Receipt className="size-4" /> Cobrar
              </IntentLink>
              {f.anulable && (
                <AnularCuentaCerrada slug={slug} orderId={f.orderId} nombre={f.nombre} onAnulada={onAnulada} />
              )}
            </div>
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
  slug,
  rendiciones,
  desde,
}: {
  saldos: SaldoMozo[];
  variasCajas: boolean;
  directoCents: number;
  onRendir: (m: SaldoMozo) => void;
  slug: string;
  rendiciones: RendicionDelTurno[];
  desde: string | null;
}) {
  if (saldos.length === 0) {
    return <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Ningún mozo cobró en efectivo en este turno.</p>;
  }
  const e = efectivoDelTurno(saldos, directoCents);
  const enCajon = e.directoCents + e.rendidoCents;
  const pct = (n: number) => (e.totalCents > 0 ? `${(n / e.totalCents) * 100}%` : "0%");
  const partes = [
    { label: "En el cajón", cents: enCajon, dot: "bg-zinc-700" },
    { label: "En manos de los mozos", cents: e.aRendirCents, dot: "bg-amber-500" },
    { label: "Propinas que se quedan", cents: e.propinasCents, dot: "bg-violet-500" },
    { label: "Quedó como deuda", cents: e.deudaCents, dot: "bg-rose-500" },
  ].filter((x, i) => i < 2 || x.cents > 0);
  const listo = (m: SaldoMozo) => m.resuelto && m.saldo_cents === 0;
  const faltan = saldos.filter((m) => !listo(m));
  const rindieron = saldos.filter(listo);

  return (
    <div className="space-y-5">
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

      {faltan.length > 0 && (
        <section aria-labelledby="rend-faltan" className="space-y-2">
          <h4 id="rend-faltan" className="text-sm font-semibold">
            Faltan rendir <span className="font-normal tabular-nums text-muted-foreground">· {faltan.length}</span>
          </h4>
          <ul className="space-y-2">
            {faltan.map((m) => (
              <FilaPorRendir key={`${m.mozo_id}-${m.caja_id}`} m={m} variasCajas={variasCajas} onRendir={onRendir} />
            ))}
          </ul>
        </section>
      )}

      {rindieron.length > 0 && (
        <section aria-labelledby="rend-listos" className="space-y-2">
          <h4 id="rend-listos" className="text-sm font-semibold">
            Ya rindieron <span className="font-normal tabular-nums text-muted-foreground">· {rindieron.length}</span>
          </h4>
          <ul className="divide-y divide-border/60 rounded-xl bg-muted/30">
            {rindieron.map((m) => (
              <FilaRendida
                key={`${m.mozo_id}-${m.caja_id}`}
                m={m}
                variasCajas={variasCajas}
                slug={slug}
                rendicion={rendicionDelTurno(rendiciones, m.mozo_id, m.caja_id, desde)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** «LM» para Lucía Moza: un ancla visual para encontrar a cada uno rápido. */
function Iniciales({ nombre, listo = false }: { nombre: string; listo?: boolean }) {
  const ini = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        listo ? "bg-emerald-100 text-emerald-800" : "bg-muted text-foreground/80",
      )}
    >
      {listo ? <Check className="size-4" /> : ini}
    </span>
  );
}

function FilaPorRendir({
  m,
  variasCajas,
  onRendir,
}: {
  m: SaldoMozo;
  variasCajas: boolean;
  onRendir: (m: SaldoMozo) => void;
}) {
  // De dónde sale lo que tiene que entregar, en una línea y sin los ceros.
  const partes: string[] = [];
  if (m.anterior_cents) partes.push(`traía ${formatCurrency(m.anterior_cents)} de antes`);
  partes.push(`Cobró ${formatCurrency(m.efectivo_cents)} en efectivo`);
  if (m.propina_tarjeta_cents) partes.push(`su propina − ${formatCurrency(m.propina_tarjeta_cents)}`);
  if (m.entregado_cents) partes.push(`ya entregó ${formatCurrency(m.entregado_cents)}`);

  const leDebe = !m.deuda && m.saldo_cents < 0;
  const rotulo = m.deuda ? "Quedó debiendo" : leDebe ? "La caja le debe" : "Tiene que entregar";
  const monto = formatCurrency(Math.abs(m.saldo_cents));

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-4 py-3 ring-1 ring-border/70">
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
        <Iniciales nombre={m.mozo_name} />
        <div className="min-w-0">
          <p className="truncate text-sm">
            <span className="font-semibold">{m.mozo_name}</span>
            {variasCajas && <span className="text-muted-foreground"> · {m.caja_name}</span>}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">{partes.join(" · ")}</p>
          {m.mesas_sin_cobrar.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-800">
              <AlertTriangle className="size-3.5" aria-hidden />
              {m.mesas_sin_cobrar.length === 1 ? "Tiene 1 mesa sin cobrar" : `Tiene ${m.mesas_sin_cobrar.length} mesas sin cobrar`}
            </p>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{rotulo}</p>
          <p
            className={cn(
              "text-xl font-bold tracking-tight tabular-nums",
              m.deuda ? "text-rose-700" : leDebe ? "text-violet-800" : "text-foreground",
            )}
          >
            {monto}
          </p>
        </div>
        <Button
          variant={m.deuda ? "outline" : "default"}
          className="min-w-28"
          onClick={() => onRendir(m)}
          aria-label={`Rendir a ${m.mozo_name}`}
        >
          {m.deuda ? "Ver la deuda" : leDebe ? "Darle la propina" : "Rendir"}
        </Button>
      </div>
    </li>
  );
}

function FilaRendida({
  m,
  variasCajas,
  slug,
  rendicion,
}: {
  m: SaldoMozo;
  variasCajas: boolean;
  slug: string;
  rendicion: RendicionDelTurno | null;
}) {
  const hora = rendicion
    ? new Date(rendicion.created_at).toLocaleTimeString("es-AR", { timeZone: TZ_AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
        <Iniciales nombre={m.mozo_name} listo />
        <p className="min-w-0 truncate text-sm">
          <span className="font-medium">{m.mozo_name}</span>
          {variasCajas && <span className="text-muted-foreground"> · {m.caja_name}</span>}
        </p>
      </div>
      <p className="text-sm tabular-nums text-muted-foreground">
        {rendicion ? `Rindió ${formatCurrency(rendicion.delivered_cash_cents)} a las ${hora}` : "No tenía nada para rendir"}
      </p>
      {rendicion && (
        <div className="ml-auto">
          <ImprimirRendicionBoton slug={slug} rendicionId={rendicion.id} mozoName={m.mozo_name} yaImpresa={rendicion.ya_impresa} />
        </div>
      )}
    </li>
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
    ? new Date(caja.ultimo_corte_at).toLocaleTimeString("es-AR", { timeZone: TZ_AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
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
