// @vitest-environment node
//
// Auditoría de pedidos · MEDIA — un cupón no se gasta con un pedido cancelado.
//
// `uses_count` subía al crear el pedido y no bajaba nunca: un pedido de MP que
// nadie pagó (o que el cliente canceló) consumía un cupón de un solo uso, y se
// podía agotar `max_uses` sin pagar nada. Ahora la cancelación devuelve el uso,
// una sola vez aunque la cascada corra dos veces.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cupon-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { cancelarOrden, cancelDownstream } = await import("./cancel-order");

describe.skipIf(!dbAvailable)("cupón devuelto al cancelar (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let promoId: string;

  const usos = async () => {
    const { data } = await supabase.from("promo_codes").select("uses_count").eq("id", promoId).single();
    return data!.uses_count as number;
  };

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cupon Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: promo, error } = await supabase
      .from("promo_codes")
      .insert({ business_id: businessId, code: "UNAVEZ", discount_type: "percentage", discount_value: 10, max_uses: 1, uses_count: 1 })
      .select("id")
      .single();
    if (error) throw error;
    promoId = promo!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("cancelar el pedido devuelve el uso, una sola vez", async () => {
    const { data: o, error } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "pickup", subtotal_cents: 1000, total_cents: 900, discount_cents: 100,
        lifecycle_status: "open", status: "pending", payment_status: "pending", payment_method: "mp",
        promo_code_id: promoId,
      })
      .select("id")
      .single();
    if (error) throw error;

    expect(await usos()).toBe(1);
    const r = await cancelarOrden(supabase as never, {
      orderId: o!.id, businessId, motivo: "Pago no completado", actorUserId: null,
    });
    expect(r.cancelled).toBe(true);
    expect(await usos()).toBe(0);

    // La cascada puede correr de nuevo (otro camino, un reintento): no resta dos veces.
    await cancelDownstream(supabase as never, { orderId: o!.id, motivo: "x", actorUserId: null });
    expect(await usos()).toBe(0);
  });
});
