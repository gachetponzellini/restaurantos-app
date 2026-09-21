// @vitest-environment node
//
// #148 · H-20 + H-45 — el barrido de pedidos online sin resolver, contra
// Postgres: cancela lo vencido, no toca lo que tiene plata y avisa una vez.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-vencer-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { vencerPedidosSinResolver, TIPO_AVISO_POR_VENCER } = await import(
  "./vencer-pendientes"
);
const { notifyPagoSobrePedidoCancelado } = await import("@/lib/notifications/events");
const { cancelarOrden } = await import("./cancel-order");

describe.skipIf(!dbAvailable)("vencer pedidos sin resolver (integration · #148)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ahora = new Date();
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();

  let businessId: string;
  let cajaId: string;

  const pedido = async (over: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: "Cliente web",
        customer_phone: "0",
        delivery_type: "pickup",
        subtotal_cents: 5_000,
        total_cents: 5_000,
        lifecycle_status: "open",
        status: "pending",
        payment_status: "pending",
        ...over,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  const estado = async (id: string) => {
    const { data } = await supabase
      .from("orders")
      .select("status, lifecycle_status, cancelled_reason")
      .eq("id", id)
      .single();
    return data;
  };

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Vencer Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja" })
      .select("id")
      .single();
    cajaId = caja!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase.from("notifications").delete().eq("business_id", businessId);
      await supabase.from("businesses").delete().eq("id", businessId);
    }
  });

  it("cancela lo vencido, respeta lo pagado y lo reciente, y avisa una sola vez", async () => {
    const mpVencido = await pedido({ payment_method: "mp", created_at: hace(130) });
    const mpReciente = await pedido({ payment_method: "mp", created_at: hace(60) });
    const mpConPago = await pedido({ payment_method: "mp", created_at: hace(130) });
    const { error: pagoErr } = await supabase.from("payments").insert({
      order_id: mpConPago,
      business_id: businessId,
      caja_id: cajaId,
      method: "mp_link",
      amount_cents: 5_000,
      payment_status: "paid",
    });
    expect(pagoErr).toBeNull();
    const programadoVencido = await pedido({
      payment_method: "cash",
      created_at: hace(600),
      scheduled_at: hace(70),
    });
    const programadoPorVencer = await pedido({
      payment_method: "cash",
      created_at: hace(600),
      scheduled_at: hace(40),
    });

    // El barrido es global (todos los negocios): se verifica por pedido, no
    // por los contadores, que incluyen lo que haya en la base.
    const r = await vencerPedidosSinResolver(ahora, supabase as never);
    expect(r.cancelados).toBeGreaterThanOrEqual(2);

    expect(await estado(mpVencido)).toMatchObject({
      lifecycle_status: "cancelled",
      cancelled_reason: "Pago no completado",
    });
    expect(await estado(programadoVencido)).toMatchObject({
      lifecycle_status: "cancelled",
      cancelled_reason: "No confirmado",
    });
    for (const id of [mpReciente, mpConPago, programadoPorVencer]) {
      expect((await estado(id))?.lifecycle_status).toBe("open");
    }

    // El cron pasa cada 5 min: el segundo tick no repite el aviso.
    await vencerPedidosSinResolver(ahora, supabase as never);
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("type", TIPO_AVISO_POR_VENCER);
    expect(count).toBe(1);
  });

  it("un pago de MP sobre un pedido cancelado avisa una sola vez, aunque MP reintente", async () => {
    const id = await pedido({ payment_method: "mp", created_at: hace(10) });
    for (let i = 0; i < 2; i++) {
      await notifyPagoSobrePedidoCancelado({
        businessId,
        orderId: id,
        paymentId: "mp-123",
        amountCents: 5_000,
      });
    }
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("type", "mp.pago_sobre_cancelado");
    expect(count).toBe(1);
  });

  // Revisión adversarial: el barrido decide con lo que leyó al principio del
  // tick; si MP acredita el pago mientras tanto, la cancelación tiene que
  // frenarse en la misma escritura, no en la lectura previa.
  it("la cancelación del barrido no pisa un pedido que se pagó o se aceptó entre medio", async () => {
    const pagado = await pedido({ payment_method: "mp", created_at: hace(130), payment_status: "paid" });
    const aceptado = await pedido({ payment_method: "cash", created_at: hace(600), status: "confirmed" });
    for (const id of [pagado, aceptado]) {
      const r = await cancelarOrden(supabase as never, {
        orderId: id,
        businessId,
        motivo: "Pago no completado",
        actorUserId: null,
        soloSiPendienteImpago: true,
      });
      expect(r.cancelled).toBe(false);
      expect((await estado(id))?.lifecycle_status).toBe("open");
    }
  });
});
