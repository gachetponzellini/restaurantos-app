// @vitest-environment node
//
// Spec 210 v2 (migración 0143) — los huecos de la revisión fresca.
//
//  · Una entrega del mozo (o la propina que le pagó la caja) no se edita ni se
//    anula por la corrección de movimientos del libro: eso dejaba la rendición
//    «rendida» con su movimiento anulado. Se anula sólo con `anular_entrega_tx`.
//  · Una entrega o una deuda a nombre de alguien que no es del negocio no entra.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-revision-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  return { data: data as T, error };
};

async function cobro(amount: number) {
  const m = await s.mesa([amount]);
  const { error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: s.ctx.cajaId,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: s.ctx.mozoId,
    method: "cash", amount_cents: amount, tip_cents: 0, payment_status: "paid",
  });
  if (error) throw error;
  await s.sb.from("orders")
    .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: amount })
    .eq("id", m.orderId);
}

type Rendicion = { rendicion: { id: string; movimiento_id: string } };
async function entregar(cents: number) {
  const r = await rpc<Rendicion>("rendir_mozo_tx", {
    p_business_id: s.ctx.businessId, p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId,
    p_entregado_cents: cents, p_registrado_por: s.ctx.encargadoId, p_notas: null,
  });
  if (r.error) throw r.error;
  return r.data.rendicion;
}

describe.skipIf(!dbAvailable)("caja v2 · huecos de la revisión (0143)", () => {
  beforeAll(async () => {
    await s.setup();
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("la corrección del libro no anula ni cambia una entrega (MOVIMIENTO_DE_MOZO)", async () => {
    await cobro(30_000);
    const r = await entregar(30_000);

    const anular = await rpc("corregir_movimiento_tx", {
      p_movimiento_id: r.movimiento_id, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId,
      p_reason: "probando", p_amount_cents: null, p_cancel: true,
    });
    expect(anular.error?.message).toContain("MOVIMIENTO_DE_MOZO");

    const monto = await rpc("corregir_movimiento_tx", {
      p_movimiento_id: r.movimiento_id, p_business_id: s.ctx.businessId, p_by_user_id: s.ctx.encargadoId,
      p_reason: "probando", p_amount_cents: 10_000, p_cancel: false,
    });
    expect(monto.error?.message).toContain("MOVIMIENTO_DE_MOZO");

    const borrar = await s.sb.from("caja_movimientos").delete().eq("id", r.movimiento_id);
    expect(borrar.error?.message ?? "").toMatch(/MOVIMIENTO_DE_MOZO|violates foreign key/);
  });

  it("anular la entrega por su camino sí anda, y el saldo vuelve", async () => {
    const { data: rows } = await s.sb.from("mozo_rendiciones").select("id")
      .eq("business_id", s.ctx.businessId).is("anulada_at", null);
    const r = await rpc("anular_entrega_tx", {
      p_business_id: s.ctx.businessId, p_rendicion_id: rows![0].id,
      p_motivo: "se cargó dos veces", p_anulada_por: s.ctx.encargadoId,
    });
    expect(r.error).toBeNull();
    const saldo = await rpc<number>("saldo_mozo", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId });
    expect(Number(saldo.data)).toBe(30_000);
  });

  it("una entrega o una deuda a nombre de alguien de otro negocio no entra (MOZO_WRONG_BUSINESS)", async () => {
    const otro = crearSalon(`test-revision-otro-${Date.now()}`);
    await otro.setup();
    try {
      const entrega = await rpc("rendir_mozo_tx", {
        p_business_id: s.ctx.businessId, p_mozo_id: otro.ctx.mozoId, p_caja_id: s.ctx.cajaId,
        p_entregado_cents: 5_000, p_registrado_por: s.ctx.encargadoId, p_notas: "sobrante",
      });
      expect(entrega.error?.message).toContain("MOZO_WRONG_BUSINESS");

      const deuda = await s.sb.from("mozo_rendiciones").insert({
        business_id: s.ctx.businessId, mozo_id: otro.ctx.mozoId, registered_by: s.ctx.encargadoId,
        caja_id: s.ctx.cajaId, expected_cash_cents: 1, delivered_cash_cents: 0, difference_cents: -1,
        por_metodo: {}, por_canal: {}, estado: "no_entrego", notes: "x",
      });
      expect(deuda.error?.message).toContain("MOZO_WRONG_BUSINESS");
    } finally {
      await otro.teardown();
    }
  });
});
