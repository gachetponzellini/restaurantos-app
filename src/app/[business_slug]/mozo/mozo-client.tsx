"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArmchairIcon,
  ArrowLeftRight,
  Ban,
  CalendarCheck,
  Check,
  ClipboardList,
  Clock,
  LogOut,
  MoveRight,
  Receipt,
  Settings,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import type { BusinessRole } from "@/lib/admin/context";
import { MobileTabBar, type MozoTab } from "@/components/mozo/mobile-tab-bar";
import { OrderSummaryCard } from "@/components/mozo/order-summary-card";
import { TableDrawer } from "@/components/mozo/table-drawer";
import { MesaActionRow, MesaActionTile } from "@/components/mozo/mesa-actions";
import { ElegirMozoModal } from "@/components/mozo/elegir-mozo-modal";
import { TrasladarMesaModal } from "@/components/mozo/trasladar-mesa-modal";
import { WalkInModal } from "@/components/mozo/walk-in-modal";
import { signOut } from "@/lib/auth/sign-out";
import { anularMesa, transferTable, volverAPedir } from "@/lib/mozo/actions";
import { tieneConsumo } from "@/lib/mozo/consumo";
import type { MozoMember, MozoAttendance } from "@/lib/mozo/queries";
import { type OperationalStatus } from "@/lib/mozo/state-machine";
import { DELAY_COLORS, tableDelay } from "@/lib/comandas/mesa-demora";
import { getMozoHomeData } from "@/lib/mozo/home-actions";
import { cn } from "@/lib/utils";
import { useTablesRealtime } from "@/lib/mozo/use-tables-realtime";
import { NotificationsToastHost } from "@/components/notifications/notifications-toast-host";
import { useNotificationsRealtime } from "@/components/notifications/use-notifications-realtime";
import { markAllRead, markRead } from "@/lib/notifications/actions";
import type { Notification } from "@/lib/notifications/queries";
import {
  NOTI_TONE_STYLES,
  formatNotificationTime,
  viewForNotification,
} from "@/lib/notifications/view";
import {
  canCancelItem,
  canMoveTable,
  canTransitionMesa,
} from "@/lib/permissions/can";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { FloorTable } from "@/lib/reservations/types";
import { TZ_AR } from "@/lib/timezone";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReservationForMozo = {
  id: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  starts_at: string;
  status: string;
  notes: string | null;
};

export type ComandaForMozo = {
  id: string;
  batch: number;
  status: "pendiente" | "en_preparacion" | "entregado";
  station_name: string;
  emitted_at: string;
  delivered_at: string | null;
  /** Anulada (spec 049): la fila se pinta «Anulada» y pierde sus acciones. */
  cancelled_at: string | null;
  items: { product_name: string; quantity: number; prep_time_minutes: number | null }[];
};

export type OrderForMozo = {
  id: string;
  order_number: number;
  /**
   * El número del pedido DEL DÍA (`orders.daily_number`): arranca en 1 cada
   * jornada y es el que sale impreso en la comanda. Es el que se muestra, para
   * que lo que el mozo canta sea lo mismo que la cocina tiene en el papel;
   * `order_number` (correlativo global, no se reinicia) queda para el
   * historial.
   */
  daily_number: number;
  table_id: string | null;
  delivery_type: string;
  total_cents: number;
  created_at: string;
  status: string;
  customer_name: string | null;
  items: { product_name: string; quantity: number; cancelled_at: string | null }[];
  comandas: ComandaForMozo[];
};

type Props = {
  businessSlug: string;
  businessName: string;
  businessId: string;
  /** Todos los floor_plans del business con sus tables. El mozo elige cuál
   *  ver en la pestaña Salón (selector si hay >1). La vista no muestra el
   *  plano SVG (mobile-first) — solo la lista de mesas. */
  floorPlans: FloorPlanWithTables[];
  reservations: ReservationForMozo[];
  activeOrders: OrderForMozo[];
  mozos: MozoMember[];
  currentUserId: string;
  role: BusinessRole;
  initialNotifications: Notification[];
  initialUnreadCount: number;
  todayTipsCents: number;
  attendance: MozoAttendance;
};

// ─── Config visual ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OperationalStatus, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pidio_cuenta: "Pidió la cuenta",
};

const STATUS_DOT: Record<OperationalStatus, string> = {
  libre: "bg-zinc-300",
  ocupada: "bg-emerald-500",
  pidio_cuenta: "bg-amber-500",
};

const STATUS_PILL: Record<OperationalStatus, string> = {
  libre: "bg-zinc-100 text-zinc-700",
  ocupada: "bg-emerald-100 text-emerald-800",
  pidio_cuenta: "bg-amber-100 text-amber-800",
};

const STATUS_BORDER: Record<OperationalStatus, string> = {
  libre: "border-l-zinc-200",
  ocupada: "border-l-emerald-500",
  pidio_cuenta: "border-l-amber-500",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minutesSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 0 })}`;
}

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "??";
}

// relativeTime + describeNotif viven en `lib/notifications/view.ts`
// (`formatNotificationTime` + `viewForNotification`) — compartidos con
// el drawer admin para mantener el lenguaje visual uniforme.

// ─── Component ───────────────────────────────────────────────────────────────

export function MozoClient({
  businessSlug,
  businessName,
  businessId,
  floorPlans: initialFloorPlans,
  reservations: initialReservations,
  activeOrders: initialActiveOrders,
  mozos: initialMozos,
  currentUserId,
  role,
  initialNotifications,
  initialUnreadCount,
  todayTipsCents,
  attendance,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Snapshot del server del home, seedeado de los props y actualizado sólo por
  // `refetchHome` (spec 107). Antes cada acción de mesa y cada evento de
  // realtime hacían `router.refresh()`, que re-ejecutaba `mozo/page.tsx`
  // entera: las 8 queries del `Promise.all`, incluidas notificaciones,
  // propinas y fichaje, que ninguna acción de mesa toca.
  const [serverData, setServerData] = useState({
    floorPlans: initialFloorPlans,
    reservations: initialReservations,
    activeOrders: initialActiveOrders,
    mozos: initialMozos,
  });
  const { floorPlans, reservations, activeOrders, mozos } = serverData;

  // Guarda de carrera por secuencia y error tragado: es un refresh de fondo, y
  // un plano vacío en medio del servicio es peor que uno de dos segundos atrás.
  const refetchSeq = useRef(0);
  const refetchHome = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getMozoHomeData(businessSlug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) setServerData(res.data);
    } catch {
      // swallow: refresh de fondo, sin toast ni rollback.
    }
  }, [businessSlug]);
  // Default tab: "Mis mesas" para el mozo (su día a día). Encargado/admin
  // arrancan en "Salón" (vista global). Platform admin = admin acá.
  const [activeTab, setActiveTab] = useState<MozoTab>(
    role === "mozo" ? "mesas" : "salon",
  );
  const [selected, setSelected] = useState<FloorTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [walkInTableId, setWalkInTableId] = useState<string | null>(null);
  const [transferTableId, setTransferTableId] = useState<string | null>(null);
  const [trasladarTableId, setTrasladarTableId] = useState<string | null>(null);
  const [anularPrompt, setAnularPrompt] = useState<{
    tableId: string;
    label: string;
  } | null>(null);
  const [anularReason, setAnularReason] = useState("");
  const [claimPrompt, setClaimPrompt] = useState<{
    tableId: string;
    label: string;
    fromName: string | null;
  } | null>(null);

  // ── Multi-salón ──
  const planStorageKey = `mozo_active_plan_${businessId}`;
  const [activePlanId, setActivePlanId] = useState<string>(
    () => floorPlans[0]?.plan.id ?? "",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(planStorageKey);
      if (stored && floorPlans.some((p) => p.plan.id === stored)) {
        setActivePlanId(stored);
      } else if (floorPlans[0]) {
        setActivePlanId(floorPlans[0].plan.id);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStorageKey]);
  useEffect(() => {
    if (!floorPlans.some((p) => p.plan.id === activePlanId) && floorPlans[0]) {
      setActivePlanId(floorPlans[0].plan.id);
    }
  }, [floorPlans, activePlanId]);

  const setActivePlan = (id: string) => {
    setActivePlanId(id);
    setSelected(null);
    try {
      localStorage.setItem(planStorageKey, id);
    } catch {
      // ignore
    }
  };

  // Mesas del negocio. Antes esto era SOLO las del plan activo, lo que
  // rompía "Mis mesas" cuando el mozo tenía asignaciones en distintos
  // floor plans (Salón + Terraza). Ahora guardamos TODAS y filtramos por
  // plan únicamente cuando rendereamos el plano del salón.
  const allTables = useMemo(
    () => floorPlans.flatMap((p) => p.tables),
    [floorPlans],
  );
  const [localTables, setLocalTables] = useState<FloorTable[]>(allTables);
  useEffect(() => setLocalTables(allTables), [allTables]);

  // Subset para el plano del salón activo (lo usa SalonSection).
  const activePlanTables = useMemo(
    () => localTables.filter((t) => t.floor_plan_id === activePlanId),
    [localTables, activePlanId],
  );

  // Deep-link: si llegamos con `?openTable=<id>` (típicamente desde /pedir
  // tras enviar comanda), abrimos el drawer de esa mesa y limpiamos el
  // param de la URL para no reabrirlo en navegaciones siguientes.
  useEffect(() => {
    const tableId = searchParams.get("openTable");
    if (!tableId) return;
    const t = allTables.find((x) => x.id === tableId);
    if (!t) return;
    setSelected(t);
    router.replace(`/${businessSlug}/mozo`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allTables]);

  // Realtime via Supabase publication (DT-011 cerrada en migración 0040).
  // Cualquier UPDATE/INSERT en tables del business re-sincroniza el home
  // (spec 107: antes invalidaba la ruta entera, en cada evento de cualquier
  // compañero). Reemplaza el polling de 10 s que tenía antes.
  useTablesRealtime({
    businessId,
    floorPlanIds: floorPlans.map((fp) => fp.plan.id),
    onChange: refetchHome,
  });

  // ── Derived ──
  const mozoNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of mozos) {
      if (x.full_name) m.set(x.user_id, x.full_name);
    }
    return m;
  }, [mozos]);

  const myName =
    mozoNameById.get(currentUserId) ??
    mozos.find((m) => m.user_id === currentUserId)?.full_name ??
    "Mozo";
  const myInitials = initialsFromName(myName);

  const reservationByTable = useMemo(
    () =>
      Object.fromEntries(
        reservations.filter((r) => r.table_id).map((r) => [r.table_id!, r]),
      ),
    [reservations],
  );
  const orderByTable = useMemo(
    () =>
      Object.fromEntries(
        activeOrders.filter((o) => o.table_id).map((o) => [o.table_id!, o]),
      ),
    [activeOrders],
  );

  const active = localTables.filter((t) => t.status === "active");

  // "Mis mesas": todas las mesas asignadas al mozo current, en cualquier
  // estado. Ordenadas: pidio_cuenta primero (urgente), después ocupada,
  // después libre. Si hay empate de estado, por label.
  const MY_TABLES_PRIORITY: Record<OperationalStatus, number> = {
    pidio_cuenta: 0,
    ocupada: 1,
    libre: 2,
  };
  const myTables = active
    .filter((t) => t.mozo_id === currentUserId)
    .slice()
    .sort((a, b) => {
      const pa =
        MY_TABLES_PRIORITY[
          (a.operational_status ?? "libre") as OperationalStatus
        ];
      const pb =
        MY_TABLES_PRIORITY[
          (b.operational_status ?? "libre") as OperationalStatus
        ];
      if (pa !== pb) return pa - pb;
      return a.label.localeCompare(b.label);
    });

  // Para el badge del tab bar: solo cuento las que requieren atención
  // (pidio_cuenta + ocupada). Las libres asignadas no son "activas".
  const myActiveCount = myTables.filter(
    (t) => (t.operational_status ?? "libre") !== "libre",
  ).length;
  const ocupadas = active.filter(
    (t) => t.operational_status && t.operational_status !== "libre",
  ).length;


  // ── Handlers ──
  /**
   * Anula la mesa. `reason` vacío sólo vale para una mesa sin consumo: el
   * server re-deriva eso contra la DB y rechaza el vacío si hay ítems (spec
   * 071), así que acá no hay riesgo de saltearse el motivo con datos viejos.
   */
  const anular = useCallback(
    async (tableId: string, reason: string) => {
      setLoading(true);
      const result = await anularMesa(tableId, reason, businessSlug);
      setLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Mesa anulada.");
      setAnularPrompt(null);
      setAnularReason("");
      setSelected(null);
      void refetchHome();
    },
    [businessSlug, refetchHome],
  );

  const handleAnular = useCallback(async () => {
    if (!anularPrompt) return;
    const reason = anularReason.trim();
    if (!reason) {
      toast.error("Necesitamos un motivo.");
      return;
    }
    await anular(anularPrompt.tableId, reason);
  }, [anularPrompt, anularReason, anular]);

  /**
   * Punto de entrada del botón «Anular» (spec 071). Sin nada cargado se cierra
   * directo; recién con consumo se pide el motivo.
   */
  const pedirAnular = useCallback(
    (tableId: string, label: string) => {
      if (!tieneConsumo(orderByTable[tableId]?.items)) {
        void anular(tableId, "");
        return;
      }
      setAnularPrompt({ tableId, label });
    },
    [orderByTable, anular],
  );

  // Realtime + toasts iOS para notificaciones del mozo. La fuente de verdad
  // sigue siendo el server (revalidatePath en markRead/markAllRead), el
  // hook hidrata en cliente y dispara toasts ante INSERTs nuevos.
  const {
    notifications: liveNotifications,
    unreadCount: liveUnreadCount,
    markReadLocally,
    markAllReadLocally,
  } = useNotificationsRealtime({
    initialNotifications,
    initialUnreadCount,
    businessId,
    userId: currentUserId,
    role,
  });

  const handleNotifClick = useCallback(
    async (n: Notification) => {
      if (n.read_at) return;
      // Optimista: se ve leído al instante (igual que "marcar todos"). Si la
      // action falla, el realtime de notificaciones trae el estado real. No se
      // refresca la ruta (spec 107): marcar leído no cambia nada del salón, y
      // re-correr `mozo/page.tsx` por un puntito azul era pagar 8 queries.
      markReadLocally(n.id);
      void markRead(n.id, businessSlug);
    },
    [businessSlug, markReadLocally],
  );

  const handleMarkAllRead = useCallback(async () => {
    markAllReadLocally();
    void markAllRead(businessSlug);
  }, [businessSlug, markAllReadLocally]);

  const handleToastClick = useCallback((n: Notification) => {
    // Tocar el toast lleva al tab Avisos. La nav del mozo gestiona la
    // marcación de leído cuando ahí toque la card.
    void n;
    setActiveTab("avisos");
  }, []);

  // ── Drawer / sheet ──
  const selectedSync = selected
    ? (localTables.find((t) => t.id === selected.id) ?? selected)
    : null;
  const selectedStatus = (selectedSync?.operational_status ??
    "libre") as OperationalStatus;

  // Mesa libre sin mozo ajeno → "Sentar walk-in".
  // Si la mesa libre tiene mozo asignado y no sos vos → mostrar "Transferir" en vez de "Sentar".
  const isOtherMozosTable =
    !!selectedSync?.mozo_id &&
    selectedSync.mozo_id !== currentUserId &&
    role === "mozo";
  const canShowWalkInButton =
    !!selectedSync && selectedStatus === "libre" && !isOtherMozosTable;
  const canShowTransferButton =
    !!selectedSync &&
    (selectedStatus !== "libre" || isOtherMozosTable) &&
    (role !== "mozo" || selectedSync.mozo_id === currentUserId || isOtherMozosTable);
  // `pidio_cuenta` incluido (issue #296): la mesa que pidió la cuenta y no
  // consumió nada no se cobra, y sin «Anular» no tenía cómo cerrarse.
  const canShowAnularButton =
    !!selectedSync &&
    selectedStatus !== "libre" &&
    !isOtherMozosTable &&
    canTransitionMesa(role, selectedStatus, "libre");
  // Si la mesa es de otro mozo, no se puede pedir/cobrar — primero transferir.
  const canShowPedirButton =
    !!selectedSync &&
    !isOtherMozosTable &&
    (selectedStatus === "ocupada" || selectedStatus === "pidio_cuenta");
  // Trasladar la mesa entera a otra libre (spec 048): mesa con orden abierta,
  // solo encargado/admin.
  const canShowTrasladarButton =
    !!selectedSync &&
    canMoveTable(role) &&
    (selectedStatus === "ocupada" || selectedStatus === "pidio_cuenta") &&
    !!orderByTable[selectedSync.id];
  // "Pedir cuenta" / "Cobrar mesa" requiere order activa. Si la mesa está
  // ocupada por walk-in pero todavía no se cargó pedido, no hay nada que
  // cobrar — el botón no debería aparecer. Estado canónico: order existe en
  // `activeOrders` para esa mesa.
  const canShowCuentaButton =
    !!selectedSync &&
    !isOtherMozosTable &&
    !!orderByTable[selectedSync.id] &&
    (selectedStatus === "ocupada" || selectedStatus === "pidio_cuenta");
  // ¿La mesa ya tiene items cargados? Decide si "Cargar pedido" o "Pedir
  // cuenta" es el botón primario en estado ocupada.
  const selectedHasItems =
    !!selectedSync &&
    !!orderByTable[selectedSync.id] &&
    orderByTable[selectedSync.id]!.items.some(
      (it) => it.cancelled_at === null,
    );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-zinc-50 pb-20">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-md items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {businessName}
            </p>
            <h1 className="font-heading text-lg font-bold leading-tight tracking-tight text-zinc-900">
              {activeTab === "salon" && "Salón"}
              {activeTab === "mesas" && "Mis mesas"}
              {activeTab === "avisos" && "Avisos"}
              {activeTab === "yo" && "Mi cuenta"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {activeTab !== "yo" && (
              <div className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-sm">
                <Users className="h-3.5 w-3.5 text-zinc-500" />
                <span className="font-bold tabular-nums">{ocupadas}</span>
                <span className="text-zinc-500">/{active.length}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-md px-4 pt-4">
        {activeTab === "salon" && (
          <>
            {floorPlans.length > 1 && (
              <div className="mb-2">
                <MozoSalonSelector
                  plans={floorPlans}
                  activeId={activePlanId}
                  onSelect={setActivePlan}
                />
              </div>
            )}
            <SalonSection
              tables={activePlanTables}
              reservationByTable={reservationByTable}
              orderByTable={orderByTable}
              mozoNameById={mozoNameById}
              currentUserId={currentUserId}
              onTableTap={setSelected}
              reservations={reservations}
            />
          </>
        )}
        {activeTab === "mesas" && (
          <MyTablesSection
            myTables={myTables}
            reservationByTable={reservationByTable}
            orderByTable={orderByTable}
            onTableTap={(t) => setSelected(t)}
          />
        )}
        {activeTab === "avisos" && (
          <AvisosSection
            notifications={liveNotifications}
            unreadCount={liveUnreadCount}
            onItemClick={handleNotifClick}
            onMarkAllRead={handleMarkAllRead}
          />
        )}
        {activeTab === "yo" && (
          <YoSection
            slug={businessSlug}
            name={myName}
            role={role}
            initials={myInitials}
            myActiveCount={myTables.length}
            todayTipsCents={todayTipsCents}
            attendance={attendance}
          />
        )}
      </main>

      <MobileTabBar
        active={activeTab}
        onChange={setActiveTab}
        unreadCount={liveUnreadCount}
        myActiveCount={myActiveCount}
      />

      {/* Toasts iOS-style. Dispara desde realtime vía el hook arriba. */}
      <NotificationsToastHost onToastClick={handleToastClick} />

      {/* Drawer de mesa */}
      <TableDrawer
        open={!!selectedSync}
        onClose={() => setSelected(null)}
        title={
          selectedSync ? (
            <span className="flex items-center gap-2">
              <span className="text-2xl font-extrabold leading-none tracking-tight">
                {selectedSync.label}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[selectedStatus]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[selectedStatus]}`} />
                {STATUS_LABEL[selectedStatus]}
              </span>
            </span>
          ) : (
            ""
          )
        }
        subtitle={
          selectedSync?.opened_at ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {minutesSince(selectedSync.opened_at)} min abierta
            </span>
          ) : null
        }
        footer={
          selectedSync ? (
            <div className="space-y-2">
              {canShowWalkInButton && (
                <button
                  disabled={loading}
                  onClick={() => setWalkInTableId(selectedSync.id)}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
                >
                  <UserPlus className="h-5 w-5" />
                  Sentar walk-in
                </button>
              )}
              {/* Acción primaria: jerarquía según estado + items.
                  - libre → Sentar walk-in (arriba).
                  - pidio_cuenta u ocupada CON items → Cobrar (paso cuenta).
                  - ocupada SIN items → Cargar pedido.

                  «Cobrar» entra SIEMPRE por el paso cuenta, nunca directo a
                  /cobrar: dividir, propina y descuento viven ahí (`CuentaClient`
                  → `DividirModal`). El atajo `pidio_cuenta → /cobrar` de
                  `947f41c` dejaba al mozo sin acceso al dividir justo en el
                  estado donde el cliente lo pide (#92). Es el mismo criterio
                  que el drawer del encargado (`salon-desktop.tsx`), que ya lo
                  había revertido en spec 23. */}
              {/* Los dos CTA del camino caliente van con `<Link>` y no con
                  `router.push` (spec 107): el prefetch por default de Link es
                  el PARCIAL, que corta en el `loading.tsx` de la ruta (spec
                  039) y deja el skeleton listo. Ojo con la alternativa: un
                  `router.prefetch(href)` imperativo usa el prefetch COMPLETO,
                  que renderiza la page entera en el server y cachea su data
                  dinámica como reusable por 5 minutos — en `cuenta`, que es
                  plata, eso es servir un total viejo. */}
              {canShowCuentaButton &&
                (selectedStatus === "pidio_cuenta" ||
                  (selectedStatus === "ocupada" && selectedHasItems)) && (
                  <Link
                    href={`/${businessSlug}/mozo/mesa/${selectedSync.id}/cuenta`}
                    aria-disabled={loading}
                    className={cn(
                      "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition active:scale-[0.98]",
                      loading && "pointer-events-none opacity-60",
                    )}
                  >
                    <Receipt className="h-5 w-5" />
                    Cobrar
                  </Link>
                )}
              {selectedStatus === "ocupada" &&
                !selectedHasItems &&
                canShowPedirButton && (
                  <Link
                    href={`/${businessSlug}/mozo/mesa/${selectedSync.id}/pedir`}
                    aria-disabled={loading}
                    className={cn(
                      "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition active:scale-[0.98]",
                      loading && "pointer-events-none opacity-60",
                    )}
                  >
                    <ClipboardList className="h-5 w-5" />
                    Cargar pedido
                  </Link>
                )}
              {/* Acciones secundarias: tiles compactos en una fila adaptativa
                  (nunca huérfano a media columna). */}
              {(() => {
                const showVolverAPedir =
                  selectedStatus === "pidio_cuenta" && canShowPedirButton;
                const showCargarMas =
                  selectedStatus === "ocupada" &&
                  selectedHasItems &&
                  canShowPedirButton;
                const showPedirCuentaSec =
                  selectedStatus === "ocupada" &&
                  !selectedHasItems &&
                  canShowCuentaButton;
                const items: React.ReactNode[] = [];
                if (showVolverAPedir) {
                  items.push(
                    <MesaActionTile
                      key="volver"
                      icon={ClipboardList}
                      label="Volver a pedir"
                      tone="zinc"
                      disabled={loading}
                      onClick={async () => {
                        const r = await volverAPedir(
                          selectedSync.id,
                          businessSlug,
                        );
                        if (!r.ok) {
                          toast.error(r.error);
                          return;
                        }
                        router.push(
                          `/${businessSlug}/mozo/mesa/${selectedSync.id}/pedir`,
                        );
                      }}
                    />,
                  );
                }
                if (showCargarMas) {
                  items.push(
                    <MesaActionTile
                      key="cargar-mas"
                      icon={ClipboardList}
                      label="Cargar más"
                      tone="emerald"
                      disabled={loading}
                      onClick={() =>
                        router.push(
                          `/${businessSlug}/mozo/mesa/${selectedSync.id}/pedir`,
                        )
                      }
                    />,
                  );
                }
                if (showPedirCuentaSec) {
                  items.push(
                    <MesaActionTile
                      key="cobrar"
                      icon={Receipt}
                      label="Cobrar"
                      tone="amber"
                      disabled={loading}
                      onClick={() =>
                        router.push(
                          `/${businessSlug}/mozo/mesa/${selectedSync.id}/cuenta`,
                        )
                      }
                    />,
                  );
                }
                if (canShowTransferButton) {
                  items.push(
                    <MesaActionTile
                      key="transferir"
                      icon={ArrowLeftRight}
                      label={isOtherMozosTable ? "Tomar mesa" : "Transferir mozo"}
                      tone="sky"
                      disabled={loading}
                      onClick={() => {
                        if (isOtherMozosTable) {
                          const fromName = selectedSync.mozo_id
                            ? mozoNameById.get(selectedSync.mozo_id) ?? null
                            : null;
                          setClaimPrompt({
                            tableId: selectedSync.id,
                            label: selectedSync.label,
                            fromName,
                          });
                        } else {
                          setTransferTableId(selectedSync.id);
                        }
                      }}
                    />,
                  );
                }
                if (canShowTrasladarButton) {
                  items.push(
                    <MesaActionTile
                      key="trasladar"
                      icon={MoveRight}
                      label="Trasladar mesa"
                      tone="violet"
                      disabled={loading}
                      onClick={() => setTrasladarTableId(selectedSync.id)}
                    />,
                  );
                }
                return <MesaActionRow items={items} />;
              })()}
              {/* Destructiva: full-width separada del grid operativo */}
              {canShowAnularButton && (
                <button
                  disabled={loading}
                  onClick={() =>
                    pedirAnular(selectedSync.id, selectedSync.label)
                  }
                  className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-rose-50 px-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-[0.97] disabled:opacity-60"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Anular
                </button>
              )}
            </div>
          ) : null
        }
      >
        {selectedSync && (
          <div className="space-y-4">
            {/* Reserva */}
            {reservationByTable[selectedSync.id] && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                  Reserva
                </p>
                <p className="mt-1 text-base font-semibold text-zinc-900">
                  {reservationByTable[selectedSync.id]!.customer_name}
                </p>
                <div className="mt-1 flex flex-wrap gap-3 text-sm text-zinc-600">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {reservationByTable[selectedSync.id]!.party_size} personas
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatTime(
                      reservationByTable[selectedSync.id]!.starts_at,
                    )}
                  </span>
                </div>
                {reservationByTable[selectedSync.id]!.notes && (
                  <p className="mt-2 text-sm italic text-zinc-600">
                    {reservationByTable[selectedSync.id]!.notes}
                  </p>
                )}
              </div>
            )}

            {/* Orden activa con resumen de items */}
            {orderByTable[selectedSync.id] && (
              <OrderSummaryCard
                order={orderByTable[selectedSync.id]!}
                slug={businessSlug}
                hideComandasIfAllDelivered={selectedStatus === "pidio_cuenta"}
                canAnular={canCancelItem(role)}
                tableLabel={selectedSync.label}
                onChanged={refetchHome}
              />
            )}

            {/* Empty state: mesa libre sin reserva. Llena el body con info
                útil en vez de quedar un hueco grande entre header y footer. */}
            {selectedStatus === "libre" &&
              !reservationByTable[selectedSync.id] &&
              !orderByTable[selectedSync.id] && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">
                    <ArmchairIcon className="size-5 text-zinc-400" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-zinc-900">
                    Mesa disponible
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {selectedSync.seats} {selectedSync.seats === 1 ? "silla" : "sillas"}
                  </p>
                  <p className="mt-3 max-w-[18rem] text-xs text-zinc-500">
                    Tocá <span className="font-semibold text-zinc-700">Sentar walk-in</span> para abrir la mesa con un comensal que llegó sin reserva.
                  </p>
                </div>
              )}
          </div>
        )}
      </TableDrawer>

      {/* Walk-in modal */}
      {walkInTableId && (
        <WalkInModal
          tableId={walkInTableId}
          tableLabel={
            localTables.find((t) => t.id === walkInTableId)?.label ?? ""
          }
          businessSlug={businessSlug}
          onClose={() => setWalkInTableId(null)}
          onSuccess={() => {
            setWalkInTableId(null);
            setSelected(null);
            void refetchHome();
          }}
        />
      )}

      {/* Transfer modal */}
      {transferTableId && (
        /* Siempre `transferir` (spec 146 · D-A1): el mozo no puede asignar
           mesas (`canAssignMozo`), pero sí **tomar** una libre —el self-claim de
           la 079, que vive en `transferTable`—. `conTeclado` va apagado: es un
           teléfono, y el autofoco abriría el teclado virtual encima de la lista. */
        <ElegirMozoModal
          modo="transferir"
          tableId={transferTableId}
          tableLabel={
            localTables.find((t) => t.id === transferTableId)?.label ?? ""
          }
          currentMozoId={
            localTables.find((t) => t.id === transferTableId)?.mozo_id ?? null
          }
          mozos={mozos}
          businessSlug={businessSlug}
          onClose={() => setTransferTableId(null)}
          onSuccess={() => {
            setTransferTableId(null);
            void refetchHome();
          }}
        />
      )}

      {/* Trasladar mesa a otra libre (spec 048) */}
      {trasladarTableId && (
        <TrasladarMesaModal
          fromTableId={trasladarTableId}
          fromLabel={
            localTables.find((t) => t.id === trasladarTableId)?.label ?? ""
          }
          tables={localTables
            .filter(
              (t) =>
                t.id !== trasladarTableId &&
                (t.operational_status ?? "libre") === "libre",
            )
            .map((t) => ({
              id: t.id,
              label: t.label,
              seats: t.seats,
              is_bar: t.is_bar,
            }))}
          businessSlug={businessSlug}
          onClose={() => setTrasladarTableId(null)}
          onSuccess={() => {
            setTrasladarTableId(null);
            setSelected(null);
            void refetchHome();
          }}
        />
      )}

      {/* Anular prompt */}
      {anularPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => {
            setAnularPrompt(null);
            setAnularReason("");
          }}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 sm:hidden" />
            <h3 className="font-heading text-lg font-bold">
              Anular mesa {anularPrompt.label}
            </h3>
            <p className="mt-1 text-sm text-zinc-600">
              Cancela las órdenes abiertas y libera la mesa. Queda en el audit log.
            </p>
            <textarea
              autoFocus
              className="mt-3 h-24 w-full rounded-xl border border-zinc-200 px-3 py-2 text-base"
              placeholder="Motivo (obligatorio)"
              value={anularReason}
              onChange={(e) => setAnularReason(e.target.value)}
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="h-12 rounded-2xl bg-zinc-100 text-base font-semibold text-zinc-700 transition active:scale-[0.98]"
                onClick={() => {
                  setAnularPrompt(null);
                  setAnularReason("");
                }}
              >
                Cancelar
              </button>
              <button
                className="h-12 rounded-2xl bg-red-600 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                disabled={loading || !anularReason.trim()}
                onClick={handleAnular}
              >
                Anular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim table prompt — modal chico para tomar mesa ajena */}
      {claimPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setClaimPrompt(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 sm:hidden" />
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <ArrowLeftRight className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-bold leading-tight">
                  Tomar mesa {claimPrompt.label}
                </h3>
                {claimPrompt.fromName && (
                  <p className="text-sm text-zinc-500">
                    Asignada a {claimPrompt.fromName}
                  </p>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              La mesa pasa a ser tuya. Se notifica al mozo actual y al encargado.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                className="h-12 rounded-2xl bg-zinc-100 text-base font-semibold text-zinc-700 transition active:scale-[0.98]"
                onClick={() => setClaimPrompt(null)}
              >
                Cancelar
              </button>
              <button
                className="h-12 rounded-2xl bg-sky-600 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  const res = await transferTable(
                    claimPrompt.tableId,
                    currentUserId,
                    businessSlug,
                  );
                  setLoading(false);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(`Mesa ${claimPrompt.label} es tuya.`);
                  setClaimPrompt(null);
                  void refetchHome();
                }}
              >
                {loading ? "Tomando..." : "Tomar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

type SalonFilter = "todas" | OperationalStatus;

const FILTER_LABEL: Record<SalonFilter, string> = {
  todas: "Todas",
  libre: "Libres",
  ocupada: "Ocupadas",
  pidio_cuenta: "Cuenta",
};

const FILTER_ORDER: SalonFilter[] = [
  "todas",
  "libre",
  "ocupada",
  "pidio_cuenta",
];

// Estado activo del chip: "Todas" = oscuro; los de estado se rellenan con su
// color semántico suave (mismo lenguaje visual que el filtro por rol de RRHH).
const FILTER_ACTIVE: Record<SalonFilter, string> = {
  todas: "bg-zinc-900 text-white ring-zinc-900",
  libre: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  ocupada: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pidio_cuenta: "bg-amber-50 text-amber-700 ring-amber-200",
};

// ─── Selector multi-salón (mobile) ──────────────────────────────────────────
function MozoSalonSelector({
  plans,
  activeId,
  onSelect,
}: {
  plans: FloorPlanWithTables[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 py-1">
      <div className="flex gap-1.5">
        {plans.map(({ plan, tables }) => {
          const activeMesas = tables.filter((t) => t.status === "active").length;
          const isActive = plan.id === activeId;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => onSelect(plan.id)}
              aria-pressed={isActive}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.96] ${
                isActive
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200"
              }`}
            >
              {plan.name}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {activeMesas}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function tableSortKey(label: string): [number, string] {
  // "1" < "2" < "10" → numérico cuando se puede, alfabético si no.
  const n = parseInt(label, 10);
  return [Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER, label];
}

function SalonSection({
  tables,
  reservationByTable,
  orderByTable,
  mozoNameById,
  currentUserId,
  onTableTap,
  reservations,
}: {
  tables: FloorTable[];
  reservationByTable: Record<string, ReservationForMozo>;
  orderByTable: Record<string, OrderForMozo>;
  mozoNameById: Map<string, string>;
  currentUserId: string;
  onTableTap: (t: FloorTable) => void;
  reservations: ReservationForMozo[];
}) {
  const [filter, setFilter] = useState<SalonFilter>("todas");

  const active = tables.filter((t) => t.status === "active");

  const counts = useMemo(() => {
    const c: Record<SalonFilter, number> = {
      todas: active.length,
      libre: 0,
      ocupada: 0,
      pidio_cuenta: 0,
    };
    for (const t of active) {
      const s = (t.operational_status ?? "libre") as OperationalStatus;
      c[s]++;
    }
    return c;
  }, [active]);

  const filtered = useMemo(() => {
    const list =
      filter === "todas"
        ? active
        : active.filter(
            (t) => (t.operational_status ?? "libre") === filter,
          );
    return [...list].sort((a, b) => {
      const [na, la] = tableSortKey(a.label);
      const [nb, lb] = tableSortKey(b.label);
      if (na !== nb) return na - nb;
      return la.localeCompare(lb);
    });
  }, [active, filter]);

  const reservasPendientes = reservations.filter(
    (r) =>
      !r.table_id ||
      (tables.find((t) => t.id === r.table_id)?.operational_status ??
        "libre") === "libre",
  );

  return (
    <div className="space-y-4">
      {/* Chips de filtro scroll horizontal */}
      <div className="-mx-4 overflow-x-auto px-4 py-1">
        <div className="flex gap-2 whitespace-nowrap">
          {FILTER_ORDER.map((f) => {
            const isActive = filter === f;
            const dot = f === "todas" ? null : STATUS_DOT[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={isActive}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition active:scale-95 ${
                  isActive
                    ? FILTER_ACTIVE[f]
                    : "bg-white text-zinc-600 ring-zinc-200/70 active:bg-zinc-50"
                }`}
              >
                {dot && <span className={`size-1.5 rounded-full ${dot}`} />}
                {FILTER_LABEL[f]}
                <span
                  className={`tabular-nums ${
                    isActive ? "opacity-60" : "text-zinc-400"
                  }`}
                >
                  {counts[f]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {active.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 p-10 text-center">
          <p className="text-sm text-zinc-500">
            No hay mesas configuradas. Configurá el plano desde el panel de admin.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center ring-1 ring-zinc-200">
          <p className="text-sm text-zinc-500">
            No hay mesas en estado “{FILTER_LABEL[filter]}” ahora.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((t) => {
            const status = (t.operational_status ?? "libre") as OperationalStatus;
            const min = minutesSince(t.opened_at ?? undefined);
            const order = orderByTable[t.id];
            const reservation = reservationByTable[t.id];
            const mozoName = t.mozo_id
              ? mozoNameById.get(t.mozo_id)
              : undefined;
            const mozoInitial = mozoName ? initialsFromName(mozoName) : null;
            const isMine = t.mozo_id === currentUserId;
            const isUrgent = status === "pidio_cuenta";

            // Línea principal: quién está, o capacidad si está libre.
            let primaryLine: React.ReactNode = null;
            let primaryClass = "text-zinc-700";
            if (status === "libre") {
              if (reservation) {
                primaryLine = (
                  <>
                    <span className="truncate">{reservation.customer_name}</span>
                  </>
                );
                primaryClass = "text-indigo-700";
              } else {
                primaryLine = (
                  <>
                    Para{" "}
                    <span className="tabular-nums">{t.seats}</span> personas
                  </>
                );
                primaryClass = "text-zinc-500";
              }
            } else if (reservation) {
              primaryLine = (
                <>
                  <span className="truncate">{reservation.customer_name}</span>
                  <span className="ml-1 text-zinc-500 tabular-nums">
                    · {reservation.party_size}p
                  </span>
                </>
              );
              primaryClass = "font-semibold text-zinc-800";
            } else {
              primaryLine = "Walk-in";
              primaryClass = "text-zinc-500";
            }

            return (
              <button
                key={t.id}
                onClick={() => onTableTap(t)}
                className={`relative flex flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-zinc-200 transition active:scale-[0.97] active:bg-zinc-50 ${
                  isUrgent ? "ring-2 ring-amber-400" : ""
                }`}
              >
                {/* Header: dot + mozo */}
                <div className="flex items-start justify-between">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`}
                    aria-label={STATUS_LABEL[status]}
                  />
                  {mozoInitial && (
                    <span
                      className={`flex h-6 items-center justify-center rounded-full text-[10px] font-bold ${
                        isMine
                          ? "w-6 bg-emerald-600 text-white"
                          : "w-6 bg-zinc-200 text-zinc-700"
                      }`}
                      title={mozoName}
                    >
                      {isMine ? "Yo" : mozoInitial}
                    </span>
                  )}
                </div>

                {/* Número grande */}
                <div className="mt-2 font-heading text-3xl font-extrabold leading-none tracking-tight text-zinc-900">
                  {t.label}
                </div>

                {/* Estado */}
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {STATUS_LABEL[status]}
                </div>

                {/* Línea principal: cliente o capacidad */}
                <div
                  className={`mt-2 truncate text-xs ${primaryClass}`}
                >
                  {primaryLine}
                </div>

                {/* Reserva pendiente en mesa libre — línea extra */}
                {status === "libre" && reservation && (
                  <div className="mt-1 inline-flex items-center gap-1 self-start rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-indigo-700">
                    <Clock className="h-2.5 w-2.5" />
                    {formatTime(reservation.starts_at)} · {reservation.party_size}p
                  </div>
                )}

                {/* Línea inferior: tiempo y total cuando aplica */}
                {(min != null && status !== "libre") || order ? (
                  <div className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-2 text-xs">
                    {min != null && status !== "libre" && (
                      <span
                        className={`inline-flex items-center gap-0.5 font-bold tabular-nums ${
                          isUrgent ? "text-amber-600" : "text-zinc-600"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {min}m
                      </span>
                    )}
                    {order && (
                      <span className="ml-auto truncate font-bold tabular-nums text-zinc-800">
                        {formatMoney(order.total_cents)}
                      </span>
                    )}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {/* Reservas pendientes hoy */}
      {filter === "todas" && reservasPendientes.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
            Reservas pendientes hoy
          </h2>
          <div className="space-y-2">
            {reservasPendientes.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-zinc-900">{r.customer_name}</p>
                  <p className="text-sm font-bold tabular-nums text-indigo-600">
                    {formatTime(r.starts_at)}
                  </p>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> {r.party_size} personas
                  </span>
                  {r.notes && <span className="truncate">· {r.notes}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MyTablesSection({
  myTables,
  reservationByTable,
  orderByTable,
  onTableTap,
}: {
  myTables: FloorTable[];
  reservationByTable: Record<string, ReservationForMozo>;
  orderByTable: Record<string, OrderForMozo>;
  onTableTap: (t: FloorTable) => void;
}) {
  if (myTables.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-100">
          <Check className="h-10 w-10 text-zinc-400" />
        </div>
        <p className="mt-4 font-semibold text-zinc-900">
          No tenés mesas asignadas
        </p>
        <p className="mt-1 max-w-xs text-sm text-zinc-500">
          Pedile al encargado que te distribuya mesas desde la vista del salón.
        </p>
      </div>
    );
  }

  // Separamos para renderizar con look distinto.
  const activas = myTables.filter(
    (t) => (t.operational_status ?? "libre") !== "libre",
  );
  const libres = myTables.filter(
    (t) => (t.operational_status ?? "libre") === "libre",
  );

  return (
    <div className="space-y-4">
      {/* Activas: cards completas con info */}
      {activas.length > 0 && (
        <div className="space-y-3">
          {activas.map((t) => (
            <ActiveTableCard
              key={t.id}
              table={t}
              reservation={reservationByTable[t.id]}
              order={orderByTable[t.id]}
              onTap={onTableTap}
            />
          ))}
        </div>
      )}

      {/* Libres: divider + grid denso */}
      {libres.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-3">
            <span className="h-px flex-1 bg-zinc-200" />
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Disponibles ({libres.length})
            </span>
            <span className="h-px flex-1 bg-zinc-200" />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {libres.map((t) => {
              const reservation = reservationByTable[t.id];
              return (
                <button
                  key={t.id}
                  onClick={() => onTableTap(t)}
                  className="flex flex-col items-center justify-center gap-0.5 rounded-2xl bg-white px-2 py-3 ring-1 ring-zinc-200 transition active:scale-[0.97] active:bg-zinc-50"
                >
                  <span className="font-heading text-xl font-extrabold leading-none tracking-tight text-zinc-900">
                    {t.label}
                  </span>
                  {reservation ? (
                    <span className="text-[0.65rem] font-semibold text-indigo-700">
                      Reserva
                    </span>
                  ) : (
                    <span className="text-[0.65rem] text-zinc-500 tabular-nums">
                      {t.seats}p
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function ActiveTableCard({
  table,
  reservation,
  order,
  onTap,
}: {
  table: FloorTable;
  reservation: ReservationForMozo | undefined;
  order: OrderForMozo | undefined;
  onTap: (t: FloorTable) => void;
}) {
  const status = (table.operational_status ?? "libre") as OperationalStatus;
  const min = minutesSince(table.opened_at ?? undefined);
  const isUrgent = status === "pidio_cuenta";
  // Demora de cocina (spec 30): comanda pendiente más pasada de su tiempo
  // esperado. Como `min`, se evalúa al render con Date.now() (sin ticker).
  const delay = order ? tableDelay(order.comandas, Date.now()) : null;
  const delayLvl = delay && delay.level >= 1 ? delay.level : 0;
  // Nombre de quién está en la mesa: prefiere reserva (más rico, tiene
  // party_size), cae al snapshot de la order (walk-in con nombre cargado),
  // sino muestra "Walk-in". Filtra placeholders de orders viejas.
  const PLACEHOLDER_NAMES = new Set(["Mesa", "Walk-in", "-"]);
  const orderName = order?.customer_name?.trim();
  const partyName =
    reservation?.customer_name ??
    (orderName && !PLACEHOLDER_NAMES.has(orderName) ? orderName : null);
  const partySize = reservation?.party_size ?? null;

  // Items activos para el preview (primeros 3 + "+N más").
  const activeItems =
    order?.items.filter((it) => it.cancelled_at === null) ?? [];
  const totalQty = activeItems.reduce((acc, it) => acc + it.quantity, 0);

  return (
    <button
      onClick={() => onTap(table)}
      className={`block w-full rounded-2xl border-l-[6px] bg-white p-4 text-left ring-1 ring-zinc-200 transition active:scale-[0.99] active:bg-zinc-50 ${STATUS_BORDER[status]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-2xl font-extrabold leading-none tracking-tight text-zinc-900">
              {table.label}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_PILL[status]}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`}
              />
              {STATUS_LABEL[status]}
            </span>
            {delayLvl >= 1 && delay && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
                style={{ background: DELAY_COLORS[delayLvl] }}
                title={`${delay.station} demorada`}
              >
                <Clock className="h-3 w-3" />
                +{Math.round(delay.excessMinutes)}m
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-sm font-semibold text-zinc-800">
            {partyName ?? "Walk-in"}
            {partySize != null && (
              <span className="ml-1.5 text-xs font-normal text-zinc-500 tabular-nums">
                · {partySize}p
              </span>
            )}
          </p>
        </div>
        {min != null && (
          <div className="shrink-0 text-right">
            <div
              className={`flex items-center justify-end gap-1 text-base font-bold tabular-nums ${
                isUrgent ? "text-amber-600" : "text-zinc-900"
              }`}
            >
              <Clock className="h-4 w-4" />
              {min}m
            </div>
            <div className="text-[10px] text-zinc-400">abierta</div>
          </div>
        )}
      </div>
      {order && (
        <>
          {/* Resumen de items: primeros 3 con cantidad */}
          {activeItems.length > 0 && (
            <div className="mt-3 space-y-0.5">
              {activeItems.slice(0, 3).map((it, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-zinc-600"
                >
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-100 px-1 text-[10px] font-bold tabular-nums text-zinc-700">
                    {it.quantity}
                  </span>
                  <span className="truncate">{it.product_name}</span>
                </div>
              ))}
              {activeItems.length > 3 && (
                <p className="pl-6 text-[11px] text-zinc-500">
                  +{activeItems.length - 3} más ·{" "}
                  <span className="tabular-nums">
                    {totalQty} items totales
                  </span>
                </p>
              )}
            </div>
          )}
          {/* Total */}
          <div className="mt-3 flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
            <span className="text-xs text-zinc-500">
              Orden #{order.daily_number}
            </span>
            <span className="text-base font-bold tabular-nums text-zinc-900">
              {formatMoney(order.total_cents)}
            </span>
          </div>
        </>
      )}
    </button>
  );
}

function AvisosSection({
  notifications,
  unreadCount,
  onItemClick,
  onMarkAllRead,
}: {
  notifications: Notification[];
  unreadCount: number;
  onItemClick: (n: Notification) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
}) {
  if (notifications.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-100">
          <Check className="h-10 w-10 text-zinc-400" />
        </div>
        <p className="mt-4 font-semibold text-zinc-900">Sin avisos</p>
        <p className="mt-1 max-w-xs text-sm text-zinc-500">
          Las transferencias de mesa y otros avisos van a aparecer acá.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-600">
            <span className="font-semibold">{unreadCount}</span> sin leer
          </p>
          <button
            type="button"
            onClick={onMarkAllRead}
            className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition active:scale-95"
          >
            Marcar todo leído
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {notifications.map((n) => {
          const view = viewForNotification(n);
          const Icon = view.icon;
          const tone = NOTI_TONE_STYLES[view.tone];
          const unread = !n.read_at;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onItemClick(n)}
                className={`flex w-full items-start gap-3 rounded-2xl p-4 text-left ring-1 transition active:scale-[0.99] ${
                  unread ? "bg-white ring-zinc-200" : "bg-zinc-50/60 ring-zinc-200/70"
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex size-9 flex-shrink-0 items-center justify-center rounded-full ring-1 ${tone.iconBg} ${tone.iconText} ${tone.ring}`}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`truncate text-sm ${unread ? "font-semibold text-zinc-900" : "font-medium text-zinc-600"}`}
                    >
                      {view.title}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                      {formatNotificationTime(n.created_at)}
                    </span>
                  </div>
                  {view.body && (
                    <p
                      className={`mt-0.5 text-xs ${unread ? "text-zinc-600" : "text-zinc-500"}`}
                    >
                      {view.body}
                    </p>
                  )}
                </div>
                {unread && (
                  <span
                    aria-hidden
                    className="mt-2 size-2 flex-shrink-0 rounded-full bg-rose-500"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function YoSection({
  slug,
  name,
  role,
  initials,
  myActiveCount,
  todayTipsCents,
  attendance,
}: {
  slug: string;
  name: string;
  role: BusinessRole;
  initials: string;
  myActiveCount: number;
  todayTipsCents: number;
  attendance: MozoAttendance;
}) {
  const [signingOut, startSignOut] = useTransition();
  const handleSignOut = () => {
    startSignOut(async () => {
      try {
        await signOut(slug);
      } catch (err) {
        // Next.js usa throw para los redirects de server actions — relanzar
        // para que Next lo procese y navegue.
        if (
          err instanceof Error &&
          "digest" in err &&
          typeof err.digest === "string" &&
          err.digest.startsWith("NEXT_REDIRECT")
        ) {
          throw err;
        }
        console.error("signOut", err);
        toast.error("No pudimos cerrar la sesión.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Perfil */}
      <section className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900 text-xl font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate font-heading text-xl font-bold text-zinc-900">
              {name}
            </p>
            <p className="text-sm capitalize text-zinc-500">{role}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-zinc-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Mis mesas
            </p>
            <p className="mt-1 font-heading text-2xl font-extrabold tabular-nums text-zinc-900">
              {myActiveCount}
            </p>
          </div>
          <div className="rounded-2xl bg-zinc-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Turno hoy
            </p>
            <p className="mt-1 font-heading text-2xl font-extrabold tabular-nums text-zinc-900">
              {attendance.todayMinutes > 0
                ? formatHoursMinutes(attendance.todayMinutes)
                : "—"}
            </p>
            {attendance.isClockedIn && (
              <p className="mt-0.5 text-[10px] font-semibold text-emerald-600">
                En turno
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Propinas hoy */}
      <section className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-emerald-600" />
          <h2 className="font-heading text-base font-bold">Propinas hoy</h2>
        </div>
        <p className="mt-3 font-heading text-3xl font-extrabold tabular-nums text-zinc-900">
          {formatMoney(todayTipsCents)}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {todayTipsCents > 0
            ? "Acumulado de cobros con propina de hoy."
            : "Todavía no se registraron propinas hoy."}
        </p>
      </section>

      {/* Horas esta semana */}
      <section className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-zinc-600" />
          <h2 className="font-heading text-base font-bold">Horas esta semana</h2>
        </div>
        <p className="mt-3 font-heading text-3xl font-extrabold tabular-nums text-zinc-900">
          {formatHoursMinutes(attendance.weeklyMinutes)}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {attendance.weeklyDays > 0
            ? `${attendance.weeklyDays} ${attendance.weeklyDays === 1 ? "día" : "días"} trabajados esta semana.`
            : "Sin fichajes esta semana."}
        </p>
      </section>

      {/* Asistencias */}
      <section className="rounded-3xl bg-white p-5 ring-1 ring-zinc-200">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-zinc-600" />
          <h2 className="font-heading text-base font-bold">Mis asistencias</h2>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-zinc-50 p-2.5 text-center">
            <p className="font-heading text-xl font-extrabold tabular-nums text-zinc-900">
              {formatHoursMinutes(attendance.weeklyMinutes)}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Esta semana
            </p>
          </div>
          <div className="rounded-xl bg-zinc-50 p-2.5 text-center">
            <p className="font-heading text-xl font-extrabold tabular-nums text-zinc-900">
              {formatHoursMinutes(attendance.monthlyMinutes)}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Este mes
            </p>
          </div>
          <div className="rounded-xl bg-zinc-50 p-2.5 text-center">
            <p className="font-heading text-xl font-extrabold tabular-nums text-zinc-900">
              {formatHoursMinutes(attendance.overtimeMinutes)}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Hs. extra
            </p>
          </div>
        </div>
      </section>

      {/* Acciones */}
      <section className="rounded-3xl bg-white ring-1 ring-zinc-200">
        {/* "Ir al panel admin" solo para admin/encargado — el mozo no tiene
            acceso al panel (lo bloquea el layout authed). */}
        {role !== "mozo" && (
          <a
            href={`/${slug}/admin`}
            className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 transition active:bg-zinc-50"
          >
            <span className="inline-flex items-center gap-3 text-base font-medium text-zinc-900">
              <Settings className="h-5 w-5 text-zinc-500" />
              Ir al panel admin
            </span>
            <span className="text-zinc-400">›</span>
          </a>
        )}
        {/* Cerrar sesión: server action via onClick. El <a> al /admin/login
            de antes solo navegaba y la página de login auto-redirige si hay
            sesión activa → loop infinito. Acá invalidamos la sesión y después
            el redirect del server action lleva al login. */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex w-full items-center justify-between px-5 py-4 text-left transition active:bg-zinc-50 disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-3 text-base font-medium text-red-600">
            <LogOut className="h-5 w-5" />
            {signingOut ? "Cerrando..." : "Cerrar sesión"}
          </span>
          <span className="text-zinc-400">›</span>
        </button>
      </section>
    </div>
  );
}
