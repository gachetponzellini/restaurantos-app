// @vitest-environment node
//
// Spec 213 (#386) — la liquidación del mozo sale al tocar «Rendir».
//
//  · La primera vez con unos números, se encola el papel con la foto.
//  · Abrirla de nuevo con el mismo saldo no imprime (no gasta papel).
//  · «Reimprimir» fuerza el papel, y puede llevar el detalle de cobros.
//  · Si el saldo cambió (cobró otra mesa), es otra liquidación: sale sola.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

let ACTOR = "";
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: ACTOR } }, error: null }),
      getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { imprimirLiquidacion } = await import("./turno-actions");

const s = crearSalon(`test-liquidacion-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

async function cobroEnEfectivo(amount: number, tip = 0) {
  const m = await s.mesa([amount - tip]);
  const { error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: s.ctx.cajaId,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: s.ctx.mozoId,
    method: "cash", amount_cents: amount, tip_cents: tip, payment_status: "paid",
  });
  if (error) throw error;
  await s.sb.from("orders").update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: amount - tip }).eq("id", m.orderId);
}
const trabajos = async () => {
  const { data } = await s.sb
    .from("print_jobs")
    .select("id, payload")
    .eq("business_id", s.ctx.businessId)
    .eq("kind", "liquidacion")
    .order("emitted_at");
  return (data ?? []) as { id: string; payload: Record<string, unknown> }[];
};

describe.skipIf(!dbAvailable)("la liquidación del mozo (spec 213)", () => {
  beforeAll(async () => {
    await s.setup();
    ACTOR = s.ctx.encargadoId;
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("la primera vez encola el papel con la foto de su cuenta", async () => {
    await cobroEnEfectivo(30_000, 2_000);
    const r = await imprimirLiquidacion({ slug: s.ctx.slug, mozoId: s.ctx.mozoId, cajaId: s.ctx.cajaId });
    expect(r).toMatchObject({ ok: true, data: { impreso: true } });
    const [t] = await trabajos();
    expect(t.payload).toMatchObject({ efectivo_cents: 28_000, saldo_cents: 28_000, reimpresion: false });
    expect(t.payload.cobros).toBeUndefined();
  });

  it("abrirla de nuevo con el mismo saldo no imprime", async () => {
    const r = await imprimirLiquidacion({ slug: s.ctx.slug, mozoId: s.ctx.mozoId, cajaId: s.ctx.cajaId });
    expect(r).toMatchObject({ ok: true, data: { impreso: false } });
    expect(await trabajos()).toHaveLength(1);
  });

  it("«Reimprimir» la saca igual, y con el detalle de cobros si se pide", async () => {
    const r = await imprimirLiquidacion({ slug: s.ctx.slug, mozoId: s.ctx.mozoId, cajaId: s.ctx.cajaId, forzar: true, conCobros: true });
    expect(r).toMatchObject({ ok: true, data: { impreso: true } });
    const lista = await trabajos();
    expect(lista).toHaveLength(2);
    expect(lista[1].payload).toMatchObject({ reimpresion: true });
    expect(lista[1].payload.cobros).toEqual([
      expect.objectContaining({ efectivo_cents: 28_000, propina_efectivo_cents: 2_000 }),
    ]);
  });

  it("si cobró otra mesa, es otra liquidación y sale sola", async () => {
    await cobroEnEfectivo(10_000);
    const r = await imprimirLiquidacion({ slug: s.ctx.slug, mozoId: s.ctx.mozoId, cajaId: s.ctx.cajaId });
    expect(r).toMatchObject({ ok: true, data: { impreso: true } });
    const lista = await trabajos();
    expect(lista).toHaveLength(3);
    expect(lista[2].payload).toMatchObject({ saldo_cents: 38_000 });
  });

  it("un mozo no la puede pedir", async () => {
    ACTOR = s.ctx.mozoId;
    const r = await imprimirLiquidacion({ slug: s.ctx.slug, mozoId: s.ctx.mozoId, cajaId: s.ctx.cajaId, forzar: true });
    expect(r.ok).toBe(false);
    ACTOR = s.ctx.encargadoId;
  });
});
