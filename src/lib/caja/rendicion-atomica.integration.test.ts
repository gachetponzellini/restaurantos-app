// @vitest-environment node
//
// #359 — la rendición y el pago de su propina son UNA transacción, y dos
// rendiciones del mismo mozo a la vez no pagan la propina dos veces.
//
// Antes: insert de la rendición, después insert del movimiento de propina, con
// un `delete` a mano si el segundo fallaba. Dos rendiciones simultáneas (doble
// tap, dos pestañas) leían el mismo pendiente y las dos pagaban la propina.
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

const { registrarRendicionMozo } = await import("./actions");

const s = crearSalon(`test-rend-atomica-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

async function cobroDelMozo(amount: number, tip: number, method = "card_manual") {
  const m = await s.mesa([amount - tip], { tip });
  await s.sb.from("payments").insert({
    order_id: m.orderId,
    business_id: s.ctx.businessId,
    caja_id: s.ctx.cajaId,
    operated_by: s.ctx.mozoId,
    attributed_mozo_id: s.ctx.mozoId,
    method,
    amount_cents: amount,
    tip_cents: tip,
    payment_status: "paid",
  });
  await s.sb
    .from("orders")
    .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: amount })
    .eq("id", m.orderId);
}

const propinasPagadas = async () => {
  const { data } = await s.sb
    .from("caja_movimientos")
    .select("amount_cents")
    .eq("business_id", s.ctx.businessId)
    .eq("kind", "propina");
  return ((data ?? []) as { amount_cents: number }[]).reduce((n, m) => n + m.amount_cents, 0);
};

describe.skipIf(!dbAvailable)("rendición atómica (integration · #359)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("dos rendiciones simultáneas del mismo mozo pagan la propina una vez", async () => {
    await cobroDelMozo(1_100_000, 100_000);
    const [a, b] = await Promise.all([
      registrarRendicionMozo(s.ctx.mozoId, 0, null, s.ctx.slug),
      registrarRendicionMozo(s.ctx.mozoId, 0, null, s.ctx.slug),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await propinasPagadas()).toBe(100_000);
    const { count } = await s.sb
      .from("mozo_rendiciones")
      .select("id", { count: "exact", head: true })
      .eq("mozo_id", s.ctx.mozoId);
    expect(count).toBe(1);
  });

  it("la rendición con propina deja la fila y el movimiento con la misma hora", async () => {
    await cobroDelMozo(550_000, 50_000);
    const r = await registrarRendicionMozo(s.ctx.mozoId, 0, null, s.ctx.slug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.propina_pagada_cents).toBe(50_000);
    const { data: mov } = await s.sb
      .from("caja_movimientos")
      .select("created_at, mozo_id")
      .eq("business_id", s.ctx.businessId)
      .eq("kind", "propina")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(new Date(mov!.created_at).getTime()).toBe(
      new Date(r.data.rendicion.created_at).getTime(),
    );
  });
});
