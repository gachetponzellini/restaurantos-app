// @vitest-environment node
//
// Spec 210 v2 (migración 0138) — las lecturas de la caja salen de la base.
// La invariante que importa: el desglose que muestra la pantalla suma
// exactamente el «debería haber» que firma el cierre, y la fila de cada mozo
// cierra con su saldo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-lecturas-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  if (error) throw error;
  return data as T;
};
const ahora = () => new Date(Date.now() + 1000).toISOString();

async function cobro(o: { mozo: string; amount: number; tip?: number; method?: string }) {
  const m = await s.mesa([o.amount - (o.tip ?? 0)]);
  const { error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: s.ctx.cajaId,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: o.mozo,
    method: o.method ?? "cash", amount_cents: o.amount, tip_cents: o.tip ?? 0, payment_status: "paid",
  });
  if (error) throw error;
  await s.sb.from("orders")
    .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: o.amount - (o.tip ?? 0) })
    .eq("id", m.orderId);
}

type Desglose = Record<string, number>;
type SaldoRow = {
  mozo_id: string; efectivo_cents: number; propina_tarjeta_cents: number; propina_efectivo_cents: number;
  entregado_cents: number; pagado_cents: number; saldo_cents: number; resuelto: boolean; cobros_count: number;
};

describe.skipIf(!dbAvailable)("caja v2 · lecturas (0138)", () => {
  beforeAll(async () => {
    await s.setup();
    await s.sb.from("businesses")
      .update({ caja_modelo_v2_desde: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", s.ctx.businessId);
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("el desglose suma exactamente el «debería haber» que firma el cierre", async () => {
    await cobro({ mozo: s.ctx.encargadoId, amount: 18_000 });          // la caja, efectivo
    await cobro({ mozo: s.ctx.mozoId, amount: 91_000 });               // el mozo, efectivo
    await cobro({ mozo: s.ctx.mozoId, amount: 67_250, tip: 8_400, method: "card_manual" });
    await s.sb.from("caja_movimientos").insert([
      { business_id: s.ctx.businessId, caja_id: s.ctx.cajaId, kind: "ingreso", amount_cents: 500, reason: "cambio", created_by: s.ctx.encargadoId },
      { business_id: s.ctx.businessId, caja_id: s.ctx.cajaId, kind: "sangria", amount_cents: 7_000, reason: "verdulería", created_by: s.ctx.encargadoId },
    ]);
    await rpc("rendir_mozo_tx", {
      p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId,
      p_entregado_cents: 82_600, p_registrado_por: s.ctx.encargadoId, p_notas: null,
    });

    const d = await rpc<Desglose>("desglose_esperado_caja", { p_caja_id: s.ctx.cajaId, p_hasta: ahora() });
    const total = await rpc<number>("efectivo_esperado_caja", { p_caja_id: s.ctx.cajaId, p_hasta: ahora() });
    expect(d.esperado_cents).toBe(Number(total));
    expect(d.efectivo_cents).toBe(18_000);
    expect(d.rendiciones_cents).toBe(82_600);
    expect(d.apertura_cents + d.efectivo_cents + d.ingresos_cents + d.rendiciones_cents - d.sangrias_cents - d.propinas_pagadas_cents)
      .toBe(d.esperado_cents);
  });

  it("después de un cierre, la apertura es lo que quedó (fondo) y el retiro no ensucia el turno", async () => {
    const e = Number(await rpc<number>("efectivo_esperado_caja", { p_caja_id: s.ctx.cajaId, p_hasta: ahora() }));
    await s.sb.from("cajas").update({ fondo_fijo_cents: 5_000 }).eq("id", s.ctx.cajaId);
    const { error } = await s.sb.rpc("cerrar_caja_tx", {
      p_caja_id: s.ctx.cajaId, p_business_id: s.ctx.businessId, p_encargado_id: s.ctx.encargadoId,
      p_expected_cash_cents: e, p_closing_cash_cents: e, p_closing_notes: null, p_denomination_count: null,
      p_retirar: true, p_barrer_salon: false, p_resumen: null,
    });
    expect(error).toBeNull();
    const d = await rpc<Desglose>("desglose_esperado_caja", { p_caja_id: s.ctx.cajaId, p_hasta: ahora() });
    expect(d.apertura_cents).toBe(5_000);
    expect(d.retiro_cierre_cents).toBe(e - 5_000);
    expect(d.esperado_cents).toBe(5_000);
  });

  it("la fila de cada mozo cierra con su saldo", async () => {
    await cobro({ mozo: s.ctx.mozoId, amount: 125_000, tip: 5_000 });
    await cobro({ mozo: s.ctx.mozoId, amount: 33_000, tip: 3_000, method: "mp_qr" });
    const filas = await rpc<SaldoRow[]>("saldos_mozos", { p_business_id: s.ctx.businessId });
    const f = filas.find((x) => x.mozo_id === s.ctx.mozoId)!;
    expect(Number(f.efectivo_cents) - Number(f.propina_tarjeta_cents) - Number(f.entregado_cents) + Number(f.pagado_cents))
      .toBe(Number(f.saldo_cents));
    expect(Number(f.propina_efectivo_cents)).toBe(5_000);
    expect(Number(f.saldo_cents)).toBe(120_000 - 3_000);
    expect(f.resuelto).toBe(false);
    expect(Number((f as unknown as { anterior_cents: number }).anterior_cents)).toBe(0);
  });

  it("del turno: lo de antes de `desde` viene como saldo anterior, y la fila sigue cerrando", async () => {
    const corte = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await cobro({ mozo: s.ctx.mozoId, amount: 10_000 });
    const filas = await rpc<(SaldoRow & { anterior_cents: number })[]>("saldos_mozos", {
      p_business_id: s.ctx.businessId, p_desde: corte,
    });
    const f = filas.find((x) => x.mozo_id === s.ctx.mozoId)!;
    expect(Number(f.efectivo_cents)).toBe(10_000);
    expect(Number(f.anterior_cents)).toBe(117_000);
    expect(Number(f.anterior_cents) + Number(f.efectivo_cents) - Number(f.propina_tarjeta_cents)
      - Number(f.entregado_cents) + Number(f.pagado_cents)).toBe(Number(f.saldo_cents));
    // El encargado cobrando mesas no aparece: su plata entró al cajón.
    expect(filas.some((x) => x.mozo_id === s.ctx.encargadoId)).toBe(false);
  });
});
