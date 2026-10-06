// @vitest-environment node
//
// Spec 210 v2 · R1–R3 (migración 0134) — la plata del mozo es del mozo hasta
// que la entrega.
//
// Lo que se fija acá es la contabilidad, contra Postgres:
//  · quién rinde cada cobro lo decide la base al cobrar (una sola regla);
//  · el cajón no espera el efectivo de un mozo hasta que lo entrega;
//  · el mozo tiene un saldo por caja, con su propina de tarjeta neta;
//  · un negocio en el modelo viejo no cambia nada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-caja-v2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

let cajaBar = "";

type Cobro = {
  mozo: string;
  caja?: string;
  method?: "cash" | "card_manual" | "mp_qr" | "transfer";
  amount: number;
  tip?: number;
  conMesa?: boolean;
};

/** Un cobro ya hecho, insertado directo: el trigger de la base decide quién rinde. */
async function cobro(c: Cobro): Promise<{ id: string; rinde: string | null }> {
  let orderId: string;
  if (c.conMesa ?? true) {
    const m = await s.mesa([c.amount - (c.tip ?? 0)]);
    orderId = m.orderId;
  } else {
    const { data: order, error } = await s.sb
      .from("orders")
      .insert({
        business_id: s.ctx.businessId,
        customer_name: "Takeaway",
        customer_phone: "0",
        delivery_type: "pickup",
        subtotal_cents: c.amount,
        total_cents: c.amount,
        lifecycle_status: "closed",
        payment_status: "paid",
      })
      .select("id")
      .single();
    if (error) throw error;
    orderId = order!.id;
  }
  const { data, error } = await s.sb
    .from("payments")
    .insert({
      order_id: orderId,
      business_id: s.ctx.businessId,
      caja_id: c.caja ?? s.ctx.cajaId,
      operated_by: s.ctx.encargadoId,
      attributed_mozo_id: c.mozo,
      method: c.method ?? "cash",
      amount_cents: c.amount,
      tip_cents: c.tip ?? 0,
      payment_status: "paid",
    })
    .select("id, rinde_mozo_id")
    .single();
  if (error) throw error;
  return { id: data!.id, rinde: data!.rinde_mozo_id };
}

const esperado = async (caja: string) => {
  const { data, error } = await s.sb.rpc("efectivo_esperado_caja", {
    p_caja_id: caja,
    p_hasta: new Date(Date.now() + 1000).toISOString(),
  });
  if (error) throw error;
  return Number(data);
};

const saldo = async (mozo: string, caja: string) => {
  const { data, error } = await s.sb.rpc("saldo_mozo", { p_mozo_id: mozo, p_caja_id: caja });
  if (error) throw error;
  return Number(data);
};

async function entrega(mozo: string, caja: string, monto: number) {
  const { error } = await s.sb.from("caja_movimientos").insert({
    business_id: s.ctx.businessId,
    caja_id: caja,
    kind: "rendicion",
    mozo_id: mozo,
    amount_cents: monto,
    reason: "Rendición",
    created_by: s.ctx.encargadoId,
  });
  if (error) throw error;
}

describe.skipIf(!dbAvailable)("caja v2 · la plata del mozo (0134)", () => {
  beforeAll(async () => {
    await s.setup();
    const { data: bar, error } = await s.sb
      .from("cajas")
      .insert({ business_id: s.ctx.businessId, name: "Bar", sort_order: 1 })
      .select("id")
      .single();
    if (error) throw error;
    cajaBar = bar!.id;
    // El negocio pasa al modelo nuevo desde hace un minuto.
    await s.sb
      .from("businesses")
      .update({ caja_modelo_v2_desde: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.ctx.businessId);
  });

  afterAll(async () => {
    await s.teardown();
  });

  it("el efectivo que cobra un mozo queda a su nombre y no entra al cajón", async () => {
    const antes = await esperado(s.ctx.cajaId);
    const c = await cobro({ mozo: s.ctx.mozoId, amount: 91_000 });
    expect(c.rinde).toBe(s.ctx.mozoId);
    expect(await esperado(s.ctx.cajaId)).toBe(antes);
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(91_000);
  });

  it("su propina en efectivo ya la tiene: no entra en lo que entrega", async () => {
    const antes = await saldo(s.ctx.mozoId, s.ctx.cajaId);
    await cobro({ mozo: s.ctx.mozoId, amount: 125_000, tip: 5_000 });
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(antes + 120_000);
  });

  it("su propina de tarjeta se la queda de lo que trae: el saldo baja", async () => {
    const antes = await saldo(s.ctx.mozoId, s.ctx.cajaId);
    const caja = await esperado(s.ctx.cajaId);
    await cobro({ mozo: s.ctx.mozoId, method: "card_manual", amount: 67_250, tip: 8_400 });
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(antes - 8_400);
    expect(await esperado(s.ctx.cajaId)).toBe(caja);
  });

  it("la entrega entra al cajón y baja el saldo en el mismo monto", async () => {
    const debe = await saldo(s.ctx.mozoId, s.ctx.cajaId);
    const caja = await esperado(s.ctx.cajaId);
    await entrega(s.ctx.mozoId, s.ctx.cajaId, debe);
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(0);
    expect(await esperado(s.ctx.cajaId)).toBe(caja + debe);
  });

  it("la plata de cada caja es de su caja: el saldo se lleva por caja", async () => {
    const barAntes = await esperado(cajaBar);
    await cobro({ mozo: s.ctx.mozoId, caja: cajaBar, amount: 40_000 });
    expect(await saldo(s.ctx.mozoId, cajaBar)).toBe(40_000);
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(0);
    expect(await esperado(cajaBar)).toBe(barAntes);
  });

  it("el operador de la caja no rinde: lo que cobra entra al cajón", async () => {
    await s.sb.from("caja_user_assignments").insert({
      business_id: s.ctx.businessId,
      caja_id: cajaBar,
      user_id: s.ctx.mozoId,
    });
    const antes = await esperado(cajaBar);
    const c = await cobro({ mozo: s.ctx.mozoId, caja: cajaBar, amount: 15_000 });
    expect(c.rinde).toBeNull();
    expect(await esperado(cajaBar)).toBe(antes + 15_000);
    await s.sb.from("caja_user_assignments").delete().eq("caja_id", cajaBar);
  });

  it("el encargado: lo de salón entra al cajón, lo sin mesa lo rinde (spec 203)", async () => {
    const conMesa = await cobro({ mozo: s.ctx.encargadoId, amount: 20_000, conMesa: true });
    expect(conMesa.rinde).toBeNull();
    const sinMesa = await cobro({ mozo: s.ctx.encargadoId, amount: 12_500, conMesa: false });
    expect(sinMesa.rinde).toBe(s.ctx.encargadoId);
  });

  it("corregir la caja de un cobro mueve el saldo del mozo de una caja a la otra", async () => {
    const c = await cobro({ mozo: s.ctx.mozoId, caja: cajaBar, amount: 30_000 });
    const bar = await saldo(s.ctx.mozoId, cajaBar);
    const prin = await saldo(s.ctx.mozoId, s.ctx.cajaId);
    const { error } = await s.sb.from("payments").update({ caja_id: s.ctx.cajaId }).eq("id", c.id);
    expect(error).toBeNull();
    expect(await saldo(s.ctx.mozoId, cajaBar)).toBe(bar - 30_000);
    expect(await saldo(s.ctx.mozoId, s.ctx.cajaId)).toBe(prin + 30_000);
  });

  it("si la caja le paga la propina (saldo negativo), el saldo vuelve a cero", async () => {
    // Sólo tarjeta: no tiene efectivo del que quedarse la propina.
    await s.sb
      .from("caja_movimientos")
      .insert({
        business_id: s.ctx.businessId, caja_id: cajaBar, kind: "rendicion",
        mozo_id: s.ctx.mozoId, amount_cents: await saldo(s.ctx.mozoId, cajaBar),
        reason: "Rendición", created_by: s.ctx.encargadoId,
      });
    await cobro({ mozo: s.ctx.mozoId, caja: cajaBar, method: "mp_qr", amount: 33_000, tip: 3_000 });
    expect(await saldo(s.ctx.mozoId, cajaBar)).toBe(-3_000);
    const caja = await esperado(cajaBar);
    const { error } = await s.sb.from("caja_movimientos").insert({
      business_id: s.ctx.businessId, caja_id: cajaBar, kind: "propina",
      mozo_id: s.ctx.mozoId, amount_cents: 3_000, reason: "Propina", created_by: s.ctx.encargadoId,
    });
    expect(error).toBeNull();
    expect(await saldo(s.ctx.mozoId, cajaBar)).toBe(0);
    expect(await esperado(cajaBar)).toBe(caja - 3_000);
  });

  it("una rendición sin mozo no se puede cargar", async () => {
    const { error } = await s.sb.from("caja_movimientos").insert({
      business_id: s.ctx.businessId, caja_id: s.ctx.cajaId, kind: "rendicion",
      amount_cents: 1_000, reason: "x", created_by: s.ctx.encargadoId,
    });
    expect(error).not.toBeNull();
  });

});
