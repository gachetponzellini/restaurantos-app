// @vitest-environment node
//
// Auditoría de pedidos · ALTA — el checkout público no toma pedidos inmediatos
// con el local cerrado (antes: a las 3 am un pago de MP se marchaba solo).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { toZonedTime } from "date-fns-tz";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const TEST_TAG = `test-cerrado-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { persistOrder } = await import("./persist-order");

describe.skipIf(!dbAvailable)("persistOrder · local cerrado (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let productId: string;

  beforeAll(async () => {
    const { data: biz, error } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cerrado Test", is_active: true, timezone: "America/Argentina/Buenos_Aires" })
      .select("id")
      .single();
    if (error) throw error;
    businessId = biz!.id;
    const { data: cat } = await supabase
      .from("categories")
      .insert({ business_id: businessId, name: "Platos", slug: "platos" })
      .select("id")
      .single();
    const { data: prod, error: pErr } = await supabase
      .from("products")
      .insert({ business_id: businessId, category_id: cat!.id, name: "Milanesa", slug: "milanesa", price_cents: 1_000_000 })
      .select("id")
      .single();
    if (pErr) throw pErr;
    productId = prod!.id;
    // Horario SÓLO otro día de la semana: cerrado ahora, a cualquier hora que
    // corra el test.
    const hoy = toZonedTime(new Date(), "America/Argentina/Buenos_Aires").getDay();
    await supabase.from("business_hours").insert({
      business_id: businessId,
      day_of_week: (hoy + 3) % 7,
      opens_at: "11:00:00",
      closes_at: "23:00:00",
    });
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("rechaza el pedido inmediato con el local cerrado, y no crea nada", async () => {
    const r = await persistOrder({
      business_slug: TEST_TAG,
      delivery_type: "pickup",
      customer_name: "Cliente",
      customer_phone: "+5493511234567",
      items: [{ product_id: productId, quantity: 1, modifier_ids: [] }],
    } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cerrado/i);
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId);
    expect(count).toBe(0);
  });

  it("el staff sí puede cargarlo (mozoId)", async () => {
    const r = await persistOrder(
      {
        business_slug: TEST_TAG,
        delivery_type: "pickup",
        customer_name: "Cliente",
        customer_phone: "+5493511234567",
        items: [{ product_id: productId, quantity: 1, modifier_ids: [] }],
      } as never,
      null,
      { source: "staff" },
    );
    if (!r.ok) expect(r.error).not.toMatch(/cerrado/i);
  });
});
