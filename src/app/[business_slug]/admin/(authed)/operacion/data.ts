import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type {
  SalonOrderRef,
  SalonReservationRef,
} from "@/components/admin/local/salon-desktop";
import type { AdminRow } from "@/components/reservations/admin-day-list";
import { getFloorPlansForBusiness } from "@/lib/admin/floor-plan/queries";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import {
  getActiveComandas,
  getPrintAgentHealth,
  getStationsForLocal,
} from "@/lib/admin/local-query";
import type { LocalComanda, LocalStation } from "@/lib/admin/local-query";
import { getTodayOrders } from "@/lib/admin/orders-query";
import type { AdminOrder } from "@/lib/admin/orders-query";
import {
  getCajasConEstado,
  getCajasForBusiness,
  getCajaUserAssignments,
  getCuentasConSaldo,
  getRendicionesHistorial,
  getRendicionesPendientesTodosLosMozos,
} from "@/lib/caja/queries";
import { getCuentasCorrientes } from "@/lib/caja/cuenta-corriente-queries";
import type { CuentasCorrientesData } from "@/lib/caja/cuenta-corriente-queries";
import type { Caja } from "@/lib/caja/types";
import type {
  CajaConEstado,
  CajaUserAssignment,
  CuentaConSaldo,
  MozoRendicion,
  RendicionMozoPendiente,
} from "@/lib/caja/types";
import { getMozosByBusiness } from "@/lib/mozo/queries";
import type { MozoMember } from "@/lib/mozo/queries";
import { orderSlotsForDay } from "@/lib/orders/scheduled";
import type { SolicitudEnBandeja } from "@/lib/reservations/pending-inbox";
import {
  getPendingInbox,
  getReservationEditContext,
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import type {
  DayServiceOption,
  FloorTable,
  ReservationMode,
} from "@/lib/reservations/types";
import { getCurrentPresent } from "@/lib/rrhh/clock-actions";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";
import { getTodaySummary } from "@/lib/rrhh/clock-queries";
import type { TodaySummary } from "@/lib/rrhh/clock-queries";

/**
 * Loaders de `/admin/operacion` agrupados por tab (spec 39, F2).
 *
 * Cada loader devuelve una promesa **independiente** con exactamente los datos
 * de su tab; la page los crea sin `await` y los pasa a `LocalShell`, que los
 * lee con `use()` dentro de un `<Suspense>` por tab. Así Salón pinta apenas
 * resuelven sus 4 queries, sin quedar bloqueado por la query más lenta de las
 * otras tabs (antes: un `Promise.all` de 15).
 *
 * Invariante multi-tenant (FR-010): toda query conserva su `business_id`; los
 * loaders corren server-side y sólo el dato ya scopeado cruza al cliente.
 */

export type SalonData = {
  floorPlans: FloorPlanWithTables[];
  dineInOrders: SalonOrderRef[];
  reservations: SalonReservationRef[];
  mozos: MozoMember[];
};

export type ComandasData = {
  initialComandas: LocalComanda[];
  stations: LocalStation[];
  // `mozos` lo necesita ComandasKanban; se recarga acá (query barata) en vez de
  // acoplar la tab Comandas a la promesa pesada de Salón (dine-in + transform).
  mozos: MozoMember[];
  printAgentLastSeenAt: string | null;
};

/**
 * Tab Pedidos. Además del board, lleva lo que necesita «Cargar pedido» para
 * **programar** (spec 085): los horarios que el negocio ofrece hoy —los mismos
 * chips que ve el cliente al programar (spec 064)— y el lead de marcha por
 * tipo, para que la UI diga cuánto antes va a salir la comanda con el número
 * real del negocio y no con un 40 escrito a mano.
 */
export type PedidosData = {
  initialOrders: AdminOrder[];
  /**
   * Spec 127 — minutos entre la marcha y la hora de cocina. La hoja lo usa sólo
   * para decir a qué hora va a salir el papel; el server hace la misma cuenta.
   */
  marchLeadKitchenMin: number;
  /** Envío del negocio, para que la hoja de carga lo muestre (issue #260). */
  deliveryFeeCents: number;
};

export type CajaData = {
  cajas: CajaConEstado[];
  /** Issue #339 — mesas con cobro parcial y cuentas cerradas con saldo. */
  cuentasConSaldo: CuentaConSaldo[];
  /**
   * #351 — la rendición se hace desde la vista Caja (ya no hay tab propia):
   * viaja con la caja y se refresca con el mismo refetch.
   */
  rendicion: RendicionData;
};

export type RendicionData = {
  rendicionPendientes: RendicionMozoPendiente[];
  rendicionHistorial: (MozoRendicion & {
    mozo_name: string;
    registered_by_name: string | null;
  })[];
  cajaAssignments: (CajaUserAssignment & {
    user_name: string | null;
    caja_name: string;
  })[];
  businessMembers: { user_id: string; full_name: string | null }[];
};

/** spec 141 — la tab «Cuentas corrientes». */
export type CuentasData = CuentasCorrientesData & {
  cajas: Caja[];
};

export type FichajeData = {
  initialPresent: PresentEmployee[];
  todaySummary?: TodaySummary;
};

/**
 * Libro de reservas del día elegido (`?date=`, default hoy en la TZ del negocio).
 * Es el MISMO dato que sirve `/admin/reservas`: la tab reusa `AdminDayList`.
 */
export type ReservasData = {
  date: string;
  rows: AdminRow[];
  floorPlans: Array<{ id: string; name: string }>;
  activeTables: FloorTable[];
  /** Spec 097 — modo + servicios del día para el editor de la fila. */
  mode: ReservationMode;
  services: DayServiceOption[];
  /** Spec 135/136 — la bandeja: solicitudes de cualquier día, no sólo de éste. */
  solicitudes: SolicitudEnBandeja[];
  /** Reloj del server, para que la bandeja hidrate sin diferencias. */
  ahoraIso: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Salón (default): plano + órdenes dine-in + reservas de hoy + mozos.
// ─────────────────────────────────────────────────────────────────────────────

/** Aplana la fila cruda de `orders` (con comandas anidadas) a `SalonOrderRef`. */
function mapDineInOrders(rows: unknown[]): SalonOrderRef[] {
  type RawProduct = { prep_time_minutes: number | null };
  type RawOrderItem = {
    product_name: string;
    quantity: number;
    cancelled_at: string | null;
    products: RawProduct | RawProduct[] | null;
  };
  type RawComandaItem = { order_items: RawOrderItem | RawOrderItem[] | null };
  type RawComanda = {
    id: string;
    batch: number;
    status: "pendiente" | "en_preparacion" | "entregado";
    station_id: string | null;
    emitted_at: string;
    delivered_at: string | null;
    cancelled_at: string | null;
    stations: { name: string } | { name: string }[] | null;
    comanda_items: RawComandaItem[];
  };

  return rows.map((raw) => {
    const o = raw as Record<string, unknown>;
    const rawComandas = (o as { comandas?: RawComanda[] }).comandas ?? [];
    return {
      id: o.id as string,
      order_number: o.order_number as number,
      daily_number: o.daily_number as number,
      table_id: o.table_id as string | null,
      total_cents: Number(o.total_cents),
      created_at: o.created_at as string,
      status: o.status as string,
      customer_name: (o as { customer_name: string | null }).customer_name,
      payment_status: (o as { payment_status: string | null }).payment_status,
      items:
        (
          o as {
            order_items?: Array<{
              id: string;
              product_id: string | null;
              product_name: string;
              quantity: number;
              cancelled_at: string | null;
              notes: string | null;
              station_id: string | null;
              unit_price_cents: number;
              price_original_cents: number | null;
              price_override_reason: string | null;
              is_combo_component: boolean | null;
              parent_order_item_id: string | null;
              daily_menu_id: string | null;
            }>;
          }
        ).order_items ?? [],
      comandas: rawComandas.map((c) => {
        const station = Array.isArray(c.stations) ? c.stations[0] : c.stations;
        const items = (c.comanda_items ?? [])
          .map((ci) =>
            Array.isArray(ci.order_items) ? ci.order_items[0] : ci.order_items,
          )
          .filter(
            (oi): oi is RawOrderItem => oi != null && oi.cancelled_at === null,
          )
          .map((oi) => {
            const product = Array.isArray(oi.products)
              ? oi.products[0]
              : oi.products;
            return {
              product_name: oi.product_name,
              quantity: oi.quantity,
              prep_time_minutes: product?.prep_time_minutes ?? null,
            };
          });
        return {
          id: c.id,
          batch: c.batch,
          status: c.status,
          station_name: station?.name ?? "—",
          emitted_at: c.emitted_at,
          delivered_at: c.delivered_at,
          cancelled_at: c.cancelled_at,
          items,
        };
      }),
    } as SalonOrderRef;
  });
}

export async function loadSalon(
  businessId: string,
  service: SupabaseClient,
  window: { todayStart: Date; tomorrowStart: Date },
): Promise<SalonData> {
  const [floorPlans, dineInRes, reservationsRes, mozos] = await Promise.all([
    getFloorPlansForBusiness(businessId),
    service
      .from("orders")
      .select(
        "id, order_number, daily_number, table_id, total_cents, created_at, status, customer_name, payment_status, order_items(id, product_id, product_name, quantity, cancelled_at, notes, station_id, unit_price_cents, price_original_cents, price_override_reason, is_combo_component, parent_order_item_id, daily_menu_id), comandas(id, batch, status, station_id, emitted_at, delivered_at, cancelled_at, stations(name), comanda_items(order_items(product_name, quantity, cancelled_at, products(prep_time_minutes))))",
      )
      .eq("business_id", businessId)
      .eq("delivery_type", "dine_in")
      .eq("lifecycle_status", "open"),
    service
      .from("reservations")
      .select(
        "id, table_id, customer_name, customer_phone, party_size, starts_at, status, notes",
      )
      .eq("business_id", businessId)
      .in("status", ["confirmed", "seated"])
      .gte("starts_at", window.todayStart.toISOString())
      .lt("starts_at", window.tomorrowStart.toISOString())
      .order("starts_at", { ascending: true }),
    getMozosByBusiness(businessId),
  ]);

  return {
    floorPlans,
    dineInOrders: mapDineInOrders(dineInRes.data ?? []),
    reservations: (reservationsRes.data ?? []) as SalonReservationRef[],
    mozos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resto de las tabs.
// ─────────────────────────────────────────────────────────────────────────────

export async function loadComandas(
  businessId: string,
  timezone: string,
): Promise<ComandasData> {
  const [initialComandas, stations, mozos, printAgentHealth] =
    await Promise.all([
      getActiveComandas(businessId, timezone),
      getStationsForLocal(businessId),
      getMozosByBusiness(businessId),
      getPrintAgentHealth(businessId),
    ]);
  return {
    initialComandas,
    stations,
    mozos,
    printAgentLastSeenAt: printAgentHealth.lastSeenAt,
  };
}

export async function loadPedidos(
  businessId: string,
  timezone: string,
  marchLead: { kitchenMin: number; deliveryFeeCents: number },
): Promise<PedidosData> {
  // Spec 127 — la grilla de chips del checkout ya no entra acá: el encargue del
  // staff escribe la hora libre, así que la hoja no necesita los horarios del
  // negocio ni los leads por tipo de entrega.
  return {
    initialOrders: await getTodayOrders(businessId, timezone),
    marchLeadKitchenMin: marchLead.kitchenMin,
    deliveryFeeCents: marchLead.deliveryFeeCents,
  };
}

export async function loadCaja(
  businessId: string,
  service: SupabaseClient = createSupabaseServiceClient() as unknown as SupabaseClient,
): Promise<CajaData> {
  const [cajas, cuentasConSaldo, rendicion] = await Promise.all([
    getCajasConEstado(businessId),
    getCuentasConSaldo(businessId),
    loadRendicion(businessId, service),
  ]);
  return { cajas, cuentasConSaldo, rendicion };
}

export async function loadCuentas(businessId: string): Promise<CuentasData> {
  const [cuentas, cajas] = await Promise.all([
    getCuentasCorrientes(businessId),
    getCajasForBusiness(businessId),
  ]);
  // Las cajas viajan con la tab porque cobrar un saldo en efectivo entra al
  // cajón (D5) y hay que elegir cuál sin pedir otro viaje.
  return { ...cuentas, cajas };
}

export async function loadRendicion(
  businessId: string,
  service: SupabaseClient,
): Promise<RendicionData> {
  const [rendicionPendientes, rendicionHistorial, cajaAssignments, membersRes] =
    await Promise.all([
      getRendicionesPendientesTodosLosMozos(businessId),
      getRendicionesHistorial(businessId),
      getCajaUserAssignments(businessId),
      service
        .from("business_users")
        .select("user_id, full_name")
        .eq("business_id", businessId)
        .is("disabled_at", null),
    ]);
  return {
    rendicionPendientes,
    rendicionHistorial,
    cajaAssignments,
    businessMembers: (membersRes.data ?? []) as {
      user_id: string;
      full_name: string | null;
    }[],
  };
}

export async function loadReservas(
  businessId: string,
  service: SupabaseClient,
  window: { date: string; dayStart: Date; dayEnd: Date; timezone: string },
): Promise<ReservasData> {
  const [rowsRes, fpRes] = await Promise.all([
    service
      .from("reservations")
      .select("*, tables(label, floor_plans(id, name))")
      .eq("business_id", businessId)
      .gte("starts_at", window.dayStart.toISOString())
      .lt("starts_at", window.dayEnd.toISOString())
      .order("starts_at", { ascending: true }),
    service
      .from("floor_plans")
      .select("id, name")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);

  const floorPlans = (fpRes.data ?? []) as Array<{ id: string; name: string }>;

  // Mesas activas: sólo para el modal "Nueva reserva". Sin salones no hay mesas
  // que buscar (y el `.in()` con lista vacía sería una query al vacío).
  let activeTables: FloorTable[] = [];
  if (floorPlans.length > 0) {
    const { data } = await service
      .from("tables")
      .select("*")
      .in(
        "floor_plan_id",
        floorPlans.map((fp) => fp.id),
      )
      .eq("status", "active");
    activeTables = (data ?? []) as FloorTable[];
  }

  // Spec 097 — el editor de la fila cambia según el modo (en flexible el
  // horario se elige por servicio + hora de llegada).
  const { mode, services } = await getReservationEditContext(
    businessId,
    window.date,
    { useService: true },
  );

  // Spec 136 — la tab de reservas del operativo lleva la misma bandeja que la
  // pantalla de reservas. El plano no: al lado está la tab «Mesas» con el salón
  // en vivo, y dos planos distintos en una pantalla confunden.
  const solicitudes = await getPendingInbox(businessId, window.timezone, {
    useService: true,
  });

  return {
    date: window.date,
    rows: (rowsRes.data ?? []) as AdminRow[],
    floorPlans,
    activeTables,
    mode,
    services,
    solicitudes,
    ahoraIso: new Date().toISOString(),
  };
}

export async function loadFichaje(
  businessId: string,
  businessSlug: string,
): Promise<FichajeData> {
  const [initialPresent, todaySummary] = await Promise.all([
    getCurrentPresent(businessSlug),
    getTodaySummary(businessId),
  ]);
  return { initialPresent, todaySummary };
}
