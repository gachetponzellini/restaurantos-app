import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfitMetrics, type ProfitMetrics } from "@/lib/admin/profit-query";
import { startOfOperatingDayUtc } from "@/lib/admin/orders-query";
import { isOrderAlive, isOrderDead } from "@/lib/orders/predicates";
import { fetchAll } from "@/lib/proveedores/unwrap";

export type DashboardOverview = {
  today: {
    orderCount: number;
    revenueCents: number;
    activeOrderCount: number;
    cancelledCount: number;
    averageTicketCents: number;
    newCustomerCount: number;
  };
  yesterday: {
    orderCount: number;
    revenueCents: number;
    averageTicketCents: number;
    newCustomerCount: number;
  };
  month: {
    orderCount: number;
    revenueCents: number;
    dailyRevenue: { date: string; revenueCents: number; orders: number }[];
  };
  channelBreakdown: {
    delivery: { count: number; revenueCents: number };
    pickup: { count: number; revenueCents: number };
    dine_in: { count: number; revenueCents: number };
  };
  topProducts: { name: string; quantity: number; revenueCents: number }[];
};

/**
 * Arranque de la jornada operativa de hace `daysAgo` jornadas, en UTC.
 *
 * Esto era medianoche calendario (`startOfDayUtc`) y ahí estaba el bug del
 * hallazgo 1 de la issue #272: a las 00:30 el tile «Pedidos hoy» arrancaba de
 * cero mientras la lista «Pedidos de hoy» de MÁS ABAJO EN LA MISMA PÁGINA
 * —que sí corta por jornada— seguía mostrando la cena. La noche entera, con
 * mesas abiertas y sin cobrar, se caía a «ayer» estando todavía viva. En Golf,
 * que cierra 01:00–02:00, eso es la cola de cada servicio.
 *
 * La jornada es la de `public.operating_day()` (corte 6 AM, migración 0049),
 * que es quien numera la comanda y llena `orders.business_day`; el helper vive
 * en `orders-query.ts` desde el arreglo del board (#259) y acá se reusa en vez
 * de escribir un tercer corte.
 *
 * El desplazamiento se hace sobre el instante y no sobre la fecha local, igual
 * que hacía la versión de medianoche.
 */
function startOfOperatingDayAgo(
  tz: string,
  daysAgo = 0,
  now: Date = new Date(),
): Date {
  const ref = new Date(now.getTime());
  ref.setUTCDate(ref.getUTCDate() - daysAgo);
  return startOfOperatingDayUtc(tz, ref);
}

/**
 * A qué jornada pertenece un instante: la misma cuenta que hace
 * `public.operating_day()` en la base (hora local menos 6 horas → fecha).
 *
 * Con la clave de calendario, el gráfico de los últimos 30 días partía cada
 * noche en dos barras y la del cierre quedaba pegada al día siguiente.
 */
function operatingDayKey(date: Date, tz: string): string {
  const HORA_DE_CORTE = 6;
  const corrido = new Date(date.getTime() - HORA_DE_CORTE * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(corrido);
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

const DAYS_IN_MONTH_RANGE = 30;

export async function getDashboardOverview(
  businessId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<DashboardOverview> {
  const supabase = await createSupabaseServerClient();

  const startToday = startOfOperatingDayAgo(timezone, 0, now);
  const startYesterday = startOfOperatingDayAgo(timezone, 1, now);
  const startMonth = startOfOperatingDayAgo(
    timezone,
    DAYS_IN_MONTH_RANGE - 1,
    now,
  );

  // `fetchAll` en vez de una sola vuelta (issue #272 · hallazgo 8): PostgREST
  // corta en 1.000 filas y devuelve 206 sin error, así que `(data ?? [])`
  // recibía el recorte y el tile dejaba de crecer justo cuando el negocio
  // empezaba a crecer. Además lanza si la lectura falla (spec 161 · D1): ver
  // que se rompió es mejor que ver $0.
  const [ordersData, todayItemsData, customersData] = await Promise.all([
    fetchAll(
      () =>
        supabase
          .from("orders")
          .select(
            "id, created_at, total_cents, tip_cents, status, lifecycle_status, delivery_type",
          )
          .eq("business_id", businessId)
          .gte("created_at", startMonth.toISOString())
          .order("id"),
      "orders",
    ),
    fetchAll(
      () =>
        supabase
          .from("order_items")
          .select(
            "id, product_name, quantity, subtotal_cents, orders!inner(business_id, created_at, status, lifecycle_status)",
          )
          .eq("orders.business_id", businessId)
          .gte("orders.created_at", startToday.toISOString())
          // issue #269 — las líneas hijas de un menú del día no son ventas.
          // Entran con `subtotal_cents = 0` (el precio vive en el padre), así
          // que inflan las unidades sin mover la plata: la guarnición aparece
          // como un producto vendidísimo a $0.
          .not("is_combo_component", "is", true)
          // spec 091 — los dos ejes. Con uno solo, Top productos seguía mostrando
          // las 6 cervezas de una mesa anulada al día siguiente.
          .neq("orders.status", "cancelled")
          .neq("orders.lifecycle_status", "cancelled")
          // issue #190 — y el tercer eje: la **línea** anulada adentro de una mesa
          // viva. Las dos milanesas que se cayeron al piso seguían en Top productos.
          .is("cancelled_at", null)
          .order("id"),
      "order_items",
    ),
    fetchAll(
      () =>
        supabase
          .from("customers")
          .select("id, created_at")
          .eq("business_id", businessId)
          .gte("created_at", startYesterday.toISOString())
          .order("id"),
      "customers",
    ),
  ]);

  type OrderRow = {
    created_at: string;
    total_cents: number;
    status: string;
    lifecycle_status: string;
    delivery_type: string;
  };
  const orders: OrderRow[] = ordersData.map((r) => ({
    created_at: r.created_at,
    total_cents: Number(r.total_cents) - (Number(r.tip_cents) || 0),
    status: r.status as string,
    lifecycle_status: (r.lifecycle_status as string) ?? "open",
    delivery_type: (r.delivery_type as string) ?? "delivery",
  }));

  const inRange = (r: OrderRow, start: Date, end?: Date) => {
    const t = new Date(r.created_at).getTime();
    return t >= start.getTime() && (!end || t < end.getTime());
  };

  const todayRows = orders.filter((r) => inRange(r, startToday));
  const yesterdayRows = orders.filter((r) =>
    inRange(r, startYesterday, startToday),
  );

  const todayNotCancelled = todayRows.filter(isOrderAlive);
  const todayRevenue = todayNotCancelled.reduce((s, r) => s + r.total_cents, 0);
  const todayCancelled = todayRows.filter(isOrderDead).length;
  const activeStatuses = new Set([
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "on_the_way",
  ]);
  // spec 091 — «Pedidos activos» miraba un solo eje, así que contaba las mesas
  // **cobradas** (que quedan en `pending` porque ningún flujo de salón escribe
  // `orders.status`) y las anuladas. El dueño abría el panel un martes a las 4
  // con el local vacío y leía «Pedidos activos: 47».
  const activeOrderCount = todayRows.filter(
    (r) =>
      isOrderAlive(r) &&
      r.lifecycle_status !== "closed" &&
      activeStatuses.has(r.status),
  ).length;

  const yesterdayNotCancelled = yesterdayRows.filter(isOrderAlive);
  const yesterdayRevenue = yesterdayNotCancelled.reduce(
    (s, r) => s + r.total_cents,
    0,
  );

  const monthNotCancelled = orders.filter(isOrderAlive);
  const monthRevenue = monthNotCancelled.reduce((s, r) => s + r.total_cents, 0);

  const dailyBuckets = new Map<
    string,
    { revenueCents: number; orders: number }
  >();
  for (let i = DAYS_IN_MONTH_RANGE - 1; i >= 0; i--) {
    const d = startOfOperatingDayAgo(timezone, i, now);
    dailyBuckets.set(operatingDayKey(d, timezone), {
      revenueCents: 0,
      orders: 0,
    });
  }
  for (const r of monthNotCancelled) {
    const k = operatingDayKey(new Date(r.created_at), timezone);
    const bucket = dailyBuckets.get(k);
    if (bucket) {
      bucket.revenueCents += r.total_cents;
      bucket.orders += 1;
    }
  }

  const channelBreakdown = {
    delivery: { count: 0, revenueCents: 0 },
    pickup: { count: 0, revenueCents: 0 },
    dine_in: { count: 0, revenueCents: 0 },
  };
  for (const r of monthNotCancelled) {
    const key =
      (r.delivery_type as keyof typeof channelBreakdown) ?? "delivery";
    if (key in channelBreakdown) {
      channelBreakdown[key].count += 1;
      channelBreakdown[key].revenueCents += r.total_cents;
    }
  }

  const productCounts = new Map<
    string,
    { quantity: number; revenueCents: number }
  >();
  for (const it of todayItemsData) {
    const name = (it as { product_name: string }).product_name;
    const qty = Number((it as { quantity: number }).quantity) || 0;
    const sub = Number((it as { subtotal_cents: number }).subtotal_cents) || 0;
    const existing = productCounts.get(name) ?? {
      quantity: 0,
      revenueCents: 0,
    };
    existing.quantity += qty;
    existing.revenueCents += sub;
    productCounts.set(name, existing);
  }
  const topProducts = Array.from(productCounts.entries())
    .map(([name, v]) => ({
      name,
      quantity: v.quantity,
      revenueCents: v.revenueCents,
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const customers = customersData;
  const newCustomersToday = customers.filter((c) => {
    const t = new Date(c.created_at as string).getTime();
    return t >= startToday.getTime();
  }).length;
  const newCustomersYesterday = customers.filter((c) => {
    const t = new Date(c.created_at as string).getTime();
    return t >= startYesterday.getTime() && t < startToday.getTime();
  }).length;

  return {
    today: {
      orderCount: todayNotCancelled.length,
      revenueCents: todayRevenue,
      activeOrderCount,
      cancelledCount: todayCancelled,
      averageTicketCents:
        todayNotCancelled.length > 0
          ? Math.round(todayRevenue / todayNotCancelled.length)
          : 0,
      newCustomerCount: newCustomersToday,
    },
    yesterday: {
      orderCount: yesterdayNotCancelled.length,
      revenueCents: yesterdayRevenue,
      averageTicketCents:
        yesterdayNotCancelled.length > 0
          ? Math.round(yesterdayRevenue / yesterdayNotCancelled.length)
          : 0,
      newCustomerCount: newCustomersYesterday,
    },
    month: {
      orderCount: monthNotCancelled.length,
      revenueCents: monthRevenue,
      dailyRevenue: Array.from(dailyBuckets.entries()).map(([date, v]) => ({
        date,
        revenueCents: v.revenueCents,
        orders: v.orders,
      })),
    },
    channelBreakdown,
    topProducts,
  };
}

export type HourlyHeatmapCell = {
  dow: number;
  hour: number;
  orderCount: number;
  revenueCents: number;
};

export type HourlyHeatmap = {
  cells: HourlyHeatmapCell[];
  maxCount: number;
  totalOrders: number;
  rangeDays: number;
};

const HEATMAP_DAYS = 90;

export async function getHourlyHeatmap(
  businessId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<HourlyHeatmap> {
  const supabase = await createSupabaseServerClient();
  const start = startOfOperatingDayAgo(timezone, HEATMAP_DAYS - 1, now);

  // La celda se sigue ubicando por la hora de RELOJ (para eso es un mapa de
  // horas: dice a qué hora entra el trabajo). Lo que cambia es la ventana, que
  // ahora arranca en una jornada y no a media noche, y que se pide `tip_cents`:
  // sin él la facturación por hora salía con la propina adentro.
  const data = await fetchAll(
    () =>
      supabase
        .from("orders")
        .select("id, created_at, total_cents, tip_cents, status")
        .eq("business_id", businessId)
        .neq("status", "cancelled")
        .neq("lifecycle_status", "cancelled")
        .gte("created_at", start.toISOString())
        .order("id"),
    "orders",
  );

  const grid = new Map<string, HourlyHeatmapCell>();
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      grid.set(`${dow}-${hour}`, {
        dow,
        hour,
        orderCount: 0,
        revenueCents: 0,
      });
    }
  }

  const dowFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const hourFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  for (const row of data) {
    const date = new Date(row.created_at as string);
    const dowName = dowFmt.format(date);
    const dow = dowMap[dowName] ?? 0;
    const hourStr = hourFmt.format(date).replace(/\D/g, "");
    const hour = Number(hourStr) % 24;
    const cell = grid.get(`${dow}-${hour}`);
    if (cell) {
      cell.orderCount += 1;
      // issue #272 · hallazgo 7 — `total_cents` lleva la propina adentro
      // (`total = subtotal + tip + fee − discount`). El tooltip decía
      // «facturación» y medía con otra regla que los tiles de arriba de la
      // misma página, que restan el tip desde la spec 098. No mueve el color de
      // la celda (eso va por `orderCount`), pero sí el número que se lee.
      cell.revenueCents +=
        (Number(row.total_cents) || 0) - (Number(row.tip_cents) || 0);
    }
  }

  const cells = Array.from(grid.values());
  const maxCount = cells.reduce((m, c) => Math.max(m, c.orderCount), 0);
  const totalOrders = cells.reduce((s, c) => s + c.orderCount, 0);

  return { cells, maxCount, totalOrders, rangeDays: HEATMAP_DAYS };
}

// ── Rentabilidad del dashboard (últimos 30 días) ──────────────────

export async function getDashboardProfit(
  businessId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<ProfitMetrics> {
  const start = startOfOperatingDayAgo(timezone, DAYS_IN_MONTH_RANGE - 1, now);
  return getProfitMetrics(businessId, start.toISOString(), now.toISOString());
}

// ── Mix de medios de pago (últimos 30 días) ───────────────────────

export type PaymentMethodKey =
  | "cash"
  | "card_manual"
  | "mp_link"
  | "mp_qr"
  | "transfer"
  | "mp_manual"
  | "other";

export type PaymentMix = {
  byMethod: Record<PaymentMethodKey, { count: number; amountCents: number }>;
  /** Lo que efectivamente entró: el fiado NO suma acá. */
  totalCents: number;
  cashCents: number;
  digitalCents: number;
  /**
   * Fiado del período (`method = 'cuenta_corriente'`, spec 141): venta sí,
   * plata cobrada no. Va aparte y no entra a ningún total ni porcentaje.
   */
  fiadoCents: number;
  fiadoCount: number;
};

const EMPTY_MIX: Record<
  PaymentMethodKey,
  { count: number; amountCents: number }
> = {
  cash: { count: 0, amountCents: 0 },
  card_manual: { count: 0, amountCents: 0 },
  mp_link: { count: 0, amountCents: 0 },
  mp_qr: { count: 0, amountCents: 0 },
  transfer: { count: 0, amountCents: 0 },
  mp_manual: { count: 0, amountCents: 0 },
  other: { count: 0, amountCents: 0 },
};

export async function getPaymentMix(
  businessId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<PaymentMix> {
  const supabase = await createSupabaseServerClient();
  const start = startOfOperatingDayAgo(timezone, DAYS_IN_MONTH_RANGE - 1, now);

  const data = await fetchAll(
    () =>
      supabase
        .from("payments")
        .select("id, method, amount_cents")
        .eq("business_id", businessId)
        .eq("payment_status", "paid")
        .gte("created_at", start.toISOString())
        .order("id"),
    "payments",
  );

  const byMethod: Record<
    PaymentMethodKey,
    { count: number; amountCents: number }
  > = JSON.parse(JSON.stringify(EMPTY_MIX));
  let totalCents = 0;
  let fiadoCents = 0;
  let fiadoCount = 0;

  for (const p of data) {
    const row = p as { method: string; amount_cents: number };
    const amount = Number(row.amount_cents) || 0;

    // issue #272 · hallazgo 2 — el fiado no es plata cobrada. Como
    // `PaymentMethodKey` no lo listaba, caía en el balde «Otros» del donut,
    // sumaba a `totalCents` y con eso bajaba el «% efectivo» del centro del
    // gráfico. La caja ya lo separa desde la spec 141 · D3
    // (`total_fiado_cents`); ésta era la pantalla del DUEÑO diciendo otra cosa
    // que la del encargado. Se lo saca de los totales y se lo devuelve aparte
    // para que se pueda mostrar sin volver a mezclarlo.
    if (row.method === "cuenta_corriente") {
      fiadoCents += amount;
      fiadoCount += 1;
      continue;
    }

    const key =
      (row.method as PaymentMethodKey) in byMethod
        ? (row.method as PaymentMethodKey)
        : "other";
    byMethod[key].count += 1;
    byMethod[key].amountCents += amount;
    totalCents += amount;
  }

  const cashCents = byMethod.cash.amountCents;
  const digitalCents = totalCents - cashCents;

  return {
    byMethod,
    totalCents,
    cashCents,
    digitalCents,
    fiadoCents,
    fiadoCount,
  };
}

// ── Control de caja (por rango) ───────────────────────────────────

export type CashControl = {
  corteCount: number;
  netDifferenceCents: number; // suma de diferencias (sobrante - faltante)
  shortageCents: number; // total faltante (diferencias negativas)
  surplusCents: number; // total sobrante (diferencias positivas)
  sangriaCents: number;
  ingresoCents: number;
};

export async function getCashControl(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<CashControl> {
  const supabase = await createSupabaseServerClient();

  const [cortes, movimientos] = await Promise.all([
    fetchAll(
      () =>
        supabase
          .from("caja_cortes")
          .select("id, difference_cents")
          .eq("business_id", businessId)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("id"),
      "caja_cortes",
    ),
    // issue #272 · hallazgo 5 — los dos filtros que le faltaban a «Sangrías».
    //
    // `cancelled_at`: un movimiento anulado (spec 070) sigue en el libro para
    // que quede la huella, pero no mueve la caja. `calculateExpectedCash` ya lo
    // filtra; esta tarjeta no, así que la sangría que el encargado cargó mal y
    // corrigió seguía contando como plata sacada.
    //
    // `corte_id`: el retiro que escribe `cerrar_caja_tx` al vaciar el cajón no
    // es una sangría del turno, es el cierre — `separarRetiroDelCierre` lo
    // netea contra la apertura por eso mismo (spec 130). Sin este filtro,
    // «¿cuánta plata se está sacando de la caja?» respondía con TODO el
    // efectivo de la semana, y un retiro discrecional de $80.000 escondido
    // adentro de $583.500 no se veía. La tarjeta se llama «Control de arqueos».
    fetchAll(
      () =>
        supabase
          .from("caja_movimientos")
          .select("id, kind, amount_cents")
          .eq("business_id", businessId)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .is("cancelled_at", null)
          .is("corte_id", null)
          .order("id"),
      "caja_movimientos",
    ),
  ]);

  let netDifferenceCents = 0;
  let shortageCents = 0;
  let surplusCents = 0;
  for (const c of cortes) {
    const diff =
      Number((c as { difference_cents: number }).difference_cents) || 0;
    netDifferenceCents += diff;
    if (diff < 0) shortageCents += Math.abs(diff);
    else surplusCents += diff;
  }

  let sangriaCents = 0;
  let ingresoCents = 0;
  for (const m of movimientos) {
    const row = m as { kind: string; amount_cents: number };
    const amount = Number(row.amount_cents) || 0;
    if (row.kind === "sangria") sangriaCents += amount;
    else if (row.kind === "ingreso") ingresoCents += amount;
  }

  return {
    corteCount: cortes.length,
    netDifferenceCents,
    shortageCents,
    surplusCents,
    sangriaCents,
    ingresoCents,
  };
}
