// Fixture compartido de los tests de integración de la plata de una cuenta
// (epic #361). Habla directo con las RPC, sin server actions: lo que se prueba
// es la regla de la base, que es la que tiene que sostenerse sola.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const dbAvailable = Boolean(supabaseUrl && serviceKey);

export type PagoInput = {
  amount: number;
  method?: string;
  split?: string | null;
  tip?: number;
  extraTip?: number;
  adjustment?: number;
  adjustmentPercent?: number;
  caja?: string;
  mozo?: string | null;
};

export function crearFixture(tag: string) {
  const sb: SupabaseClient = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ctx = { businessId: "", cajaId: "" };

  async function setup() {
    const { data: biz, error } = await sb
      .from("businesses")
      .insert({ slug: tag, name: "Plata Test", is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    ctx.businessId = biz!.id as string;
    const { data: caja, error: cajaErr } = await sb
      .from("cajas")
      .insert({ business_id: ctx.businessId, name: "Principal", is_active: true })
      .select("id")
      .single();
    if (cajaErr) throw cajaErr;
    ctx.cajaId = caja!.id as string;
  }

  async function teardown() {
    if (ctx.businessId) await sb.from("businesses").delete().eq("id", ctx.businessId);
  }

  async function orden(totalCents: number, tipCents = 0): Promise<string> {
    const { data, error } = await sb
      .from("orders")
      .insert({
        order_number: 0,
        business_id: ctx.businessId,
        customer_name: "Plata test",
        customer_phone: "-",
        delivery_type: "dine_in",
        lifecycle_status: "open",
        subtotal_cents: totalCents - tipCents,
        tip_cents: tipCents,
        delivery_fee_cents: 0,
        total_cents: totalCents,
        payment_method: "cash",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  async function subcuentas(
    orderId: string,
    expecteds: number[],
    tips: number[] = [],
  ): Promise<string[]> {
    const { data, error } = await sb
      .from("order_splits")
      .insert(
        expecteds.map((e, i) => ({
          order_id: orderId,
          business_id: ctx.businessId,
          split_mode: "por_monto",
          split_index: i + 1,
          expected_amount_cents: e,
          tip_cents: tips[i] ?? 0,
          paid_amount_cents: 0,
          status: "pending",
        })),
      )
      .select("id, split_index")
      .order("split_index");
    if (error) throw error;
    return (data as { id: string }[]).map((s) => s.id);
  }

  function pagar(orderId: string, p: PagoInput) {
    const extra = p.extraTip ?? 0;
    return sb.rpc("registrar_pago_tx", {
      p_order_id: orderId,
      p_business_id: ctx.businessId,
      p_split_id: p.split ?? null,
      p_caja_id: p.caja ?? ctx.cajaId,
      p_operated_by: null,
      p_attributed_mozo_id: p.mozo ?? null,
      p_method: p.method ?? "transfer",
      p_amount_cents: p.amount,
      p_tip_cents: (p.tip ?? 0) + extra,
      p_last_four: null,
      p_card_brand: null,
      p_notes: null,
      p_adjustment_percent: p.adjustmentPercent ?? 0,
      p_adjustment_cents: p.adjustment ?? 0,
      p_request_id: crypto.randomUUID(),
      p_received_cents: p.amount,
      p_extra_tip_cents: extra,
    });
  }

  /** Paga y devuelve la fila del pago; falla el test si la RPC dio error. */
  async function pagarOk(orderId: string, p: PagoInput) {
    const r = await pagar(orderId, p);
    if (r.error) throw new Error(`registrar_pago_tx: ${r.error.message}`);
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    return row as {
      payment: {
        id: string;
        tip_cents: number;
        extra_tip_cents: number;
        amount_cents: number;
        created_at: string;
      };
      fully_paid: boolean;
      split_done: boolean;
    };
  }

  function anular(paymentId: string) {
    return sb.rpc("anular_pago_tx", {
      p_payment_id: paymentId,
      p_business_id: ctx.businessId,
      p_by_user_id: null,
      p_reason: "test",
    });
  }

  function corregir(paymentId: string, patch: Record<string, unknown>) {
    return sb.rpc("corregir_pago_tx", {
      p_payment_id: paymentId,
      p_business_id: ctx.businessId,
      p_by_user_id: null,
      p_reason: "test",
      p_patch: patch,
    });
  }

  async function cerrarOrden(orderId: string) {
    await sb
      .from("orders")
      .update({ lifecycle_status: "closed", payment_status: "paid", status: "delivered" })
      .eq("id", orderId);
  }

  async function leerOrden(orderId: string) {
    const { data } = await sb
      .from("orders")
      .select("tip_cents, total_cents, total_paid_cents, payment_status, lifecycle_status, status")
      .eq("id", orderId)
      .single();
    return data as {
      tip_cents: number;
      total_cents: number;
      total_paid_cents: number;
      payment_status: string;
      lifecycle_status: string;
      status: string;
    };
  }

  async function leerSubcuenta(splitId: string) {
    const { data } = await sb
      .from("order_splits")
      .select("paid_amount_cents, expected_amount_cents, status")
      .eq("id", splitId)
      .single();
    return data as { paid_amount_cents: number; expected_amount_cents: number; status: string };
  }

  async function pagos(orderId: string) {
    const { data } = await sb
      .from("payments")
      .select("id, amount_cents, tip_cents, extra_tip_cents, adjustment_cents, method, payment_status")
      .eq("order_id", orderId)
      .order("created_at");
    return (data ?? []) as Array<{
      id: string;
      amount_cents: number;
      tip_cents: number;
      extra_tip_cents: number;
      adjustment_cents: number;
      method: string;
      payment_status: string;
    }>;
  }

  return {
    sb,
    ctx,
    setup,
    teardown,
    orden,
    subcuentas,
    pagar,
    pagarOk,
    anular,
    corregir,
    cerrarOrden,
    leerOrden,
    leerSubcuenta,
    pagos,
  };
}
