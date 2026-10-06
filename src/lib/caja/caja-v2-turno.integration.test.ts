// @vitest-environment node
//
// Spec 210 v2 · R5/R7/R8 (migración 0136) — el cierre de caja v2, el turno y
// el pasaje al modelo nuevo.
//
//  · Ninguna caja cierra con mesas abiertas ni con plata de mozos sin resolver
//    en ella; y ya no barre el salón.
//  · Cerrar el turno exige todas las cajas contadas, barre el salón y abre el
//    siguiente.
//  · Un negocio que pidió el modelo nuevo entra en el cierre de su principal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-turno-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
let cajaBar = "";

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  return { data: data as T, error };
};
const esperado = async (caja: string) =>
  Number(
    (await rpc("efectivo_esperado_caja", { p_caja_id: caja, p_hasta: new Date(Date.now() + 1000).toISOString() }))
      .data,
  );

type CierreRow = { corte: { id: string }; retiro_cents: number; mesas_liberadas: number };
async function cerrar(caja: string, opts: { barrer?: boolean } = {}) {
  const e = await esperado(caja);
  const r = await rpc<CierreRow[]>("cerrar_caja_tx", {
    p_caja_id: caja, p_business_id: s.ctx.businessId, p_encargado_id: s.ctx.encargadoId,
    p_expected_cash_cents: e, p_closing_cash_cents: e, p_closing_notes: null,
    p_denomination_count: null, p_retirar: true, p_barrer_salon: opts.barrer ?? false, p_resumen: null,
  });
  return { row: Array.isArray(r.data) ? r.data[0] : (r.data as unknown as CierreRow), error: r.error, esperado: e };
}

async function cobroMesa(amount: number, caja: string, cerrarCuenta = true) {
  const m = await s.mesa([amount]);
  const { error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: caja,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: s.ctx.mozoId,
    method: "cash", amount_cents: amount, tip_cents: 0, payment_status: "paid",
  });
  if (error) throw error;
  if (cerrarCuenta) {
    await s.sb.from("orders")
      .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: amount })
      .eq("id", m.orderId);
  }
  return m;
}

const rendirTodo = async (caja: string) => {
  const { data } = await rpc<number>("saldo_mozo", { p_mozo_id: s.ctx.mozoId, p_caja_id: caja });
  if (Number(data) === 0) return;
  const r = await rpc("rendir_mozo_tx", {
    p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: caja,
    p_entregado_cents: Number(data), p_registrado_por: s.ctx.encargadoId, p_notas: null,
  });
  if (r.error) throw r.error;
};

describe.skipIf(!dbAvailable)("caja v2 · turno y cierre (0136)", () => {
  beforeAll(async () => {
    await s.setup();
    const { data: bar } = await s.sb
      .from("cajas").insert({ business_id: s.ctx.businessId, name: "Bar", sort_order: 1 })
      .select("id").single();
    cajaBar = bar!.id;
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("una caja con plata de un mozo sin rendir no cierra (UNRENDERED_MOZOS), aunque no sea la principal", async () => {
    await cobroMesa(40_000, cajaBar);
    const c = await cerrar(cajaBar);
    expect(c.error?.message).toContain("UNRENDERED_MOZOS");
    await rendirTodo(cajaBar);
    const ok = await cerrar(cajaBar);
    expect(ok.error).toBeNull();
    expect(ok.row.retiro_cents).toBe(ok.esperado);
  });

  it("con una mesa abierta no cierra ninguna caja (OPEN_TABLE_ORDERS)", async () => {
    await rendirTodo(s.ctx.cajaId);
    await s.mesa([15_000]); // queda abierta
    const c = await cerrar(cajaBar);
    expect(c.error?.message).toContain("OPEN_TABLE_ORDERS");
    await s.sb.from("orders")
      .update({ lifecycle_status: "closed", status: "cancelled" })
      .eq("business_id", s.ctx.businessId).eq("lifecycle_status", "open");
  });

  it("cerrar una caja ya no barre el salón, aunque se lo pida", async () => {
    await s.sb.from("tables").update({ operational_status: "ocupada" }).eq("floor_plan_id", s.ctx.floorPlanId);
    const c = await cerrar(s.ctx.cajaId, { barrer: true });
    expect(c.error).toBeNull();
    expect(c.row.mesas_liberadas).toBe(0);
    const { count } = await s.sb.from("tables").select("id", { count: "exact", head: true })
      .eq("floor_plan_id", s.ctx.floorPlanId).neq("operational_status", "libre");
    expect(count).toBeGreaterThan(0);
  });

  it("cerrar el turno: con una caja sin contar no cierra; con todas contadas barre el salón y abre otro", async () => {
    await cobroMesa(12_000, cajaBar);
    const sin = await rpc("cerrar_turno_tx", { p_business_id: s.ctx.businessId, p_por: s.ctx.encargadoId });
    expect(sin.error?.message).toContain("CAJA_SIN_CONTAR");
    expect(sin.error?.message).toContain("Bar");
    await rendirTodo(cajaBar);
    const c = await cerrar(cajaBar);
    expect(c.error).toBeNull();

    const ok = await rpc<{ mesas_liberadas: number }>("cerrar_turno_tx", {
      p_business_id: s.ctx.businessId, p_por: s.ctx.encargadoId,
    });
    expect(ok.error).toBeNull();
    expect(ok.data.mesas_liberadas).toBeGreaterThan(0);
    const { data: turnos } = await s.sb.from("turnos").select("cerrado_at")
      .eq("business_id", s.ctx.businessId).order("abierto_at");
    expect(turnos).toHaveLength(2);
    expect(turnos![0].cerrado_at).not.toBeNull();
    expect(turnos![1].cerrado_at).toBeNull();
  });

});
