import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { createNotification } from "./create";

/**
 * Notifica la anulación de un ítem (spec 27). El destinatario depende de quién
 * lo cancela (principio "no notificar al actor", design D3):
 *   - actor `mozo` → broadcast a `encargado`.
 *   - actor `encargado`/`admin` → puntual al **mozo de la mesa** (omitido si el
 *     mozo es el propio actor).
 *   - mesa sin mozo asignado (delivery, bar) → broadcast a `encargado`.
 *
 * Resuelve la mesa (label + mozo) desde el `orderId`. Best-effort.
 */
export async function notifyItemCancelled(params: {
  businessId: string;
  orderId: string;
  reason: string;
  actorUserId: string;
  actorRole: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();

  const { data: order } = await service
    .from("orders")
    .select("table_id")
    .eq("id", params.orderId)
    .maybeSingle();
  const tableId = (order as { table_id: string | null } | null)?.table_id ?? null;

  let tableLabel: string | undefined;
  let mozoId: string | null = null;
  if (tableId) {
    const { data: table } = await service
      .from("tables")
      .select("label, mozo_id")
      .eq("id", tableId)
      .maybeSingle();
    tableLabel = (table as { label: string } | null)?.label;
    mozoId = (table as { mozo_id: string | null } | null)?.mozo_id ?? null;
  }

  const payload = { tableLabel, reason: params.reason };

  if (params.actorRole === "mozo" || !mozoId) {
    await createNotification({
      businessId: params.businessId,
      targetRole: "encargado",
      type: "item.cancelado",
      payload,
      actorUserId: params.actorUserId,
    });
  } else {
    await createNotification({
      businessId: params.businessId,
      userId: mozoId,
      type: "item.cancelado",
      payload,
      actorUserId: params.actorUserId,
    });
  }
}

/**
 * Avisa que el print agent no pudo imprimir una comanda (spec 33). Resuelve el
 * sector + la mesa/origen desde la comanda y notifica al `encargado` (broadcast)
 * y al **mozo de la mesa** (si es dine-in con mozo). Best-effort.
 *
 * El **dedup** (no avisar en cada reintento) lo maneja el caller vía
 * `comandas.print_failed_at` — acá solo se emite el aviso. Sin actor (lo dispara
 * el sistema/agente, no un usuario).
 */
export async function notifyPrintFailed(params: {
  businessId: string;
  comandaId: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();

  const { data: comanda } = await service
    .from("comandas")
    .select(
      "station_id, stations(name), orders!inner(order_number, delivery_type, tables!orders_table_id_fkey(label, mozo_id))",
    )
    .eq("id", params.comandaId)
    .maybeSingle();
  if (!comanda) return;

  const station = (comanda as { stations: { name: string } | null }).stations;
  const order = (comanda as {
    orders: {
      order_number: number | null;
      delivery_type: string;
      tables: { label: string; mozo_id: string | null } | null;
    } | null;
  }).orders;

  const payload = {
    stationName: station?.name ?? "Cocina",
    tableLabel: order?.tables?.label,
    orderNumber: order?.order_number ?? undefined,
    deliveryType: order?.delivery_type,
  };

  // Broadcast al encargado.
  await createNotification({
    businessId: params.businessId,
    targetRole: "encargado",
    type: "comanda.impresion_fallida",
    payload,
  });

  // Puntual al mozo de la mesa (dine-in con mozo asignado).
  const mozoId = order?.tables?.mozo_id ?? null;
  if (mozoId) {
    await createNotification({
      businessId: params.businessId,
      userId: mozoId,
      type: "comanda.impresion_fallida",
      payload,
    });
  }
}

/**
 * Aviso al admin cuando una rendición deja plata en el aire (spec 139 · D6).
 *
 * La diferencia de rendición **no** consume el techo del encargado
 * (`canAcceptCajaDifference` es del arqueo, no de esto): un faltante de un mozo
 * no se "acepta", se cobra, y aplicarle el techo trabaría el cierre a la 1 de
 * la mañana esperando que atienda el admin. A cambio de no trabar, no puede
 * quedar invisible — de ahí este aviso.
 *
 * Se dispara con `no_entrego` (deuda declarada) o con un faltante ≥ el mismo
 * umbral que el arqueo usa como techo del encargado. Broadcast a `admin`: es el
 * dueño el que decide qué hacer con esa plata.
 */
export async function notifyRendicionPendiente(params: {
  businessId: string;
  mozoName: string;
  estado: "rendida" | "no_entrego";
  expectedCents: number;
  deliveredCents: number;
  differenceCents: number;
  reason: string | null;
  actorUserId: string | null;
}): Promise<void> {
  await createNotification({
    businessId: params.businessId,
    targetRole: "admin",
    type: "rendicion.pendiente",
    payload: {
      mozoName: params.mozoName,
      estado: params.estado,
      expectedCents: params.expectedCents,
      deliveredCents: params.deliveredCents,
      differenceCents: params.differenceCents,
      reason: params.reason ?? undefined,
    },
    actorUserId: params.actorUserId,
  });
}

/**
 * Avisa que un comprobante que se emitió **solo** terminó rechazado (spec 147 · D6).
 *
 * Es la mitad que hace segura a la otra: automatizar la emisión sin esto
 * convierte «alguien facturó y le falló» en «todas las mesas fallan y nadie se
 * entera». Los 14 rechazos de golf-jcr se descubrieron consultando la base —la
 * spec 088 ya lo había advertido con dos, y un mes después eran catorce—, así
 * que el fallo silencioso no es una hipótesis.
 *
 * Sólo para la emisión automática: la manual falla en la cara del operador, que
 * ve el error en la pantalla donde apretó. El caller filtra por `auto_emitted`.
 *
 * Broadcast a `encargado`, y con eso alcanza para los dos roles que pide la
 * spec: `visibleTargetRoles` hace que el `admin` vea el feed del encargado
 * («el dueño ve todo»). Una segunda fila a `admin` sería el mismo aviso dos
 * veces en la campana del dueño.
 *
 * Sin actor: lo dispara el cobro o el cron, no una persona. Best-effort.
 */
export async function notifyInvoiceFailed(params: {
  businessId: string;
  invoiceId: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();

  const { data: invoice } = await service
    .from("invoices")
    .select(
      "error_message, total_cents, orders(order_number, tables!orders_table_id_fkey(label))",
    )
    .eq("id", params.invoiceId)
    .maybeSingle();
  if (!invoice) return;

  const order = (invoice as {
    orders: {
      order_number: number | null;
      tables: { label: string } | null;
    } | null;
  }).orders;

  await createNotification({
    businessId: params.businessId,
    targetRole: "encargado",
    type: "factura.emision_fallida",
    payload: {
      invoiceId: params.invoiceId,
      orderNumber: order?.order_number ?? undefined,
      tableLabel: order?.tables?.label,
      totalCents: Number((invoice as { total_cents: number }).total_cents),
      error: (invoice as { error_message: string | null }).error_message ?? undefined,
    },
  });
}

/**
 * #148 · H-20 — Mercado Pago acreditó un pago de un pedido ya cancelado.
 *
 * Pasa con los medios offline (se aprueban horas después) o con un link que
 * quedó abierto. La plata entró y el pedido no se cocina: alguien tiene que
 * devolverla. Antes era un `console.warn` que nadie leía. MP reintenta los
 * webhooks, así que el aviso es uno por pago.
 */
export async function notifyPagoSobrePedidoCancelado(params: {
  businessId: string;
  orderId: string;
  paymentId: string;
  amountCents: number | null;
}): Promise<void> {
  const service = createSupabaseServiceClient();

  const { count } = await service
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("business_id", params.businessId)
    .eq("type", "mp.pago_sobre_cancelado")
    .eq("payload->>paymentId", params.paymentId);
  if ((count ?? 0) > 0) return;

  const { data: order } = await service
    .from("orders")
    .select("order_number")
    .eq("id", params.orderId)
    .maybeSingle();

  await createNotification({
    businessId: params.businessId,
    targetRole: "encargado",
    type: "mp.pago_sobre_cancelado",
    payload: {
      orderId: params.orderId,
      paymentId: params.paymentId,
      orderNumber:
        (order as { order_number: number | null } | null)?.order_number ??
        undefined,
      amountCents: params.amountCents ?? undefined,
    },
  });
}

/**
 * Revisión adversarial (auditoría de pedidos) — entró un SEGUNDO pago aprobado
 * de un pedido que ya estaba pagado (el link viejo y el del reintento, o un
 * cupón offline que se acreditó tarde). Se asentó en la caja porque la plata
 * entró, pero el pedido no se cocina dos veces: hay que devolver uno. Un aviso
 * por pago.
 */
export async function notifyPagoDuplicado(params: {
  businessId: string;
  orderId: string;
  paymentId: string;
  amountCents: number | null;
}): Promise<void> {
  const service = createSupabaseServiceClient();
  const { count } = await service
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("business_id", params.businessId)
    .eq("type", "mp.pago_duplicado")
    .eq("payload->>paymentId", params.paymentId);
  if ((count ?? 0) > 0) return;

  const { data: order } = await service
    .from("orders")
    .select("order_number")
    .eq("id", params.orderId)
    .maybeSingle();

  await createNotification({
    businessId: params.businessId,
    targetRole: "encargado",
    type: "mp.pago_duplicado",
    payload: {
      orderId: params.orderId,
      paymentId: params.paymentId,
      orderNumber:
        (order as { order_number: number | null } | null)?.order_number ??
        undefined,
      amountCents: params.amountCents ?? undefined,
    },
  });
}
