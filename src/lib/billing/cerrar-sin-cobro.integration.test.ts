// @vitest-environment node
//
// 0126 — «Cerrar sin cobro»: la mesa de $0 (una invitación total) se cierra
// dejando rastro, en vez de quedar abierta trabando el cierre de caja o de
// tener que ANULARLA (que borra la venta del día y devuelve el stock de una
// comida que sí se sirvió).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearSalon, dbAvailable } from "./test-helpers/salon-fixture";

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

const { cerrarSinCobro } = await import("./cerrar-sin-cobro");

const s = crearSalon(`test-sincobro-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

/** Una mesa invitada: $10.000 de carta con 100 % de descuento. */
async function mesaInvitada() {
  const m = await s.mesa([600_000, 400_000]);
  await s.sb
    .from("orders")
    .update({ discount_cents: 1_000_000, discount_reason: "Invitación de la casa", total_cents: 0 })
    .eq("id", m.orderId);
  return m;
}

describe.skipIf(!dbAvailable)("cerrar sin cobro (integration · 0126)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("cierra la mesa de $0, libera la mesa y deja escrito quién invitó y cuánto valía", async () => {
    const m = await mesaInvitada();
    const r = await cerrarSinCobro(m.orderId, "Cumpleaños del dueño", s.ctx.slug);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);

    const { data: o } = await s.sb
      .from("orders")
      .select("lifecycle_status, status, payment_status, cortesia_reason, cortesia_by, cortesia_valor_cents, closed_at")
      .eq("id", m.orderId)
      .single();
    expect(o!.lifecycle_status).toBe("closed");
    expect(o!.status).toBe("delivered");
    expect(o!.cortesia_reason).toBe("Cumpleaños del dueño");
    expect(o!.cortesia_by).toBe(s.ctx.encargadoId);
    expect(o!.cortesia_valor_cents).toBe(1_000_000);
    expect(o!.closed_at).not.toBeNull();

    const { data: t } = await s.sb
      .from("tables")
      .select("operational_status, current_order_id")
      .eq("id", m.tableId)
      .single();
    expect(t!.operational_status).toBe("libre");
    expect(t!.current_order_id).toBeNull();

    // Ni pago ni comprobante: no entró plata y no hay nada que declarar.
    expect(await s.pagosVivos(m.orderId)).toHaveLength(0);
  });

  it("una cuenta que SÍ debe plata no se cierra sin cobro", async () => {
    const m = await s.mesa([500_000]);
    const r = await cerrarSinCobro(m.orderId, "me olvidé", s.ctx.slug);
    expect(r.ok).toBe(false);
    expect((await s.orden(m.orderId)).lifecycle_status).toBe("open");
  });

  it("pide motivo", async () => {
    const m = await mesaInvitada();
    const r = await cerrarSinCobro(m.orderId, "   ", s.ctx.slug);
    expect(r.ok).toBe(false);
  });

  it("el mozo no puede: invitar es del encargado o el dueño", async () => {
    const m = await mesaInvitada();
    CURRENT_USER_ID = s.ctx.mozoId;
    const r = await cerrarSinCobro(m.orderId, "invito yo", s.ctx.slug);
    CURRENT_USER_ID = s.ctx.encargadoId;
    expect(r.ok).toBe(false);
    expect((await s.orden(m.orderId)).lifecycle_status).toBe("open");
  });

  it("una mesa vacía no es una invitación: eso es liberar la mesa", async () => {
    const m = await s.mesa([0]);
    await s.sb.from("order_items").delete().eq("order_id", m.orderId);
    const r = await cerrarSinCobro(m.orderId, "nada", s.ctx.slug);
    expect(r.ok).toBe(false);
  });
});
