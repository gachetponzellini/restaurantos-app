// @vitest-environment node
//
// Issue #339 (migración 0113) — el caso real de #338 contra Postgres:
// una transferencia cargada dos veces deja propina fantasma; se anulan las dos
// líneas; la orden queda cerrada con saldo. Tiene que:
//   · devolver la propina del excedente al anular la línea que la sumó;
//   · poder cobrarse otra vez aunque esté cerrada, y quedar pagada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-saldo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("cuenta cerrada con saldo (integration · #339)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let cajaId: string;

  const seedOrder = async (totalCents: number): Promise<string> => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Saldo test",
        customer_phone: "-",
        delivery_type: "dine_in",
        lifecycle_status: "open",
        subtotal_cents: totalCents,
        delivery_fee_cents: 0,
        total_cents: totalCents,
        payment_method: "cash",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  const pagar = (orderId: string, amount: number, extraTip = 0) =>
    supabase.rpc("registrar_pago_tx", {
      p_order_id: orderId,
      p_business_id: businessId,
      p_split_id: null,
      p_caja_id: cajaId,
      p_operated_by: null,
      p_attributed_mozo_id: null,
      p_method: "transfer",
      p_amount_cents: amount,
      p_tip_cents: extraTip,
      p_last_four: null,
      p_card_brand: null,
      p_notes: null,
      p_adjustment_percent: 0,
      p_adjustment_cents: 0,
      p_request_id: crypto.randomUUID(),
      p_received_cents: amount,
      p_extra_tip_cents: extraTip,
    });

  const anular = (paymentId: string) =>
    supabase.rpc("anular_pago_tx", {
      p_payment_id: paymentId,
      p_business_id: businessId,
      p_by_user_id: null,
      p_reason: "se cargó dos veces",
    });

  const leerOrden = async (orderId: string) => {
    const { data } = await supabase
      .from("orders")
      .select("tip_cents, total_cents, total_paid_cents, payment_status, lifecycle_status")
      .eq("id", orderId)
      .single();
    return data!;
  };

  beforeAll(async () => {
    const { data: biz, error } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Saldo Test", is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    businessId = biz!.id as string;

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Principal", is_active: true })
      .select("id")
      .single();
    cajaId = caja!.id as string;
  }, 60_000);

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
  }, 60_000);

  it("anular la línea que sumó propina por excedente la devuelve", async () => {
    const orderId = await seedOrder(1_850_000);
    const p1 = await pagar(orderId, 1_800_000);
    expect(p1.error).toBeNull();
    // El segundo cobro: saldo $500, entraron $18.000 → $17.500 de excedente.
    const p2 = await pagar(orderId, 1_800_000, 1_750_000);
    expect(p2.error).toBeNull();
    const pago2 = (Array.isArray(p2.data) ? p2.data[0] : p2.data).payment;
    expect(pago2.extra_tip_cents).toBe(1_750_000);
    expect((await leerOrden(orderId)).total_cents).toBe(3_600_000);

    const a = await anular(pago2.id);
    expect(a.error).toBeNull();
    const o = await leerOrden(orderId);
    expect(o.tip_cents).toBe(0);
    expect(o.total_cents).toBe(1_850_000);
    expect(o.total_paid_cents).toBe(1_800_000);
  });

  it("una cuenta cerrada con saldo se cobra y queda pagada", async () => {
    const orderId = await seedOrder(1_850_000);
    const p1 = await pagar(orderId, 1_850_000);
    expect(p1.error).toBeNull();
    await supabase
      .from("orders")
      .update({ lifecycle_status: "closed", payment_status: "paid", status: "delivered" })
      .eq("id", orderId);

    // Se anula la línea con la cuenta ya cerrada: queda cerrada, con saldo.
    const pago1 = (Array.isArray(p1.data) ? p1.data[0] : p1.data).payment;
    expect((await anular(pago1.id)).error).toBeNull();
    let o = await leerOrden(orderId);
    expect(o.lifecycle_status).toBe("closed");
    expect(o.payment_status).toBe("pending");
    expect(o.total_paid_cents).toBe(0);

    // Antes de la 0113 esto era ORDER_CLOSED.
    const re = await pagar(orderId, 1_850_000);
    expect(re.error).toBeNull();
    o = await leerOrden(orderId);
    expect(o.total_paid_cents).toBe(1_850_000);
    expect(o.payment_status).toBe("paid");
    expect(o.lifecycle_status).toBe("closed");
  });

  it("una cuenta cerrada y saldada sigue sin aceptar cobros", async () => {
    const orderId = await seedOrder(1_000_000);
    await pagar(orderId, 1_000_000);
    await supabase
      .from("orders")
      .update({ lifecycle_status: "closed", payment_status: "paid", status: "delivered" })
      .eq("id", orderId);
    const re = await pagar(orderId, 1_000_000);
    expect(re.error?.message).toContain("ORDER_CLOSED");
  });

  it("una cancelada no se cobra aunque le falte plata", async () => {
    const orderId = await seedOrder(1_000_000);
    await supabase
      .from("orders")
      .update({ lifecycle_status: "closed", status: "cancelled" })
      .eq("id", orderId);
    const re = await pagar(orderId, 1_000_000);
    expect(re.error?.message).toContain("ORDER_CLOSED");
  });
});
