// @vitest-environment node
//
// Auditoría de pedidos · MEDIA — la cancelación del cliente es atómica.
//
// Antes: validaba el estado, REEMBOLSABA por MP y recién después cancelaba sin
// guarda. Si el local lo pasó a cocina en el medio, se cancelaba igual; y si el
// update fallaba, la plata ya se había devuelto con el pedido vivo. Ahora se
// cancela primero con guarda de estado y se reembolsa sólo si se canceló.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cancel-cli-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_USER_ID = "";
const refundPayment = vi.fn(async () => ({ ok: true }));
const estadoAlReembolsar: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));
vi.mock("@/lib/payments/mercadopago", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/mercadopago")>(
    "@/lib/payments/mercadopago",
  );
  return { ...actual, refundPayment: (...a: unknown[]) => refundPayment(...(a as [])) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/delivery-notify", () => ({
  notifyDeliveryStatusChange: vi.fn(async () => {}),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { cancelOrderByCustomer } = await import("./customer-cancel-actions");

describe.skipIf(!dbAvailable)("cancelación del cliente (integration · auditoría)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let customerId: string;

  const pedido = async (over: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_id: customerId, customer_name: "C", customer_phone: "0",
        delivery_type: "pickup", subtotal_cents: 1000, total_cents: 1000,
        lifecycle_status: "open", status: "pending", payment_status: "pending", payment_method: "mp",
        ...over,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };
  const estado = async (id: string) =>
    (await supabase.from("orders").select("status, payment_status").eq("id", id).single()).data;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cancel Test", is_active: true, mp_access_token: "APP_USR-x" })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: u } = await supabase.auth.admin.createUser({
      email: `${TEST_TAG}@example.test`, password: "test-pass-12345", email_confirm: true,
    });
    CURRENT_USER_ID = u!.user!.id;
    await supabase.from("users").upsert({ id: CURRENT_USER_ID, email: `${TEST_TAG}@example.test` });
    const { data: c } = await supabase
      .from("customers")
      .insert({ business_id: businessId, user_id: CURRENT_USER_ID, phone: "3510000000", name: "C" })
      .select("id")
      .single();
    customerId = c!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    if (CURRENT_USER_ID) {
      await supabase.from("users").delete().eq("id", CURRENT_USER_ID);
      await supabase.auth.admin.deleteUser(CURRENT_USER_ID);
    }
  });
  beforeEach(() => {
    refundPayment.mockClear();
    estadoAlReembolsar.length = 0;
  });

  it("pagado por MP: cancela primero y reembolsa después", async () => {
    const id = await pedido({ payment_status: "paid", mp_payment_id: "mp-1" });
    refundPayment.mockImplementationOnce(async () => {
      estadoAlReembolsar.push((await estado(id))!.status as string);
      return { ok: true };
    });
    const r = await cancelOrderByCustomer({ order_id: id, business_slug: TEST_TAG });
    expect(r.ok && r.data.refund).toBe("refunded");
    expect(estadoAlReembolsar).toEqual(["cancelled"]);
    expect(await estado(id)).toEqual({ status: "cancelled", payment_status: "refunded" });
  });

  it("ya en preparación: ni se cancela ni se reembolsa", async () => {
    const id = await pedido({ status: "preparing", payment_status: "paid", mp_payment_id: "mp-2" });
    const r = await cancelOrderByCustomer({ order_id: id, business_slug: TEST_TAG });
    expect(r.ok).toBe(false);
    expect(refundPayment).not.toHaveBeenCalled();
    expect((await estado(id))?.status).toBe("preparing");
  });
});
