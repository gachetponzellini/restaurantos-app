// @vitest-environment node
//
// Auditoría 2026-09-20 — la cobranza de una cuenta corriente en efectivo entra
// al cajón como `ingreso`. Anularla anula ese ingreso… y no miraba si el
// ingreso ya había entrado en un arqueo cerrado: la plata se contó, se retiró,
// y después el movimiento aparecía anulado dentro de un cierre firmado. Es la
// misma frontera que ya respetan corregir y anular un cobro (spec 098 · H-35).
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

const { registrarCobranza, anularCobranza } = await import("./cuenta-corriente-actions");

const s = crearSalon(`test-cobranza-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
let customerId = "";

/** Le fía $10.000 al cliente, sin pasar por la UI. */
async function fiar(cents: number) {
  const { data: order } = await s.sb
    .from("orders")
    .insert({
      business_id: s.ctx.businessId,
      customer_name: "Fiado",
      customer_phone: "0",
      delivery_type: "pickup",
      subtotal_cents: cents,
      total_cents: cents,
      lifecycle_status: "closed",
      payment_status: "paid",
    })
    .select("id")
    .single();
  const { error } = await s.sb.from("payments").insert({
    order_id: order!.id,
    business_id: s.ctx.businessId,
    caja_id: s.ctx.cajaId,
    method: "cuenta_corriente",
    amount_cents: cents,
    tip_cents: 0,
    payment_status: "paid",
    credit_customer_id: customerId,
  });
  if (error) throw error;
}

describe.skipIf(!dbAvailable)("cobranza de cuenta corriente y arqueo (integration)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
    const { data: c, error } = await s.sb
      .from("customers")
      .insert({ business_id: s.ctx.businessId, name: "Socio", phone: `549${Date.now()}`, credit_enabled: true })
      .select("id")
      .single();
    if (error) throw error;
    customerId = c!.id;
    await fiar(1_000_000);
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("una cobranza del período abierto se anula, y su ingreso con ella", async () => {
    const r = await registrarCobranza({
      customerId, amount_cents: 200_000, method: "cash", cajaId: s.ctx.cajaId, slug: s.ctx.slug,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await anularCobranza(r.data.id, "se equivocó de cliente", s.ctx.slug)).ok).toBe(true);
    const { data: mov } = await s.sb
      .from("caja_movimientos")
      .select("cancelled_at")
      .eq("caja_id", s.ctx.cajaId)
      .eq("kind", "ingreso")
      .single();
    expect(mov!.cancelled_at).not.toBeNull();
  });

  it("una cobranza en efectivo que ya entró en un arqueo cerrado no se anula", async () => {
    const r = await registrarCobranza({
      customerId, amount_cents: 300_000, method: "cash", cajaId: s.ctx.cajaId, slug: s.ctx.slug,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Se cierra la caja con esa plata adentro.
    const { error } = await s.sb.from("caja_cortes").insert({
      caja_id: s.ctx.cajaId,
      business_id: s.ctx.businessId,
      encargado_id: s.ctx.encargadoId,
      expected_cash_cents: 300_000,
      closing_cash_cents: 300_000,
      difference_cents: 0,
    });
    expect(error).toBeNull();

    const a = await anularCobranza(r.data.id, "tarde", s.ctx.slug);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toMatch(/arqueo cerrado/i);
    const { data: set } = await s.sb
      .from("customer_credit_settlements")
      .select("cancelled_at")
      .eq("id", r.data.id)
      .single();
    expect(set!.cancelled_at).toBeNull();
  });
});
