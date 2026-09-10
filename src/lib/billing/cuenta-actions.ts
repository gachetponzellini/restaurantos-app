"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { encolarReimpresionDeItem } from "@/lib/comandas/reprint";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { notifyItemCancelled } from "@/lib/notifications/events";
import { canApplyDiscount, canCancelItem } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  calculateTotals,
  expectedByAmounts,
  expectedBySplitItems,
  groupItemsBySeat,
  prorrateEqualSplits,
  prorratearPropina,
  sumActiveItems,
} from "./totals";
import type { CuentaItem, OrderSplit, SplitMode } from "./types";

type GenericClient = SupabaseClient;

// ── Helpers ────────────────────────────────────────────────────

type LoadedOrder = {
  id: string;
  business_id: string;
  lifecycle_status: "open" | "closed" | "cancelled";
  tip_cents: number;
  discount_cents: number;
  discount_reason: string | null;
};

async function loadOrderForBusiness(
  service: GenericClient,
  orderId: string,
  businessId: string,
): Promise<LoadedOrder | null> {
  const { data } = await service
    .from("orders")
    .select(
      "id, business_id, lifecycle_status, tip_cents, discount_cents, discount_reason",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;
  const row = data as LoadedOrder;
  if (row.business_id !== businessId) return null;
  return row;
}

async function loadActiveItems(
  service: GenericClient,
  orderId: string,
): Promise<CuentaItem[]> {
  const { data } = await service
    .from("order_items")
    .select(
      "id, product_name, quantity, subtotal_cents, notes, station_id, cancelled_at, loaded_by, seat_number",
    )
    .eq("order_id", orderId);
  return (data ?? []) as CuentaItem[];
}

async function recalcOrderTotals(
  service: GenericClient,
  orderId: string,
  patch: { tip_cents?: number; discount_cents?: number; discount_reason?: string | null },
): Promise<{ total_cents: number }> {
  const items = await loadActiveItems(service, orderId);
  // Tomamos el order actualizado para tip/discount sólidos.
  const { data: orderRow } = await service
    .from("orders")
    .select("tip_cents, discount_cents")
    .eq("id", orderId)
    .single();
  const tip_cents = patch.tip_cents ?? (orderRow!.tip_cents as number);
  const discount_cents = patch.discount_cents ?? (orderRow!.discount_cents as number);
  const totals = calculateTotals({
    subtotal_cents: sumActiveItems(items),
    tip_cents,
    discount_cents,
  });
  await service
    .from("orders")
    .update({
      total_cents: totals.total_cents,
      ...(patch.tip_cents !== undefined && { tip_cents: patch.tip_cents }),
      ...(patch.discount_cents !== undefined && { discount_cents: patch.discount_cents }),
      ...(patch.discount_reason !== undefined && { discount_reason: patch.discount_reason }),
    })
    .eq("id", orderId);
  return { total_cents: totals.total_cents };
}

/**
 * Limpia los splits de una orden **sin perder los que ya tienen pagos** (spec
 * 094 · H-10).
 *
 * Antes esto era un `DELETE` liso de todos los splits. El FK de `payments` es
 * `ON DELETE SET NULL`, así que no fallaba: **los pagos sobrevivían sin
 * vínculo**. Combinado con H-07 (`total_paid_cents` en 0), no quedaba ningún
 * registro consultable de que alguien ya había pagado.
 *
 * Lo que se veía: mesa de 4 dividida en $10.000; uno paga y se va; después
 * piden sacar un plato. Al anular el ítem se borraban los 4 splits, incluido el
 * cobrado, y la pantalla volvía a mostrar la cuenta entera pendiente → **el que
 * ya pagó paga dos veces**.
 *
 * El propio código sabía del peligro: `limpiarDivision` marcaba `cancelled` los
 * splits con pagos en vez de borrarlos. Esto es esa lógica, extraída, para que
 * la usen los tres callers y no sólo uno.
 */
async function deleteSplitsAndItems(
  service: GenericClient,
  orderId: string,
): Promise<void> {
  const { data: paySplits } = await service
    .from("payments")
    .select("split_id")
    .eq("order_id", orderId);
  const conPagos = [
    ...new Set(
      (paySplits ?? [])
        .map((p) => (p as { split_id: string | null }).split_id)
        .filter((s): s is string => s !== null),
    ),
  ];

  if (conPagos.length === 0) {
    // ON DELETE CASCADE en order_split_items vía FK a splits.
    await service.from("order_splits").delete().eq("order_id", orderId);
    return;
  }

  // Los que tienen plata asentada se conservan como `cancelled`: la fila es el
  // único rastro de a qué se imputó ese pago.
  await service
    .from("order_splits")
    .update({ status: "cancelled" })
    .eq("order_id", orderId)
    .in("id", conPagos);

  // El resto sí se borra.
  await service
    .from("order_splits")
    .delete()
    .eq("order_id", orderId)
    .not("id", "in", `(${conPagos.map((id) => `"${id}"`).join(",")})`);
}

// ── Propina + descuento ───────────────────────────────────────

export async function aplicarPropinaYDescuento(
  orderId: string,
  input: {
    tip_cents: number;
    discount_cents: number;
    discount_reason: string | null;
  },
  businessSlug: string,
): Promise<ActionResult<{ total_cents: number }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (input.tip_cents < 0) return actionError("La propina no puede ser negativa.");
  if (input.discount_cents < 0) return actionError("El descuento no puede ser negativo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrderForBusiness(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  // Validar permiso de descuento server-side (R3 de CU-03).
  if (input.discount_cents > 0) {
    const items = await loadActiveItems(service, orderId);
    const subtotal = sumActiveItems(items);
    if (subtotal === 0) return actionError("No hay items activos para descontar.");
    const percent = (input.discount_cents / subtotal) * 100;
    if (!canApplyDiscount(ctx.role, percent)) {
      return actionError(
        `Tu rol no permite descuentos de ${percent.toFixed(1)}%. Pedile al encargado.`,
      );
    }
    if (!input.discount_reason || input.discount_reason.trim() === "") {
      return actionError("El descuento requiere un motivo.");
    }
  }

  const reason =
    input.discount_cents > 0 && input.discount_reason
      ? input.discount_reason.trim()
      : null;

  const { total_cents } = await recalcOrderTotals(service, orderId, {
    tip_cents: input.tip_cents,
    discount_cents: input.discount_cents,
    discount_reason: reason,
  });

  // Si había splits, los invalidamos: hay que volver a dividir con los
  // nuevos números (R8 de CU-03 — la última división gana, pero un cambio
  // de tip/discount cambia los expected por split).
  await deleteSplitsAndItems(service, orderId);

  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk({ total_cents });
}

// ── Cancelar item desde la cuenta ─────────────────────────────

export async function cancelarItemEnCuenta(
  orderItemId: string,
  motivo: string,
  businessSlug: string,
): Promise<ActionResult<{ total_cents: number }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canCancelItem(ctx.role)) {
    return actionError("Solo encargado o admin pueden cancelar items.");
  }
  if (!motivo || motivo.trim() === "") {
    return actionError("Cancelar item requiere un motivo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: itemRow } = await service
    .from("order_items")
    .select("id, order_id, cancelled_at, orders!inner(business_id, lifecycle_status)")
    .eq("id", orderItemId)
    .maybeSingle();
  if (!itemRow) return actionError("Item no encontrado.");

  const ordersRaw = (itemRow as unknown as { orders: unknown }).orders;
  const orderInfo = Array.isArray(ordersRaw)
    ? (ordersRaw[0] as { business_id: string; lifecycle_status: string })
    : (ordersRaw as { business_id: string; lifecycle_status: string });
  if (!orderInfo || orderInfo.business_id !== business.id) {
    return actionError("Item no encontrado.");
  }
  if (orderInfo.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  const orderId = (itemRow as { order_id: string }).order_id;
  const already = (itemRow as { cancelled_at: string | null }).cancelled_at;
  if (already) {
    return actionError("El item ya está cancelado.");
  }

  await service
    .from("order_items")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: motivo.trim(),
      cancelled_by: ctx.userId, // spec 34 — responsable de la anulación
    })
    .eq("id", orderItemId);

  // spec 095 · H-36 — avisarle a la comandera. Este camino (sacar un plato
  // desde la pantalla de cuenta) tampoco encolaba la reimpresión: cocina se
  // quedaba con el papel colgado y mandaba el plato igual.
  await encolarReimpresionDeItem(service, orderItemId);

  // Splits previos quedan inválidos.
  await deleteSplitsAndItems(service, orderId);
  const { total_cents } = await recalcOrderTotals(service, orderId, {});

  // spec 27 — avisar al mozo de la mesa que se anuló un ítem.
  await notifyItemCancelled({
    businessId: business.id,
    orderId,
    reason: motivo.trim(),
    actorUserId: ctx.userId,
    actorRole: ctx.role,
  });

  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk({ total_cents });
}

// ── Dividir cuenta ────────────────────────────────────────────

async function persistSplits(
  service: GenericClient,
  orderId: string,
  businessId: string,
  mode: SplitMode,
  expecteds: Array<{ split_index: number; expected_amount_cents: number; label?: string | null }>,
  itemsByIndex: Map<number, string[]> | null,
  tipCents: number,
): Promise<OrderSplit[]> {
  await deleteSplitsAndItems(service, orderId);

  // Spec 177 · Parte 0 — cuánta propina cubre cada sub-cuenta, congelada acá.
  // Las pantallas de cobro leían `orders.tip_cents` entero por tarjeta, así que
  // una cuenta dividida registraba la propina una vez por sub-cuenta.
  const propinas = prorratearPropina(
    tipCents,
    expecteds.map((e) => e.expected_amount_cents),
  );

  const rowsToInsert = expecteds.map((e, i) => ({
    order_id: orderId,
    business_id: businessId,
    split_mode: mode,
    split_index: e.split_index,
    expected_amount_cents: e.expected_amount_cents,
    tip_cents: propinas[i] ?? 0,
    paid_amount_cents: 0,
    status: "pending" as const,
    label: e.label ?? null,
  }));

  const { data: inserted, error } = await service
    .from("order_splits")
    .insert(rowsToInsert)
    .select(
      "id, order_id, business_id, split_mode, split_index, expected_amount_cents, tip_cents, paid_amount_cents, status, label",
    );
  if (error) throw new Error(error.message);

  const splits = (inserted ?? []) as OrderSplit[];

  if ((mode === "por_items" || mode === "por_comensal") && itemsByIndex) {
    const splitIdByIndex = new Map(splits.map((s) => [s.split_index, s.id]));
    const itemsRows: Array<{ split_id: string; order_item_id: string }> = [];
    for (const [idx, ids] of itemsByIndex.entries()) {
      const splitId = splitIdByIndex.get(idx);
      if (!splitId) continue;
      for (const oid of ids) {
        itemsRows.push({ split_id: splitId, order_item_id: oid });
      }
    }
    if (itemsRows.length > 0) {
      const { error: e2 } = await service
        .from("order_split_items")
        .insert(itemsRows);
      if (e2) throw new Error(e2.message);
    }
  }

  return splits;
}

export async function dividirPorPersonas(
  orderId: string,
  count: number,
  businessSlug: string,
): Promise<ActionResult<{ splits: OrderSplit[] }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  if (count < 2 || count > 20) {
    return actionError("La cantidad de personas debe estar entre 2 y 20.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrderForBusiness(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  const items = await loadActiveItems(service, orderId);
  if (items.length === 0 || sumActiveItems(items) === 0) {
    return actionError("No hay items para dividir.");
  }

  const totals = calculateTotals({
    subtotal_cents: sumActiveItems(items),
    tip_cents: order.tip_cents,
    discount_cents: order.discount_cents,
  });

  const portions = prorrateEqualSplits(totals.total_cents, count);
  const expecteds = portions.map((amt, i) => ({
    split_index: i + 1,
    expected_amount_cents: amt,
  }));

  try {
    const splits = await persistSplits(
      service,
      orderId,
      business.id,
      "por_personas",
      expecteds,
      null,
      order.tip_cents,
    );
    revalidatePath(`/${businessSlug}/mozo`);
    return actionOk({ splits });
  } catch (e) {
    return actionError(`No se pudieron crear los splits: ${(e as Error).message}`);
  }
}

export async function dividirPorItems(
  orderId: string,
  mapping: Record<number, string[]>,
  businessSlug: string,
): Promise<ActionResult<{ splits: OrderSplit[] }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const indices = Object.keys(mapping).map(Number).sort((a, b) => a - b);
  if (indices.length < 2) {
    return actionError("Tenés que dividir en al menos 2 sub-cuentas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrderForBusiness(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  const items = await loadActiveItems(service, orderId);
  const activeIds = new Set(
    items.filter((it) => it.cancelled_at === null).map((it) => it.id),
  );

  // Validar: cada item activo asignado a exactamente 1 split (R6 de CU-03).
  const seen = new Set<string>();
  for (const idx of indices) {
    for (const id of mapping[idx]) {
      if (!activeIds.has(id)) {
        return actionError("Hay items en la división que no son válidos.");
      }
      if (seen.has(id)) {
        return actionError("Un item está asignado a dos sub-cuentas.");
      }
      seen.add(id);
    }
  }
  for (const id of activeIds) {
    if (!seen.has(id)) {
      return actionError("Hay items sin asignar a ninguna sub-cuenta.");
    }
  }

  const mappingMap = new Map<number, string[]>(
    indices.map((i) => [i, mapping[i]]),
  );
  const expecteds = expectedBySplitItems({
    items,
    mapping: mappingMap,
    tip_cents: order.tip_cents,
    discount_cents: order.discount_cents,
  });

  try {
    const splits = await persistSplits(
      service,
      orderId,
      business.id,
      "por_items",
      expecteds,
      mappingMap,
      order.tip_cents,
    );
    revalidatePath(`/${businessSlug}/mozo`);
    return actionOk({ splits });
  } catch (e) {
    return actionError(`No se pudieron crear los splits: ${(e as Error).message}`);
  }
}

export async function dividirPorComensal(
  orderId: string,
  businessSlug: string,
): Promise<ActionResult<{ splits: OrderSplit[] }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrderForBusiness(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  const items = await loadActiveItems(service, orderId);
  if (items.length === 0 || sumActiveItems(items) === 0) {
    return actionError("No hay items para dividir.");
  }

  const bySeat = groupItemsBySeat(items);
  if (bySeat.size < 2 && !bySeat.has(null)) {
    return actionError("Se necesitan al menos 2 comensales para dividir.");
  }

  const mapping = new Map<number, string[]>();
  const labels = new Map<number, string>();
  let splitIndex = 1;

  const seatNumbers = Array.from(bySeat.keys())
    .filter((k): k is number => k !== null)
    .sort((a, b) => a - b);

  for (const seatNum of seatNumbers) {
    const seatItems = bySeat.get(seatNum)!;
    mapping.set(splitIndex, seatItems.map((it) => it.id));
    labels.set(splitIndex, `Comensal ${seatNum}`);
    splitIndex++;
  }

  const unassigned = bySeat.get(null);
  if (unassigned && unassigned.length > 0) {
    mapping.set(splitIndex, unassigned.map((it) => it.id));
    labels.set(splitIndex, "Sin asignar");
  }

  if (mapping.size < 2) {
    return actionError("Se necesitan al menos 2 sub-cuentas para dividir.");
  }

  const expecteds = expectedBySplitItems({
    items,
    mapping,
    tip_cents: order.tip_cents,
    discount_cents: order.discount_cents,
  });

  const expectedsWithLabels = expecteds.map((e) => ({
    ...e,
    label: labels.get(e.split_index) ?? null,
  }));

  try {
    const splits = await persistSplits(
      service,
      orderId,
      business.id,
      "por_comensal",
      expectedsWithLabels,
      mapping,
      order.tip_cents,
    );
    revalidatePath(`/${businessSlug}/mozo`);
    return actionOk({ splits });
  } catch (e) {
    return actionError(`No se pudieron crear los splits: ${(e as Error).message}`);
  }
}

/**
 * Dividir por monto de dinero: el mozo carga cuánto pone cada uno y el resto
 * queda como última sub-cuenta (ver `expectedByAmounts`). Es el cuarto modo,
 * y el único que no se deriva de los items — los montos los decide la mesa.
 *
 * Es también el camino formal para el pago partido: con el cobro en efectivo
 * bloqueando montos menores a lo que se debe, partir una cuenta deja de ser
 * "cobro un poco menos" y pasa a ser una división explícita, con su expected y
 * su progreso visibles.
 */
export async function dividirPorMonto(
  orderId: string,
  amounts: number[],
  businessSlug: string,
): Promise<ActionResult<{ splits: OrderSplit[] }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrderForBusiness(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  const items = await loadActiveItems(service, orderId);
  if (items.length === 0 || sumActiveItems(items) === 0) {
    return actionError("No hay items para dividir.");
  }

  // El total a repartir es el de la cuenta con propina y descuento ya
  // aplicados — igual que `dividirPorPersonas`. Dividir sobre el subtotal
  // dejaría splits que no suman lo que el cliente tiene que pagar.
  const totals = calculateTotals({
    subtotal_cents: sumActiveItems(items),
    tip_cents: order.tip_cents,
    discount_cents: order.discount_cents,
  });

  const result = expectedByAmounts(totals.total_cents, amounts);
  if (!result.ok) return actionError(result.error);

  const expecteds = result.expecteds.map((amt, i) => ({
    split_index: i + 1,
    expected_amount_cents: amt,
  }));

  try {
    const splits = await persistSplits(
      service,
      orderId,
      business.id,
      "por_monto",
      expecteds,
      null,
      order.tip_cents,
    );
    revalidatePath(`/${businessSlug}/mozo`);
    return actionOk({ splits });
  } catch (e) {
    return actionError(`No se pudieron crear los splits: ${(e as Error).message}`);
  }
}

export async function limpiarDivision(
  orderId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrderForBusiness(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");

  // Si hay payments asociados a algún split → no permitir borrado físico,
  // marcar como cancelled. Sino, delete físico.
  // spec 094 — esta lógica vivía sólo acá y ahora es la de
  // `deleteSplitsAndItems`, así que la usan los tres callers.
  await deleteSplitsAndItems(service, orderId);

  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk(undefined);
}
