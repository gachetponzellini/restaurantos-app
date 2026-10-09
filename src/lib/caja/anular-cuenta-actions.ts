"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { puedeAnularCuentaCerrada, type OrdenParaSaldo } from "@/lib/billing/saldo-pendiente";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { bloqueoPorPlata } from "@/lib/orders/cancel-guards";
import { cancelarOrden } from "@/lib/orders/cancel-order";
import { canCancelItem } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

const Input = z.object({
  orderId: z.string().uuid(),
  motivo: z.string().trim().min(1, "El motivo es obligatorio.").max(500),
  slug: z.string().min(1),
});

/**
 * Anular una mesa que ya se cerró (spec 215).
 *
 * El caso: la mesa 14 de KCC se cobró por fuera (Factura A en MaxiRest); la
 * encargada anuló el cobro y la cuenta quedó «cerrada con saldo» en Por cobrar,
 * sin forma de darla de baja y trabando el «Rendir» del mozo.
 *
 * Es la segunda mitad del camino de la spec 092 —primero se anula el cobro,
 * después la mesa— para una mesa que ya se liberó. Las guardas son las mismas
 * que las de «Anular mesa»: sin cobros vivos y sin factura real.
 */
export async function anularCuentaCerrada(input: {
  orderId: string;
  motivo: string;
  slug: string;
}): Promise<ActionResult<void>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const { orderId, motivo, slug } = parsed.data;

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (!canCancelItem(ctx.role)) {
    return actionError("Solo encargado o admin pueden anular una mesa.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  const { data: orderRow } = await service
    .from("orders")
    .select("id, lifecycle_status, status, total_cents, total_paid_cents")
    .eq("id", orderId)
    .eq("business_id", business.id)
    .maybeSingle();
  const order = orderRow as (OrdenParaSaldo & { id: string }) | null;
  if (!order) return actionError("No se encontró la cuenta.");

  const noSe = puedeAnularCuentaCerrada(order);
  if (noSe) return actionError(noSe);

  const bloqueo = await bloqueoPorPlata(service, [order.id]);
  if (bloqueo) return actionError(bloqueo);

  // Lo pagado se recalcula desde `payments` antes de escribir: la guarda de la
  // escritura mira `total_paid_cents`, y un valor desfasado dejaría la cuenta
  // trabada justo en el caso que esto viene a resolver.
  await service.rpc("recalcular_pagado_orden", { p_order_id: order.id });

  const r = await cancelarOrden(service, {
    orderId: order.id,
    businessId: business.id,
    motivo,
    actorUserId: ctx.userId,
    nowIso: new Date().toISOString(),
    desdeCerrada: true,
  });
  if (!r.cancelled) {
    const { data: ahora } = await service
      .from("orders")
      .select("lifecycle_status")
      .eq("id", order.id)
      .eq("business_id", business.id)
      .maybeSingle();
    return actionError(
      (ahora as { lifecycle_status: string } | null)?.lifecycle_status === "cancelled"
        ? "La cuenta ya está anulada."
        : "Entró un cobro mientras la anulabas. Revisala y probá de nuevo.",
    );
  }

  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/admin/caja/movimientos`);
  revalidatePath(`/${slug}/mozo`);
  return actionOk(undefined);
}
