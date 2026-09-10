import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calculateTotals, sumActiveItems } from "./totals";
import type { CuentaItem, CuentaState, OrderSplit } from "./types";

/**
 * Carga el estado completo de la cuenta de una mesa para renderizar la
 * pantalla `/mozo/mesa/[id]/cuenta` o `/cobrar`.
 *
 * Cross-tenant: tables → floor_plans → business_id, y orders se filtra por
 * business_id. Devuelve null si la mesa no es del business o no tiene order
 * abierta.
 */
export async function getCuentaForTable(
  tableId: string,
  businessId: string,
): Promise<CuentaState | null> {
  const service = createSupabaseServiceClient();

  // 1. Resolver mesa + business via floor_plans (defense cross-tenant).
  const { data: tableRow } = await service
    .from("tables")
    .select("id, floor_plans!inner(business_id)")
    .eq("id", tableId)
    .maybeSingle();
  if (!tableRow) return null;
  const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== businessId) return null;

  // 2. Order abierta de la mesa.
  const { data: orderRow } = await service
    .from("orders")
    .select(
      "id, business_id, order_number, table_id, tip_cents, discount_cents, discount_reason, lifecycle_status, status, total_cents, closed_at, total_paid_cents",
    )
    .eq("table_id", tableId)
    .eq("business_id", businessId)
    .eq("lifecycle_status", "open")
    .maybeSingle();
  if (!orderRow) return null;
  const order = orderRow as CuentaState["order"];

  // 3. Items + splits en paralelo.
  const [itemsRes, splitsRes] = await Promise.all([
    service
      .from("order_items")
      // `seat_number` es necesario para la tab "dividir por comensal" y el badge
      // "Comensal N" (spec 36 · R-F1): sin él, la UI recibía undefined y la
      // feature quedaba inalcanzable pese a estar implementada.
      .select(
        "id, product_name, quantity, subtotal_cents, notes, station_id, seat_number, cancelled_at, loaded_by, unit_price_cents, price_original_cents, price_override_reason",
      )
      .eq("order_id", order.id)
      .order("id", { ascending: true }),
    service
      .from("order_splits")
      .select(
        "id, order_id, business_id, split_mode, split_index, expected_amount_cents, tip_cents, paid_amount_cents, status, label",
      )
      .eq("order_id", order.id)
      .order("split_index", { ascending: true }),
  ]);

  const items = (itemsRes.data ?? []) as CuentaItem[];
  const splits = (splitsRes.data ?? []) as OrderSplit[];

  // 4. Totales server-side (no confiar en `orders.total_cents` por si quedó
  //    desactualizado tras un cancelarItem).
  const subtotal = sumActiveItems(items);
  const totals = calculateTotals({
    subtotal_cents: subtotal,
    tip_cents: order.tip_cents,
    discount_cents: order.discount_cents,
  });

  // 5. last_mozo_id: el loaded_by del último item activo cargado en la
  //    order. Sirve para atribuir la propina al cobrar.
  const last_mozo_id =
    items
      .filter((it) => it.cancelled_at === null && it.loaded_by !== null)
      .reduce<string | null>((acc, it) => it.loaded_by, null);

  return {
    order,
    items,
    splits,
    totals,
    last_mozo_id,
  };
}
