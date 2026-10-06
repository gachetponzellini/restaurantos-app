// @vitest-environment node
//
// Spec 210 v2 · R3/R4/R7 (migración 0135) — la rendición es una entrega.
//
// Contra Postgres: entregar justo, de menos (saldo), de más (con nota), la
// caja que le paga la propina cuando no tiene efectivo, «no entregó» como
// deuda reconocida, anular una entrega, y cuándo un mozo está resuelto para el
// cierre. Todo con el negocio en el modelo nuevo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-entregas-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

/** Un cobro de mesa ya hecho y la cuenta cerrada: no deja mesas sin cobrar. */
async function cobro(c: {
  amount: number;
  tip?: number;
  method?: "cash" | "card_manual" | "mp_qr";
  dejarAbierta?: boolean;
}) {
  const m = await s.mesa([c.amount - (c.tip ?? 0)]);
  const { error } = await s.sb.from("payments").insert({
    order_id: m.orderId,
    business_id: s.ctx.businessId,
    caja_id: s.ctx.cajaId,
    operated_by: s.ctx.encargadoId,
    attributed_mozo_id: s.ctx.mozoId,
    method: c.method ?? "cash",
    amount_cents: c.amount,
    tip_cents: c.tip ?? 0,
    payment_status: "paid",
  });
  if (error) throw error;
  if (!c.dejarAbierta) {
    await s.sb
      .from("orders")
      .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: c.amount - (c.tip ?? 0) })
      .eq("id", m.orderId);
  }
  return m;
}

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  return { data: data as T, error };
};
const saldo = async () =>
  Number((await rpc("saldo_mozo", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId })).data);
const esperado = async () =>
  Number(
    (await rpc("efectivo_esperado_caja", {
      p_caja_id: s.ctx.cajaId,
      p_hasta: new Date(Date.now() + 1000).toISOString(),
    })).data,
  );
const rendir = (entregado: number, notas?: string) =>
  rpc<{ rendicion: { id: string; difference_cents: number }; saldo_restante: number }>("rendir_mozo_tx", {
    p_business_id: s.ctx.businessId,
    p_mozo_id: s.ctx.mozoId,
    p_caja_id: s.ctx.cajaId,
    p_entregado_cents: entregado,
    p_registrado_por: s.ctx.encargadoId,
    p_notas: notas ?? null,
  });
const resuelto = async () =>
  Boolean((await rpc("mozo_resuelto", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId })).data);

describe.skipIf(!dbAvailable)("caja v2 · la rendición es una entrega (0135)", () => {
  beforeAll(async () => {
    await s.setup();
    await s.sb
      .from("businesses")
      .update({ caja_modelo_v2_desde: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.ctx.businessId);
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("entrega justa: el cajón sube lo entregado, el saldo queda en cero y está resuelto", async () => {
    await cobro({ amount: 91_000 });
    await cobro({ amount: 67_250, tip: 8_400, method: "card_manual" });
    expect(await saldo()).toBe(91_000 - 8_400);
    const caja = await esperado();
    const r = await rendir(82_600);
    expect(r.error).toBeNull();
    expect(r.data.saldo_restante).toBe(0);
    expect(await esperado()).toBe(caja + 82_600);
    expect(await resuelto()).toBe(true);
  });

  it("entrega de menos: entra lo que trajo y el resto queda en su saldo, sin pedir nota", async () => {
    await cobro({ amount: 182_400 });
    const caja = await esperado();
    const r = await rendir(150_000);
    expect(r.error).toBeNull();
    expect(r.data.saldo_restante).toBe(32_400);
    expect(await esperado()).toBe(caja + 150_000);
    expect(await resuelto()).toBe(false);
  });

  it("entrega de más sin nota se rechaza; con nota entra y queda el sobrante anotado", async () => {
    const debe = await saldo();
    const sinNota = await rendir(debe + 1_000);
    expect(sinNota.error?.message).toContain("NOTES_REQUIRED");
    const conNota = await rendir(debe + 1_000, "trajo de más el cambio");
    expect(conNota.error).toBeNull();
    expect(conNota.data.rendicion.difference_cents).toBe(1_000);
    expect(await saldo()).toBe(-1_000);
  });

  it("si el saldo es negativo, la caja le paga: no puede «entregar» y el pago lo deja en cero", async () => {
    // Saldo −1.000 del sobrante anterior + una propina de QR sin efectivo.
    await cobro({ amount: 33_000, tip: 3_000, method: "mp_qr" });
    expect(await saldo()).toBe(-4_000);
    const mal = await rendir(500);
    expect(mal.error?.message).toContain("SALDO_A_FAVOR_DEL_MOZO");
    const caja = await esperado();
    const ok = await rendir(0);
    expect(ok.error).toBeNull();
    expect(await saldo()).toBe(0);
    expect(await esperado()).toBe(caja - 4_000);
  });

  it("con una mesa suya sin cobrar no rinde (MOZO_HAS_OPEN_TABLES)", async () => {
    const m = await cobro({ amount: 20_000, dejarAbierta: true });
    const r = await rendir(20_000);
    expect(r.error?.message).toContain("MOZO_HAS_OPEN_TABLES");
    await s.sb
      .from("orders")
      .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: 20_000 })
      .eq("id", m.orderId);
  });

  it("«no entregó»: pide motivo, no mueve plata, y deja al mozo resuelto mientras no cobre más", async () => {
    const debe = await saldo();
    expect(debe).toBe(20_000);
    const sin = await rpc("reconocer_deuda_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId,
      p_motivo: "  ", p_registrado_por: s.ctx.encargadoId,
    });
    expect(sin.error?.message).toContain("NOTES_REQUIRED");
    const caja = await esperado();
    const ok = await rpc("reconocer_deuda_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId,
      p_motivo: "se fue temprano", p_registrado_por: s.ctx.encargadoId,
    });
    expect(ok.error).toBeNull();
    expect(await esperado()).toBe(caja);
    expect(await saldo()).toBe(20_000);
    expect(await resuelto()).toBe(true);

    // Si cobra algo más, la deuda reconocida ya no cubre el saldo de ahora.
    await cobro({ amount: 5_000 });
    expect(await resuelto()).toBe(false);
  });

  it("mozos_sin_resolver lista al mozo con su saldo", async () => {
    const { data } = await rpc<{ mozo_id: string; saldo_cents: number }[]>("mozos_sin_resolver", {
      p_caja_id: s.ctx.cajaId,
    });
    expect(data).toEqual([{ mozo_id: s.ctx.mozoId, saldo_cents: 25_000 }]);
  });

  it("anular una entrega: pide motivo, el movimiento queda anulado y el saldo vuelve", async () => {
    const r = await rendir(25_000);
    expect(r.data.saldo_restante).toBe(0);
    const caja = await esperado();
    const sin = await rpc("anular_entrega_tx", {
      p_business_id: s.ctx.businessId, p_rendicion_id: r.data.rendicion.id,
      p_motivo: "", p_anulada_por: s.ctx.encargadoId,
    });
    expect(sin.error?.message).toContain("NOTES_REQUIRED");
    const ok = await rpc("anular_entrega_tx", {
      p_business_id: s.ctx.businessId, p_rendicion_id: r.data.rendicion.id,
      p_motivo: "se cargó a la caja equivocada", p_anulada_por: s.ctx.encargadoId,
    });
    expect(ok.error).toBeNull();
    expect(await saldo()).toBe(25_000);
    expect(await esperado()).toBe(caja - 25_000);
    const otra = await rpc("anular_entrega_tx", {
      p_business_id: s.ctx.businessId, p_rendicion_id: r.data.rendicion.id,
      p_motivo: "otra vez", p_anulada_por: s.ctx.encargadoId,
    });
    expect(otra.error?.message).toContain("YA_ANULADA");
  });

});
