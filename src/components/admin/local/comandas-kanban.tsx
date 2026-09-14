"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Ban,
  ChefHat,
  Check,
  Clock,
  MapPin,
  MoreVertical,
  Package,
  Pencil,
  Play,
  Printer,
  RotateCcw,
  Truck,
  UtensilsCrossed,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  advanceComandaStatus,
  getComandasTabData,
  marcarComandaEntregada,
  solicitarReimpresion,
} from "@/lib/comandas/actions";
import type { BusinessRole } from "@/lib/admin/context";
import type { LocalComanda, LocalStation } from "@/lib/admin/local-query";
import { matchesSalon } from "@/lib/admin/salon-filter";
import {
  ENTREGADAS_VISIBLE_MINUTES,
  isEntregadaVisible,
} from "@/lib/comandas/entregadas-window";
import type { ComandaStatus } from "@/lib/comandas/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  canCancelItem,
  canEmpezarComanda,
  canModifyPostEnvio,
  canReimprimirComanda,
} from "@/lib/permissions/can";
import { AnularComandaModal } from "@/components/shared/anular-comanda-modal";
import { EditarItemsModal } from "@/components/shared/editar-items-modal";

/**
 * Umbral (ms) para considerar "caído" al print agent: sin heartbeat hace más
 * de esto → "sin conexión" (spec 35). Definido acá (client) y no importado de
 * `local-query` para no arrastrar su `import "server-only"` al bundle del
 * cliente. El loader server (`getPrintAgentHealth`) solo devuelve `last_seen_at`;
 * la derivación conectado/caído vive en el cliente con reloj vivo.
 */
const PRINT_AGENT_OFFLINE_THRESHOLD_MS = 60_000;
import { useOptimisticAction } from "@/lib/ui/use-optimistic-action";
import { useOnActivate } from "@/lib/ui/use-tab-param";
import { mozoPalette } from "@/lib/mozo/colors";
import type { MozoMember } from "@/lib/mozo/queries";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// ─── Paleta de sectores (sort_order → color) ────────────────────────────────

const SECTOR_PALETTE = [
  { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500" },
  { bg: "bg-rose-100", text: "text-rose-700", dot: "bg-rose-500" },
  { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  { bg: "bg-sky-100", text: "text-sky-700", dot: "bg-sky-500" },
  { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500" },
  { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" },
  { bg: "bg-pink-100", text: "text-pink-700", dot: "bg-pink-500" },
  { bg: "bg-lime-100", text: "text-lime-700", dot: "bg-lime-500" },
  { bg: "bg-teal-100", text: "text-teal-700", dot: "bg-teal-500" },
  { bg: "bg-indigo-100", text: "text-indigo-700", dot: "bg-indigo-500" },
];
const FALLBACK = {
  bg: "bg-zinc-100",
  text: "text-zinc-700",
  dot: "bg-zinc-400",
};

// ─── Columnas (estilo idéntico al board de pedidos) ─────────────────────────

type Column = {
  id: ComandaStatus;
  label: string;
  accent: string;
  ring: string;
  countBg: string;
  countText: string;
  /** Color del botón de acción de la card. Matchea el estado actual de la
   *  comanda (no el próximo) para que la card lea como un bloque coherente. */
  buttonClass: string;
  emptyHint: string;
  /** Aclaración chica bajo el título. Hoy sólo la usa Entregadas, para que el
   *  encargado sepa por qué las cards se van solas (spec 082). */
  note?: string;
};

const COLUMNS: Column[] = [
  {
    id: "pendiente",
    label: "Pendientes",
    accent: "bg-amber-500",
    ring: "ring-amber-500/30",
    countBg: "bg-amber-50",
    countText: "text-amber-800",
    buttonClass: "bg-amber-500 hover:bg-amber-600 text-white",
    emptyHint: "Sin comandas pendientes",
  },
  {
    id: "en_preparacion",
    label: "En cocina",
    accent: "bg-sky-500",
    ring: "ring-sky-500/30",
    countBg: "bg-sky-50",
    countText: "text-sky-800",
    buttonClass: "bg-sky-500 hover:bg-sky-600 text-white",
    emptyHint: "Cocina libre",
  },
  {
    id: "entregado",
    label: "Entregadas",
    accent: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    countBg: "bg-emerald-50",
    countText: "text-emerald-800",
    buttonClass: "bg-emerald-500 hover:bg-emerald-600 text-white",
    emptyHint: "Sin entregas recientes",
    note: `Últimos ${ENTREGADAS_VISIBLE_MINUTES} min`,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Reloj vivo: `Date.now()` que se refresca cada `everyMs`.
 *
 * Devuelve `null` hasta que monta, y eso NO es un detalle (issue #257).
 * `useState(() => Date.now())` corre en el server y otra vez en el cliente, con
 * dos relojes distintos. Acá el `now` no sólo pinta un texto: filtra **qué
 * comandas se muestran** (la ventana de entregadas de la spec 082, más abajo).
 * Una comanda parada justo en el borde de los 30 min entraba en un render y no
 * en el otro → distinta cantidad de tarjetas → la secuencia de `useId` se
 * corría → todos los ids que genera base-ui para los menús quedaban
 * desalineados, y React tiraba hydration mismatch en cada carga. Los ids eran
 * el síntoma; el árbol distinto era la causa.
 *
 * Con `null` el server y el primer render del cliente producen el MISMO árbol
 * por construcción. El efecto pone la hora real enseguida, así que el precio es
 * un frame sin tiempos, no un parpadeo visible.
 */
function useNow(everyMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(i);
  }, [everyMs]);
  return now;
}

/** Minutos desde `iso`, o `null` mientras el reloj no montó. */
function useElapsedMinutes(iso: string): number | null {
  const now = useNow(30_000);
  if (now === null) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Mismo formato que el salón ("ahora", "5 min", "1h 20", "2h", "3 d") para
 * que el encargado lea el mismo lenguaje de tiempos en todas las tabs.
 */
function formatRelativeTime(minutes: number | null): string {
  // Sin reloj todavía (primer render): se reserva el lugar sin inventar un
  // número. Ver `useNow`.
  if (minutes === null) return "·";
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours}h ${rest}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function elapsedTone(min: number | null, terminal: boolean): string {
  if (terminal || min === null) return "text-muted-foreground";
  if (min >= 15) return "text-rose-700";
  if (min >= 8) return "text-amber-700";
  return "text-muted-foreground";
}

/** Tiempo de preparación de una comanda entregada (delivered − emitted). */
function prepMinutes(emitted: string, delivered: string | null): number | null {
  if (!delivered) return null;
  return Math.max(
    0,
    Math.floor(
      (new Date(delivered).getTime() - new Date(emitted).getTime()) / 60_000,
    ),
  );
}

/** Color del KPI de prep: verde rápido, ámbar medio, rojo lento. */
function prepTone(min: number): string {
  if (min <= 10) return "text-emerald-700";
  if (min <= 20) return "text-amber-700";
  return "text-rose-700";
}

function deliveryIcon(type: string) {
  if (type === "delivery") return Truck;
  // Take away = `pickup`. Antes se comparaba contra `take_away`, que no se
  // persiste nunca, así que los retiros salían con el ícono de salón.
  if (type === "pickup") return Package;
  return UtensilsCrossed;
}

// ─── Componente principal ───────────────────────────────────────────────────

/** Cambio optimista de estado de una comanda (id + transición a aplicar). */
type ComandaOptimistic =
  | { kind: "empezar"; id: string }
  | { kind: "entregar"; id: string; deliveredAt: string }
  | { kind: "reimprimir"; id: string; requestedAt: string };

export function ComandasKanban({
  slug,
  businessId,
  role,
  initialComandas,
  stations: initialStations,
  mozos: initialMozos,
  printAgentLastSeenAt: initialPrintAgentLastSeenAt,
  salonIds = [],
  salonLabel = null,
  active = true,
}: {
  slug: string;
  businessId: string;
  /**
   * Spec 182 · D2 — hasta acá el kanban no sabía quién lo miraba, y le pintaba
   * a la `terminal` los tres botones que el server le rechaza: reimprimir,
   * editar y anular. Un botón que existe para fallar enseña a ignorar los
   * errores. La terminal ve y **entrega**; empezar es de cocina.
   */
  role: BusinessRole;
  initialComandas: LocalComanda[];
  stations: LocalStation[];
  mozos: MozoMember[];
  printAgentLastSeenAt: string | null;
  /** Spec 065: salones elegidos en el operativo. Vacío = sin filtro. */
  salonIds?: string[];
  /** Etiqueta de la selección, para los textos. `null` sin filtro. */
  salonLabel?: string | null;
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
}) {
  // Filtro "solo fallidas": lo activa la alerta de fallos de impresión (spec
  // 35) para ir directo a las comandas con `print_failed_at`.
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);

  // Modales de gestión de comanda (spec 049): anular la comanda entera / editar
  // sus ítems. Guardan la comanda objetivo; null = cerrado.
  const [anularTarget, setAnularTarget] = useState<LocalComanda | null>(null);
  const [editarTarget, setEditarTarget] = useState<LocalComanda | null>(null);

  // Snapshot del server de TODA la tab (comandas + stations + mozos + salud del
  // print agent), seedeado una vez de los props y actualizado SOLO por el
  // refetch de realtime. Antes cada evento hacía `router.refresh()`, que
  // re-corría los 6 loaders de /admin/operacion + re-serializaba todo el árbol
  // RSC; ahora `getComandasTabData` corre las 4 queries de esta tab y mergea
  // acá — cero refresh de ruta. Un solo escritor (el refetch) → sin carrera
  // contra un re-sync del prop (los props sólo seedean el estado inicial; en
  // navegación / cambio de tab el componente se remonta y re-seedea).
  const [serverData, setServerData] = useState({
    comandas: initialComandas,
    stations: initialStations,
    mozos: initialMozos,
    printAgentLastSeenAt: initialPrintAgentLastSeenAt,
  });
  const { stations, mozos, printAgentLastSeenAt } = serverData;

  // Refetch de la tab. Guard de carrera por secuencia — ante ráfagas (o
  // respuestas fuera de orden) sólo aplica el más nuevo. Nunca lanza (lo awaitea
  // `onReimprimir` dentro de su transición): en error mantiene el estado actual
  // (nunca vacía el KDS), es un refresh de fondo, no una acción del usuario.
  const refetchSeq = useRef(0);
  const refetchComandas = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getComandasTabData(slug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) setServerData(res.data);
    } catch {
      // swallow: refresh de fondo, sin toast ni rollback.
    }
  }, [slug]);

  // Refetch al montar. `serverData` se seedea de la promesa RSC de
  // `initialComandas`, que quedó CONGELADA al page-load (ya no hay
  // `router.refresh()` que la revalide). Sin esto, entrar a la tab tras un rato
  // mostraría el snapshot viejo (comandas ya entregadas reapareciendo) hasta el
  // próximo evento de realtime. El guard de secuencia lo coordina con realtime.
  useEffect(() => {
    void refetchComandas();
  }, [refetchComandas]);

  // Y otra vez cada vez que se vuelve a la tab: desde la spec 101 el panel no se
  // desmonta al cambiar de tab (keep-alive), así que el refetch de mount ya no
  // alcanza para garantizar frescura al volver.
  useOnActivate(active, refetchComandas);

  // Optimistic con rollback en error vía helper compartido (spec 21). El `base`
  // es `serverData.comandas` (snapshot del server + merge de realtime): el
  // overlay optimista persiste hasta que termina SU transición, sin pisar el
  // cambio ni hacer flash. El rollback es automático si la action falla.
  const {
    state: comandas,
    run,
    pending: isPending,
  } = useOptimisticAction(
    serverData.comandas,
    (cs: LocalComanda[], action: ComandaOptimistic): LocalComanda[] =>
      cs.map((c) => {
        if (c.id !== action.id) return c;
        if (action.kind === "empezar")
          return { ...c, status: "en_preparacion" };
        if (action.kind === "reimprimir")
          // Reimpresión = flag lateral: NO toca el estado de cocina. Marca la
          // comanda en cola de (re)impresión y limpia el fallo (reintento).
          return {
            ...c,
            reprint_requested_at: action.requestedAt,
            print_failed_at: null,
          };
        return { ...c, status: "entregado", delivered_at: action.deliveredAt };
      }),
  );

  // Los tres del ⋯ son admin/encargado en el server; `puedeEmpezar` lo es
  // desde la 182. Se calculan una vez acá y bajan a las cards.
  const puedeEmpezar = canEmpezarComanda(role);
  const puedeReimprimir = canReimprimirComanda(role);
  const puedeEditar = canModifyPostEnvio(role);
  const puedeAnular = canCancelItem(role);

  const onEmpezar = (id: string) => {
    run({ kind: "empezar", id }, () => advanceComandaStatus(id, slug));
  };

  const onEntregar = (id: string) => {
    run({ kind: "entregar", id, deliveredAt: new Date().toISOString() }, () =>
      marcarComandaEntregada(id, slug),
    );
  };

  const onReimprimir = (id: string) => {
    run(
      { kind: "reimprimir", id, requestedAt: new Date().toISOString() },
      // Reimpresión es infrecuente: esperamos el refetch DENTRO de la transición
      // para que el overlay optimista caiga sobre base ya-persistida
      // (`reprint_requested_at` del server), sin el flicker del botón que habría
      // si el overlay se soltara antes de que el refetch de realtime aterrice.
      // `refetchComandas` nunca lanza, así que no dispara rollback/toast.
      async () => {
        const r = await solicitarReimpresion(slug, id);
        if (r.ok) await refetchComandas();
        return r;
      },
    );
  };

  // ── Realtime sobre `comandas` ──
  const businessIdRef = useRef(businessId);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      // Debounce: una orden multi-sector dispara N INSERTs en `comandas`
      // (uno por sector) → sin esto serían N refetch seguidos. 200 ms los
      // coalesce en uno solo, imperceptible. Mismo patrón que
      // use-tables-realtime.ts.
      if (pendingRefresh) clearTimeout(pendingRefresh);
      pendingRefresh = setTimeout(() => {
        if (!cancelled) void refetchComandas();
        pendingRefresh = null;
      }, 200);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(`comandas:${businessIdRef.current}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "comandas",
          },
          () => {
            // Comandas no tiene business_id directo, así que el canal escucha
            // TODA la tabla; el filtro por negocio lo aplica el refetch server
            // (`getComandasTabData` → business_id + RLS). Un evento de
            // otro negocio dispara un refetch que igual devuelve sólo lo nuestro.
            // Debounced para no spamear en ráfagas.
            scheduleRefresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "orders",
          },
          () => {
            // La etiqueta de mesa de cada comanda sale del JOIN order→table.
            // Un traslado (spec 048) sólo toca orders.table_id, NO comandas, así
            // que sin esto el KDS seguiría mostrando la mesa vieja. Debounced.
            scheduleRefresh();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (pendingRefresh) clearTimeout(pendingRefresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refetchComandas]);

  // Resolución de nombre del mozo → mismo patrón que SalonDesktop.
  const mozoNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of mozos) {
      if (x.full_name) m.set(x.user_id, x.full_name);
    }
    return m;
  }, [mozos]);

  // Reloj vivo para la ventana de entregadas (spec 082): sin esto, una comanda
  // que cumple los 30 min con la pantalla quieta se quedaría hasta el próximo
  // evento de realtime. 30 s = misma cadencia que el contador de las cards.
  const now = useNow(30_000);

  // ── Qué se ve: filtro por salón (spec 065) + ventana de entregadas (082) ──
  // Todo lo que sigue (saturación por sector, alerta de impresión, kanban) mira
  // `visibles`, no `comandas`: la tab y sus números tienen que contar lo mismo.
  // La ventana se aplica ACÁ y no sólo al armar las columnas para que la alerta
  // de impresión no cuente una comanda que ya no se muestra — el filtro "solo
  // fallidas" abriría una columna vacía sin explicación.
  const visibles = useMemo(
    () =>
      comandas.filter(
        (c) =>
          matchesSalon(salonIds, c.floor_plan_id) &&
          // `now === null` es el primer render (ver `useNow`): sin ventana, para
          // que el árbol del server y el del cliente sean idénticos. El efecto
          // la aplica un frame después.
          (c.status !== "entregado" ||
            now === null ||
            isEntregadaVisible(c.delivered_at, now)),
      ),
    [comandas, salonIds, now],
  );

  // Comandas activas que el filtro dejó afuera por no tener mesa (delivery,
  // retiro, mostrador). Esconderlas en silencio sería el riesgo real de esta
  // feature: una comanda de cocina que nadie mira. Se avisan.
  const ocultasSinSalon = useMemo(() => {
    if (salonIds.length === 0) return 0;
    return comandas.filter(
      (c) =>
        c.floor_plan_id === null &&
        c.status !== "entregado" &&
        c.items.some((it) => !it.cancelled_at),
    ).length;
  }, [comandas, salonIds]);

  // Mapas derivados.
  const stationStyleById = useMemo(() => {
    const out = new Map<string, (typeof SECTOR_PALETTE)[number]>();
    stations.forEach((s, idx) =>
      out.set(s.id, SECTOR_PALETTE[idx % SECTOR_PALETTE.length] ?? FALLBACK),
    );
    return out;
  }, [stations]);

  const stationStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stations) m.set(s.id, 0);
    for (const c of visibles) {
      if (c.status === "entregado") continue;
      // No contamos comandas fantasma (todos los items cancelados): no se
      // muestran como card, así que no deben inflar la saturación del sector.
      if (!c.items.some((it) => !it.cancelled_at)) continue;
      m.set(c.station_id, (m.get(c.station_id) ?? 0) + 1);
    }
    return m;
  }, [visibles, stations]);

  // Comandas con fallo de impresión pendiente (spec 33/35), visibles (no
  // fantasma). Alimenta la alerta accionable y el filtro "solo fallidas".
  // Sobre `visibles`: la alerta tiene que corresponderse con lo que el filtro
  // «solo fallidas» va a mostrar (spec 065, FR-004).
  const failedCount = useMemo(
    () =>
      visibles.filter(
        (c) =>
          c.print_failed_at &&
          (c.status === "entregado" || c.items.some((it) => !it.cancelled_at)),
      ).length,
    [visibles],
  );

  // Si se resolvieron todas las fallidas mientras el filtro estaba activo, lo
  // apagamos para no dejar el kanban vacío sin explicación.
  useEffect(() => {
    if (showOnlyFailed && failedCount === 0) setShowOnlyFailed(false);
  }, [showOnlyFailed, failedCount]);

  const byColumn = useMemo(() => {
    const groups: Record<ComandaStatus, LocalComanda[]> = {
      pendiente: [],
      en_preparacion: [],
      entregado: [],
    };
    for (const c of visibles) {
      // Comandas activas (pendiente/en_preparacion) cuyos items están TODOS
      // cancelados quedarían como cards fantasma: header + sector + botón
      // accionable pero sin un solo item vivo. Las ocultamos. Las entregadas
      // sí se muestran aunque no tengan items vivos (registro histórico del día).
      if (c.status !== "entregado") {
        const hasLiveItem = c.items.some((it) => !it.cancelled_at);
        if (!hasLiveItem) continue;
      }
      // Filtro de la alerta: solo las que no imprimieron (spec 35).
      if (showOnlyFailed && !c.print_failed_at) continue;
      groups[c.status].push(c);
    }
    // Entregadas ya vienen acotadas a la ventana de 30 min + tope 100 desde la
    // query, ordenadas por delivered_at desc. Alineamos el cap de display al
    // mismo 100 del server para no recortar lo que sí trajo la query.
    groups.entregado = groups.entregado.slice(0, 100);
    return groups;
  }, [visibles, showOnlyFailed]);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Salud del print agent (spec 35) ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AgentHealthPill lastSeenAt={printAgentLastSeenAt} />
        {salonIds.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
            <MapPin className="size-3.5 shrink-0" strokeWidth={2.5} />
            Solo {salonLabel ?? "un salón"}
            {ocultasSinSalon > 0 && (
              <span className="font-medium text-amber-800">
                ·{" "}
                {ocultasSinSalon === 1
                  ? "1 comanda de delivery / mostrador oculta"
                  : `${ocultasSinSalon} comandas de delivery / mostrador ocultas`}
              </span>
            )}
          </span>
        )}
      </div>

      {/* ── Alerta de fallos de impresión (spec 35) ── */}
      {failedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
            <Printer className="size-4 shrink-0" strokeWidth={2.5} />
            <span>
              {failedCount === 1
                ? "1 comanda no se imprimió"
                : `${failedCount} comandas no se imprimieron`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowOnlyFailed((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-700 active:translate-y-px"
          >
            {showOnlyFailed ? "Mostrar todas" : "Ver solo las fallidas"}
          </button>
        </div>
      )}

      {/* ── Stats de saturación por sector ── */}
      <SectorStatsBar
        stations={stations}
        stationStats={stationStats}
        stationStyleById={stationStyleById}
      />

      {/* ── Kanban (mismo lenguaje visual que el board de pedidos) ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = byColumn[col.id];
          return (
            <section
              key={col.id}
              className="bg-muted/30 ring-border/60 flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-3 ring-1"
            >
              <div className="flex flex-col gap-2">
                <div className={`h-1 w-10 rounded-full ${col.accent}`} />
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-foreground flex min-w-0 items-baseline gap-1.5 text-base font-bold tracking-tight">
                    {col.label}
                    {col.note && (
                      <span className="text-muted-foreground/70 truncate text-[11px] font-medium tracking-normal">
                        {col.note}
                      </span>
                    )}
                  </h2>
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums ${col.countBg} ${col.countText}`}
                  >
                    {items.length}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {items.map((c) => (
                  <ComandaCard
                    key={c.id}
                    comanda={c}
                    stationStyle={
                      stationStyleById.get(c.station_id) ?? FALLBACK
                    }
                    columnRing={col.ring}
                    buttonClass={col.buttonClass}
                    mozoName={
                      c.mozo_id ? (mozoNameById.get(c.mozo_id) ?? null) : null
                    }
                    onEmpezar={onEmpezar}
                    onEntregar={onEntregar}
                    onReimprimir={onReimprimir}
                    onEditar={() => setEditarTarget(c)}
                    onAnular={() => setAnularTarget(c)}
                    puedeEmpezar={puedeEmpezar}
                    puedeReimprimir={puedeReimprimir}
                    puedeEditar={puedeEditar}
                    puedeAnular={puedeAnular}
                    isPending={isPending}
                  />
                ))}
                {items.length === 0 && (
                  <div className="border-border/60 text-muted-foreground/70 rounded-xl border border-dashed px-3 py-6 text-center text-xs">
                    {col.emptyHint}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Modales de gestión de comanda (spec 049) ── */}
      {anularTarget && (
        <AnularComandaModal
          slug={slug}
          comandaId={anularTarget.id}
          stationName={anularTarget.station_name}
          batch={anularTarget.batch}
          origen={comandaOrigen(anularTarget)}
          onClose={() => setAnularTarget(null)}
          onDone={() => {
            setAnularTarget(null);
            void refetchComandas();
          }}
        />
      )}
      {editarTarget && (
        <EditarItemsModal
          slug={slug}
          titulo={`Editar comanda · ${editarTarget.station_name} · tanda ${editarTarget.batch}`}
          items={editarTarget.items
            .filter((it) => !it.cancelled_at)
            .map((it) => ({
              order_item_id: it.order_item_id,
              product_id: it.product_id,
              product_name: it.product_name,
              quantity: it.quantity,
              notes: it.notes,
              combo_name: it.combo_name,
              // Los ítems de una comanda son todos del sector de la comanda.
              station_id: editarTarget.station_id,
              unit_price_cents: it.unit_price_cents,
              price_original_cents: it.price_original_cents,
              price_override_reason: it.price_override_reason,
            }))}
          saveLabel="Guardar y reimprimir"
          afterSave={async () => {
            const rp = await solicitarReimpresion(slug, editarTarget.id);
            if (!rp.ok) {
              toast.error("Cambios guardados, pero no se pudo reimprimir.");
            } else {
              toast.success(
                "Comanda actualizada · se reimprime el ticket corregido.",
              );
            }
          }}
          onClose={() => setEditarTarget(null)}
          onDone={() => {
            setEditarTarget(null);
            void refetchComandas();
          }}
        />
      )}
    </div>
  );
}

// ─── Stats por sector ───────────────────────────────────────────────────────

function SectorStatsBar({
  stations,
  stationStats,
  stationStyleById,
}: {
  stations: LocalStation[];
  stationStats: Map<string, number>;
  stationStyleById: Map<string, (typeof SECTOR_PALETTE)[number]>;
}) {
  if (stations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        No hay sectores configurados. Cargá los sectores desde el catálogo para
        que las comandas se ruteen a cocina.
      </div>
    );
  }

  return (
    <div className="bg-card ring-border/60 rounded-2xl p-3 ring-1">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <ChefHat className="size-4" />
        <h3 className="text-xs font-bold tracking-wider uppercase">
          Saturación por sector
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {stations.map((s) => {
          const count = stationStats.get(s.id) ?? 0;
          const style = stationStyleById.get(s.id) ?? FALLBACK;
          return (
            <div
              key={s.id}
              className={`flex items-center justify-between rounded-xl px-3 py-2 ${style.bg}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                <span className={`text-xs font-semibold ${style.text}`}>
                  {s.name}
                </span>
              </div>
              <span
                className={`text-base font-bold tabular-nums ${style.text}`}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Card de comanda ────────────────────────────────────────────────────────

function ComandaCard({
  comanda,
  stationStyle,
  columnRing,
  buttonClass,
  mozoName,
  onEmpezar,
  onEntregar,
  onReimprimir,
  onEditar,
  onAnular,
  puedeEmpezar,
  puedeReimprimir,
  puedeEditar,
  puedeAnular,
  isPending,
}: {
  comanda: LocalComanda;
  stationStyle: (typeof SECTOR_PALETTE)[number];
  columnRing: string;
  buttonClass: string;
  mozoName: string | null;
  onEmpezar: (id: string) => void;
  onEntregar: (id: string) => void;
  onReimprimir: (id: string) => void;
  onEditar: () => void;
  onAnular: () => void;
  /** Spec 182 · D2. Ojo con el nombre: `isTerminal` de acá abajo es el ESTADO
   *  de la comanda (entregada), no el rol `terminal`. */
  puedeEmpezar: boolean;
  puedeReimprimir: boolean;
  puedeEditar: boolean;
  puedeAnular: boolean;
  isPending: boolean;
}) {
  const elapsed = useElapsedMinutes(comanda.emitted_at);
  const isTerminal = comanda.status === "entregado";
  const printFailed = Boolean(comanda.print_failed_at);
  const reprintQueued = Boolean(comanda.reprint_requested_at);
  // Para entregadas mostramos la recencia ("hace X") en vez del tiempo desde
  // emisión, que crecería sin sentido. El KPI de prep va abajo en su chip.
  const deliveredAgo = useElapsedMinutes(
    comanda.delivered_at ?? comanda.emitted_at,
  );
  const prep = prepMinutes(comanda.emitted_at, comanda.delivered_at);

  const liveItems = comanda.items.filter((it) => !it.cancelled_at);
  const cancelledItems = comanda.items.filter((it) => it.cancelled_at);

  const ChannelIcon = deliveryIcon(comanda.delivery_type);

  // Etiqueta principal: mesa o customer.
  const origenLabel =
    comanda.delivery_type === "dine_in"
      ? `Mesa ${comanda.table_label ?? "?"}`
      : comanda.customer_name || "Pedido online";

  return (
    <article
      className={[
        "bg-card group relative flex flex-col gap-1.5 rounded-xl p-2.5 text-left transition-all",
        "shadow-[0_1px_2px_rgba(19,27,46,0.04)]",
        // Fallo de impresión (spec 33/35): resalta la card con ring rojo para
        // que no se confunda con una recién marchada.
        printFailed ? "ring-2 ring-rose-400/70" : `ring-1 ${columnRing}`,
      ].join(" ")}
    >
      {/* Badge de fallo de impresión (spec 35) — distinto de una recién creada. */}
      {printFailed && (
        <span className="inline-flex items-center gap-1 self-start rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-rose-700 uppercase">
          <Printer className="size-3" strokeWidth={2.5} />
          No imprimió
        </span>
      )}

      {/* Top row: origen + minutos + canal */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground truncate text-base leading-none font-extrabold tracking-tight">
            {origenLabel}
          </span>
          <span
            className={`text-xs font-medium tabular-nums ${elapsedTone(elapsed, isTerminal)}`}
          >
            {isTerminal
              ? deliveredAgo !== null && deliveredAgo < 1
                ? "recién"
                : `hace ${formatRelativeTime(deliveredAgo)}`
              : formatRelativeTime(elapsed)}
          </span>
        </div>
        <ChannelIcon
          className="text-muted-foreground size-4 shrink-0"
          aria-label={comanda.delivery_type}
        />
      </header>

      {/* Sector + mozo en la misma fila (dos chips), con el tiempo desde que se
          comandó a la derecha (solo activas; las entregadas ya muestran "hace X"
          arriba y "Preparada en X" abajo). El sector no encoge (dato crítico,
          color del sector); el chip del mozo — su color del palette del salón —
          trunca si falta lugar. */}
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-bold tracking-wide uppercase ${stationStyle.bg} ${stationStyle.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${stationStyle.dot}`} />
          {comanda.station_name}
        </span>
        {mozoName &&
          comanda.mozo_id &&
          (() => {
            const p = mozoPalette(comanda.mozo_id);
            return (
              <span
                className={`inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${p.bg} ${p.text} ${p.ring}`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${p.dot}`}
                />
                <span className="truncate">{mozoName}</span>
              </span>
            );
          })()}
        {!isTerminal && (
          <span className="text-muted-foreground/70 ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums">
            <Clock className="size-3" strokeWidth={2.5} />
            {formatRelativeTime(elapsed)}
          </span>
        )}
      </div>

      {/* La observación de la tanda (spec 128): lo que el mozo escribió para
          TODO el envío. Va arriba de los ítems y no truncada —a diferencia de
          la nota de un plato— porque es la instrucción con la que se lee la
          lista: «va todo junto», «la mesa tiene apuro». En papel sale igual, en
          las comandas de todos los sectores de la tanda; acá está para el que
          trabaja mirando la pantalla. */}
      {comanda.notes && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug font-semibold text-amber-900 ring-1 ring-amber-200">
          <span className="font-bold tracking-wide uppercase">Obs: </span>
          {comanda.notes}
        </p>
      )}

      {/* Items */}
      <ul className="flex flex-col gap-0.5">
        {liveItems.map((it) => (
          <li
            key={it.order_item_id}
            className="text-muted-foreground flex items-start gap-1.5 text-xs"
          >
            <span className="text-foreground/70 shrink-0 font-semibold tabular-nums">
              {it.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              {/* De qué menú viene el plato (spec 145). Arriba del nombre y no
                  abajo: cambia CÓMO se lee lo que sigue —la milanesa del
                  ejecutivo no es la de la carta— igual que en el papel. Chico y
                  en mayúsculas para que no le compita al plato. */}
              {it.combo_name && (
                <p className="truncate text-[10px] font-bold tracking-wide text-amber-700 uppercase">
                  {it.combo_name}
                </p>
              )}
              <p className="text-foreground truncate font-medium">
                {it.product_name}
              </p>
              {it.modifiers.length > 0 && (
                <p className="text-muted-foreground/80 truncate text-[11px]">
                  {it.modifiers.join(" · ")}
                </p>
              )}
              {it.notes && (
                <p className="text-muted-foreground/80 truncate text-[11px] italic">
                  “{it.notes}”
                </p>
              )}
            </div>
          </li>
        ))}
        {cancelledItems.map((it) => (
          <li
            key={it.order_item_id}
            className="text-muted-foreground/50 flex items-start gap-1.5 text-[11px]"
          >
            <span className="shrink-0 font-semibold tabular-nums line-through">
              {it.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              {it.combo_name && (
                <p className="truncate text-[10px] font-bold tracking-wide uppercase line-through">
                  {it.combo_name}
                </p>
              )}
              <p className="truncate font-medium line-through">
                {it.product_name}
              </p>
              {it.cancelled_reason && (
                <p className="truncate text-rose-600/80 no-underline">
                  Cancelado: {it.cancelled_reason}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Footer compacto: el botón PRINCIPAL (Empezar/Entregar) queda a la vista;
          el resto (Reimprimir / Editar / Anular) va al menú de tres puntos (⋯)
          para que la card ocupe poco con muchas comandas a la vez. */}
      {!isTerminal ? (
        <div className="flex items-center gap-1.5 pt-0.5">
          {comanda.status === "pendiente" && puedeEmpezar && (
            <button
              type="button"
              onClick={() => onEmpezar(comanda.id)}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition active:translate-y-px ${buttonClass}`}
            >
              <Play className="size-3.5" strokeWidth={2.5} />
              Empezar
            </button>
          )}
          {comanda.status === "en_preparacion" && (
            <button
              type="button"
              onClick={() => onEntregar(comanda.id)}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition active:translate-y-px ${buttonClass}`}
            >
              <Check className="size-3.5" strokeWidth={2.5} />
              Entregar
            </button>
          )}
          <ComandaMenu
            comanda={comanda}
            isPending={isPending}
            printFailed={printFailed}
            reprintQueued={reprintQueued}
            onReimprimir={onReimprimir}
            onEditar={onEditar}
            onAnular={onAnular}
            puedeReimprimir={puedeReimprimir}
            puedeEditar={puedeEditar}
            puedeAnular={puedeAnular}
          />
        </div>
      ) : (
        /* Entregadas: KPI de preparación (delivered − emitted) + menú (solo
           Reimprimir). Sin botón primario. */
        <div className="border-border/40 mt-0.5 flex items-center justify-between gap-2 border-t pt-1.5">
          {prep != null ? (
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${prepTone(prep)}`}
            >
              <Check className="size-3.5" strokeWidth={2.5} />
              Preparada en {formatRelativeTime(prep)}
            </span>
          ) : (
            <span className="text-muted-foreground/60 text-[11px]">
              Entregada
            </span>
          )}
          <ComandaMenu
            comanda={comanda}
            isPending={isPending}
            printFailed={printFailed}
            reprintQueued={reprintQueued}
            onReimprimir={onReimprimir}
            onEditar={onEditar}
            onAnular={onAnular}
            puedeReimprimir={puedeReimprimir}
            puedeEditar={puedeEditar}
            puedeAnular={puedeAnular}
          />
        </div>
      )}
    </article>
  );
}

// ─── Menú de opciones de la comanda (⋯) ─────────────────────────────────────

/**
 * Acciones secundarias de la card en un menú de tres puntos: Reimprimir /
 * Reintentar (cualquier estado) + Editar / Anular (solo activas y no anuladas).
 * El botón principal (Empezar/Entregar) queda afuera, a la vista. Mantiene el
 * loading explícito (frontera de plata, spec 21): los modales manejan su pending.
 */
function ComandaMenu({
  comanda,
  isPending,
  printFailed,
  reprintQueued,
  onReimprimir,
  onEditar,
  onAnular,
  puedeReimprimir,
  puedeEditar,
  puedeAnular,
}: {
  comanda: LocalComanda;
  isPending: boolean;
  printFailed: boolean;
  reprintQueued: boolean;
  onReimprimir: (id: string) => void;
  onEditar: () => void;
  onAnular: () => void;
  puedeReimprimir: boolean;
  puedeEditar: boolean;
  puedeAnular: boolean;
}) {
  const activa = comanda.status !== "entregado" && !comanda.cancelled_at;
  const verEditar = activa && puedeEditar;
  const verAnular = activa && puedeAnular;

  // Sin ninguna de las tres no hay menú: el ⋯ vacío era la versión que veía la
  // terminal (spec 182 · D2).
  if (!puedeReimprimir && !verEditar && !verAnular) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Opciones de la comanda"
        disabled={isPending}
        className="text-muted-foreground ring-border/70 hover:bg-muted/60 data-[popup-open]:bg-muted/60 inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 transition disabled:opacity-50"
      >
        <MoreVertical className="size-4" strokeWidth={2.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {puedeReimprimir && (
          <DropdownMenuItem
            onClick={() => onReimprimir(comanda.id)}
            disabled={reprintQueued}
          >
            {reprintQueued ? (
              <>
                <Printer />
                En cola de impresión…
              </>
            ) : printFailed ? (
              <>
                <RotateCcw />
                Reintentar impresión
              </>
            ) : (
              <>
                <Printer />
                Reimprimir
              </>
            )}
          </DropdownMenuItem>
        )}
        {verEditar && (
          <DropdownMenuItem onClick={onEditar}>
            <Pencil />
            Editar comanda
          </DropdownMenuItem>
        )}
        {verAnular && (
          <>
            {(puedeReimprimir || verEditar) && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={onAnular}>
              <Ban />
              Anular comanda
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Pill de salud del print agent (spec 35) ────────────────────────────────

/**
 * Deriva la salud del print agent del último heartbeat, con un reloj vivo.
 * "Conectada" si el último latido fue hace menos del umbral; si no, "sin
 * conexión hace X". `null` = nunca reportó.
 *
 * Usa `useNow`, que arranca en `null`, y no un `useState(() => Date.now())`
 * propio: ese initializer corre **también en el render del server** —el
 * comentario viejo acá decía lo contrario— con un reloj distinto al del
 * cliente. Y `now` no pinta sólo un texto: decide `connected`, o sea **qué
 * rama se renderiza**. Con el heartbeat cerca del umbral, server y cliente
 * armaban pills distintas. Mismo peligro que el reloj de las cards (#257).
 */
function AgentHealthPill({ lastSeenAt }: { lastSeenAt: string | null }) {
  const now = useNow(15_000);

  const msSince =
    lastSeenAt && now !== null ? now - new Date(lastSeenAt).getTime() : null;
  const connected =
    msSince != null && msSince < PRINT_AGENT_OFFLINE_THRESHOLD_MS;

  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <Wifi className="size-3.5" strokeWidth={2.5} />
        Impresión: conectada
      </span>
    );
  }

  const agoLabel =
    msSince == null
      ? "sin señal"
      : `hace ${formatRelativeTime(Math.floor(msSince / 60_000))}`;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
      <WifiOff className="size-3.5" strokeWidth={2.5} />
      Agente de impresión sin conexión ({agoLabel})
    </span>
  );
}

// ─── Anular comanda entera (spec 049) ───────────────────────────────────────

/** De dónde salió la comanda, para que el modal diga qué se está anulando. */
function comandaOrigen(comanda: LocalComanda): string {
  return comanda.delivery_type === "dine_in"
    ? `Mesa ${comanda.table_label ?? "?"}`
    : comanda.customer_name || "Pedido online";
}
