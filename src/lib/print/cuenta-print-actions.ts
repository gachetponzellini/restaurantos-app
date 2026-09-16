"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { resolveCuentaPrinter } from "./cuenta-printer";

type GenericClient = SupabaseClient;

/**
 * Encola la impresión de la cuenta de una mesa (spec 080).
 *
 * A diferencia del control de pedido (spec 063), que sale **una** vez por orden,
 * esto se puede pedir las veces que haga falta: la mesa pide la cuenta, agrega
 * un café y la vuelve a pedir. Por eso no hay unicidad por `order_id` para
 * `kind='cuenta'` — cada toque es un papel nuevo con lo que haya en ese momento.
 *
 * La comandera se resuelve **antes** de insertar: si no hay ninguna, el mozo se
 * entera en el acto en vez de quedarse esperando un papel que nunca sale.
 */
export async function imprimirCuenta(
  tableId: string,
  businessSlug: string,
): Promise<ActionResult<{ print_job_id: string; reprint: boolean }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Defensa cross-tenant: `tables` no tiene `business_id`, va vía `floor_plans`
  // — el mismo camino que `loadTableForBusiness`. De paso trae la comandera del
  // salón, que es lo que hay que resolver.
  const { data: tableRow } = await service
    .from("tables")
    .select(
      "id, current_order_id, floor_plans!inner(business_id, name, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled)",
    )
    .eq("id", tableId)
    .maybeSingle();

  if (!tableRow) return actionError("Mesa no encontrada.");

  const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
  const floorPlan = (
    Array.isArray(fpRaw) ? fpRaw[0] : fpRaw
  ) as {
    business_id: string;
    name: string;
    cuenta_printer_ip: string | null;
    cuenta_printer_port: number | null;
    cuenta_printer_enabled: boolean | null;
  } | null;

  if (!floorPlan || floorPlan.business_id !== business.id) {
    return actionError("Mesa no encontrada.");
  }

  const orderId = (tableRow as { current_order_id: string | null })
    .current_order_id;
  if (!orderId) return actionError("La mesa no tiene una cuenta abierta.");

  const { data: orderRow } = await service
    .from("orders")
    .select("id, business_id, lifecycle_status, total_cents")
    .eq("id", orderId)
    .maybeSingle();

  const order = orderRow as {
    business_id: string;
    lifecycle_status: string;
    total_cents: number;
  } | null;
  if (!order || order.business_id !== business.id) {
    return actionError("La cuenta de la mesa no existe.");
  }
  if (order.lifecycle_status !== "open") {
    return actionError("La cuenta ya está cerrada.");
  }
  if ((order.total_cents ?? 0) <= 0) {
    return actionError("La mesa todavía no consumió nada.");
  }

  const printer = resolveCuentaPrinter(floorPlan, {
    cuenta_printer_ip: (business as { cuenta_printer_ip?: string | null })
      .cuenta_printer_ip,
    cuenta_printer_port: (business as { cuenta_printer_port?: number | null })
      .cuenta_printer_port,
    cuenta_printer_enabled: (
      business as { cuenta_printer_enabled?: boolean | null }
    ).cuenta_printer_enabled,
  });
  if (!printer) {
    return actionError(
      `No hay comandera de cuentas configurada para ${floorPlan.name}. Configurala en Ajustes → Operación del local.`,
    );
  }

  // ¿Ya se imprimió antes esta cuenta? Entonces el papel sale marcado como
  // reimpresión, para que la mesa no termine con dos tickets distintos sin
  // saber cuál vale.
  const { count: previos } = await service
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("kind", "cuenta");
  const reprint = (previos ?? 0) > 0;

  const { data: inserted, error } = await service
    .from("print_jobs")
    .insert({
      order_id: orderId,
      business_id: business.id,
      kind: "cuenta",
      requested_by: ctx.userId ?? null,
      reprint_requested_at: reprint ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    console.error("imprimirCuenta", error);
    return actionError("No pudimos mandar la cuenta a la impresora.");
  }

  return actionOk({
    print_job_id: (inserted as { id: string }).id,
    reprint,
  });
}

/**
 * Imprimir la cuenta de un pedido online (tab Pedidos). Mismo `print_job` de
 * `kind='cuenta'` que el de la mesa, pero sin salón: sale por la comandera de
 * cuentas del negocio.
 */
export async function imprimirCuentaPedido(
  orderId: string,
  businessSlug: string,
): Promise<ActionResult<{ print_job_id: string; reprint: boolean }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: orderRow } = await service
    .from("orders")
    .select("id, business_id, lifecycle_status, total_cents")
    .eq("id", orderId)
    .maybeSingle();

  const order = orderRow as {
    business_id: string;
    lifecycle_status: string;
    total_cents: number;
  } | null;
  if (!order || order.business_id !== business.id) {
    return actionError("Pedido no encontrado.");
  }
  // El pedido online se imprime también entregado/cobrado: sólo el anulado no.
  if (order.lifecycle_status === "cancelled") {
    return actionError("El pedido está anulado.");
  }
  if ((order.total_cents ?? 0) <= 0) {
    return actionError("El pedido no tiene nada cargado.");
  }

  const printer = resolveCuentaPrinter(null, {
    cuenta_printer_ip: (business as { cuenta_printer_ip?: string | null })
      .cuenta_printer_ip,
    cuenta_printer_port: (business as { cuenta_printer_port?: number | null })
      .cuenta_printer_port,
    cuenta_printer_enabled: (
      business as { cuenta_printer_enabled?: boolean | null }
    ).cuenta_printer_enabled,
  });
  if (!printer) {
    return actionError(
      "No hay comandera de cuentas configurada. Configurala en Ajustes → Operación del local.",
    );
  }

  const { count: previos } = await service
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("kind", "cuenta");
  const reprint = (previos ?? 0) > 0;

  const { data: inserted, error } = await service
    .from("print_jobs")
    .insert({
      order_id: orderId,
      business_id: business.id,
      kind: "cuenta",
      requested_by: ctx.userId ?? null,
      reprint_requested_at: reprint ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    console.error("imprimirCuentaPedido", error);
    return actionError("No pudimos mandar la cuenta a la impresora.");
  }

  return actionOk({
    print_job_id: (inserted as { id: string }).id,
    reprint,
  });
}
