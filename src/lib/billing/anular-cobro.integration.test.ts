// @vitest-environment node
//
// #355 — anular el cobro completo de una cuenta es UNA transacción y devuelve
// la propina del excedente.
//
// Antes eran seis escrituras sueltas (reabrir, reembolsar, auditar, borrar
// pendientes, resetear sub-cuentas, resetear total): un fallo en el medio
// dejaba la cuenta a medio anular. Y no revertía `extra_tip_cents` — el fix de
// #339 sólo había llegado a anular UNA línea —, así que al volver a cobrar se
// cobraba otra vez la propina fantasma.
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

const { registrarPago, anularCobro } = await import("./cobro-actions");
const { dividirPorPersonas } = await import("./cuenta-actions");

const s = crearSalon(`test-anularcobro-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const cobrar = (orderId: string, amount: number, splitId: string | null = null) =>
  registrarPago({
    orderId,
    splitId,
    method: "card_manual",
    amount_cents: amount,
    tip_cents: 0,
    caja_id: s.ctx.cajaId,
    slug: s.ctx.slug,
    requestId: crypto.randomUUID(),
  });

describe.skipIf(!dbAvailable)("anular el cobro completo (integration · #355)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("devuelve la propina del excedente y deja la cuenta como antes de cobrar", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    // Tarjeta por $12.000 sobre $10.000: $2.000 de propina por excedente.
    const r = await cobrar(orderId, 1_200_000);
    expect(r.ok).toBe(true);
    let o = await s.orden(orderId);
    expect(o.total_cents).toBe(1_200_000);
    expect(o.lifecycle_status).toBe("closed");

    const a = await anularCobro(orderId, "se cobró la mesa equivocada", s.ctx.slug);
    expect(a.ok).toBe(true);
    o = await s.orden(orderId);
    expect(o.lifecycle_status).toBe("open");
    expect(o.tip_cents).toBe(0);
    expect(o.total_cents).toBe(1_000_000);
    expect(o.total_paid_cents).toBe(0);
    expect(o.payment_status).toBe("pending");
    expect(await s.pagosVivos(orderId)).toHaveLength(0);

    // Se vuelve a cobrar lo que se debe, sin la propina fantasma.
    expect((await cobrar(orderId, 1_000_000)).ok).toBe(true);
    expect((await s.orden(orderId)).lifecycle_status).toBe("closed");
  });

  it("deja rastro en el libro por cada línea reembolsada", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    await dividirPorPersonas(orderId, 2, s.ctx.slug);
    const [a, b] = await s.subcuentasVivas(orderId);
    await cobrar(orderId, a.expected_amount_cents, a.id);
    await cobrar(orderId, b.expected_amount_cents, b.id);
    const ids = (await s.pagosVivos(orderId)).map((p) => p.id);

    expect((await anularCobro(orderId, "error", s.ctx.slug)).ok).toBe(true);
    const { data: audit } = await s.sb
      .from("caja_audit_log")
      .select("entity_id, to_value, by_user_id")
      .in("entity_id", ids);
    expect(audit).toHaveLength(2);
    expect((audit ?? []).every((x) => x.by_user_id === s.ctx.encargadoId)).toBe(true);

    // Las sub-cuentas vuelven a estar por cobrar.
    const vivas = await s.subcuentasVivas(orderId);
    expect(vivas.every((x) => x.paid_amount_cents === 0 && x.status === "pending")).toBe(true);
  });

  it("si la mesa ya tiene otra cuenta abierta no toca un peso", async () => {
    const { orderId, tableId } = await s.mesa([1_000_000]);
    expect((await cobrar(orderId, 1_000_000)).ok).toBe(true);
    // Se sentó gente nueva en la misma mesa.
    await s.sb.from("orders").insert({
      business_id: s.ctx.businessId,
      customer_name: "Nuevos",
      customer_phone: "0",
      delivery_type: "dine_in",
      table_id: tableId,
      subtotal_cents: 0,
      total_cents: 0,
      lifecycle_status: "open",
    });

    const a = await anularCobro(orderId, "error", s.ctx.slug);
    expect(a.ok).toBe(false);
    expect(await s.pagosVivos(orderId)).toHaveLength(1);
    expect((await s.orden(orderId)).lifecycle_status).toBe("closed");
  });
});
