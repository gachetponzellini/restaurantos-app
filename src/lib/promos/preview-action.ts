"use server";

import { headers } from "next/headers";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { limitCreateOrder } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { validatePromoCode } from "./validate";

/**
 * Server action used by the checkout UI to preview a promo code BEFORE the
 * customer submits the order. Pure read — does NOT increment uses_count.
 *
 * The actual validation + increment happens atomically inside persist-order
 * when the order is created. This action is ergonomic only — it lets us show
 * "✓ VUELVE10 · -$1500" while the customer is still editing.
 */
export async function previewPromoCode(input: {
  business_slug: string;
  code: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
}): Promise<
  ActionResult<{
    code: string;
    discount_cents: number;
    free_shipping: boolean;
  }>
> {
  if (!input.code?.trim()) return actionError("Ingresá un código.");
  // Auditoría de pedidos · baja — sin techo, se podían probar códigos por
  // fuerza bruta. Mismo límite que crear un pedido.
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success: allowed } = await limitCreateOrder(ip);
  if (!allowed) return actionError("Demasiados intentos, esperá un minuto.");
  const service = createSupabaseServiceClient();

  // Resolve business
  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", input.business_slug)
    .maybeSingle();
  if (!business) return actionError("Negocio no encontrado.");

  // Cliente autenticado (si hay) para validar códigos personales en el preview
  // (spec 36 · R-D1). Anónimo = null → un código personal ajeno se muestra como
  // inválido, coherente con lo que hará el checkout.
  const authed = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  let customerId: string | null = null;
  if (user) {
    const { data: cust } = await service
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .eq("business_id", business.id)
      .maybeSingle();
    customerId = (cust as { id: string } | null)?.id ?? null;
  }

  const result = await validatePromoCode(service, {
    businessId: business.id,
    code: input.code,
    subtotalCents: input.subtotal_cents,
    deliveryFeeCents: input.delivery_fee_cents,
    customerId,
  });

  if (!result.ok) return actionError(result.error);
  return actionOk({
    code: result.promo.code,
    discount_cents: result.promo.discount_cents,
    free_shipping: result.promo.free_shipping,
  });
}
