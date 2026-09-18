import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { OrderStatus } from "@/lib/orders/status";

export type AdminOrder = {
  id: string;
  /** Correlativo global del negocio: no se reinicia nunca, sirve para buscar
   *  un pedido en el historial. */
  order_number: number;
  /** Número del pedido DEL DÍA (`orders.daily_number`): arranca en 1 cada
   *  jornada y es el que sale impreso en la comanda. Es el que se muestra en
   *  la operación en vivo, para que coincida con el papel de cocina. */
  daily_number: number;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  delivery_type: "delivery" | "pickup" | "dine_in";
  total_cents: number;
  status: OrderStatus;
  payment_method: string;
  payment_status: string;
  cancelled_reason: string | null;
  /** Hora DEL PEDIDO: cuándo el cliente lo retira o lo recibe (spec 31 + 127).
   *  Null = para ahora. */
  scheduled_at: string | null;
  /** Hora DE COCINA (spec 127): para cuándo el plato tiene que estar listo. Es
   *  la que se imprime arriba de la comanda y la que manda la ventana de
   *  marcha. Sólo la tiene el encargue que carga el staff. */
  kitchen_at: string | null;
  /** Nota del encargado para cocina («junto con la mesa 5»). Desde la spec 127
   *  es sólo eso, una nota: el «para cuándo» tiene sus dos campos. */
  kitchen_notes: string | null;
  items: { product_name: string; quantity: number }[];
  /** La mesa de una orden de salón (issue #339). Sólo la trae el historial:
   *  el board de pedidos no lista órdenes de mesa. */
  table_label?: string | null;
};

/**
 * Arranque de la **jornada operativa** en curso, en UTC.
 *
 * No es medianoche: es la última vez que dieron las 6 AM en el local — el mismo
 * corte que `public.operating_day()` (migración 0049), que es quien materializa
 * `orders.business_day` y sobre quien se reinicia `daily_number`.
 *
 * Antes esto era medianoche calendario y ahí estaba el bug (issue #259): a las
 * 00:00 el delivery de las 23:40 dejaba de cumplir el filtro y **se caía del
 * board**, con su botón de cobrar adentro. La cocina ya tenía el papel, el
 * cliente esperaba, y el pedido quedaba `preparing` + impago para siempre: el
 * realtime de UPDATE hace `prev.map`, o sea que sólo pisa lo que ya está en la
 * lista, nunca lo reinserta. Nadie se enteraba hasta que el cliente llamaba.
 *
 * El resto del sistema ya usaba la jornada operativa; el board era el único que
 * miraba el calendario. El mismo arreglo ya se había hecho en el tablero de
 * comandas y éste quedó sin él.
 *
 * `now` se puede inyectar para poder probar el borde de las 00:05 sin esperar a
 * que sean las 00:05.
 */
export function startOfOperatingDayUtc(tz: string, now = new Date()): Date {
  const HORA_DE_CORTE = 6;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // Diferencia entre la hora local del negocio y UTC, medida sobre este mismo
  // instante: sirve para cualquier huso y contempla horario de verano.
  const nowInTz = new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}Z`,
  );
  const offsetMs = nowInTz.getTime() - now.getTime();

  // Antes de las 6 AM todavía se está trabajando la jornada de ayer: la cena
  // que cruza las doce no se parte en dos.
  const corte = new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T0${HORA_DE_CORTE}:00:00Z`,
  );
  if (Number(pick("hour")) < HORA_DE_CORTE) {
    corte.setUTCDate(corte.getUTCDate() - 1);
  }
  return new Date(corte.getTime() - offsetMs);
}

/**
 * Medianoche calendario en la TZ del negocio, en UTC.
 *
 * **No es lo mismo que `startOfOperatingDayUtc` y no son intercambiables.** Una
 * reserva pertenece a un día del calendario —«la del jueves» es del jueves aunque
 * el local siga sirviendo a la 1 AM—, mientras que un pedido pertenece a la
 * jornada de trabajo, con corte a las 6. Usar ésta para el board fue el bug
 * #259; usar la otra para reservas correría el día del libro tres horas.
 *
 * Si estás eligiendo entre las dos: ¿lo que filtrás lo numera `business_day`?
 * Entonces va la jornada operativa. ¿Lo elige una persona en un calendario?
 * Entonces va medianoche.
 */
export function startOfTodayUtc(tz: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const nowInTz = new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}Z`,
  );
  const offsetMs = nowInTz.getTime() - now.getTime();
  const localMidnight = new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T00:00:00Z`,
  );
  return new Date(localMidnight.getTime() - offsetMs);
}

export async function getTodayOrders(
  businessId: string,
  timezone: string,
): Promise<AdminOrder[]> {
  const supabase = await createSupabaseServerClient();
  const since = startOfOperatingDayUtc(timezone).toISOString();
  // Filtramos `dine_in` afuera: las orders de mesa viven en otra pantalla
  // (Salón). Aquí solo queremos delivery / pickup (canal online).
  //
  // Diferidos (spec 31): además de lo creado hoy, traemos lo agendado para hoy
  // en adelante (`scheduled_at >= hoy`) — así un pedido cargado ayer para hoy
  // entra a la operación, y la sección "Próximos" del board (client-side)
  // separa los que todavía no marcharon. Un agendado para dentro de 3 días
  // entra por `created_at` pero el board lo manda a Próximos, no al kanban.
  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_number, daily_number, created_at, customer_name, customer_phone, delivery_type, total_cents, status, payment_method, payment_status, cancelled_reason, scheduled_at, kitchen_at, kitchen_notes, order_items(product_name, quantity, is_combo_component)",
    )
    .eq("business_id", businessId)
    .neq("delivery_type", "dine_in")
    .or(`created_at.gte.${since},scheduled_at.gte.${since}`)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((o: any) => ({
    id: o.id,
    order_number: o.order_number,
    daily_number: o.daily_number,
    created_at: o.created_at,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    delivery_type: o.delivery_type as "delivery" | "pickup" | "dine_in",
    total_cents: Number(o.total_cents),
    status: o.status as OrderStatus,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    cancelled_reason: o.cancelled_reason,
    scheduled_at: o.scheduled_at,
    kitchen_at: o.kitchen_at,
    kitchen_notes: o.kitchen_notes,
    items: (o.order_items ?? [])
      .filter((i: any) => !i.is_combo_component)
      .map((i: any) => ({
        product_name: i.product_name,
        quantity: i.quantity,
      })),
  }));
}

const ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "on_the_way",
] as const;

export async function getPendingOrderCount(
  businessId: string,
  timezone: string,
): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const since = startOfOperatingDayUtc(timezone).toISOString();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    // Excluimos dine_in: el badge cuenta pedidos online (mismo universo que
    // el board), no mesas — así el número inicial coincide con la realtime.
    .neq("delivery_type", "dine_in")
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .gte("created_at", since);
  return count ?? 0;
}

// ─── Historial / list view (with filters + pagination) ───────────────────────

export type OrderListRange = "today" | "7d" | "30d" | "all";
export type OrderListPaymentStatus = "all" | "paid" | "pending" | "failed";
export type OrderListDeliveryType = "all" | "delivery" | "pickup";

export type OrderListFilters = {
  range?: OrderListRange;
  status?: OrderStatus | "all";
  deliveryType?: OrderListDeliveryType;
  paymentStatus?: OrderListPaymentStatus;
  search?: string;
  page?: number; // 1-based
  limit?: number;
};

export type OrderListResult = {
  orders: AdminOrder[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function rangeStart(tz: string, range: OrderListRange): string | null {
  if (range === "all") return null;
  const today = startOfOperatingDayUtc(tz);
  if (range === "today") return today.toISOString();
  const days = range === "7d" ? 7 : 30;
  const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return since.toISOString();
}

export async function getOrdersList(
  businessId: string,
  timezone: string,
  filters: OrderListFilters = {},
): Promise<OrderListResult> {
  const supabase = await createSupabaseServerClient();

  const range: OrderListRange = filters.range ?? "today";
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters.limit ?? 24));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("orders")
    .select(
      "id, order_number, daily_number, created_at, customer_name, customer_phone, delivery_type, total_cents, status, payment_method, payment_status, cancelled_reason, scheduled_at, kitchen_at, kitchen_notes, order_items(product_name, quantity, is_combo_component), tables!orders_table_id_fkey(label)",
      { count: "exact" },
    )
    .eq("business_id", businessId);

  const since = rangeStart(timezone, range);
  if (since) query = query.gte("created_at", since);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.deliveryType && filters.deliveryType !== "all") {
    query = query.eq("delivery_type", filters.deliveryType);
  }
  if (filters.paymentStatus && filters.paymentStatus !== "all") {
    query = query.eq("payment_status", filters.paymentStatus);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    // Search across customer name and phone (OR). Numeric search also
    // matches order_number.
    const numeric = Number(q);
    if (Number.isFinite(numeric) && /^\d+$/.test(q)) {
      query = query.or(
        `customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,order_number.eq.${numeric}`,
      );
    } else {
      query = query.or(
        `customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`,
      );
    }
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count } = await query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: AdminOrder[] = (data ?? []).map((o: any) => ({
    id: o.id,
    order_number: o.order_number,
    daily_number: o.daily_number,
    created_at: o.created_at,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    delivery_type: o.delivery_type as "delivery" | "pickup" | "dine_in",
    total_cents: Number(o.total_cents),
    status: o.status as OrderStatus,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    cancelled_reason: o.cancelled_reason,
    scheduled_at: o.scheduled_at,
    kitchen_at: o.kitchen_at,
    kitchen_notes: o.kitchen_notes,
    items: (o.order_items ?? [])
      .filter((i: any) => !i.is_combo_component)
      .map((i: any) => ({
        product_name: i.product_name,
        quantity: i.quantity,
      })),
    table_label: o.tables?.label ?? null,
  }));

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return { orders, total, page, pageSize, pageCount };
}

export async function getOrderDetail(orderId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select(
      `id, order_number, daily_number, created_at, updated_at,
       customer_name, customer_phone,
       delivery_type, delivery_address, delivery_notes,
       subtotal_cents, delivery_fee_cents, total_cents,
       status, cancelled_reason, payment_method, payment_status,
       order_items(id, product_name, quantity, unit_price_cents, subtotal_cents, notes,
         daily_menu_id, daily_menu_snapshot, is_combo_component, parent_order_item_id,
         order_item_modifiers(modifier_name, price_delta_cents)),
       order_status_history(status, notes, created_at)`,
    )
    .eq("id", orderId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}
