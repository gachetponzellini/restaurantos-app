import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Qué ficha de cliente (`customers`) lleva un pedido (auditoría de pedidos ·
 * ALTA).
 *
 * Antes era un upsert por `(business_id, phone)` que le pegaba el `user_id` del
 * que estaba logueado. Dos agujeros:
 * - Tipear el teléfono de otro te daba su ficha: su historial, sus pedidos
 *   pendientes para cancelar y sus cupones personales.
 * - Cambiar el propio teléfono chocaba con la unique `(business_id, user_id)`:
 *   «No pudimos guardar tus datos» y no se podía pedir.
 *
 * Con cuenta (`userId`, checkout público):
 * 1. La ficha de ESA cuenta manda. Si cambió el teléfono se le actualiza; si el
 *    nuevo ya es de otra ficha, se deja el anterior (el pedido guarda igual el
 *    teléfono tipeado en `orders.customer_phone`).
 * 2. Sin ficha propia: una ficha con ese teléfono y SIN cuenta (la cargó el
 *    staff) se liga — es la misma persona que ahora se registró.
 * 3. Una ficha con ese teléfono ligada a OTRA cuenta no se toca: error claro.
 *
 * Sin cuenta (staff, o sin login): por teléfono como siempre, sin tocar
 * `user_id` — una columna ausente no se pisa en el upsert.
 */
export type ResolverClienteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export const TELEFONO_DE_OTRA_CUENTA =
  "Ese teléfono ya está registrado con otra cuenta en este local. Usá otro número o entrá con esa cuenta.";

export async function resolverClienteDelPedido(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    /** Sólo si el pedido lo hace el propio cliente logueado (no el staff). */
    userId: string | null;
    phoneKey: string;
    name: string;
    email: string | null;
  },
): Promise<ResolverClienteResult> {
  const { businessId, userId, phoneKey, name, email } = params;

  if (!userId) {
    const { data, error } = await supabase
      .from("customers")
      .upsert(
        { business_id: businessId, phone: phoneKey, name, email },
        { onConflict: "business_id,phone" },
      )
      .select("id")
      .single();
    if (error || !data) {
      console.error("resolverClienteDelPedido · upsert por teléfono", error);
      return { ok: false, error: "No pudimos guardar tus datos." };
    }
    return { ok: true, id: (data as { id: string }).id };
  }

  // 1. La ficha de esta cuenta.
  const { data: propia } = await supabase
    .from("customers")
    .select("id, phone")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (propia) {
    const p = propia as { id: string; phone: string | null };
    await supabase.from("customers").update({ name, email }).eq("id", p.id);
    if (p.phone !== phoneKey) {
      const { error } = await supabase
        .from("customers")
        .update({ phone: phoneKey })
        .eq("id", p.id);
      // 23505: el teléfono nuevo ya es de otra ficha. Se queda con el suyo.
      if (error && error.code !== "23505") {
        console.error("resolverClienteDelPedido · cambio de teléfono", error);
      }
    }
    return { ok: true, id: p.id };
  }

  // 2 y 3. Una ficha con ese teléfono.
  const { data: porTelefono } = await supabase
    .from("customers")
    .select("id, user_id")
    .eq("business_id", businessId)
    .eq("phone", phoneKey)
    .maybeSingle();
  if (porTelefono) {
    const t = porTelefono as { id: string; user_id: string | null };
    if (t.user_id && t.user_id !== userId) {
      return { ok: false, error: TELEFONO_DE_OTRA_CUENTA };
    }
    await supabase
      .from("customers")
      .update({ user_id: userId, name, email })
      .eq("id", t.id);
    return { ok: true, id: t.id };
  }

  // Cliente nuevo.
  const { data: nueva, error } = await supabase
    .from("customers")
    .insert({ business_id: businessId, user_id: userId, phone: phoneKey, name, email })
    .select("id")
    .single();
  if (error || !nueva) {
    console.error("resolverClienteDelPedido · alta", error);
    return { ok: false, error: "No pudimos guardar tus datos." };
  }
  return { ok: true, id: (nueva as { id: string }).id };
}

/**
 * La ficha que valida un cupón personal: la de la cuenta logueada si la hay
 * (no la del teléfono tipeado, que podía ser de otro); sin cuenta, la del
 * teléfono, como antes.
 */
export async function clienteParaCupon(
  supabase: SupabaseClient,
  params: { businessId: string; userId: string | null; phoneKey: string },
): Promise<string | null> {
  const q = supabase.from("customers").select("id").eq("business_id", params.businessId);
  const { data } = params.userId
    ? await q.eq("user_id", params.userId).maybeSingle()
    : await q.eq("phone", params.phoneKey).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
