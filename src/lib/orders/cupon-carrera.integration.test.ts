// @vitest-environment node
//
// Auditoría de pedidos · MEDIA — si se pierde la carrera del cupón, MP cobra
// lo que dice la orden.
//
// El incremento del cupón corre después del alta; si falla (otro lo agotó
// entre la validación y el alta), la orden se revierte sin descuento — pero
// la preferencia de MP salía igual con la línea «Descuento»: el cliente pagaba
// de menos y la caja asentaba el total sin descuento.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-carrera-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let PROMO_ID = "";
let ENVIO_GRATIS = false;
// La validación «gana»; el incremento real falla porque el cupón está inactivo
// en la base — el mismo efecto que perder la carrera.
vi.mock("@/lib/promos/validate", () => ({
  validatePromoCode: async () => ({
    ok: true,
    promo: {
      promo_code_id: PROMO_ID,
      code: "CARRERA",
      discount_cents: ENVIO_GRATIS ? 0 : 200_000,
      free_shipping: ENVIO_GRATIS,
    },
  }),
}));
const createPreference = vi.fn(async () => ({ preferenceId: "p", initPoint: "https://mp/x", sandboxInitPoint: "x" }));
vi.mock("@/lib/payments/mercadopago", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/mercadopago")>("@/lib/payments/mercadopago");
  return { ...actual, createPreference: (...a: unknown[]) => createPreference(...(a as [])) };
});
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { persistOrder } = await import("./persist-order");

describe.skipIf(!dbAvailable)("carrera del cupón (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let productId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Carrera", is_active: true, mp_access_token: "APP_USR-x", mp_accepts_payments: true, delivery_fee_cents: 150_000 })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: cat } = await supabase.from("categories").insert({ business_id: businessId, name: "P", slug: "p" }).select("id").single();
    const { data: prod } = await supabase
      .from("products")
      .insert({ business_id: businessId, category_id: cat!.id, name: "Milanesa", slug: "mila", price_cents: 1_000_000 })
      .select("id")
      .single();
    productId = prod!.id;
    const { data: promo } = await supabase
      .from("promo_codes")
      .insert({ business_id: businessId, code: "CARRERA", discount_type: "fixed_amount", discount_value: 200_000, is_active: false })
      .select("id")
      .single();
    PROMO_ID = promo!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("la orden queda sin descuento y MP cobra ese mismo total", async () => {
    const r = await persistOrder({
      business_slug: TEST_TAG,
      delivery_type: "pickup",
      customer_name: "Cliente",
      customer_phone: "3511234567",
      payment_method: "mp",
      promo_code: "CARRERA",
      items: [{ product_id: productId, quantity: 1, modifier_ids: [] }],
    } as never);
    expect(r.ok).toBe(true);

    const { data: o } = await supabase
      .from("orders")
      .select("total_cents, discount_cents, promo_code_id")
      .eq("business_id", businessId)
      .single();
    expect(o).toMatchObject({ total_cents: 1_000_000, discount_cents: 0, promo_code_id: null });

    const items = (createPreference.mock.calls[0] as unknown as [{ items: { id: string; unit_price: number; quantity: number }[] }])[0].items;
    expect(items.find((i) => i.id === "descuento")).toBeUndefined();
    expect(items.reduce((n, i) => n + i.unit_price * i.quantity, 0)).toBe(10_000);
  });

  // Revisión adversarial — con un cupón de envío gratis, perder la carrera
  // dejaba el envío en $0.
  it("con envío gratis, perder la carrera vuelve a cobrar el envío", async () => {
    ENVIO_GRATIS = true;
    createPreference.mockClear();
    const r = await persistOrder({
      business_slug: TEST_TAG,
      delivery_type: "delivery",
      delivery_address: "Calle 123",
      customer_name: "Cliente",
      customer_phone: "3511234567",
      payment_method: "mp",
      promo_code: "CARRERA",
      items: [{ product_id: productId, quantity: 1, modifier_ids: [] }],
    } as never);
    ENVIO_GRATIS = false;
    expect(r.ok).toBe(true);
    const { data: o } = await supabase
      .from("orders")
      .select("total_cents, delivery_fee_cents")
      .eq("business_id", businessId)
      .eq("delivery_type", "delivery")
      .single();
    expect(o).toMatchObject({ delivery_fee_cents: 150_000, total_cents: 1_150_000 });
    const items = (createPreference.mock.calls[0] as unknown as [{ items: { id: string; unit_price: number; quantity: number }[] }])[0].items;
    expect(items.reduce((n, i) => n + i.unit_price * i.quantity, 0)).toBe(11_500);
  });

  // Auditoría de pedidos · baja — un producto oculto de la carta online no se
  // pide desde el checkout público; el staff sí lo carga.
  it("producto oculto: el público no, el staff sí", async () => {
    const { data: cat } = await supabase.from("categories").select("id").eq("business_id", businessId).limit(1).single();
    const { data: oculto } = await supabase
      .from("products")
      .insert({ business_id: businessId, category_id: cat!.id, name: "Secreto", slug: "secreto", price_cents: 500_000, show_online: false })
      .select("id")
      .single();
    const pedido = (opts?: Record<string, unknown>) =>
      persistOrder(
        {
          business_slug: TEST_TAG,
          delivery_type: "pickup",
          customer_name: "Cliente",
          customer_phone: "3511234567",
          items: [{ product_id: oculto!.id, quantity: 1, modifier_ids: [] }],
        } as never,
        null,
        opts as never,
      );
    const publico = await pedido();
    expect(publico.ok).toBe(false);
    if (!publico.ok) expect(publico.error).toMatch(/online/);
    const staff = await pedido({ source: "staff" });
    expect(staff.ok).toBe(true);
  });
});
