// @vitest-environment node
//
// #372 · revisión — un cobro de MESA con link de Mercado Pago que después se
// devuelve desde el panel de MP.
//
// El webhook marcaba el pago `refunded` (la caja quedaba bien) y bajaba el
// split, pero no recalculaba lo pagado de la ORDEN: `orders.total_paid_cents`
// seguía contando la plata devuelta. Esa columna es la que lee «cuenta con
// saldo»: la mesa quedaba como saldada y nadie la volvía a cobrar.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-reembolso-mesa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let EXTERNAL_REF = "";
vi.mock("@/lib/payments/mercadopago", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/mercadopago")>(
    "@/lib/payments/mercadopago",
  );
  return {
    ...actual,
    verifySignature: () => true,
    fetchPayment: async () => ({
      id: "mp-mesa-1",
      status: "refunded",
      statusDetail: null,
      externalReference: EXTERNAL_REF,
      transactionAmount: 10_000,
      payerEmail: null,
    }),
  };
});
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { POST } = await import("./route");

describe.skipIf(!dbAvailable)("webhook MP · reembolso de un cobro de mesa (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let orderId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({
        slug: TEST_TAG, name: "Reembolso mesa", is_active: true,
        mp_access_token: "APP_USR-x", mp_webhook_secret: "s",
      })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: caja } = await supabase
      .from("cajas").insert({ business_id: businessId, name: "Caja" }).select("id").single();
    const { data: o } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "Mesa", customer_phone: "0",
        delivery_type: "dine_in", subtotal_cents: 1_000_000, total_cents: 1_000_000,
        lifecycle_status: "closed", status: "delivered", payment_status: "pending",
        payment_method: "mp",
      })
      .select("id")
      .single();
    orderId = o!.id;
    const { data: pago } = await supabase
      .from("payments")
      .insert({
        order_id: orderId, business_id: businessId, caja_id: caja!.id,
        method: "mp_link", amount_cents: 1_000_000, tip_cents: 0,
        payment_status: "paid", mp_payment_id: "mp-mesa-1",
      })
      .select("id")
      .single();
    EXTERNAL_REF = pago!.id;
    await supabase.rpc("recalcular_pagado_orden", { p_order_id: orderId });
  });
  afterAll(async () => {
    if (businessId) {
      await supabase.from("payments").delete().eq("business_id", businessId);
      await supabase.from("businesses").delete().eq("id", businessId);
    }
  });

  it("la plata devuelta deja de contar como pagada en la orden", async () => {
    const { data: antes } = await supabase
      .from("orders").select("total_paid_cents, payment_status").eq("id", orderId).single();
    expect(antes).toEqual({ total_paid_cents: 1_000_000, payment_status: "paid" });

    const res = await POST(
      new Request(`http://x/api/mp/webhook?business_id=${businessId}`, {
        method: "POST",
        body: JSON.stringify({ type: "payment", data: { id: "mp-mesa-1" } }),
      }),
    );
    expect(res.status).toBe(200);

    const { data: pago } = await supabase
      .from("payments").select("payment_status").eq("id", EXTERNAL_REF).single();
    expect(pago!.payment_status).toBe("refunded");
    const { data: despues } = await supabase
      .from("orders").select("total_paid_cents, payment_status").eq("id", orderId).single();
    expect(despues).toEqual({ total_paid_cents: 0, payment_status: "pending" });
  });
});
