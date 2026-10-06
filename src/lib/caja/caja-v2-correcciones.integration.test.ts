// @vitest-environment node
//
// Spec 210 v2 · R6 (migración 0137) — corregir con vista previa, y lo rendido
// no se toca.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const tag = `test-correc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const s = crearSalon(tag);
let cajaBar = "";
let mozo2 = "";

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  return { data: data as T, error };
};
const saldo = async (mozo: string, caja: string) =>
  Number((await rpc("saldo_mozo", { p_mozo_id: mozo, p_caja_id: caja })).data);
const esperado = async (caja: string) =>
  Number((await rpc("efectivo_esperado_caja", { p_caja_id: caja, p_hasta: new Date(Date.now() + 1000).toISOString() })).data);

async function cobro(o: { mozo: string; caja: string; amount: number; tip?: number; method?: string }) {
  const m = await s.mesa([o.amount - (o.tip ?? 0)]);
  const { data, error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: o.caja,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: o.mozo,
    method: o.method ?? "cash", amount_cents: o.amount, tip_cents: o.tip ?? 0, payment_status: "paid",
  }).select("id").single();
  if (error) throw error;
  await s.sb.from("orders")
    .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: o.amount - (o.tip ?? 0) })
    .eq("id", m.orderId);
  return data!.id as string;
}

const corregir = (paymentId: string, patch: Record<string, unknown>) =>
  rpc("corregir_pago_tx", {
    p_payment_id: paymentId, p_business_id: s.ctx.businessId,
    p_by_user_id: s.ctx.encargadoId, p_reason: "corrección de prueba", p_patch: patch,
  });
const efecto = (paymentId: string, patch: Record<string, unknown>) =>
  rpc<{ cajas: { caja: string; antes: number; despues: number }[]; mozos: { mozo_id: string; caja_id: string; antes: number; despues: number }[] }>(
    "efecto_de_correccion", { p_business_id: s.ctx.businessId, p_payment_id: paymentId, p_patch: patch });

describe.skipIf(!dbAvailable)("caja v2 · correcciones (0137)", () => {
  beforeAll(async () => {
    await s.setup();
    const { data: bar } = await s.sb.from("cajas")
      .insert({ business_id: s.ctx.businessId, name: "Bar", sort_order: 1 }).select("id").single();
    cajaBar = bar!.id;
    const { data: u } = await s.sb.auth.admin.createUser({
      email: `${tag}-mozo2@example.test`, password: "test-pass-12345", email_confirm: true,
    });
    mozo2 = u.user!.id;
    await s.sb.from("users").upsert({ id: mozo2, email: `${tag}-mozo2@example.test`, full_name: "Mozo2" });
    await s.sb.from("business_users").insert({ business_id: s.ctx.businessId, user_id: mozo2, role: "mozo", full_name: "Mozo2" });
    await s.sb.from("businesses")
      .update({ caja_modelo_v2_desde: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.ctx.businessId);
  });
  afterAll(async () => {
    await s.teardown();
    if (mozo2) {
      await s.sb.from("users").delete().eq("id", mozo2);
      await s.sb.auth.admin.deleteUser(mozo2);
    }
  });

  it("vista previa: pasar un cobro de mozo a otro mueve los saldos y no toca el cajón", async () => {
    const id = await cobro({ mozo: s.ctx.mozoId, caja: s.ctx.cajaId, amount: 91_000 });
    const { data, error } = await efecto(id, { attributed_mozo_id: mozo2 });
    expect(error).toBeNull();
    expect(data.cajas).toEqual([]);
    const porMozo = Object.fromEntries(data.mozos.map((m) => [m.mozo_id, m.despues - m.antes]));
    expect(porMozo[s.ctx.mozoId]).toBe(-91_000);
    expect(porMozo[mozo2]).toBe(91_000);

    // Y lo que muestra es lo que queda.
    const antes1 = await saldo(s.ctx.mozoId, s.ctx.cajaId);
    const antes2 = await saldo(mozo2, s.ctx.cajaId);
    expect((await corregir(id, { attributed_mozo_id: mozo2 })).error).toBeNull();
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(antes1 - 91_000);
    expect(await saldo(mozo2, s.ctx.cajaId)).toBe(antes2 + 91_000);
  });

  it("vista previa: se confundieron de caja → el saldo pasa de la Bar a la Principal", async () => {
    const id = await cobro({ mozo: s.ctx.mozoId, caja: cajaBar, amount: 40_000 });
    const { data } = await efecto(id, { caja_id: s.ctx.cajaId });
    const d = data.mozos.map((m) => ({ caja: m.caja_id, delta: m.despues - m.antes }));
    expect(d).toContainEqual({ caja: cajaBar, delta: -40_000 });
    expect(d).toContainEqual({ caja: s.ctx.cajaId, delta: 40_000 });
    expect((await corregir(id, { caja_id: s.ctx.cajaId })).error).toBeNull();
  });

  it("vista previa: un cobro de la caja (sin mozo que rinda) de efectivo a tarjeta baja el cajón", async () => {
    // El encargado cobrando una mesa: entra directo al cajón.
    const id = await cobro({ mozo: s.ctx.encargadoId, caja: s.ctx.cajaId, amount: 18_000 });
    const caja = await esperado(s.ctx.cajaId);
    const { data } = await efecto(id, { method: "card_manual" });
    expect(data.cajas).toEqual([{ caja_id: s.ctx.cajaId, caja: expect.any(String), antes: caja, despues: caja - 18_000 }]);
    expect(data.mozos).toEqual([]);
  });

  it("lo rendido no se toca: tras la entrega, cambiar la plata del cobro da MOZO_YA_RINDIO", async () => {
    const id = await cobro({ mozo: mozo2, caja: cajaBar, amount: 25_000 });
    const r = await rpc<{ rendicion: { id: string } }>("rendir_mozo_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: mozo2, p_caja_id: cajaBar,
      p_entregado_cents: await saldo(mozo2, cajaBar), p_registrado_por: s.ctx.encargadoId, p_notas: null,
    });
    expect(r.error).toBeNull();
    const mal = await corregir(id, { method: "card_manual" });
    expect(mal.error?.message).toContain("MOZO_YA_RINDIO");
    // Un dato que no es plata sí se puede corregir.
    const nota = await corregir(id, { notes: "mesa del fondo" });
    expect(nota.error).toBeNull();
    // Anulando la entrega, se corrige.
    await rpc("anular_entrega_tx", {
      p_business_id: s.ctx.businessId, p_rendicion_id: r.data.rendicion.id,
      p_motivo: "rehacer", p_anulada_por: s.ctx.encargadoId,
    });
    expect((await corregir(id, { method: "card_manual" })).error).toBeNull();
  });

  it("tampoco se le puede pasar un cobro a un mozo que ya entregó en esa caja después del cobro", async () => {
    const id = await cobro({ mozo: s.ctx.mozoId, caja: cajaBar, amount: 12_000 });
    // mozo2 entrega lo suyo en la Bar después de este cobro.
    await cobro({ mozo: mozo2, caja: cajaBar, amount: 5_000 });
    const r = await rpc("rendir_mozo_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: mozo2, p_caja_id: cajaBar,
      p_entregado_cents: await saldo(mozo2, cajaBar), p_registrado_por: s.ctx.encargadoId, p_notas: null,
    });
    expect(r.error).toBeNull();
    const mal = await corregir(id, { attributed_mozo_id: mozo2 });
    expect(mal.error?.message).toContain("MOZO_YA_RINDIO");
  });
});
