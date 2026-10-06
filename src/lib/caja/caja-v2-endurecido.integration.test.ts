// @vitest-environment node
//
// Migración 0139 — lo que encontró la revisión fresca de 0134–0137. Cada test
// es un hallazgo: si vuelve a fallar, volvió el agujero.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const tag = `test-endurecido-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const s = crearSalon(tag);
let otroNegocio = "";
let cajaAjena = "";

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  return { data: data as T, error };
};
const saldo = async () => Number((await rpc("saldo_mozo", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId })).data);
const esperado = async () =>
  Number((await rpc("efectivo_esperado_caja", { p_caja_id: s.ctx.cajaId, p_hasta: new Date(Date.now() + 1000).toISOString() })).data);

async function cobro(o: { mozo?: string; amount: number; tip?: number; method?: string; adj?: number }) {
  const m = await s.mesa([o.amount - (o.tip ?? 0) - (o.adj ?? 0)]);
  const { data, error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: s.ctx.cajaId,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: o.mozo ?? s.ctx.mozoId,
    method: o.method ?? "cash", amount_cents: o.amount, tip_cents: o.tip ?? 0,
    adjustment_cents: o.adj ?? 0, payment_status: "paid",
  }).select("id").single();
  if (error) throw error;
  await s.sb.from("orders")
    .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: o.amount - (o.tip ?? 0) - (o.adj ?? 0) })
    .eq("id", m.orderId);
  return data!.id as string;
}
const rendir = (monto: number, notas?: string) =>
  rpc<{ rendicion: { id: string } }>("rendir_mozo_tx", {
    p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId,
    p_entregado_cents: monto, p_registrado_por: s.ctx.encargadoId, p_notas: notas ?? null,
  });

describe.skipIf(!dbAvailable)("caja v2 · endurecido (0139)", () => {
  beforeAll(async () => {
    await s.setup();
    await s.sb.from("businesses")
      .update({ caja_modelo_v2_desde: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.ctx.businessId);
    const { data: b } = await s.sb.from("businesses")
      .insert({ slug: `${tag}-otro`, name: "Otro", is_active: true }).select("id").single();
    otroNegocio = b!.id;
    const { data: existente } = await s.sb.from("cajas").select("id").eq("business_id", otroNegocio).limit(1).maybeSingle();
    if (existente) cajaAjena = existente.id;
    else {
      const { data: c } = await s.sb.from("cajas").insert({ business_id: otroNegocio, name: "Ajena" }).select("id").single();
      cajaAjena = c!.id;
    }
  });
  afterAll(async () => {
    if (otroNegocio) await s.sb.from("businesses").delete().eq("id", otroNegocio);
    await s.teardown();
  });

  it("un mozo con su JWT no puede cargarse una rendición ni tocar a nombre de quién está un cobro", async () => {
    const id = await cobro({ amount: 91_000 });
    const mozo = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: login } = await mozo.auth.signInWithPassword({
      email: `${tag}-Mozo@example.test`, password: "test-pass-12345",
    });
    expect(login).toBeNull();

    const { error: ins } = await mozo.from("caja_movimientos").insert({
      business_id: s.ctx.businessId, caja_id: s.ctx.cajaId, kind: "rendicion",
      mozo_id: s.ctx.mozoId, amount_cents: 91_000, reason: "me rindo solo",
    });
    expect(ins).not.toBeNull();

    await mozo.from("payments").update({ rinde_mozo_id: null }).eq("id", id);
    const { data: pago } = await s.sb.from("payments").select("rinde_mozo_id").eq("id", id).single();
    expect(pago!.rinde_mozo_id).toBe(s.ctx.mozoId);
    expect(await saldo()).toBe(91_000);
  });

  it("un cobro no puede apuntar a la caja de otro negocio", async () => {
    const m = await s.mesa([1_000]);
    const { error } = await s.sb.from("payments").insert({
      order_id: m.orderId, business_id: s.ctx.businessId, caja_id: cajaAjena,
      operated_by: s.ctx.encargadoId, attributed_mozo_id: s.ctx.mozoId,
      method: "cash", amount_cents: 1_000, tip_cents: 0, payment_status: "paid",
    });
    expect(error?.message).toContain("CAJA_WRONG_BUSINESS");
    // La cuenta de prueba no se cobró: se cancela para no dejar una mesa abierta.
    await s.sb.from("orders").update({ lifecycle_status: "closed", status: "cancelled" }).eq("id", m.orderId);
    const prev = await rpc("efecto_de_correccion", {
      p_business_id: s.ctx.businessId, p_payment_id: (await cobro({ amount: 2_000 })), p_patch: { caja_id: cajaAjena },
    });
    expect(prev.error?.message).toContain("CAJA_INVALID");
  });

  it("entregar $0 con saldo no es entregar (AMOUNT_NOT_POSITIVE)", async () => {
    const r = await rendir(0);
    expect(r.error?.message).toContain("AMOUNT_NOT_POSITIVE");
  });

  it("la devolución de un cobro de QR después de rendir no se traba", async () => {
    await rendir(await saldo());
    const id = await cobro({ amount: 33_000, tip: 3_000, method: "mp_qr" });
    // El mozo se quedó la propina de lo que traía: queda saldo −3.000; la caja se lo paga.
    expect((await rendir(0)).error).toBeNull();
    const { error } = await s.sb.from("payments").update({ payment_status: "refunded" }).eq("id", id);
    expect(error).toBeNull();
  });

  it("anular en efectivo lo que ya entregó sigue trabado (MOZO_YA_RINDIO)", async () => {
    const id = await cobro({ amount: 10_000 });
    await rendir(await saldo());
    const { error } = await s.sb.from("payments").update({ payment_status: "refunded" }).eq("id", id);
    expect(error?.message).toContain("MOZO_YA_RINDIO");
  });

  it("una entrega que ya entró en un arqueo no se anula (ARQUEO_CERRADO)", async () => {
    await cobro({ amount: 7_000 });
    const r = await rendir(7_000);
    const e = await esperado();
    const c = await s.sb.rpc("cerrar_caja_tx", {
      p_caja_id: s.ctx.cajaId, p_business_id: s.ctx.businessId, p_encargado_id: s.ctx.encargadoId,
      p_expected_cash_cents: e, p_closing_cash_cents: e, p_closing_notes: null, p_denomination_count: null,
      p_retirar: true, p_barrer_salon: false, p_resumen: null,
    });
    expect(c.error).toBeNull();
    const a = await rpc("anular_entrega_tx", {
      p_business_id: s.ctx.businessId, p_rendicion_id: r.data.rendicion.id,
      p_motivo: "tarde", p_anulada_por: s.ctx.encargadoId,
    });
    expect(a.error?.message).toContain("ARQUEO_CERRADO");
  });

  it("«no entregó» vale para ESE saldo: si los cobros cambian, aunque sume igual, hay que volver a resolver", async () => {
    const a = await cobro({ amount: 5_000 });
    await cobro({ amount: 3_000 });
    const ok = await rpc("reconocer_deuda_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId,
      p_motivo: "se fue", p_registrado_por: s.ctx.encargadoId,
    });
    expect(ok.error).toBeNull();
    expect((await rpc("mozo_resuelto", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId })).data).toBe(true);
    // −500 en uno y +500 en otro cobro: mismo saldo, otros cobros.
    await rpc("corregir_pago_tx", {
      p_payment_id: a, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId,
      p_reason: "nota", p_patch: { notes: "cambio de dato" },
    });
    await s.sb.from("payments").update({ tip_cents: 500 }).eq("id", a);
    await cobro({ amount: 500 });
    expect((await rpc("mozo_resuelto", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId })).data).toBe(false);
  });

  it("vista previa: tarjeta con recargo → efectivo recalcula el monto con el ajuste del efectivo", async () => {
    await s.sb.from("payment_method_configs").upsert(
      [{ business_id: s.ctx.businessId, method: "cash", adjustment_percent: -10, is_active: true }],
      { onConflict: "business_id,method" },
    );
    // Cobrado por la caja (encargado en mesa): venta 10.000 + 10% de recargo.
    const id = await cobro({ mozo: s.ctx.encargadoId, amount: 11_000, adj: 1_000, method: "card_manual" });
    const prev = await rpc<{ cajas: { antes: number; despues: number }[]; amount_cents: number }>(
      "efecto_de_correccion", { p_business_id: s.ctx.businessId, p_payment_id: id, p_patch: { method: "cash" } });
    expect(prev.error).toBeNull();
    expect(prev.data.amount_cents).toBe(9_000);
    expect(prev.data.cajas[0].despues - prev.data.cajas[0].antes).toBe(9_000);
  });

  it("la rendición v1 no corre en el modelo nuevo (MODELO_NUEVO)", async () => {
    const r = await rpc("registrar_rendicion_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_registered_by: s.ctx.encargadoId,
      p_desde_rendicion_id: null, p_created_at: new Date().toISOString(), p_expected_cash_cents: 0,
      p_delivered_cash_cents: 0, p_difference_cents: 0, p_notes: null, p_por_metodo: {}, p_por_canal: {},
      p_estado: "rendida", p_propina_pagada_cents: 3_000, p_caja_id: s.ctx.cajaId, p_propina_reason: "x",
      p_pagos_leidos: null,
    });
    expect(r.error?.message).toContain("MODELO_NUEVO");
  });
});
