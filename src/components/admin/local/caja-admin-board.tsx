"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ReceiptText,
  RefreshCw,
  Settings,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { IntentLink } from "@/components/ui/intent-link";
import { Surface } from "@/components/admin/shell/page-shell";
import { CerrarCajaModal } from "@/components/admin/local/cerrar-caja-modal";
import { CierreDelTurno } from "@/components/admin/local/cierre-del-turno";
import { CajaAssignmentsPanel } from "@/components/admin/local/caja-assignments-tab";
import { DetalleSheet } from "@/components/admin/local/detalle-movimiento-sheet";
import {
  COBRO_METHOD_ORDER,
  METHOD_COLOR,
  METHOD_LABEL,
  methodIcon,
} from "@/components/admin/local/caja-metricas";
import { SegmentedSelector } from "@/components/admin/local/segmented-selector";
import { MovimientoModal } from "@/components/admin/local/movimiento-modal";
import { Button } from "@/components/ui/button";
import { registrarIngreso, registrarSangria } from "@/lib/caja/actions";
import type {
  CajaData,
  RendicionData,
} from "@/app/[business_slug]/admin/(authed)/operacion/data";
import { MOVIMIENTO_LABEL, saleDelCajon } from "@/lib/caja/movimiento-label";
import type { CajaPayment } from "@/lib/caja/queries";
import type {
  CajaConEstado,
  CajaLiveStats,
  CajaMovimiento,
} from "@/lib/caja/types";
import {
  resolverCajaActiva,
  useCajaPreferida,
} from "@/lib/caja/use-caja-preferida";
import { useOnActivate } from "@/lib/ui/use-tab-param";
import {
  getCajaTabData,
  getEntradaDelLibroTabData,
} from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import type { LibroEntry } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import {
  conSaldoCorrido,
  efectoEnCajon,
  FILTROS_CAJA,
  pasaFiltro,
  type FiltroCaja,
  type LineaDeCaja,
} from "@/lib/caja/saldo-corrido";
import { cn } from "@/lib/utils";
import type {
} from "@/lib/caja/types";
import { TZ_AR } from "@/lib/timezone";

type Props = {
  slug: string;
  cajas: CajaConEstado[];
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
  /** `true` si el panel montó lazy (spec 103): entonces revalida al montar. */
  refetchAlMontar?: boolean;
  /** Spec 103: cada snapshot nuevo del refetch, para el badge de la tab. */
  onServerData?: (d: CajaData) => void;
  /**
   * Spec 153 — el `?caja=` con el que «Ver ahora» abre una caja puntual desde
   * la sección Caja. Viaja como prop desde el server y no por
   * `useSearchParams`: la página ya lee sus searchParams y este panel se monta
   * lazy detrás de un `next/dynamic`, así que el dato explícito es el que
   * llega seguro.
   */
  cajaPedida?: string | null;
  /** #351 — la rendición de mozos se hace acá, en las cards por empleado. */
  rendicion?: RendicionData;
  /** Asignación caja↔usuario: sólo el admin. */
  showAssignments?: boolean;
};

export function CajaAdminBoard({
  slug,
  cajas: initialCajas,
  active = true,
  refetchAlMontar = false,
  onServerData,
  cajaPedida,
  rendicion: initialRendicion,
  showAssignments = false,
}: Props) {
  const [statsByCaja, setStatsByCaja] = useState<
    Record<string, CajaLiveStats | null>
  >({});
  const [movimientosByCaja, setMovimientosByCaja] = useState<
    Record<string, CajaMovimiento[]>
  >({});
  const [paymentsByCaja, setPaymentsByCaja] = useState<
    Record<string, CajaPayment[]>
  >({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Snapshot del server de la tab (las cajas con su último corte y período),
  // seedeado de los props y actualizado sólo por el refetch (spec 103). Antes
  // esto se refrescaba con `router.refresh()`, que re-corría las 7 tabs.
  const [cajas, setCajas] = useState(initialCajas);
  // Se reemplaza entero con cada refetch: es plata, y sumar en el cliente es
  // como se duplica una rendición.
  const [rendicion, setRendicion] = useState(initialRendicion);
  const refetchSeq = useRef(0);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  const refetchCaja = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getCajaTabData(slug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) {
        setCajas(res.data.cajas);
        setRendicion(res.data.rendicion);
        onServerDataRef.current?.(res.data);
      }
    } catch {
      // swallow: refresh de fondo. La caja NUNCA se vacía por un error de red;
      // los números que decidan un corte salen del poll de stats, que avisa
      // aparte.
    }
  }, [slug]);

  /**
   * Después de mover plata: se re-piden las dos mitades. `refetchCaja` trae el
   * estado de la caja (último corte, período) y el bump del `refreshKey`
   * recomputa los stats **después** del insert — nunca al revés, o el corte
   * mostraría la plata del período que acaba de cerrar.
   */
  const resincronizar = useCallback(() => {
    void refetchCaja();
    setRefreshKey((k) => k + 1);
  }, [refetchCaja]);

  // Volver a la tab (o abrirla por primera vez) revalida el estado de las cajas
  // sin esperar al tick de 30 s: es plata y se decide un corte con esto.
  useOnActivate(active, () => void refetchCaja(), { onMount: refetchAlMontar });

  // ── Selector de caja activa (persiste por máquina) ──
  // Misma preferencia que usa el cobro: el puesto del bar registra en Caja Bar
  // acá y al cobrar. Ver `use-caja-preferida.ts`.
  // Spec 153 — `?caja=` llega desde «Ver ahora» de la sección Caja: abre esa
  // caja y no la que quedó guardada en esta máquina.
  const [cajaPreferida, selectCaja] = useCajaPreferida(slug, cajas);
  // La caja pedida manda para ESTA vista y **no** pisa la preferencia de la
  // máquina: mirar la Caja Bar desde la compu del salón no tiene por qué
  // cambiar dónde cobra esa compu después. Elegirla en el selector sí.
  const activeCajaId = resolverCajaActiva(cajaPedida, cajaPreferida, cajas);
  // Spec 211 · R6 — «Contar la caja Bar» desde la franja estando en otra caja:
  // se cambia de caja y el conteo se abre al entrar.
  const [contarAlEntrar, setContarAlEntrar] = useState<string | null>(null);


  // Poll de stats por caja. Depende de `active` (spec 101): con el keep-alive el
  // panel queda montado al cambiar de tab, y sin esta guarda seguiría golpeando
  // `/api/caja/stats` × N cajas cada 30 s desde cada tablet del local, para
  // siempre, sin que nadie lo mire. Volver a la tab re-corre el effect → `load()`
  // inmediato: la tab de plata nunca pinta el snapshot viejo mientras espera el
  // primer tick.
  // La clave son los ids, no el array: el panel re-renderiza con un `cajas`
  // nuevo en cada refresh y eso cancelaba la primera carga (la caja quedaba en
  // esqueleto hasta el tick de 30 s).
  const cajasKey = cajas.map((c) => c.id).join(",");
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const ids = cajasKey ? cajasKey.split(",") : [];
    const load = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          const c = { id };
          try {
            const res = await fetch(`/api/caja/stats?caja=${c.id}`);
            const data = await res.json();
            return [
              c.id,
              data?.stats ?? null,
              data?.movimientos ?? [],
              data?.payments ?? [],
            ] as const;
          } catch {
            return [c.id, null, [], []] as const;
          }
        }),
      );
      if (!cancelled) {
        setStatsByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[1]])),
        );
        setMovimientosByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[2]])),
        );
        setPaymentsByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[3]])),
        );
      }
    };
    if (ids.length > 0) load();
    const i = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [cajasKey, refreshKey, active]);

  if (cajas.length === 0) {
    return (
      <div className="space-y-5">
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-6 text-center">
            <div
              className="flex size-14 items-center justify-center rounded-full"
              style={{ background: "var(--brand-soft, #F4F4F5)" }}
            >
              <Wallet
                className="size-7"
                style={{ color: "var(--brand, #18181B)" }}
              />
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Sin cajas configuradas
              </h3>
              <p className="mt-1 text-sm text-foreground/70">
                Creá una caja desde la configuración para empezar a operar.
              </p>
            </div>
            <IntentLink
              href={`/${slug}/admin/caja`}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-95"
              style={{
                background: "var(--brand, #18181B)",
                color: "var(--brand-foreground, white)",
              }}
            >
              <Settings className="size-4" />
              Configurar cajas
            </IntentLink>
          </div>
        </Surface>
      </div>
    );
  }

  const activeCaja = cajas.find((c) => c.id === activeCajaId) ?? cajas[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        {/* Spec 217 · D6 — cada caja dice lo que debería haber en su cajón. */}
        {cajas.length > 1 ? (
          <SegmentedSelector
            ariaLabel="Seleccionar caja"
            activeId={activeCajaId}
            onSelect={selectCaja}
            items={cajas.map((c) => ({
              id: c.id,
              label: c.name,
              hint: statsByCaja[c.id] ? `· ${formatCurrency(statsByCaja[c.id]!.expected_cash_cents)}` : undefined,
            }))}
          />
        ) : (
          <p className="text-sm font-semibold text-foreground">
            {cajas[0].name}
            {statsByCaja[cajas[0].id] && (
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                · {formatCurrency(statsByCaja[cajas[0].id]!.expected_cash_cents)} en el cajón
              </span>
            )}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={resincronizar}
          aria-label="Refrescar"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <CajaCard
        key={activeCaja.id}
        caja={activeCaja}
        stats={statsByCaja[activeCaja.id] ?? null}
        movimientos={movimientosByCaja[activeCaja.id] ?? []}
        payments={paymentsByCaja[activeCaja.id] ?? []}
        slug={slug}
        onChanged={resincronizar}
        active={active}
        refreshKey={refreshKey}
        puedeEditarComoAdmin={showAssignments}
        statsByCaja={statsByCaja}
        paymentsByCaja={paymentsByCaja}
        abrirConteo={contarAlEntrar === activeCaja.id}
        onConteoAbierto={() => setContarAlEntrar(null)}
        onContarOtraCaja={(id) => {
          setContarAlEntrar(id);
          selectCaja(id);
        }}
        rendiciones={rendicion?.rendicionHistorial ?? []}
        alPie={
          // Spec 217 — el historial de rendiciones se fue: cada mozo que ya
          // rindió tiene su «Reimprimir» en el paso 2. Queda, sólo para el
          // admin, quién cobra en cada caja.
          rendicion && showAssignments ? (
            <details className="group rounded-2xl bg-card ring-1 ring-border/70">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                Quién cobra en cada caja
                <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-border/60 p-5">
                <CajaAssignmentsPanel
                  slug={slug}
                  cajas={cajas}
                  assignments={rendicion.cajaAssignments}
                  members={rendicion.businessMembers}
                  onChanged={resincronizar}
                />
              </div>
            </details>
          ) : null
        }
      />

      <div className="pt-1 text-center">
        <IntentLink
          href={`/${slug}/admin/caja`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <Settings className="size-3" />
          Configurar cajas
        </IntentLink>
      </div>
    </div>
  );
}

// ── Card de caja (siempre operativa) ─────────────────────────────

/**
 * Spec 217 — la caja muestra los últimos movimientos, no todos: una lista con
 * scroll adentro de una página que también scrollea es un antipatrón (Juan,
 * 2026-10-08). El resto está en el libro.
 */
const ULTIMOS_MOVIMIENTOS = 10;

function CajaCard({
  caja,
  stats,
  movimientos,
  payments,
  slug,
  onChanged,
  active,
  refreshKey,
  puedeEditarComoAdmin,
  statsByCaja,
  paymentsByCaja,
  rendiciones,
  abrirConteo,
  onConteoAbierto,
  onContarOtraCaja,
  alPie,
}: {
  caja: CajaConEstado;
  stats: CajaLiveStats | null;
  movimientos: CajaMovimiento[];
  payments: CajaPayment[];
  slug: string;
  /** Re-sincroniza la tab después de mover plata (spec 103). */
  onChanged: () => void;
  active: boolean;
  refreshKey: number;
  puedeEditarComoAdmin: boolean;
  /** Spec 217 — el cierre del turno mira todas las cajas, no sólo la de la vista. */
  statsByCaja: Record<string, CajaLiveStats | null>;
  paymentsByCaja: Record<string, CajaPayment[]>;
  /** Las últimas rendiciones: el «Reimprimir» de cada mozo que ya rindió. */
  rendiciones: RendicionData["rendicionHistorial"];
  abrirConteo: boolean;
  onConteoAbierto: () => void;
  onContarOtraCaja: (cajaId: string) => void;
  /** #351 — cobrado por empleado + rendición, al pie de la caja. */
  alPie?: React.ReactNode;
}) {
  const [, startTransition] = useTransition();
  const [filtro, setFiltro] = useState<FiltroCaja>("todo");
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [ingresoOpen, setIngresoOpen] = useState(false);
  const [corteOpen, setCorteOpen] = useState(false);
  // Spec 211 · R4/R5 — corregir un movimiento ahí mismo, con el formulario del libro.
  const [editando, setEditando] = useState<{
    entry: LibroEntry;
    mozos: { id: string; name: string }[];
    cajas: { id: string; name: string }[];
  } | null>(null);
  const editar = (createdAt: string, id: string) =>
    startTransition(async () => {
      // Spec 216 — hasta que llega el renglón no se veía nada: el encargado
      // tocaba de nuevo creyendo que no había agarrado el click.
      toast.loading("Abriendo el movimiento…", { id: "abrir-movimiento" });
      try {
        const r = await getEntradaDelLibroTabData(slug, { cajaId: caja.id, createdAt, id });
        if (!r.ok) toast.error(r.error);
        else setEditando(r.data);
      } finally {
        toast.dismiss("abrir-movimiento");
      }
    });

  useEffect(() => {
    if (abrirConteo) {
      setCorteOpen(true);
      onConteoAbierto();
    }
  }, [abrirConteo, onConteoAbierto]);

  // Los stats llegan por poll, no con la page. Hasta que caen, los montos no
  // son cero: **no se saben**. Mostrar «$0» hacía que por medio segundo el
  // encargado leyera «en la caja deberías tener $0» con la caja llena
  // (issue #189).
  const cargandoStats = stats == null;
  const expected = stats?.expected_cash_cents ?? 0;
  const ventas = stats?.total_ventas_cents ?? 0;
  const propinas = stats?.total_propinas_cents ?? 0;
  const cobros = stats?.cobros_count ?? 0;
  const porMetodo = stats?.ventas_por_metodo;
  const porOrigen = stats?.ventas_por_origen;
  const porOrigenYMetodo = stats?.ventas_por_origen_y_metodo;
  const periodoDesdeFecha = stats?.periodo_desde ?? caja.periodo_desde;

  const periodoLabel = (() => {
    // Relativo al reloj: el server y el cliente pueden diferir en un minuto
    // (se marca con suppressHydrationWarning donde se dibuja).
    const d = new Date(periodoDesdeFecha);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
    if (diffMin < 1) return "desde ahora";
    if (diffMin < 60) return `desde hace ${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m === 0 ? `desde hace ${h}h` : `desde hace ${h}h ${m}m`;
  })();

  type Entry =
    | { kind: "cobro"; createdAt: string; data: CajaPayment }
    | { kind: "movimiento"; createdAt: string; data: CajaMovimiento };
  const entries: Entry[] = [
    ...payments.map((p) => ({
      kind: "cobro" as const,
      createdAt: p.created_at,
      data: p,
    })),
    ...movimientos.map((m) => ({
      kind: "movimiento" as const,
      createdAt: m.created_at,
      data: m,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Spec 211 · R4 — qué le hace cada línea al cajón y cómo queda, hacia atrás
  // desde «Debería haber» (la línea más nueva lo deja exacto).
  const lineas: (LineaDeCaja & { entry: Entry })[] = entries.map((e) =>
    e.kind === "cobro"
      ? { tipo: "cobro", id: e.data.id, createdAt: e.createdAt, method: e.data.method, amount_cents: e.data.amount_cents, rinde_mozo_id: e.data.rinde_mozo_id, entry: e }
      : { tipo: "movimiento", id: e.data.id, createdAt: e.createdAt, kind: e.data.kind, amount_cents: e.data.amount_cents, cancelled: e.data.cancelled_at !== null, entry: e },
  );
  const corrido = stats ? conSaldoCorrido(lineas, stats.expected_cash_cents) : lineas.map((linea) => ({ linea, efecto: efectoEnCajon(linea), saldoDespues: null as number | null }));
  const visibles = corrido.filter((f) => pasaFiltro(f.linea, filtro));

  return (
    <div className="space-y-4">
      {/* Spec 217 · D6 — el período y sus cierres; el nombre ya está en el selector. */}
      <p className="text-xs text-muted-foreground">
        {caja.name}: período abierto <span suppressHydrationWarning>{periodoLabel}</span>
        {caja.ultimo_corte && (
          <>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <IntentLink
              href={`/${slug}/admin/caja/cierres?caja=${caja.id}`}
              className="font-medium underline underline-offset-2 transition hover:text-foreground"
            >
              cierres anteriores
            </IntentLink>
          </>
        )}
      </p>

      <CierreDelTurno
        slug={slug}
        cajaActivaId={caja.id}
        active={active}
        refreshKey={refreshKey}
        onContar={(id) => (id === caja.id ? setCorteOpen(true) : onContarOtraCaja(id))}
        onChanged={onChanged}
        statsByCaja={statsByCaja}
        paymentsByCaja={paymentsByCaja}
        rendiciones={rendiciones}
      />

      <VentasDelPeriodo
        cargando={cargandoStats}
        ventas={ventas}
        cobros={cobros}
        propinas={propinas}
        porMetodo={porMetodo}
        porOrigen={porOrigen}
        porOrigenYMetodo={porOrigenYMetodo}
      />

      {/* Spec 217 · D7 — el registro de la caja, con las dos acciones que lo alimentan. */}
      <section aria-labelledby="movimientos-titulo" className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="movimientos-titulo" className="text-lg font-semibold tracking-tight">
            Movimientos de {caja.name}
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">· {entries.length}</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSangriaOpen(true)}>
              <ArrowDownToLine className="size-3.5" /> Sangría
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setIngresoOpen(true)}>
              <ArrowUpFromLine className="size-3.5" /> Ingreso
            </Button>
            {/* El período es el hot path del turno; el libro (spec 070) es el
                histórico con filtros, los anulados y la corrección. */}
            <IntentLink
              href={`/${slug}/admin/caja/movimientos?caja=${caja.id}`}
              className="px-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground/90 hover:underline"
            >
              Ver todos
            </IntentLink>
          </div>
        </div>
        {entries.length > 0 && (
          <div role="group" aria-label="Filtrar movimientos" className="mt-3 flex flex-wrap gap-1.5">
            {FILTROS_CAJA.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition",
                  filtro === f.id ? "bg-foreground text-background ring-foreground" : "bg-card text-foreground/80 ring-border hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Todavía no hubo movimientos en este período.</p>
        ) : visibles.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Ningún movimiento con ese filtro.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60 rounded-xl ring-1 ring-border/70">
            {visibles.slice(0, ULTIMOS_MOVIMIENTOS).map(({ linea, efecto, saldoDespues }) => {
              const e = linea.entry;
              const cajon = { efecto, saldoDespues, mozo: e.kind === "cobro" && e.data.rinde_mozo_id ? e.data.attributed_mozo_name : null };
              return e.kind === "cobro" ? (
                <CobroRow key={`p-${e.data.id}`} payment={e.data} cajon={cajon} onEditar={() => editar(e.data.created_at, e.data.id)} />
              ) : (
                <MovimientoRow key={`m-${e.data.id}`} mov={e.data} cajon={cajon} onEditar={() => editar(e.data.created_at, e.data.id)} />
              );
            })}
          </ul>
        )}
        {visibles.length > ULTIMOS_MOVIMIENTOS && (
          <p className="mt-3 text-sm text-muted-foreground">
            Estos son los últimos {ULTIMOS_MOVIMIENTOS} de {visibles.length}.{" "}
            <IntentLink
              href={`/${slug}/admin/caja/movimientos?caja=${caja.id}`}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              Ver todos en el libro
            </IntentLink>
          </p>
        )}
      </section>

      {alPie}

      {editando && (
        <DetalleSheet
          entry={editando.entry}
          slug={slug}
          cajas={editando.cajas}
          mozos={editando.mozos}
          puedeCorregir
          esAdmin={puedeEditarComoAdmin}
          onClose={() => setEditando(null)}
          onDone={() => {
            setEditando(null);
            onChanged();
          }}
        />
      )}

      <MovimientoModal
        open={sangriaOpen}
        onOpenChange={setSangriaOpen}
        title="Registrar sangría"
        icon={<ArrowDownToLine />}
        description="Sacar efectivo de la caja (depósito en banco, cambio que se lleva alguien, etc.). Los pagos a proveedor no van acá: salen de la Caja Mayor, desde Proveedores."
        requiereMotivo
        ctaLabel="Registrar sangría"
        disponibleCents={expected}
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarSangria(caja.id, amount, reason ?? "", slug);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Sangría registrada");
              setSangriaOpen(false);
              onChanged();
            }
          })
        }
      />
      <MovimientoModal
        open={ingresoOpen}
        onOpenChange={setIngresoOpen}
        title="Registrar ingreso"
        icon={<ArrowUpFromLine />}
        description="Sumar efectivo extra a la caja."
        requiereMotivo={false}
        ctaLabel="Registrar ingreso"
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarIngreso(caja.id, amount, reason ?? null, slug);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Ingreso registrado");
              setIngresoOpen(false);
              onChanged();
            }
          })
        }
      />
      <CerrarCajaModal
        open={corteOpen}
        onOpenChange={setCorteOpen}
        slug={slug}
        cajaId={caja.id}
        cajaName={caja.name}
        onCerrada={onChanged}
      />
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────

const ORIGEN_LABEL: Record<string, string> = { salon: "Salón", delivery: "Delivery", takeaway: "Take away", otro: "Otro" };

/**
 * Spec 217 — las ventas del período en una franja chica, arriba de los
 * movimientos: el total, una barra por medio de pago (el efectivo primero y
 * más oscuro: es el único que se cuenta) y una línea por origen. Es lectura,
 * no operación: no compite con el cierre.
 */
function VentasDelPeriodo({
  cargando,
  ventas,
  cobros,
  propinas,
  porMetodo,
  porOrigen,
  porOrigenYMetodo,
}: {
  cargando: boolean;
  ventas: number;
  cobros: number;
  propinas: number;
  porMetodo: CajaLiveStats["ventas_por_metodo"] | undefined;
  porOrigen: CajaLiveStats["ventas_por_origen"] | undefined;
  porOrigenYMetodo: CajaLiveStats["ventas_por_origen_y_metodo"] | undefined;
}) {
  type Metodo = keyof typeof METHOD_LABEL;
  const montoDe = (m: Metodo) => (porMetodo?.[m] ?? 0) as number;
  // Mismos medios que «Cobrado por método» (sin la cuenta corriente, que es fiado y va aparte).
  const conPlata = COBRO_METHOD_ORDER.filter((m) => montoDe(m) > 0).sort((a, b) =>
    a === "cash" ? -1 : b === "cash" ? 1 : montoDe(b) - montoDe(a),
  );
  const fiado = montoDe("cuenta_corriente");
  const metodos: Metodo[] = fiado > 0 ? [...conPlata, "cuenta_corriente"] : conPlata;
  const sinUso = COBRO_METHOD_ORDER.filter((m) => montoDe(m) === 0);
  const totalMetodos = metodos.reduce((a, m) => a + montoDe(m), 0);
  const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "0%");

  const origenes = porOrigen
    ? (Object.entries(porOrigen) as [string, number][]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
    : [];
  const totalOrigenes = origenes.reduce((a, [, c]) => a + c, 0);
  const desgloseDe = (o: string) => {
    const fila = (porOrigenYMetodo as Record<string, Record<string, number>> | undefined)?.[o] ?? {};
    return (Object.entries(fila) as [Metodo, number][])
      .filter(([, c]) => c > 0)
      .sort((a, b) => (a[0] === "cash" ? -1 : b[0] === "cash" ? 1 : b[1] - a[1]))
      .map(([m, c]) => `${METHOD_LABEL[m]} ${formatCurrency(c)}`)
      .join(" · ");
  };

  return (
    <section aria-labelledby="ventas-titulo" className="rounded-2xl bg-card px-5 py-4 ring-1 ring-border/70">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id="ventas-titulo" className="text-lg font-semibold tracking-tight">Ventas del período</h3>
        {cargando ? (
          <span className="inline-block h-6 w-48 animate-pulse rounded bg-muted" aria-busy />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span className="text-xl font-bold tracking-tight tabular-nums text-foreground">{formatCurrency(ventas)}</span>
            <span className="tabular-nums">
              {cobros} {cobros === 1 ? "cobro" : "cobros"}
              {/* Las propinas no están adentro de este número —es venta, no
                  lo que entró— así que se dicen aparte y con esa palabra. */}
              {propinas > 0 && ` · más ${formatCurrency(propinas)} de propina`}
            </span>
          </p>
        )}
      </div>
      {!cargando && totalMetodos === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">Todavía no hubo cobros en este período.</p>
      )}
      {!cargando && totalMetodos > 0 && (
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
              {metodos.map((m) => (
                <div key={m} style={{ width: `${(montoDe(m) / totalMetodos) * 100}%`, background: METHOD_COLOR[m] }} />
              ))}
            </div>
            <dl aria-label="Por medio de pago" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {metodos.map((m) => (
                <div key={m} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-sm ring-1 ring-border/60" style={{ background: METHOD_COLOR[m] }} />
                  <dt className="text-foreground/80">{METHOD_LABEL[m]}</dt>
                  <dd className="tabular-nums">
                    <span className="font-semibold">{formatCurrency(montoDe(m))}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{pct(montoDe(m), totalMetodos)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {origenes.length > 0 && (
            <dl aria-label="Por origen" className="grid gap-1 border-t border-border/60 pt-2.5 text-sm">
              {origenes.map(([o, c]) => (
                <div key={o} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <dt className="w-24 shrink-0 font-medium">{ORIGEN_LABEL[o] ?? o}</dt>
                  <dd className="tabular-nums">
                    <span className="font-semibold">{formatCurrency(c)}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{pct(c, totalOrigenes)}</span>
                  </dd>
                  <dd className="text-xs tabular-nums text-muted-foreground">{desgloseDe(o)}</dd>
                </div>
              ))}
            </dl>
          )}

          {sinUso.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Sin cobros con {sinUso.map((m) => METHOD_LABEL[m]).join(", ")}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

type Cajon = { efecto: number; saldoDespues: number | null; mozo: string | null };

/** Spec 211 · R4 — qué le hizo la línea al cajón y cómo lo dejó. */
function EfectoEnCajon({ cajon, esEfectivo, anulado }: { cajon: Cajon; esEfectivo?: boolean; anulado?: boolean }) {
  let texto: string;
  if (anulado) texto = "Anulado: no mueve el cajón";
  else if (cajon.efecto > 0) texto = `Cajón +${formatCurrency(cajon.efecto)}`;
  else if (cajon.efecto < 0) texto = `Cajón −${formatCurrency(-cajon.efecto)}`;
  else if (esEfectivo) texto = `No entra al cajón: lo tiene ${cajon.mozo ?? "el mozo"} hasta que rinda`;
  else texto = "No mueve el cajón";
  return <>{texto}</>;
}

/**
 * Spec 217 — el monto y cómo queda el cajón, juntos a la derecha: se leen
 * de un vistazo bajando por la lista.
 */
function MontoYSaldo({ monto, tono, cajon }: { monto: string; tono: string; cajon: Cajon }) {
  return (
    <div className="shrink-0 text-right">
      <p className={cn("text-sm font-bold tabular-nums", tono)}>{monto}</p>
      {cajon.saldoDespues !== null && (
        <p className="text-xs tabular-nums text-muted-foreground">queda {formatCurrency(cajon.saldoDespues)}</p>
      )}
    </div>
  );
}

function BotonEditar({ onEditar }: { onEditar: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onEditar} aria-label="Editar este movimiento">
      Editar
    </Button>
  );
}



function MovimientoRow({ mov, cajon, onEditar }: { mov: CajaMovimiento; cajon: Cajon; onEditar: () => void }) {
  // issue #299 — esto era `mov.kind === "sangria"`, así que el pago de propina
  // (spec 177 · D6) caía en el `else` y se dibujaba como «Ingreso», verde y con
  // `+`: plata que salió del cajón figurando como que entró.
  const sale = saleDelCajon(mov.kind);
  const time = new Date(mov.created_at).toLocaleTimeString("es-AR", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", mov.cancelled_at && "opacity-50")}>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          sale ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
        )}
      >
        {sale ? <ArrowDownToLine className="size-4" strokeWidth={2.25} /> : <ArrowUpFromLine className="size-4" strokeWidth={2.25} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-semibold">{MOVIMIENTO_LABEL[mov.kind]}</span>
          {mov.reason && mov.reason.trim() !== MOVIMIENTO_LABEL[mov.kind] && (
            <span className="text-muted-foreground"> · {mov.reason}</span>
          )}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {time} · <EfectoEnCajon cajon={cajon} anulado={mov.cancelled_at !== null} />
        </p>
      </div>
      <MontoYSaldo monto={`${sale ? "−" : "+"}${formatCurrency(mov.amount_cents)}`} tono={sale ? "text-rose-700" : "text-emerald-700"} cajon={cajon} />
      <BotonEditar onEditar={onEditar} />
    </li>
  );
}


function CobroRow({ payment, cajon, onEditar }: { payment: CajaPayment; cajon: Cajon; onEditar: () => void }) {
  const Icon = methodIcon(payment.method);
  const time = new Date(payment.created_at).toLocaleTimeString("es-AR", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
  });
  const origen =
    payment.delivery_type === "dine_in" && payment.table_label
      ? `Mesa ${payment.table_label}`
      : payment.customer_name?.trim() ||
        (payment.order_number > 0 ? `#${payment.order_number}` : "Orden");

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80">
        <Icon className="size-4" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-semibold">{origen}</span>
          <span className="text-muted-foreground"> · {METHOD_LABEL[payment.method]}</span>
          {payment.attributed_mozo_name && <span className="text-muted-foreground"> · {payment.attributed_mozo_name}</span>}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {time} · <EfectoEnCajon cajon={cajon} esEfectivo={payment.method === "cash"} />
          {payment.tip_cents > 0 && <span className="text-emerald-700"> · incluye {formatCurrency(payment.tip_cents)} de propina</span>}
          {/* spec 147 — el cobro está bien; lo que falta es el papel de ARCA.
              Mismo lenguaje visual que la comanda que no imprimió (spec 33). */}
          {payment.comprobante_fallido && (
            <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 align-middle">
              <ReceiptText className="size-3" strokeWidth={2.25} />
              Sin comprobante
            </span>
          )}
        </p>
      </div>
      <MontoYSaldo monto={`+${formatCurrency(payment.amount_cents)}`} tono="text-foreground" cajon={cajon} />
      <BotonEditar onEditar={onEditar} />
    </li>
  );
}

// ── Modales ──────────────────────────────────────────────────────
