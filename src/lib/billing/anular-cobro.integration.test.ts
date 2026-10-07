// @vitest-environment node
//
// #355 — anular el cobro completo de una cuenta es UNA transacción y devuelve
// la propina del excedente. Spec 212 (#385): sólo con la cuenta abierta; una
// cuenta cobrada y cerrada no se anula, se corrige.
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

  it("en una cuenta abierta: devuelve la propina del excedente y la deja como antes de cobrar", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    await dividirPorPersonas(orderId, 2, s.ctx.slug);
    const [a] = await s.subcuentasVivas(orderId);
    // Tarjeta por $6.000 sobre una sub-cuenta de $5.000: $1.000 de propina por excedente.
    const r = await cobrar(orderId, 600_000, a.id);
    expect(r.ok).toBe(true);
    let o = await s.orden(orderId);
    expect(o.tip_cents).toBe(100_000);
    expect(o.lifecycle_status).toBe("open");

    const anulado = await anularCobro(orderId, "se cobró la mesa equivocada", s.ctx.slug);
    expect(anulado.ok).toBe(true);
    o = await s.orden(orderId);
    expect(o.lifecycle_status).toBe("open");
    expect(o.tip_cents).toBe(0);
    expect(o.total_cents).toBe(1_000_000);
    expect(o.total_paid_cents).toBe(0);
    expect(await s.pagosVivos(orderId)).toHaveLength(0);
  });

  it("en una cuenta abierta: deja rastro en el libro por cada línea reembolsada", async () => {
    const { orderId } = await s.mesa([1_500_000]);
    await dividirPorPersonas(orderId, 3, s.ctx.slug);
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

  it("spec 212 · una cuenta cobrada y cerrada no se anula: no toca un peso", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    expect((await cobrar(orderId, 1_000_000)).ok).toBe(true);
    expect((await s.orden(orderId)).lifecycle_status).toBe("closed");

    const r = await anularCobro(orderId, "error", s.ctx.slug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no se anula, se corrige/);
    expect(await s.pagosVivos(orderId)).toHaveLength(1);
    expect((await s.orden(orderId)).lifecycle_status).toBe("closed");
  });
});
