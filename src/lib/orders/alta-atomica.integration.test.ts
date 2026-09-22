// @vitest-environment node
//
// Auditoría · baja (#372) — el alta de un pedido no es transaccional.
//
// `persistOrder` inserta la orden y después los ítems uno por uno. Si un ítem
// fallaba, devolvía «No pudimos guardar los productos del pedido» y dejaba
// atrás una orden viva a medio cargar: visible en el tablero, con el cupón
// gastado y con el stock de los ítems que sí entraron ya descontado.
//
// Borrarla no alcanza: el descuento de stock es un trigger AFTER INSERT de
// `order_items` y borrar no lo devuelve. Por eso se CANCELA por el camino común
// (`cancelarOrden`), que devuelve stock y cupón.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-alta-atomica-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let PROMO_ID = "";
vi.mock("@/lib/promos/validate", () => ({
  validatePromoCode: async () => ({
    ok: true,
    promo: { promo_code_id: PROMO_ID, code: "ALTA", discount_cents: 100_000, free_shipping: false },
  }),
}));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

// El cliente real, salvo que el insert del ítem «Falla» devuelve error.
vi.mock("@/lib/supabase/service", () => {
  const real = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const conFalla = new Proxy(real, {
    get(target, prop, recv) {
      if (prop !== "from") return Reflect.get(target, prop, recv);
      return (tabla: string) => {
        const builder = target.from(tabla);
        if (tabla !== "order_items") return builder;
        return new Proxy(builder, {
          get(b, p, r) {
            if (p !== "insert") return Reflect.get(b, p, r);
            return (row: { product_name?: string }) => {
              if (row?.product_name !== "Falla") return b.insert(row as never);
              const error = { message: "boom", code: "XX000" };
              const fallo = { data: null, error };
              return { select: () => ({ single: async () => fallo }), then: (ok: (v: unknown) => unknown) => ok(fallo) };
            };
          },
        });
      };
    },
  }) as SupabaseClient;
  return { createSupabaseServiceClient: () => conFalla };
});

const { persistOrder } = await import("./persist-order");

describe.skipIf(!dbAvailable)("alta atómica del pedido (integration · #372)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let conStockId: string;
  let fallaId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Alta atómica", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: cat } = await supabase.from("categories").insert({ business_id: businessId, name: "P", slug: "p" }).select("id").single();
    const { data: prods, error: prodErr } = await supabase
      .from("products")
      .insert([
        { business_id: businessId, category_id: cat!.id, name: "Coca", slug: "coca", price_cents: 500_000, track_stock: true },
        { business_id: businessId, category_id: cat!.id, name: "Falla", slug: "falla", price_cents: 700_000, track_stock: false },
      ])
      .select("id, name");
    if (prodErr) throw prodErr;
    conStockId = prods!.find((p) => p.name === "Coca")!.id;
    fallaId = prods!.find((p) => p.name === "Falla")!.id;
    await supabase.from("stock_items").insert({ business_id: businessId, product_id: conStockId, current_qty: 10 });
    const { data: promo } = await supabase
      .from("promo_codes")
      .insert({ business_id: businessId, code: "ALTA", discount_type: "fixed_amount", discount_value: 100_000, is_active: true })
      .select("id")
      .single();
    PROMO_ID = promo!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("si un ítem no se guarda, el pedido se cancela y vuelven el stock y el cupón", async () => {
    const r = await persistOrder({
      business_slug: TEST_TAG,
      delivery_type: "pickup",
      customer_name: "Cliente",
      customer_phone: "3511234567",
      payment_method: "cash",
      promo_code: "ALTA",
      items: [
        { product_id: conStockId, quantity: 2, modifier_ids: [] },
        { product_id: fallaId, quantity: 1, modifier_ids: [] },
      ],
    } as never);
    expect(r.ok).toBe(false);

    const { data: ordenes } = await supabase
      .from("orders")
      .select("status, lifecycle_status")
      .eq("business_id", businessId);
    expect(ordenes).toEqual([{ status: "cancelled", lifecycle_status: "cancelled" }]);

    const { data: stock } = await supabase
      .from("stock_items")
      .select("current_qty")
      .eq("product_id", conStockId)
      .single();
    expect(Number(stock!.current_qty)).toBe(10);

    const { data: promo } = await supabase
      .from("promo_codes")
      .select("uses_count")
      .eq("id", PROMO_ID)
      .single();
    expect(promo!.uses_count).toBe(0);
  });
});
