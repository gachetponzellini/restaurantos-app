// @vitest-environment node
//
// #368 — reintentar el pago con MP desde la confirmación, contra Postgres.
// `createPreference` va mockeado: no se le habla a Mercado Pago.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-reintento-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const createPreference = vi.fn(async () => ({
  preferenceId: "pref-nueva",
  initPoint: "https://mp/checkout/pref-nueva",
  sandboxInitPoint: "https://mp/checkout/pref-nueva",
}));
const pagoEnCurso = vi.fn(
  async (): Promise<"aprobado" | "en_proceso" | "desconocido" | null> => null,
);
vi.mock("@/lib/payments/mercadopago", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/mercadopago")>(
    "@/lib/payments/mercadopago",
  );
  return {
    ...actual,
    createPreference: (...a: unknown[]) => createPreference(...(a as [])),
    pagoEnCursoPorReferencia: (...a: unknown[]) => pagoEnCurso(...(a as [])),
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }),
}));
vi.mock("@/lib/rate-limit", () => ({ limitCreateOrder: async () => ({ success: true }) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { reintentarPagoMp } = await import("./reintentar-pago-actions");

describe.skipIf(!dbAvailable)("reintentar pago MP (integration · #368)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;

  const pedido = async (over: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: "Cliente web",
        customer_phone: "0",
        delivery_type: "pickup",
        subtotal_cents: 1_234_500,
        total_cents: 1_234_500,
        lifecycle_status: "open",
        status: "pending",
        payment_status: "pending",
        payment_method: "mp",
        ...over,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({
        slug: TEST_TAG,
        name: "Reintento Test",
        is_active: true,
        mp_access_token: "APP_USR-test",
        mp_public_key: "APP_USR-pub",
        mp_accepts_payments: true,
      })
      .select("id")
      .single();
    businessId = biz!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });
  beforeEach(() => {
    createPreference.mockClear();
    pagoEnCurso.mockReset();
    pagoEnCurso.mockResolvedValue(null);
  });

  it("un MP que falló devuelve un link nuevo por el total, lo guarda y vuelve a pending", async () => {
    const creado = new Date(Date.now() - 100 * 60_000);
    const id = await pedido({ payment_status: "failed", created_at: creado.toISOString() });

    const r = await reintentarPagoMp({ business_slug: TEST_TAG, order_id: id });
    expect(r.ok && r.data.initPoint).toBe("https://mp/checkout/pref-nueva");

    const args = (createPreference.mock.calls[0] as unknown as [Record<string, unknown>])[0] as {
      orderId: string;
      items: { unit_price: number; quantity: number }[];
      venceEl: Date;
    };
    expect(args.orderId).toBe(id);
    expect(args.items).toEqual([expect.objectContaining({ quantity: 1, unit_price: 12_345 })]);
    // A los 100 min del pedido el link vence a los 110, no a los 190.
    expect(args.venceEl.getTime()).toBe(creado.getTime() + 110 * 60_000);

    const { data } = await supabase
      .from("orders")
      .select("mp_preference_id, payment_status")
      .eq("id", id)
      .single();
    expect(data).toEqual({ mp_preference_id: "pref-nueva", payment_status: "pending" });
  });

  it("vencido, en efectivo o pagado: no genera link", async () => {
    const vencido = await pedido({ created_at: new Date(Date.now() - 108 * 60_000).toISOString() });
    const efectivo = await pedido({ payment_method: "cash" });
    const pagado = await pedido({ payment_status: "paid" });
    for (const id of [vencido, efectivo, pagado]) {
      const r = await reintentarPagoMp({ business_slug: TEST_TAG, order_id: id });
      expect(r.ok).toBe(false);
    }
    expect(createPreference).not.toHaveBeenCalled();
  });

  it("un pedido de otro negocio no se encuentra", async () => {
    const id = await pedido({});
    const r = await reintentarPagoMp({ business_slug: "demo", order_id: id });
    expect(r.ok).toBe(false);
    expect(createPreference).not.toHaveBeenCalled();
  });

  // Auditoría de pedidos · MEDIA — doble cobro.
  it("con un pago todavía en proceso en MP no abre un segundo cobro", async () => {
    const id = await pedido({});
    pagoEnCurso.mockResolvedValueOnce("en_proceso");
    const r = await reintentarPagoMp({ business_slug: TEST_TAG, order_id: id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/en proceso/i);
    expect(createPreference).not.toHaveBeenCalled();
  });

  it("si no se puede consultar MP, no abre un segundo cobro (falla cerrado)", async () => {
    const id = await pedido({});
    pagoEnCurso.mockResolvedValueOnce("desconocido");
    const r = await reintentarPagoMp({ business_slug: TEST_TAG, order_id: id });
    expect(r.ok).toBe(false);
    expect(createPreference).not.toHaveBeenCalled();
  });

  it("si MP ya tiene el pago aprobado, avisa que se está confirmando", async () => {
    const id = await pedido({});
    pagoEnCurso.mockResolvedValueOnce("aprobado");
    const r = await reintentarPagoMp({ business_slug: TEST_TAG, order_id: id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya recibimos/i);
    expect(createPreference).not.toHaveBeenCalled();
  });
});
