"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { Check, ChevronDown, MapPin } from "lucide-react";

// Las 7 tabs, cada una en su chunk (spec 108). Se montan lazy desde la spec 101
// —una tab se monta la primera vez que se entra— pero su JS venía igual en el
// bundle inicial: `/admin/operacion` arrancaba en 440 kB, la pantalla más pesada
// del producto, para mostrar el plano del salón. Ahora son 119 kB.
//
// El SSR se mantiene (no va `ssr: false`), así que la tab de entrada sigue
// llegando pintada del server. Ojo con la contabilidad: de las 7, dos bajan
// igual en la carga inicial —Mesas, que es la tab default y se renderiza en el
// server, y Pedidos online, que está montado siempre para no tirar su realtime—.
// Las otras cinco son las que se difieren de verdad.
const CajaAdminBoard = dynamic(() =>
  import("@/components/admin/local/caja-admin-board").then(
    (m) => m.CajaAdminBoard,
  ),
);
const ComandasKanban = dynamic(() =>
  import("@/components/admin/local/comandas-kanban").then(
    (m) => m.ComandasKanban,
  ),
);
const FichajeTab = dynamic(() =>
  import("@/components/admin/local/fichaje-tab").then((m) => m.FichajeTab),
);
const CuentasPanel = dynamic(() =>
  import("@/components/admin/local/cuentas-corrientes-tab").then(
    (m) => m.CuentasPanel,
  ),
);
const RendicionMozosTab = dynamic(() =>
  import("@/components/admin/local/rendicion-mozos-tab").then(
    (m) => m.RendicionMozosTab,
  ),
);
const SalonDesktop = dynamic(() =>
  import("@/components/admin/local/salon-desktop").then((m) => m.SalonDesktop),
);
const OrdersRealtimeBoard = dynamic(() =>
  import("@/components/admin/orders-realtime-board").then(
    (m) => m.OrdersRealtimeBoard,
  ),
);
const ReservasWorkspace = dynamic(() =>
  import("@/components/reservations/reservas-workspace").then(
    (m) => m.ReservasWorkspace,
  ),
);
import { ErrorBoundary } from "@/components/shared/error-boundary";
import {
  SalonBoardSkeleton,
  TabContentSkeleton,
} from "@/components/skeletons/operacion-skeleton";
import {
  countCajas,
  countPedidosNuevos,
  countPresentes,
  countRendicionesPendientes,
  countReservasPorSentar,
  countSalonOcupadas,
} from "@/app/[business_slug]/admin/(authed)/operacion/counts";
import { canCobrarCuentaCorriente } from "@/lib/permissions/can";
import type {
  CajaData,
  ComandasData,
  CuentasData,
  FichajeData,
  PedidosData,
  RendicionData,
  ReservasData,
  SalonData,
} from "@/app/[business_slug]/admin/(authed)/operacion/data";
import type { BusinessRole } from "@/lib/admin/context";
import type { SalonOption } from "@/lib/admin/floor-plan/queries";
import { salonFilterStorageKey } from "@/lib/admin/salon-filter";
import { localDate } from "@/lib/reservations/pending-inbox";
import { useStickyMultiFilter } from "@/lib/ui/use-sticky-filter";
import { useOnActivate, useTabParam } from "@/lib/ui/use-tab-param";
import {
  getFichajeTabData,
  getReservasTabData,
} from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import {
  tabsVisiblesEnOperacion,
  type OperacionTab,
} from "@/lib/permissions/operacion-tabs";
import { cn } from "@/lib/utils";
import { AyudaChip } from "@/components/admin/ayuda-chip";

// Spec 182 — la lista y el gate viven en `lib/permissions/operacion-tabs.ts`:
// el server los necesita para no crear la promesa de una tab que el rol no ve.
type Tab = OperacionTab;

/**
 * Tabs a las que aplica el filtro por salón (spec 065, FR-002).
 *
 * En Caja / Rendición / Fichaje / Pedidos online el selector se **oculta**: no
 * tienen dimensión salón y dejarlo a la vista invitaría a leer un total de caja
 * como si estuviera recortado por salón.
 */
const SALON_FILTERABLE: Tab[] = ["salon", "comandas", "reservas"];

/** Qué tema de la guía abre el "?" de cada tab — spec 134 D7. Las siete. */
const TEMA_POR_TAB: Record<Tab, string> = {
  salon: "mesas",
  reservas: "reservas",
  comandas: "comandas",
  pedidos: "pedidos",
  caja: "caja",
  cuentas: "cuentas-corrientes",
  rendicion: "rendicion",
  fichaje: "fichaje",
};

type ShellProps = {
  slug: string;
  businessId: string;
  timezone: string;
  currentUserId: string;
  role: BusinessRole;
  /** Salones del negocio (id + nombre) para el selector de la barra de tabs. */
  salones: SalonOption[];
  /** Spec 153 — `?caja=`, para que «Ver ahora» abra esa caja y no la guardada. */
  cajaPedida?: string | null;
  salon: Promise<SalonData>;
  comandas: Promise<ComandasData>;
  fichaje: Promise<FichajeData>;
  /**
   * Spec 182 · D3 — `null` cuando el rol no ve esa tab. No es una optimización:
   * una promesa pasada a un componente cliente la serializa React y viaja al
   * navegador, vea o no el pane. Así llegaban a la terminal —una PC compartida
   * por todo el salón— los cortes de caja, las rendiciones por mozo y los
   * teléfonos de las reservas del día.
   */
  pedidos: Promise<PedidosData> | null;
  caja: Promise<CajaData> | null;
  cuentas: Promise<CuentasData> | null;
  rendicion: Promise<RendicionData> | null;
  reservas: Promise<ReservasData> | null;
};

// ─── Pills: nunca un "0" provisional (FR-006) ────────────────────────────────
// Mientras la promesa del grupo está pendiente, el <Suspense> muestra "—"; el
// número se calcula recién con el dato resuelto, con el mismo predicado que usa
// la tab (FR-012). Un rechazo cae al ErrorBoundary → "—" (no tumba el shell).

function CountFallback() {
  return <span className="opacity-40">—</span>;
}

function CountValue<T>({
  promise,
  compute,
}: {
  promise: Promise<T>;
  compute: (d: T) => number;
}) {
  return <>{compute(use(promise))}</>;
}

function Pill<T>({
  promise,
  compute,
  override,
}: {
  promise: Promise<T>;
  compute: (d: T) => number;
  /**
   * Dato ya resuelto que le gana a la promesa. Lo usa Mesas desde la spec 102:
   * el plano se actualiza por refetch de tab, y sin esto el badge se quedaría
   * con el conteo del page-load — contradiciendo, en la misma barra, a lo que
   * muestra el panel de al lado.
   */
  override?: T | null;
}) {
  if (override != null) return <>{compute(override)}</>;
  return (
    <ErrorBoundary fallback={<CountFallback />}>
      <Suspense fallback={<CountFallback />}>
        <CountValue promise={promise} compute={compute} />
      </Suspense>
    </ErrorBoundary>
  );
}

// ─── Error de carga de una tab (FR-007) ──────────────────────────────────────
// Para tabs de plata (Caja / Rendición): mensaje explícito y accionable, jamás
// un estado vacío que se lea como "no hay nada".

function TabLoadError({ money }: { money?: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
      <p className="text-sm font-semibold text-red-800">
        {money
          ? "No se pudieron cargar los datos de esta sección."
          : "No se pudo cargar esta sección."}
      </p>
      <p className="max-w-sm text-xs text-red-700">
        {money
          ? "Esto NO significa que no haya nada: hay datos, pero fallaron al cargar. Reintentá antes de tomar decisiones de cierre."
          : "Reintentá para volver a cargarla."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Reintentar
      </button>
    </div>
  );
}

// ─── Paneles: cada uno lee su promesa con use() ──────────────────────────────

function SalonPanel({
  promise,
  slug,
  businessId,
  currentUserId,
  role,
  visiblePlanIds,
  distribuirOpen,
  onDistribuirOpen,
  onDistribuirClose,
  active,
  refetchAlMontar,
  onServerData,
  onReservationsChanged,
}: {
  promise: Promise<SalonData>;
  slug: string;
  businessId: string;
  currentUserId: string;
  role: BusinessRole;
  visiblePlanIds: string[];
  distribuirOpen: boolean;
  onDistribuirOpen: () => void;
  onDistribuirClose: () => void;
  active: boolean;
  refetchAlMontar: boolean;
  onServerData: (d: SalonData) => void;
  onReservationsChanged: () => void;
}) {
  const { floorPlans, dineInOrders, reservations, mozos } = use(promise);
  return (
    <SalonDesktop
      slug={slug}
      businessId={businessId}
      visiblePlanIds={visiblePlanIds}
      floorPlans={floorPlans}
      dineInOrders={dineInOrders}
      reservations={reservations}
      mozos={mozos}
      currentUserId={currentUserId}
      role={role}
      distribuirOpen={distribuirOpen}
      onDistribuirOpen={onDistribuirOpen}
      onDistribuirClose={onDistribuirClose}
      tabActive={active}
      refetchAlMontar={refetchAlMontar}
      onServerData={onServerData}
      onReservationsChanged={onReservationsChanged}
    />
  );
}

function PedidosPanel({
  promise,
  slug,
  businessId,
  timezone,
  active,
}: {
  promise: Promise<PedidosData>;
  slug: string;
  businessId: string;
  timezone: string;
  active: boolean;
}) {
  const { initialOrders, marchLeadKitchenMin, deliveryFeeCents } = use(promise);
  return (
    <OrdersRealtimeBoard
      businessId={businessId}
      slug={slug}
      timezone={timezone}
      initialOrders={initialOrders}
      marchLeadKitchenMin={marchLeadKitchenMin}
      deliveryFeeCents={deliveryFeeCents}
      active={active}
    />
  );
}

function ComandasPanel({
  promise,
  slug,
  businessId,
  role,
  salonIds,
  salonLabel,
  active,
}: {
  promise: Promise<ComandasData>;
  slug: string;
  businessId: string;
  role: BusinessRole;
  salonIds: string[];
  salonLabel: string | null;
  active: boolean;
}) {
  const { initialComandas, stations, mozos, printAgentLastSeenAt } =
    use(promise);
  return (
    <ComandasKanban
      slug={slug}
      businessId={businessId}
      role={role}
      initialComandas={initialComandas}
      stations={stations}
      mozos={mozos}
      printAgentLastSeenAt={printAgentLastSeenAt}
      salonIds={salonIds}
      salonLabel={salonLabel}
      active={active}
    />
  );
}

function CajaPanel({
  promise,
  slug,
  cajaPedida,
  active,
  refetchAlMontar,
  onServerData,
}: {
  promise: Promise<CajaData>;
  slug: string;
  cajaPedida?: string | null;
  active: boolean;
  refetchAlMontar: boolean;
  onServerData: (d: CajaData) => void;
}) {
  const { cajas } = use(promise);
  return (
    <CajaAdminBoard
      slug={slug}
      cajas={cajas}
      cajaPedida={cajaPedida}
      active={active}
      refetchAlMontar={refetchAlMontar}
      onServerData={onServerData}
    />
  );
}

function RendicionPanel({
  rendicionPromise,
  cajaPromise,
  slug,
  role,
  active,
  refetchAlMontar,
  onServerData,
}: {
  rendicionPromise: Promise<RendicionData>;
  cajaPromise: Promise<CajaData>;
  slug: string;
  role: BusinessRole;
  active: boolean;
  refetchAlMontar: boolean;
  onServerData: (d: RendicionData) => void;
}) {
  const {
    rendicionPendientes,
    rendicionHistorial,
    cajaAssignments,
    businessMembers,
  } = use(rendicionPromise);
  // La tab de rendición también necesita las cajas: se lee de la MISMA promesa
  // que alimenta la tab Caja y su pill (fuente única, sin duplicar la query).
  const { cajas } = use(cajaPromise);
  return (
    <RendicionMozosTab
      slug={slug}
      initialPendientes={rendicionPendientes}
      initialHistorial={rendicionHistorial}
      cajas={cajas}
      cajaAssignments={cajaAssignments}
      members={businessMembers}
      showAssignments={role === "admin"}
      active={active}
      refetchAlMontar={refetchAlMontar}
      onServerData={onServerData}
    />
  );
}

function ReservasPanel({
  promise,
  slug,
  businessId,
  timezone,
  salonIds,
  active,
  refetchAlMontar,
  onServerData,
  reloadRef,
}: {
  promise: Promise<ReservasData>;
  slug: string;
  businessId: string;
  timezone: string;
  salonIds: string[];
  active: boolean;
  refetchAlMontar: boolean;
  onServerData: (d: ReservasData) => void;
  /** El shell publica acá cómo re-pedir el día que se está mirando. */
  reloadRef: React.RefObject<(() => void) | null>;
}) {
  const inicial = use(promise);
  // Snapshot propio (spec 103): el libro del día se re-pide con su action —al
  // cambiar de día, al mutar, y al volver a la tab—, no re-corriendo la ruta.
  const [data, setData] = useState(inicial);
  const seq = useRef(0);
  // Día PEDIDO, no el pintado: se marca antes del await, así una revalidación
  // que se cruce con un cambio de día (realtime, vuelta a la tab) re-pide el día
  // nuevo —el que ya quedó escrito en la URL— en vez de revertirlo al anterior.
  const diaPedido = useRef(inicial.date);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  const refetch = useCallback(
    async (date: string) => {
      diaPedido.current = date;
      const n = ++seq.current;
      try {
        const res = await getReservasTabData(slug, date);
        if (n !== seq.current) return;
        if (res.ok) {
          setData(res.data);
          onServerDataRef.current(res.data);
        }
      } catch {
        // swallow: refresh de fondo, mantiene el día que se está mirando.
      }
    },
    [slug],
  );
  useOnActivate(active, () => void refetch(diaPedido.current), {
    onMount: refetchAlMontar,
  });
  reloadRef.current = () => void refetch(diaPedido.current);

  // Spec 192 — la MISMA pantalla que /admin/reservas, no una copia: el
  // workspace trae el layout, la bandeja y el plano del día. La tab tenía su
  // propio armado y por eso se quedó sin plano cuando el plano pasó a ser la
  // vista de entrada (spec 189).
  const solicitudes = data.solicitudes ?? [];
  const diasConSolicitudes = [
    ...new Set(
      solicitudes.map((s) => localDate(s.reserva.starts_at, timezone)),
    ),
  ];

  return (
    <ReservasWorkspace
      slug={slug}
      businessId={businessId}
      date={data.date}
      rows={data.rows}
      timezone={timezone}
      floorPlans={data.floorPlans}
      activeTables={data.activeTables}
      mode={data.mode}
      services={data.services}
      solicitudes={solicitudes}
      diasConSolicitudes={diasConSolicitudes}
      // La tab se hidrata con el mismo reloj con el que el server armó los
      // «vence en» (spec 135).
      ahoraIso={data.ahoraIso}
      salonIds={salonIds}
      onChanged={(d) => void refetch(d)}
      // Embebida en el operativo: el navegador de fechas se queda acá
      // (`?tab=reservas&date=…`) en vez de saltar a /admin/reservas.
      datePath={`/${slug}/admin/operacion`}
    />
  );
}

function FichajePanel({
  promise,
  slug,
  active,
  refetchAlMontar,
  onServerData,
}: {
  promise: Promise<FichajeData>;
  slug: string;
  active: boolean;
  refetchAlMontar: boolean;
  onServerData: (d: FichajeData) => void;
}) {
  const inicial = use(promise);
  // Snapshot propio (spec 103): el fichaje se re-pide con su action al volver a
  // la tab. Reemplaza al puente `router.refresh()` de la spec 101.
  const [data, setData] = useState(inicial);
  const seq = useRef(0);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  useOnActivate(
    active,
    () => {
      const n = ++seq.current;
      void getFichajeTabData(slug)
        .then((res) => {
          if (n !== seq.current || !res.ok) return;
          setData(res.data);
          onServerDataRef.current(res.data);
        })
        .catch(() => {});
    },
    { onMount: refetchAlMontar },
  );

  return (
    <FichajeTab
      slug={slug}
      initialPresent={data.initialPresent}
      todaySummary={data.todaySummary}
      active={active}
    />
  );
}

/**
 * Selector de salón del operativo (spec 065, FR-001).
 *
 * Un solo control para las tres tabs que tienen salón. La elección se recuerda
 * por máquina: la tablet de la terraza mira la terraza.
 *
 * **Multi-selección** (fast-follow 2026-07-30): un encargado puede cubrir dos
 * salones a la vez, así que son checkboxes y no un `<select>`. Ninguno marcado
 * = todos; no hay opción "Todos" que se pueda combinar con las otras y quedar
 * en un estado contradictorio — el botón «Ver todos» simplemente vacía.
 *
 * Vive **pegado a las tabs** (izquierda) a propósito: en la esquina superior
 * derecha flota la campana de notificaciones del panel admin y se chocaban.
 */
function SalonSelector({
  salones,
  selected,
  onToggle,
  onClear,
}: {
  salones: SalonOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const filtrando = selected.length > 0;

  // Cerrar al tocar afuera / con Escape. Sin librería: es un menú de 3 líneas.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = !filtrando
    ? "Todos los salones"
    : selected.length === 1
      ? (salones.find((s) => s.id === selected[0])?.name ?? "1 salón")
      : `${selected.length} salones`;

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Filtrar por salón"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold ring-1 transition",
          // Filtrando = estado "no estás viendo todo": tiene que cantar.
          filtrando
            ? "bg-amber-50 text-amber-900 ring-amber-300"
            : "bg-white text-zinc-500 ring-zinc-200/70 hover:text-zinc-900",
        )}
      >
        <MapPin className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={3} />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 min-w-52 rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200">
          <button
            type="button"
            onClick={onClear}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition",
              filtrando
                ? "text-zinc-500 hover:bg-zinc-50"
                : "bg-zinc-100 text-zinc-900",
            )}
          >
            Todos los salones
          </button>
          <div className="my-1 h-px bg-zinc-100" />
          {salones.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(s.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border transition",
                    on
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-zinc-300",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={4} />}
                </span>
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabsInner({
  slug,
  businessId,
  timezone,
  currentUserId,
  role,
  salones,
  cajaPedida,
  salon,
  comandas,
  pedidos,
  caja,
  cuentas,
  rendicion,
  fichaje,
  reservas,
}: ShellProps) {
  // Default = "salon" porque es la pantalla principal del operativo en local.
  // La tab es estado de CLIENTE y la URL se escribe con la History API: cambiar
  // de tab no dispara ningún request (spec 101). Antes era `router.replace`, o
  // sea una navegación soft que re-ejecutaba la page entera — las 7 promesas,
  // ~30 queries — para pintar una sola tab.
  const visibles = useMemo(() => tabsVisiblesEnOperacion(role), [role]);
  const ve = useCallback((t: Tab) => visibles.includes(t), [visibles]);
  const [active, setTab] = useTabParam<Tab>("tab", "salon", visibles);

  // Keep-alive: una tab se monta la PRIMERA vez que se entra y de ahí en más se
  // esconde con CSS en vez de desmontarse (es lo que ya hacía Pedidos para no
  // tirar su realtime, generalizado a todas). Sin esto, cortar la navegación
  // haría que cada vuelta a una tab remonte `SalonDesktop` / `ComandasKanban`,
  // re-suscriba sus channels (`getSession()` + `setAuth()` cada vez) y pierda
  // scroll y filtros. Se monta lazy —no las 7 de una— para que el primer
  // pintado siga siendo el de Mesas.
  // Con qué tab abrió la página: es la única cuyo dato viene recién renderizado
  // por el server. Las demás montan lazy, con la promesa del page-load ya
  // envejecida, así que al abrirlas revalidan.
  const tabInicial = useRef(active).current;
  const visited = useRef<Set<Tab>>(new Set<Tab>([active]));
  visited.current.add(active);
  const mounted = (t: Tab) => visited.current.has(t);
  // `h-full` en la activa: los paneles que lo usan (Mesas, Fichaje) colgaban de
  // un contenedor con altura definida y este wrapper queda en el medio.
  const paneClass = (t: Tab) => (active === t ? "h-full" : "hidden");

  // Ya no queda ningún puente `router.refresh()` (spec 103): las 7 tabs tienen
  // su propio refetch y revalidan al activarse, cada una con sus queries.
  //
  // La única suscripción a `reservations` de la app vive en SalonDesktop
  // (spec 102). Si el encargado está justo mirando el libro del día, una
  // reserva nueva de la web o del chatbot tiene que aparecerle sin tocar nada,
  // así que se le avisa a la tab Reservas para que re-pida SU día. Si está en
  // otra tab no hace falta: al volver, la tab revalida sola.
  // El panel de Reservas publica acá cómo re-pedir el día que está mirando.
  const recargarReservas = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onReservasCambiaron = () => {
    if (activeRef.current === "reservas") recargarReservas.current?.();
  };

  // Como todo /admin/operacion es fullscreen, colapsamos el sidebar al entrar.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("admin-sidebar-collapse"));
  }, []);

  // Modo "Distribuir mozos": vive en el shell para que el botón quede alineado
  // con las tabs en el header (en vez de dentro del SalonDesktop).
  const [distribuirOpen, setDistribuirOpen] = useState(false);

  // Último snapshot que trajo el refetch de cada tab (specs 102 y 103). Los
  // badges cuentan sobre esto y no sobre la promesa del page-load, que desde
  // que ninguna tab re-corre la ruta ya no se revalida nunca.
  const [salonData, setSalonData] = useState<SalonData | null>(null);
  const [cajaData, setCajaData] = useState<CajaData | null>(null);
  const [cuentasData] = useState<CuentasData | null>(null);
  const [rendicionData, setRendicionData] = useState<RendicionData | null>(
    null,
  );
  const [reservasData, setReservasData] = useState<ReservasData | null>(null);
  const [fichajeData, setFichajeData] = useState<FichajeData | null>(null);

  // ── Filtro por salón (spec 065) ──
  // Preferencia por máquina + negocio, multi-selección (vacío = todos).
  // Gobierna Mesas, Comandas y Reservas; las pills cuentan sobre el mismo dato
  // filtrado (FR-006).
  const salonIds = useMemo(() => salones.map((s) => s.id), [salones]);
  const [salonFilter, toggleSalon, clearSalones] = useStickyMultiFilter(
    salonFilterStorageKey(businessId),
    salonIds,
  );
  const salonLabel =
    salonFilter.length === 1
      ? (salones.find((s) => s.id === salonFilter[0])?.name ?? null)
      : salonFilter.length > 1
        ? `${salonFilter.length} salones`
        : null;
  // Con un solo salón no hay nada que elegir.
  const showSalonFilter =
    salones.length > 1 && SALON_FILTERABLE.includes(active);
  const temaDeAyuda = TEMA_POR_TAB[active];

  const tabsBar = (
    <nav
      aria-label="Secciones del operativo"
      className="inline-flex rounded-2xl bg-white p-1 ring-1 ring-zinc-200/70"
    >
      <TabButton
        active={active === "salon"}
        onClick={() => setTab("salon")}
        count={
          <Pill
            promise={salon}
            override={salonData}
            compute={(d) => countSalonOcupadas(d.floorPlans, salonFilter)}
          />
        }
      >
        Mesas
      </TabButton>
      {ve("reservas") && reservas && (
        <TabButton
          active={active === "reservas"}
          onClick={() => setTab("reservas")}
          count={
            <Pill
              promise={reservas}
              override={reservasData}
              compute={(d) => countReservasPorSentar(d.rows, salonFilter)}
            />
          }
        >
          Reservas
        </TabButton>
      )}
      {/* Comandas va SIN pill: el contador de "activas" no coincidía con lo que
          se ve en el kanban de la tab, así que un número mal es peor que
          ninguno. La tab muestra el estado real. */}
      <TabButton
        active={active === "comandas"}
        onClick={() => setTab("comandas")}
      >
        Comandas
      </TabButton>
      {ve("pedidos") && pedidos && (
        <TabButton
          active={active === "pedidos"}
          onClick={() => setTab("pedidos")}
          count={
            <Pill
              promise={pedidos}
              compute={(d) => countPedidosNuevos(d.initialOrders)}
            />
          }
        >
          Pedidos online
        </TabButton>
      )}
      {ve("caja") && caja && (
        <TabButton
          active={active === "caja"}
          onClick={() => setTab("caja")}
          count={
            <Pill
              promise={caja}
              override={cajaData}
              compute={(d) => countCajas(d.cajas)}
            />
          }
        >
          Caja
        </TabButton>
      )}
      {ve("cuentas") && cuentas && (
        <TabButton
          active={active === "cuentas"}
          onClick={() => setTab("cuentas")}
          count={
            <Pill
              promise={cuentas}
              override={cuentasData}
              /* Cuántos DEBEN, no cuánto: el pill es un contador en las otras
                 siete tabs, y romper eso haría leer «8» como ocho pesos. */
              compute={(d) => d.cuantos_deben}
            />
          }
        >
          Cuentas corrientes
        </TabButton>
      )}
      {ve("rendicion") && rendicion && (
        <TabButton
          active={active === "rendicion"}
          onClick={() => setTab("rendicion")}
          count={
            <Pill
              promise={rendicion}
              override={rendicionData}
              compute={(d) => countRendicionesPendientes(d.rendicionPendientes)}
            />
          }
        >
          Rendición
        </TabButton>
      )}
      <TabButton
        active={active === "fichaje"}
        onClick={() => setTab("fichaje")}
        count={
          <Pill
            promise={fichaje}
            override={fichajeData}
            compute={(d) => countPresentes(d.initialPresent)}
          />
        }
      >
        Fichaje
      </TabButton>
    </nav>
  );

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col bg-zinc-50 transition-[left] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:top-0 md:left-[var(--admin-sidebar-width,60px)]">
      {/* El selector va pegado a las tabs, NO en la esquina derecha: ahí flota
          la campana de notificaciones del panel admin y se chocaban.

          El `overflow-x-auto` va SOLO en las tabs, no en la barra entera: un
          contenedor que scrollea en X establece un contexto de recorte también
          en Y, y con la barra entera scrolleando el desplegable del selector
          quedaba cortado (no tapado — por eso subirle el z-index no servía). */}
      {/* `relative z-40` es lo que mantiene el desplegable del selector por
          ENCIMA del panel de la mesa. El `backdrop-blur` de esta barra crea un
          contexto de apilamiento propio: sin posicionarla, el `z-50` del menú
          sólo compite adentro de la barra, y el `<aside>` del panel (que es
          `relative`) pinta por arriba de todo el bloque. */}
      <div className="border-border/60 relative z-40 flex items-center gap-3 border-b bg-white/95 px-3 py-3 pr-16 backdrop-blur sm:px-4 sm:pr-20">
        <div className="min-w-0 overflow-x-auto">{tabsBar}</div>
        {showSalonFilter && (
          <SalonSelector
            salones={salones}
            selected={salonFilter}
            onToggle={toggleSalon}
            onClear={clearSalones}
          />
        )}
        {/* El "?" de la tab activa (spec 134). Va acá y no en el índice de
            Ayuda porque nadie se acuerda de que la guía existe justo cuando
            está trabado: tiene que estar en la pantalla del problema. */}
        <AyudaChip slug={slug} tema={temaDeAyuda} />
      </div>
      <div className="flex-1 overflow-auto p-4">
        {mounted("salon") && (
          <div className={paneClass("salon")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<SalonBoardSkeleton />}>
                <SalonPanel
                  promise={salon}
                  slug={slug}
                  businessId={businessId}
                  currentUserId={currentUserId}
                  role={role}
                  visiblePlanIds={salonFilter}
                  distribuirOpen={distribuirOpen}
                  onDistribuirOpen={() => setDistribuirOpen(true)}
                  onDistribuirClose={() => setDistribuirOpen(false)}
                  active={active === "salon"}
                  refetchAlMontar={tabInicial !== "salon"}
                  onServerData={setSalonData}
                  onReservationsChanged={onReservasCambiaron}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {/* Pedidos online: SIEMPRE montado (oculto con CSS) para que su
            suscripción realtime no se caiga al cambiar de tab. Salvo que el rol
            no lo vea (spec 140): ahí no se monta y no abre su channel. */}
        {ve("pedidos") && pedidos && (
          <div className={paneClass("pedidos")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <PedidosPanel
                  promise={pedidos}
                  slug={slug}
                  businessId={businessId}
                  timezone={timezone}
                  active={active === "pedidos"}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {ve("reservas") && mounted("reservas") && reservas && (
          <div className={paneClass("reservas")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <ReservasPanel
                  promise={reservas}
                  slug={slug}
                  businessId={businessId}
                  timezone={timezone}
                  salonIds={salonFilter}
                  active={active === "reservas"}
                  refetchAlMontar={tabInicial !== "reservas"}
                  onServerData={setReservasData}
                  reloadRef={recargarReservas}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted("comandas") && (
          <div className={paneClass("comandas")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <ComandasPanel
                  promise={comandas}
                  slug={slug}
                  businessId={businessId}
                  role={role}
                  salonIds={salonFilter}
                  salonLabel={salonLabel}
                  active={active === "comandas"}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {ve("caja") && mounted("caja") && caja && (
          <div className={paneClass("caja")}>
            <ErrorBoundary fallback={<TabLoadError money />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <CajaPanel
                  promise={caja}
                  slug={slug}
                  cajaPedida={cajaPedida}
                  active={active === "caja"}
                  refetchAlMontar={tabInicial !== "caja"}
                  onServerData={setCajaData}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {ve("cuentas") && mounted("cuentas") && cuentas && (
          <div className={paneClass("cuentas")}>
            <ErrorBoundary fallback={<TabLoadError money />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <CuentasPanel
                  promise={cuentas}
                  slug={slug}
                  puedeCobrar={canCobrarCuentaCorriente(role)}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {ve("rendicion") && mounted("rendicion") && rendicion && caja && (
          <div className={paneClass("rendicion")}>
            <ErrorBoundary fallback={<TabLoadError money />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <RendicionPanel
                  rendicionPromise={rendicion}
                  cajaPromise={caja}
                  slug={slug}
                  role={role}
                  active={active === "rendicion"}
                  refetchAlMontar={tabInicial !== "rendicion"}
                  onServerData={setRendicionData}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted("fichaje") && (
          <div className={paneClass("fichaje")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <FichajePanel
                  promise={fichaje}
                  slug={slug}
                  active={active === "fichaje"}
                  refetchAlMontar={tabInicial !== "fichaje"}
                  onServerData={setFichajeData}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Sin `count` la tab se dibuja sin badge (no un badge vacío). */
  count?: ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap transition sm:px-4",
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-500 hover:text-zinc-900",
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums",
            active
              ? "bg-white text-zinc-900 ring-1 ring-zinc-200"
              : "bg-zinc-100 text-zinc-500",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function LocalShell(props: ShellProps) {
  return (
    <Suspense fallback={null}>
      <TabsInner {...props} />
    </Suspense>
  );
}
