// @vitest-environment node
//
// #358 — el cierre de caja calcula el esperado ADENTRO de su transacción.
//
// `cerrarCaja` calculaba el efectivo esperado en TS y `cerrar_caja_tx` lo
// guardaba sin mirar: un cobro que entraba en el medio quedaba en el período
// cerrado y fuera del esperado — no lo contaba ni este cierre ni el siguiente.
// Ahora la RPC bloquea la caja, recalcula, y si el número cambió respecto de
// lo que el encargado vio, rechaza (EXPECTED_CHANGED) en vez de firmar otro.
//
// Además: la guarda de rendiciones en la base espeja la de la pantalla (el
// encargado rinde lo sin mesa), y el retiro informado descuenta el fondo.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { cerrarCaja } = await import("./actions");
const { getCajaLiveStats } = await import("./queries");

const s = crearSalon(`test-cierre-tx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

/** Un cobro en efectivo ya cerrado, sin pasar por las actions. */
async function cobroEnEfectivo(opts: {
  amount: number;
  mozo: string;
  conMesa: boolean;
}) {
  let tableId: string | null = null;
  if (opts.conMesa) {
    const m = await s.mesa([opts.amount]);
    tableId = m.tableId;
    await s.sb.from("orders").update({ lifecycle_status: "closed", payment_status: "paid" }).eq("id", m.orderId);
    await s.sb.from("payments").insert({
      order_id: m.orderId,
      business_id: s.ctx.businessId,
      caja_id: s.ctx.cajaId,
      operated_by: opts.mozo,
      attributed_mozo_id: opts.mozo,
      method: "cash",
      amount_cents: opts.amount,
      tip_cents: 0,
      payment_status: "paid",
    });
    await s.sb.from("tables").update({ operational_status: "libre", current_order_id: null }).eq("id", tableId);
    return;
  }
  const { data: order } = await s.sb
    .from("orders")
    .insert({
      business_id: s.ctx.businessId,
      customer_name: "Takeaway",
      customer_phone: "0",
      delivery_type: "pickup",
      subtotal_cents: opts.amount,
      total_cents: opts.amount,
      lifecycle_status: "closed",
      payment_status: "paid",
    })
    .select("id")
    .single();
  await s.sb.from("payments").insert({
    order_id: order!.id,
    business_id: s.ctx.businessId,
    caja_id: s.ctx.cajaId,
    operated_by: opts.mozo,
    attributed_mozo_id: opts.mozo,
    method: "cash",
    amount_cents: opts.amount,
    tip_cents: 0,
    payment_status: "paid",
  });
}

const cerrarRpc = (expected: number, contado: number) =>
  s.sb.rpc("cerrar_caja_tx", {
    p_caja_id: s.ctx.cajaId,
    p_business_id: s.ctx.businessId,
    p_encargado_id: s.ctx.encargadoId,
    p_expected_cash_cents: expected,
    p_closing_cash_cents: contado,
    p_closing_notes: expected === contado ? null : "diferencia",
    p_denomination_count: null,
    p_retirar: true,
    p_barrer_salon: true,
  });

describe.skipIf(!dbAvailable)("cierre de caja transaccional (integration · #358)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("si el esperado cambió desde que el encargado lo vio, la RPC no firma", async () => {
    // El encargado cobró en el salón: no rinde (va directo al cajón).
    await cobroEnEfectivo({ amount: 300_000, mozo: s.ctx.encargadoId, conMesa: true });
    const antes = (await getCajaLiveStats(s.ctx.cajaId, s.ctx.businessId))!.expected_cash_cents;
    expect(antes).toBe(300_000);

    // Entra otro cobro mientras cuenta.
    await cobroEnEfectivo({ amount: 50_000, mozo: s.ctx.encargadoId, conMesa: true });

    const r = await cerrarRpc(antes, antes);
    expect(r.error?.message).toContain("EXPECTED_CHANGED:350000");
    const { count } = await s.sb
      .from("caja_cortes")
      .select("id", { count: "exact", head: true })
      .eq("caja_id", s.ctx.cajaId);
    expect(count).toBe(0);

    // Con el número al día, cierra, y guarda el esperado que calculó la base.
    const ok = await cerrarRpc(350_000, 350_000);
    expect(ok.error).toBeNull();
    const row = Array.isArray(ok.data) ? ok.data[0] : ok.data;
    expect(row.corte.expected_cash_cents).toBe(350_000);
    expect(row.corte.difference_cents).toBe(0);
    // El período nuevo arranca en cero.
    expect((await getCajaLiveStats(s.ctx.cajaId, s.ctx.businessId))!.expected_cash_cents).toBe(0);
  });

  it("el encargado que cobró un takeaway en efectivo tiene que rendir: la base lo exige", async () => {
    await cobroEnEfectivo({ amount: 80_000, mozo: s.ctx.encargadoId, conMesa: false });
    const r = await cerrarRpc(80_000, 80_000);
    expect(r.error?.message ?? "").toMatch(/UNRENDERED_MOZOS/);

    // Rinde, y ahí cierra.
    await s.sb.from("mozo_rendiciones").insert({
      business_id: s.ctx.businessId,
      mozo_id: s.ctx.encargadoId,
      registered_by: s.ctx.encargadoId,
      expected_cash_cents: 80_000,
      delivered_cash_cents: 80_000,
      difference_cents: 0,
      estado: "rendida",
    });
    expect((await cerrarRpc(80_000, 80_000)).error).toBeNull();
  });

  it("el retiro informado descuenta el fondo fijo de la caja", async () => {
    await s.sb.from("cajas").update({ fondo_fijo_cents: 20_000 }).eq("id", s.ctx.cajaId);
    await cobroEnEfectivo({ amount: 100_000, mozo: s.ctx.encargadoId, conMesa: true });

    const r = await cerrarCaja({
      cajaId: s.ctx.cajaId,
      closing_cash_cents: 100_000,
      closing_notes: null,
      denomination_count: null,
      retirar: true,
      businessSlug: s.ctx.slug,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.retiro_cents).toBe(80_000);
    // Queda el fondo en el cajón.
    expect((await getCajaLiveStats(s.ctx.cajaId, s.ctx.businessId))!.expected_cash_cents).toBe(20_000);
  });
});
