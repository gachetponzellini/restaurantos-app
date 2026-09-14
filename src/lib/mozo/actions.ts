"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { clearAssignmentsForBusiness } from "@/lib/mozo/clear-assignments";
import { MOTIVO_MESA_SIN_CONSUMO, tieneConsumo } from "@/lib/mozo/consumo";
import {
  canTransition,
  nextOpenedAt,
  type OperationalStatus,
} from "@/lib/mozo/state-machine";
import {
  canAssignMozo,
  canMoveTable,
  canTransferTable,
  canTransitionMesa,
} from "@/lib/permissions/can";
import { createNotification } from "@/lib/notifications/create";
import { bloqueoPorPlata } from "@/lib/orders/cancel-guards";
import { cancelarOrden } from "@/lib/orders/cancel-order";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

type GenericClient = SupabaseClient;

// ── Helpers internos ────────────────────────────────────────────

type LoadedTable = {
  id: string;
  operational_status: OperationalStatus;
  opened_at: string | null;
  mozo_id: string | null;
  label: string;
};

async function loadTableForBusiness(
  service: GenericClient,
  tableId: string,
  businessId: string,
): Promise<LoadedTable | null> {
  // Cross-tenant defense: tables no tiene business_id directo, va via floor_plans.
  const { data } = await service
    .from("tables")
    .select(
      "id, operational_status, opened_at, mozo_id, label, floor_plans!inner(business_id)",
    )
    .eq("id", tableId)
    .maybeSingle();
  if (!data) return null;
  const fpRaw = (data as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== businessId) return null;
  return {
    id: (data as { id: string }).id,
    operational_status: (data as { operational_status: OperationalStatus })
      .operational_status,
    opened_at: (data as { opened_at: string | null }).opened_at,
    mozo_id: (data as { mozo_id: string | null }).mozo_id,
    label: (data as { label: string }).label,
  };
}

/**
 * Chequea si una mesa tiene una order open con al menos un item activo.
 * Usado para gatear transiciones a `pidio_cuenta` (no se puede pedir cuenta
 * sin items que cobrar).
 */
async function tableHasActiveOrderWithItems(
  service: GenericClient,
  tableId: string,
  businessId: string,
): Promise<boolean> {
  const { data: order } = await service
    .from("orders")
    .select("id")
    .eq("table_id", tableId)
    .eq("business_id", businessId)
    .eq("lifecycle_status", "open")
    .maybeSingle();
  if (!order) return false;
  const orderId = (order as { id: string }).id;
  const { count } = await service
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .is("cancelled_at", null);
  return (count ?? 0) > 0;
}

async function insertAudit(
  service: GenericClient,
  params: {
    tableId: string;
    businessId: string;
    kind: "status" | "assignment" | "transfer";
    fromValue: string | null;
    toValue: string | null;
    byUserId: string | null;
    reason?: string | null;
  },
): Promise<void> {
  const { error } = await service.from("tables_audit_log").insert({
    table_id: params.tableId,
    business_id: params.businessId,
    kind: params.kind,
    from_value: params.fromValue,
    to_value: params.toValue,
    by_user_id: params.byUserId,
    reason: params.reason ?? null,
  });
  if (error) {
    // El audit no debería bloquear la mutación primaria, pero loggear es importante.
    console.error("tables_audit_log insert", error);
  }
}

/**
 * Al cerrar una mesa, sus reservas `seated` quedan huérfanas si no se transicionan.
 * Las pasamos a un estado terminal para que no reaparezcan pegadas a la mesa libre.
 */
async function closeSeatedReservations(
  service: GenericClient,
  tableId: string,
  businessId: string,
  to: "completed" | "no_show",
): Promise<void> {
  const { error } = await service
    .from("reservations")
    .update({ status: to })
    .eq("table_id", tableId)
    .eq("business_id", businessId)
    .eq("status", "seated");
  if (error) console.error("closeSeatedReservations", error);
}

// ── Estado operacional de la mesa (CU-07) ───────────────────────

export async function updateTableOperationalStatus(
  tableId: string,
  status: OperationalStatus,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const table = await loadTableForBusiness(service, tableId, business.id);
  if (!table) return actionError("Mesa no encontrada.");

  const from = table.operational_status;
  if (!canTransition(from, status)) {
    return actionError("Transición no permitida.");
  }
  if (!canTransitionMesa(ctx.role, from, status)) {
    return actionError("No tenés permisos para esta acción.");
  }

  if (from === status) {
    // No-op: aceptado por la state machine, pero no escribimos ni audit ni patch.
    return actionOk(undefined);
  }

  // Pidió cuenta requiere order open con items: sin items no hay nada
  // que cobrar. Defensa también disparada desde transiciones genéricas
  // (drawer admin con dropdown de estado).
  if (status === "pidio_cuenta") {
    const hasOrder = await tableHasActiveOrderWithItems(
      service,
      tableId,
      business.id,
    );
    if (!hasOrder) {
      return actionError("La mesa no tiene una orden activa para cobrar.");
    }
  }

  // spec 092 — liberar **cancela la cuenta abierta**, así que por encima de
  // plata cobrada o de una factura emitida hace exactamente el mismo daño que
  // anular. La guarda va acá, antes de tocar `tables`: más abajo la mesa ya
  // quedó libre y auditada, y devolver un error ahí dejaría la mesa liberada
  // con su orden viva — el estado imposible que este bloque existe para evitar.
  if (status === "libre" && from !== "libre") {
    const { data: abiertasPrev } = await service
      .from("orders")
      .select("id")
      .eq("table_id", tableId)
      .eq("business_id", business.id)
      .eq("lifecycle_status", "open");
    const bloqueo = await bloqueoPorPlata(
      service,
      ((abiertasPrev ?? []) as { id: string }[]).map((o) => o.id),
    );
    if (bloqueo) return actionError(bloqueo);
  }

  const patch: Record<string, unknown> = { operational_status: status };
  patch.opened_at = nextOpenedAt(from, status, table.opened_at);
  if (status === "libre") {
    patch.current_order_id = null;
  }

  const { error } = await service
    .from("tables")
    .update(patch)
    .eq("id", tableId);
  if (error) {
    console.error("updateTableOperationalStatus", error);
    return actionError("No pudimos actualizar el estado de la mesa.");
  }

  await insertAudit(service, {
    tableId,
    businessId: business.id,
    kind: "status",
    fromValue: from,
    toValue: status,
    byUserId: ctx.userId,
  });

  // Al liberar: no dejar órdenes abiertas ni reservas seated huérfanas — eso
  // produce el estado imposible "mesa Libre con orden abierta".
  if (status === "libre" && from !== "libre") {
    // spec 090 — esto era un `anularMesa` degradado: cancelaba la cuenta y
    // dejaba las comandas **vivas y accionables** en el kanban (el botón sólo
    // se apaga con `cancelled_at`, que acá nunca se escribía), los ítems sin
    // marcar y el total sin recalcular. Ahora usa el mismo helper que anular.
    const { data: abiertas } = await service
      .from("orders")
      .select("id")
      .eq("table_id", tableId)
      .eq("business_id", business.id)
      .eq("lifecycle_status", "open");

    const nowIso = new Date().toISOString();
    for (const o of (abiertas ?? []) as { id: string }[]) {
      await cancelarOrden(service, {
        orderId: o.id,
        businessId: business.id,
        motivo: "Mesa liberada",
        actorUserId: ctx.userId, // spec 34 — responsable de la anulación
        nowIso,
      });
    }
    await closeSeatedReservations(service, tableId, business.id, "completed");
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Pedir cuenta: setea `orders.bill_requested_at = now()` (timestamp persistente,
 * fuente de verdad) y transiciona la mesa a `pidio_cuenta` para el color en el
 * plano. Falla si la mesa no tiene order open o no está en estado `ocupada`.
 */
export async function pedirCuenta(
  tableId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const table = await loadTableForBusiness(service, tableId, business.id);
  if (!table) return actionError("Mesa no encontrada.");

  const from = table.operational_status;
  if (!canTransition(from, "pidio_cuenta")) {
    return actionError("La mesa no puede pedir cuenta desde este estado.");
  }
  if (!canTransitionMesa(ctx.role, from, "pidio_cuenta")) {
    return actionError("No tenés permisos para esta acción.");
  }

  // Validación dura: tiene que haber order open con items activos. Sin esto
  // no hay nada que cobrar — y la mesa quedaría en pidio_cuenta huérfana.
  const hasOrder = await tableHasActiveOrderWithItems(
    service,
    tableId,
    business.id,
  );
  if (!hasOrder) {
    return actionError("La mesa no tiene una orden activa para cobrar.");
  }

  // Setear bill_requested_at en la order activa (verdad inmutable del evento).
  const { error: orderErr } = await service
    .from("orders")
    .update({ bill_requested_at: new Date().toISOString() })
    .eq("table_id", tableId)
    .eq("business_id", business.id)
    .eq("lifecycle_status", "open")
    .is("bill_requested_at", null);
  if (orderErr) {
    console.error("pedirCuenta order", orderErr);
    return actionError("No pudimos registrar el pedido de cuenta.");
  }

  if (from !== "pidio_cuenta") {
    const { error: tableErr } = await service
      .from("tables")
      .update({ operational_status: "pidio_cuenta" })
      .eq("id", tableId);
    if (tableErr) {
      console.error("pedirCuenta table", tableErr);
      return actionError("No pudimos cambiar el estado de la mesa.");
    }
    await insertAudit(service, {
      tableId,
      businessId: business.id,
      kind: "status",
      fromValue: from,
      toValue: "pidio_cuenta",
      byUserId: ctx.userId,
    });

    // spec 27 — avisar al encargado que la mesa pidió la cuenta (no al mozo
    // que la marcó: actorUserId lo excluye si justo es el destinatario).
    await createNotification({
      businessId: business.id,
      targetRole: "encargado",
      type: "mesa.pidio_cuenta",
      payload: { tableLabel: table.label },
      actorUserId: ctx.userId,
    });
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Volver a pedir: cliente pidió cuenta pero se arrepintió y quiere postre.
 * Limpia `orders.bill_requested_at` y vuelve la mesa a `ocupada`.
 */
export async function volverAPedir(
  tableId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const table = await loadTableForBusiness(service, tableId, business.id);
  if (!table) return actionError("Mesa no encontrada.");

  const from = table.operational_status;
  if (!canTransition(from, "ocupada")) {
    return actionError("La mesa no puede volver a pedir desde este estado.");
  }
  if (!canTransitionMesa(ctx.role, from, "ocupada")) {
    return actionError("No tenés permisos para esta acción.");
  }

  await service
    .from("orders")
    .update({ bill_requested_at: null })
    .eq("table_id", tableId)
    .eq("business_id", business.id)
    .eq("lifecycle_status", "open");

  if (from !== "ocupada") {
    const { error: tableErr } = await service
      .from("tables")
      .update({ operational_status: "ocupada" })
      .eq("id", tableId);
    if (tableErr) {
      console.error("volverAPedir table", tableErr);
      return actionError("No pudimos cambiar el estado de la mesa.");
    }
    await insertAudit(service, {
      tableId,
      businessId: business.id,
      kind: "status",
      fromValue: from,
      toValue: "ocupada",
      byUserId: ctx.userId,
    });
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

export async function liberarMesa(
  tableId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  return updateTableOperationalStatus(tableId, "libre", businessSlug);
}

/**
 * Anular mesa: pasa a `libre` y marca todas las orders abiertas asociadas
 * como `cancelled` con motivo. Solo encargado/admin.
 *
 * **El motivo es obligatorio sólo si la mesa tiene consumo** (spec 071). Una
 * mesa a la que no se le cargó nada se cierra directo: anular ahí es deshacer
 * un click, no tirar comida. Quién decide eso es el server, no el cliente —
 * un cliente con datos viejos podría mandar el motivo vacío en una mesa a la
 * que le acaban de cargar algo, así que se re-deriva acá contra la DB.
 */
export async function anularMesa(
  tableId: string,
  motivo: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const motivoDado = motivo.trim();

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const table = await loadTableForBusiness(service, tableId, business.id);
  if (!table) return actionError("Mesa no encontrada.");

  const from = table.operational_status;
  if (!canTransition(from, "libre")) {
    return actionError("La mesa no está en un estado anulable.");
  }
  if (!canTransitionMesa(ctx.role, from, "libre")) {
    return actionError("Solo encargado o admin pueden anular una mesa.");
  }

  // spec 096 · H-30 — la mesa que YA está libre no se anula, y el corte va acá
  // arriba: más abajo ya se auditó y se notificó.
  //
  // `canTransition('libre','libre')` es true por el caso `from === to`, y la
  // guarda de rol (`isAnulacion`) sólo cubre `from` ocupada/pidio_cuenta — o sea
  // que sobre una mesa ya libre **también se caía el chequeo de encargado**. El
  // UPDATE no matcheaba nada y nadie miraba el resultado vacío: igual se
  // auditaba, se notificaba y se devolvía «Mesa anulada.». Lo que pasaba: el
  // mozo cobra la 12 y el encargado le da Anular casi en simultáneo; el
  // encargado se queda tranquilo y al mozo le llega «te anularon la Mesa 12».
  //
  // issue #296 — este corte estaba escrito contra la **cuenta** («si no hay
  // orden abierta, no hay nada que anular») en vez de contra el **estado de la
  // mesa**, y así se llevaba puesta la mesa ocupada sin cuenta abierta: la que
  // deja el walk-in cuando el insert de la orden falla (`openTable` lo hace
  // best-effort a propósito), o la que se quedó sin cuenta por cualquier otro
  // camino. Esa mesa es justo la que hay que poder cerrar de un toque —no se le
  // cargó nada, anular ahí es deshacer un click (spec 071)— y no tenía ninguna
  // salida en el plano: quedaba ocupada hasta que el cierre de caja barría el
  // salón. Sin cuenta que cancelar, anular es liberar: la mesa igual se libera,
  // se audita y la reserva `seated` se cierra.
  if (from === "libre") {
    return actionError("La mesa ya está libre.");
  }

  // ¿Tiene consumo? Se pregunta a la DB, no al cliente (ver doc de arriba).
  const { data: openOrders, error: openErr } = await service
    .from("orders")
    .select("id, order_items(cancelled_at)")
    .eq("table_id", tableId)
    .eq("business_id", business.id)
    .eq("lifecycle_status", "open");
  if (openErr) {
    console.error("anularMesa openOrders", openErr);
    return actionError("No pudimos leer el estado de la mesa.");
  }
  const items = ((openOrders ?? []) as { order_items?: { cancelled_at: string | null }[] }[])
    .flatMap((o) => o.order_items ?? []);
  const conConsumo = tieneConsumo(items);

  if (conConsumo && !motivoDado) {
    return actionError("El motivo de anulación es obligatorio.");
  }

  // spec 092 — no se anula por encima de plata ya movida.
  const openOrderIdsPrev = ((openOrders ?? []) as { id: string }[]).map(
    (o) => o.id,
  );
  const bloqueo = await bloqueoPorPlata(service, openOrderIdsPrev);
  if (bloqueo) return actionError(bloqueo);
  // Sin consumo y sin motivo: se registra uno del sistema. La auditoría nunca
  // queda con el campo vacío, pero al encargado no se le pide nada.
  const reason = motivoDado || MOTIVO_MESA_SIN_CONSUMO;

  // Cancelar las orders abiertas de esta mesa. Cada una pasa por
  // `cancelarOrden` (spec 090), que escribe los **cinco** ejes: los dos de
  // `orders`, todos los `order_items` vivos, las comandas activas con su ticket
  // «ANULADA», y el recompute de totales.
  //
  // Antes esto vivía inline acá y tenía dos agujeros: sólo escribía
  // `lifecycle_status` —el eje del que no cuelga ni la analítica ni la reversión
  // de stock— y derivaba los ítems a cancelar **desde las comandas activas**,
  // así que las bebidas (`station_id` null, nunca entran a `comanda_items`) y lo
  // cargado-sin-enviar quedaban vivos. En el cloud: 29 ítems por $606.200.
  const nowIso = new Date().toISOString();
  const openOrderIds = openOrderIdsPrev;
  for (const orderId of openOrderIds) {
    await cancelarOrden(service, {
      orderId,
      businessId: business.id,
      motivo: reason,
      actorUserId: ctx.userId, // spec 34 — responsable de la anulación
      nowIso,
    });
  }

  // mozo_id se preserva: la asignación es fija hasta que el encargado la
  // cambie manualmente. Anular la mesa no la saca del mozo asignado.
  const { error: tableErr } = await service
    .from("tables")
    .update({
      operational_status: "libre",
      opened_at: null,
      current_order_id: null,
    })
    .eq("id", tableId);
  if (tableErr) {
    console.error("anularMesa table", tableErr);
    return actionError("No pudimos cambiar el estado de la mesa.");
  }

  await insertAudit(service, {
    tableId,
    businessId: business.id,
    kind: "status",
    fromValue: from,
    toValue: "libre",
    byUserId: ctx.userId,
    reason,
  });

  // spec 096 · H-29 — el desenlace de la reserva se **deriva del consumo**, no
  // se asume. La llamada era incondicional a `no_show` aunque el comentario
  // dijera "sin consumo": el cliente que reservó, comió y se fue sin pagar abría
  // «Mis reservas» y leía «No asististe», y al dueño le llegaba una alerta de
  // que la asistencia se había caído. `conConsumo` ya está calculado arriba.
  await closeSeatedReservations(
    service,
    tableId,
    business.id,
    conConsumo ? "completed" : "no_show",
  );

  // Notify the assigned mozo (if any) that their table was cancelled.
  const cancelPayload = { tableLabel: table.label, reason };
  if (table.mozo_id) {
    await createNotification({
      businessId: business.id,
      userId: table.mozo_id,
      type: "mesa.cancelled",
      payload: cancelPayload,
      actorUserId: ctx.userId,
    });
  }
  // Broadcast to encargado so the manager always sees cancellations.
  await createNotification({
    businessId: business.id,
    targetRole: "encargado",
    type: "mesa.cancelled",
    payload: cancelPayload,
    actorUserId: ctx.userId,
  });

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Asignación / transferencia de mozo (CU-09) ──────────────────

async function ensureUserIsMozoMember(
  service: GenericClient,
  businessId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await service
    .from("business_users")
    .select("role, disabled_at")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { role: string; disabled_at: string | null } | null;
  if (!row) return false;
  if (row.disabled_at) return false;
  return row.role === "mozo" || row.role === "encargado" || row.role === "admin";
}

export async function assignMozoToTable(
  tableId: string,
  mozoId: string | null,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canAssignMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden asignar mozos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const table = await loadTableForBusiness(service, tableId, business.id);
  if (!table) return actionError("Mesa no encontrada.");

  if (mozoId) {
    const isMember = await ensureUserIsMozoMember(service, business.id, mozoId);
    if (!isMember) return actionError("Usuario no es miembro activo del negocio.");
  }

  const from = table.mozo_id;
  if (from === mozoId) return actionOk(undefined); // no-op

  const { error } = await service
    .from("tables")
    .update({ mozo_id: mozoId })
    .eq("id", tableId);
  if (error) {
    console.error("assignMozoToTable", error);
    return actionError("No pudimos asignar el mozo.");
  }

  await insertAudit(service, {
    tableId,
    businessId: business.id,
    kind: "assignment",
    fromValue: from,
    toValue: mozoId,
    byUserId: ctx.userId,
  });

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Limpia la distribución entera: desasigna el mozo de todas las mesas del
 * negocio. Es el reset de arranque de turno — el encargado que llega con la
 * distribución de ayer pegada prefiere partir de cero antes que ir mesa por
 * mesa desasignando (la asignación es fija, ver `assignMozoToTable`).
 *
 * Devuelve cuántas mesas quedaron liberadas.
 */
export async function clearMozoAssignments(
  businessSlug: string,
): Promise<ActionResult<{ cleared: number }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canAssignMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden asignar mozos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const cleared = await clearAssignmentsForBusiness(
    service,
    business.id,
    ctx.userId,
    "Limpiar distribución",
  );
  if (cleared === null) return actionError("No pudimos limpiar la distribución.");

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({ cleared });
}

export async function transferTable(
  tableId: string,
  toMozoId: string,
  businessSlug: string,
  reason?: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const table = await loadTableForBusiness(service, tableId, business.id);
  if (!table) return actionError("Mesa no encontrada.");

  const fromMozoId = table.mozo_id;
  const isOrigen = fromMozoId !== null && fromMozoId === ctx.userId;
  const isSelfClaim = toMozoId === ctx.userId && !isOrigen;
  if (!canTransferTable(ctx.role, isOrigen, isSelfClaim)) {
    return actionError("No podés transferir una mesa que no tenés asignada.");
  }

  if (fromMozoId === toMozoId) {
    return actionError("La mesa ya está asignada a ese mozo.");
  }

  const isMember = await ensureUserIsMozoMember(service, business.id, toMozoId);
  if (!isMember) return actionError("El destino no es miembro activo del negocio.");

  const { error: updErr } = await service
    .from("tables")
    .update({ mozo_id: toMozoId })
    .eq("id", tableId);
  if (updErr) {
    console.error("transferTable update", updErr);
    return actionError("No pudimos transferir la mesa.");
  }

  await insertAudit(service, {
    tableId,
    businessId: business.id,
    kind: "transfer",
    fromValue: fromMozoId,
    toValue: toMozoId,
    byUserId: ctx.userId,
    reason: reason?.trim() || null,
  });

  // Notif al encargado (T5 CU-09).
  // Resolver nombres para el payload.
  const namesToFetch = [fromMozoId, toMozoId, ctx.userId].filter(
    (x): x is string => !!x,
  );
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", business.id)
    .in("user_id", namesToFetch);
  const nameById = new Map<string, string>();
  for (const m of (members ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>) {
    if (m.full_name) nameById.set(m.user_id, m.full_name);
  }

  const transferPayload = {
    tableId,
    tableLabel: table.label,
    fromMozoId,
    fromName: fromMozoId ? (nameById.get(fromMozoId) ?? null) : null,
    toMozoId,
    toName: nameById.get(toMozoId) ?? null,
    transferredBy: ctx.userId,
    transferredByName: nameById.get(ctx.userId) ?? null,
    reason: reason?.trim() || null,
  };

  // Broadcast al encargado (T5 CU-09) — vía createNotification para respetar
  // las preferencias de canal del negocio (spec 27, antes era INSERT directo).
  await createNotification({
    businessId: business.id,
    targetRole: "encargado",
    type: "mesa.transferred",
    payload: transferPayload,
    actorUserId: ctx.userId,
  });

  // Notify the destination mozo directly so they see the new table.
  await createNotification({
    businessId: business.id,
    userId: toMozoId,
    type: "mesa.transferred",
    payload: transferPayload,
    actorUserId: ctx.userId,
  });

  // Notify the original mozo that their table was taken. `actorUserId` ya omite
  // la notif si el origen es quien transfiere (no hace falta el guard manual).
  if (fromMozoId) {
    await createNotification({
      businessId: business.id,
      userId: fromMozoId,
      type: "mesa.transferred",
      payload: transferPayload,
      actorUserId: ctx.userId,
    });
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Trasladar mesa completa a otra mesa física (spec 048) ────────

/**
 * Mapea los errores que levanta la RPC `trasladar_mesa_tx` (raise exception en
 * plpgsql → texto crudo en error.message) a mensajes de usuario.
 */
function mapTrasladarMesaError(message: string): string {
  if (message.includes("DESTINATION_OCCUPIED"))
    return "La mesa está ocupada. Cobrala o liberala antes de mover.";
  if (message.includes("NO_OPEN_ORDER"))
    return "La mesa no tiene una cuenta abierta para trasladar.";
  if (message.includes("SAME_TABLE"))
    return "Elegí una mesa distinta a la de origen.";
  if (message.includes("STALE_STATE"))
    return "La mesa cambió mientras la movías. Refrescá e intentá de nuevo.";
  if (message.includes("CROSS_TENANT")) return "Mesa no encontrada.";
  return `No pudimos trasladar la mesa: ${message}`;
}

/**
 * Traslada la orden abierta (con su cuenta, comandas y cobros parciales) de la
 * mesa origen a una mesa destino **libre**. Toda la operación va en la RPC
 * transaccional `trasladar_mesa_tx` (migración 0015): repunteo de
 * `orders.table_id` + swap de las dos mesas + reserva seated + audit, bajo lock
 * FOR UPDATE de la orden. El contenido y la plata viajan solos (cuelgan de
 * `order_id`). Si el destino está ocupado → `DESTINATION_OCCUPIED`: la fusión de
 * dos cuentas NO se soporta (descartada) — hay que cobrar/cerrar una primero.
 * Solo encargado/admin.
 */
export async function trasladarMesa(
  fromTableId: string,
  toTableId: string,
  businessSlug: string,
  reason?: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canMoveTable(ctx.role)) {
    return actionError("Solo encargado o admin pueden trasladar una mesa.");
  }

  if (fromTableId === toTableId) {
    return actionError("Elegí una mesa distinta a la de origen.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Cross-tenant defense: ambas mesas deben pertenecer al negocio.
  const fromTable = await loadTableForBusiness(service, fromTableId, business.id);
  if (!fromTable) return actionError("Mesa de origen no encontrada.");
  const toTable = await loadTableForBusiness(service, toTableId, business.id);
  if (!toTable) return actionError("Mesa de destino no encontrada.");

  // Resolver la orden abierta de la mesa origen: la pasamos como
  // `p_expected_order_id` para que la RPC rechace (STALE_STATE) si la mesa
  // cambió entre que la UI la mostró y el submit (doble-tap / cover nuevo).
  const { data: openOrder } = await service
    .from("orders")
    .select("id")
    .eq("table_id", fromTableId)
    .eq("business_id", business.id)
    .eq("lifecycle_status", "open")
    .maybeSingle();
  const expectedOrderId = (openOrder as { id: string } | null)?.id ?? null;
  if (!expectedOrderId) {
    return actionError("La mesa no tiene una cuenta abierta para trasladar.");
  }

  const { error } = await service.rpc("trasladar_mesa_tx", {
    p_business_id: business.id,
    p_from_table_id: fromTableId,
    p_to_table_id: toTableId,
    p_expected_order_id: expectedOrderId,
    p_actor_user_id: ctx.userId,
    p_reason: reason?.trim() || null,
  });
  if (error) return actionError(mapTrasladarMesaError(error.message));

  // Notif mesa.moved: broadcast al encargado + puntual al mozo de la mesa (el
  // que viajó con ella). actorUserId omite la notif si el actor es el destino.
  const movedMozoId = fromTable.mozo_id;
  const namesToFetch = [ctx.userId, movedMozoId].filter(
    (x): x is string => !!x,
  );
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", business.id)
    .in("user_id", namesToFetch);
  const nameById = new Map<string, string>();
  for (const m of (members ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>) {
    if (m.full_name) nameById.set(m.user_id, m.full_name);
  }

  const movedPayload = {
    fromTableId,
    toTableId,
    fromLabel: fromTable.label,
    toLabel: toTable.label,
    movedBy: ctx.userId,
    movedByName: nameById.get(ctx.userId) ?? null,
  };

  await createNotification({
    businessId: business.id,
    targetRole: "encargado",
    type: "mesa.moved",
    payload: movedPayload,
    actorUserId: ctx.userId,
  });
  if (movedMozoId) {
    await createNotification({
      businessId: business.id,
      userId: movedMozoId,
      type: "mesa.moved",
      payload: movedPayload,
      actorUserId: ctx.userId,
    });
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

