import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

import { getInvoiceKPIs } from "@/lib/afip/queries";
import { startOfOperatingDayUtc } from "@/lib/admin/orders-query";
import type { PaymentMethod } from "@/lib/caja/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type {
  CancellationRow,
  CorrectionRow,
  ShiftCorte,
  ShiftMozo,
  ShiftSummaryData,
} from "./shift-summary";

// Cliente service-role con tipos laxos: el loader corre tanto en el cron (sin
// sesión → RLS no aplica, por eso service) como en la server action manual.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

const EMPTY_METODO: Record<PaymentMethod, number> = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  mp_manual: 0,
  other: 0,
  cuenta_corriente: 0,
};

function tipoLabel(tipo: string): string {
  switch (tipo) {
    case "factura_a":
      return "Factura A";
    case "factura_b":
      return "Factura B";
    case "nota_credito_a":
      return "Nota de crédito A";
    case "nota_credito_b":
      return "Nota de crédito B";
    default:
      return "Comprobante";
  }
}

async function resolveUserNames(
  service: AnyClient,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(ids.filter((x): x is string => Boolean(x))),
  );
  if (unique.length === 0) return new Map();
  const { data } = await service
    .from("users")
    .select("id, full_name")
    .in("id", unique);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map((u) => [
      u.id,
      u.full_name ?? "—",
    ]),
  );
}

/**
 * Junta las fuentes del resumen de cierre para un negocio en su **día operativo**
 * (timezone AR). Multi-tenant: todo scopeado por `business_id` con service client.
 *
 * Recaudación + por-mozo salen de `payments` del día (misma tabla/campos que
 * caja, scopeada al día → total consistente con la suma por mozo). AFIP reusa
 * `getInvoiceKPIs`. Operación/cortes/anulaciones son lecturas acotadas al rango.
 */
export async function loadShiftSummaryData(
  businessId: string,
  now: Date = new Date(),
): Promise<ShiftSummaryData | null> {
  const service = db();

  const { data: biz } = await service
    .from("businesses")
    .select("id, name, timezone")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz) return null;

  const timezone = (biz as { timezone: string }).timezone;
  const businessName = (biz as { name: string }).name;

  // issue #272 · hallazgo 1 — el día del resumen es la JORNADA, no el
  // calendario.
  //
  // Cortaba a medianoche: el mail que Golf recibe al cerrar (01:00–02:00)
  // resumía dos horas de servicio y mandaba el resto de la noche al resumen del
  // día siguiente. La jornada es `public.operating_day()` (corte 6 AM,
  // migración 0049), el mismo corte que numera la comanda y que usa el board de
  // pedidos desde el arreglo #259.
  //
  // `rangeLabel` se arma sobre el arranque de la jornada y no sobre `now`: a las
  // 00:30 el mail decía «lunes 07/09» arriba de los números del domingo.
  const start = startOfOperatingDayUtc(timezone, now);
  const startIso = start.toISOString();
  const endIso = now.toISOString();
  const rangeLabel = formatInTimeZone(start, timezone, "EEEE dd/MM/yyyy", {
    locale: es,
  });

  // ── Recaudación + por mozo (payments del día) ─────────────────────────
  const { data: payRows } = await service
    .from("payments")
    .select("method, amount_cents, tip_cents, attributed_mozo_id")
    .eq("business_id", businessId)
    .eq("payment_status", "paid")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  const payments = (payRows ?? []) as {
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    attributed_mozo_id: string | null;
  }[];

  const por_metodo: Record<PaymentMethod, number> = { ...EMPTY_METODO };
  let total_cents = 0;
  let fiado_cents = 0;
  let propinas_cents = 0;
  const mozoAgg = new Map<
    string,
    { ventas: number; propinas: number; count: number }
  >();
  for (const p of payments) {
    // issue #190 — venta = `amount − tip`, el mismo criterio que la caja
    // (spec 098) y el dashboard. La propina viaja adentro de `amount_cents`
    // porque es plata que entró, pero no es del negocio: sumándola, la fila del
    // mozo decía «ventas $71.500 · propinas $6.500» por una venta de $65.000, y
    // dos pantallas del mismo negocio daban números distintos para lo mismo.
    const venta = p.amount_cents - p.tip_cents;
    por_metodo[p.method] = (por_metodo[p.method] ?? 0) + venta;
    // issue #272 · hallazgo 2 — el fiado (spec 141) es venta pero NO entró al
    // cajón, y el mail lo imprimía bajo el título «Recaudación». Peor que en el
    // donut del panel: `METHOD_ORDER` tampoco lo lista, así que la tabla de
    // abajo no sumaba al KPI de arriba y no había forma de notarlo. La caja ya
    // lo separa en `total_fiado_cents` desde la 141 · D3; acá se hace lo mismo.
    if (p.method === "cuenta_corriente") fiado_cents += venta;
    else total_cents += venta;
    propinas_cents += p.tip_cents;
    // Lo del mozo sí incluye el fiado: él vendió la mesa. Lo que no le
    // corresponde es la propina, que ya se resta arriba.
    if (p.attributed_mozo_id) {
      const cur = mozoAgg.get(p.attributed_mozo_id) ?? {
        ventas: 0,
        propinas: 0,
        count: 0,
      };
      cur.ventas += venta;
      cur.propinas += p.tip_cents;
      cur.count += 1;
      mozoAgg.set(p.attributed_mozo_id, cur);
    }
  }

  const mozoNames = await resolveUserNames(service, [...mozoAgg.keys()]);
  const porMozo: ShiftMozo[] = [...mozoAgg.entries()]
    .map(([id, v]) => ({
      mozo_name: mozoNames.get(id) ?? "—",
      ventas_cents: v.ventas,
      propinas_cents: v.propinas,
      cobros_count: v.count,
    }))
    .sort((a, b) => b.ventas_cents - a.ventas_cents);

  // ── AFIP (reuse) ──────────────────────────────────────────────────────
  const afip = await getInvoiceKPIs(businessId, startIso, endIso);

  // ── Operación del día (orders) ────────────────────────────────────────
  const { data: orderRows } = await service
    .from("orders")
    .select(
      "id, total_cents, tip_cents, status, lifecycle_status, delivery_type, cancelled_at, cancelled_reason, cancelled_by, table_id, order_number",
    )
    .eq("business_id", businessId)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  const orders = (orderRows ?? []) as {
    id: string;
    total_cents: number;
    tip_cents: number;
    status: string;
    lifecycle_status: string | null;
    delivery_type: string;
    cancelled_at: string | null;
    cancelled_reason: string | null;
    cancelled_by: string | null;
    table_id: string | null;
    order_number: number;
  }[];

  const isCancelled = (o: (typeof orders)[number]) =>
    o.status === "cancelled" || o.lifecycle_status === "cancelled";
  const live = orders.filter((o) => !isCancelled(o));
  const orderCount = live.length;
  // issue #272 · hallazgo 4 — la misma regla que 55 líneas más arriba.
  //
  // `orders.total_cents` lleva la propina adentro (`recomputeOrderTotals`:
  // `total = subtotal + tip + fee − discount`), así que el bloque «Operación»
  // medía con otra vara que el bloque «Recaudación» del MISMO mail. Lo único
  // que se imprime de acá es el ticket promedio —`revenueCents` no está en el
  // modelo de vista— y es el número con el que el dueño decide los precios de
  // la carta: salía inflado por la propina, todos los días.
  //
  // Ojo, siguen siendo dos poblaciones distintas y eso no lo arregla esto:
  // «Recaudación» son cobros del día, y esto son órdenes creadas en el día
  // (incluidas las abiertas y sin cobrar). Por eso el promedio puede superar la
  // recaudación de arriba sin que ninguno de los dos esté mal.
  const revenueCents = live.reduce(
    (acc, o) => acc + Number(o.total_cents) - (Number(o.tip_cents) || 0),
    0,
  );
  const deliveryCount = live.filter(
    (o) => o.delivery_type === "delivery",
  ).length;
  const pickupCount = live.filter((o) => o.delivery_type === "pickup").length;
  const dineInCount = live.filter((o) => o.delivery_type === "dine_in").length;
  const cancelledOrders = orders.filter(isCancelled);

  // ── Cortes del día (diferencia + encargado + hora) ────────────────────
  const { data: corteRows } = await service
    .from("caja_cortes")
    .select(
      "caja_id, encargado_id, difference_cents, closing_cash_cents, expected_cash_cents, created_at, cajas(name)",
    )
    .eq("business_id", businessId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: true });

  const corteRaw = (corteRows ?? []) as {
    encargado_id: string;
    difference_cents: number;
    closing_cash_cents: number;
    expected_cash_cents: number;
    created_at: string;
    cajas: { name: string } | { name: string }[] | null;
  }[];
  const encargadoNames = await resolveUserNames(
    service,
    corteRaw.map((c) => c.encargado_id),
  );
  const cortes: ShiftCorte[] = corteRaw.map((c) => ({
    caja_name: Array.isArray(c.cajas)
      ? (c.cajas[0]?.name ?? "Caja")
      : (c.cajas?.name ?? "Caja"),
    encargado_name: encargadoNames.get(c.encargado_id) ?? null,
    difference_cents: c.difference_cents,
    closing_cash_cents: c.closing_cash_cents,
    expected_cash_cents: c.expected_cash_cents,
    at: c.created_at,
  }));

  // ── Anulaciones (mesa + ítem + factura) con motivo + responsable ──────
  const anulaciones = await loadCancellations(service, businessId, {
    startIso,
    endIso,
    cancelledOrders,
  });

  // ── Correcciones de caja del día (spec 070) ───────────────────────────
  const correcciones = await loadCorrecciones(service, businessId, {
    startIso,
    endIso,
  });

  return {
    businessName,
    timezone,
    rangeLabel,
    recaudacion: {
      total_cents,
      fiado_cents,
      propinas_cents,
      por_metodo,
      cobros_count: payments.length,
    },
    afip,
    operacion: {
      orderCount,
      revenueCents,
      averageTicketCents:
        orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
      deliveryCount,
      pickupCount,
      dineInCount,
      cancelledCount: cancelledOrders.length,
    },
    cortes,
    porMozo,
    anulaciones,
    correcciones,
  };
}

/**
 * Las correcciones del turno: qué línea de caja cambió, de qué a qué, quién y
 * por qué. Los ids de mozo/caja se traducen acá — el log guarda el dato exacto,
 * el mail necesita nombres.
 */
async function loadCorrecciones(
  service: AnyClient,
  businessId: string,
  ctx: { startIso: string; endIso: string },
): Promise<CorrectionRow[]> {
  const { data } = await service
    .from("caja_audit_log")
    .select(
      "entity_type, field, from_value, to_value, reason, by_user_id, created_at",
    )
    .eq("business_id", businessId)
    .gte("created_at", ctx.startIso)
    .lte("created_at", ctx.endIso)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as {
    entity_type: "payment" | "movimiento";
    field: string;
    from_value: string | null;
    to_value: string | null;
    reason: string;
    by_user_id: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const actores = await resolveUserNames(
    service,
    rows.map((r) => r.by_user_id),
  );

  // Ids que hay que traducir a nombre (mozo o caja).
  const idsALabelear = new Set<string>();
  for (const r of rows) {
    if (r.field === "attributed_mozo_id" || r.field === "caja_id") {
      if (r.from_value) idsALabelear.add(r.from_value);
      if (r.to_value) idsALabelear.add(r.to_value);
    }
  }
  const labels = new Map<string, string>();
  if (idsALabelear.size > 0) {
    const lista = Array.from(idsALabelear);
    const [{ data: users }, { data: cajas }] = await Promise.all([
      service
        .from("business_users")
        .select("user_id, full_name")
        .eq("business_id", businessId)
        .in("user_id", lista),
      service
        .from("cajas")
        .select("id, name")
        .eq("business_id", businessId)
        .in("id", lista),
    ]);
    for (const u of (users ?? []) as {
      user_id: string;
      full_name: string | null;
    }[]) {
      if (u.full_name) labels.set(u.user_id, u.full_name);
    }
    for (const c of (cajas ?? []) as { id: string; name: string }[]) {
      labels.set(c.id, c.name);
    }
  }

  return rows.map((r) => ({
    entity: r.entity_type,
    field: r.field,
    from_value: r.from_value,
    to_value: r.to_value,
    from_label: r.from_value ? (labels.get(r.from_value) ?? null) : null,
    to_label: r.to_value ? (labels.get(r.to_value) ?? null) : null,
    reason: r.reason,
    responsable: r.by_user_id ? (actores.get(r.by_user_id) ?? null) : null,
    at: r.created_at,
  }));
}

async function loadCancellations(
  service: AnyClient,
  businessId: string,
  ctx: {
    startIso: string;
    endIso: string;
    cancelledOrders: {
      cancelled_at: string | null;
      cancelled_reason: string | null;
      cancelled_by: string | null;
      table_id: string | null;
      order_number: number;
    }[];
  },
): Promise<CancellationRow[]> {
  const { startIso, endIso, cancelledOrders } = ctx;
  const rows: CancellationRow[] = [];
  const actorIds: (string | null)[] = [];

  // Mesas anuladas (orders ya cargadas) — label por etiqueta de mesa.
  const mesaAnuladas = cancelledOrders.filter((o) => o.cancelled_at);
  const tableIds = Array.from(
    new Set(
      mesaAnuladas.map((o) => o.table_id).filter((x): x is string => !!x),
    ),
  );
  const tableLabels = new Map<string, string>();
  if (tableIds.length > 0) {
    const { data: tbls } = await service
      .from("tables")
      .select("id, label")
      .in("id", tableIds);
    for (const t of (tbls ?? []) as { id: string; label: string }[]) {
      tableLabels.set(t.id, t.label);
    }
  }
  for (const o of mesaAnuladas) {
    actorIds.push(o.cancelled_by);
    rows.push({
      kind: "mesa",
      label: o.table_id
        ? `Mesa ${tableLabels.get(o.table_id) ?? "?"}`
        : `Pedido #${o.order_number}`,
      reason: o.cancelled_reason,
      responsable: null, // se resuelve abajo vía el array paralelo `actorIds`
      at: o.cancelled_at as string,
    });
  }

  // Ítems anulados.
  const { data: itemRows } = await service
    .from("order_items")
    .select(
      "product_name, cancelled_at, cancelled_reason, cancelled_by, orders!inner(business_id)",
    )
    .not("cancelled_at", "is", null)
    .gte("cancelled_at", startIso)
    .lte("cancelled_at", endIso)
    .eq("orders.business_id", businessId);
  const items = (itemRows ?? []) as {
    product_name: string;
    cancelled_at: string;
    cancelled_reason: string | null;
    cancelled_by: string | null;
  }[];
  for (const it of items) {
    actorIds.push(it.cancelled_by);
    rows.push({
      kind: "item",
      label: it.product_name,
      reason: it.cancelled_reason,
      responsable: null,
      at: it.cancelled_at,
    });
  }

  // Facturas anuladas (sin timestamp de anulación → se usa created_at).
  const { data: invRows } = await service
    .from("invoices")
    .select(
      "punto_venta, numero, tipo_comprobante, cancelled_reason, cancelled_by, created_at",
    )
    .eq("business_id", businessId)
    .eq("status", "cancelled")
    .gte("created_at", startIso)
    .lte("created_at", endIso);
  const invoices = (invRows ?? []) as {
    punto_venta: number;
    numero: number | null;
    tipo_comprobante: string;
    cancelled_reason: string | null;
    cancelled_by: string | null;
    created_at: string;
  }[];
  for (const inv of invoices) {
    actorIds.push(inv.cancelled_by);
    const pv = String(inv.punto_venta).padStart(4, "0");
    const nro = inv.numero ? String(inv.numero).padStart(8, "0") : "—";
    rows.push({
      kind: "factura",
      label: `${tipoLabel(inv.tipo_comprobante)} ${pv}-${nro}`,
      reason: inv.cancelled_reason,
      responsable: null,
      at: inv.created_at,
    });
  }

  // Resolver nombres de responsables (staff). Clientes/null → "—".
  const names = await resolveUserNames(service, actorIds);
  // Re-map manteniendo el orden de inserción de actorIds == orden de rows.
  rows.forEach((r, i) => {
    const actor = actorIds[i];
    r.responsable = actor ? (names.get(actor) ?? null) : null;
  });

  // Orden cronológico.
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}
