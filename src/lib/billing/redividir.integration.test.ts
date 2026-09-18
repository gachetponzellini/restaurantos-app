// @vitest-environment node
//
// #354 — dividir una cuenta que ya tiene cobros reparte el SALDO, no el total.
//
// Caso real (kcc, 2026-09-18): cuenta de $150.100, se cobró una sub-cuenta de
// $47.100, se re-dividió y las sub-cuentas nuevas sumaban los $150.100 enteros.
// Para que cerrara hubo que anular el cobro y volver a cobrarlo.
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

const { dividirPorPersonas, dividirPorMonto, dividirPorItems, dividirPorComensal } =
  await import("./cuenta-actions");
const { registrarPago } = await import("./cobro-actions");

const s = crearSalon(`test-redividir-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const cobrar = (orderId: string, amount: number, splitId: string | null, method = "card_manual") =>
  registrarPago({
    orderId,
    splitId,
    method: method as "card_manual",
    amount_cents: amount,
    tip_cents: 0,
    caja_id: s.ctx.cajaId,
    slug: s.ctx.slug,
    requestId: crypto.randomUUID(),
  });

describe.skipIf(!dbAvailable)("re-dividir con cobros (integration · #354)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("el caso de kcc: cobrar una sub-cuenta y re-dividir por monto reparte el saldo", async () => {
    const { orderId } = await s.mesa([15_010_000]);
    await dividirPorMonto(orderId, [4_710_000], s.ctx.slug);
    const [primera] = await s.subcuentasVivas(orderId);
    expect((await cobrar(orderId, 4_710_000, primera.id)).ok).toBe(true);

    // Se re-divide: lo que queda son $103.000.
    const r = await dividirPorMonto(orderId, [5_000_000], s.ctx.slug);
    expect(r.ok).toBe(true);
    const vivas = await s.subcuentasVivas(orderId);
    expect(vivas.reduce((n, x) => n + x.expected_amount_cents, 0)).toBe(10_300_000);

    for (const sc of vivas) {
      expect((await cobrar(orderId, sc.expected_amount_cents, sc.id)).ok).toBe(true);
    }
    const o = await s.orden(orderId);
    expect(o.lifecycle_status).toBe("closed");
    expect(o.total_paid_cents).toBe(15_010_000);
    const cobrado = (await s.pagosVivos(orderId)).reduce((n, p) => n + p.amount_cents, 0);
    expect(cobrado).toBe(15_010_000);
  });

  it("dividir por personas después de un pago parcial reparte el saldo y la propina que falta", async () => {
    const { orderId } = await s.mesa([1_000_000], { tip: 100_000 });
    // Pago parcial sin dividir: $5.000 con tarjeta (lleva la propina entera).
    expect((await cobrar(orderId, 500_000, null)).ok).toBe(true);

    const r = await dividirPorPersonas(orderId, 2, s.ctx.slug);
    expect(r.ok).toBe(true);
    const vivas = await s.subcuentasVivas(orderId);
    expect(vivas.reduce((n, x) => n + x.expected_amount_cents, 0)).toBe(600_000);
    // La propina ya viajó entera en el primer pago.
    expect(vivas.reduce((n, x) => n + x.tip_cents, 0)).toBe(0);

    for (const sc of vivas) {
      expect((await cobrar(orderId, sc.expected_amount_cents, sc.id)).ok).toBe(true);
    }
    const pagos = await s.pagosVivos(orderId);
    expect(pagos.reduce((n, p) => n + p.amount_cents, 0)).toBe(1_100_000);
    expect(pagos.reduce((n, p) => n + p.tip_cents, 0)).toBe(100_000);
    expect((await s.orden(orderId)).lifecycle_status).toBe("closed");
  });

  it("dividir por ítems con cobros previos se rechaza", async () => {
    const { orderId, itemIds } = await s.mesa([500_000, 500_000]);
    expect((await cobrar(orderId, 300_000, null)).ok).toBe(true);
    const r = await dividirPorItems(orderId, { 1: [itemIds[0]], 2: [itemIds[1]] }, s.ctx.slug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya se cobr/i);
  });

  it("dividir por comensal con cobros previos se rechaza", async () => {
    const { orderId } = await s.mesa([500_000, 500_000]);
    expect((await cobrar(orderId, 300_000, null)).ok).toBe(true);
    const r = await dividirPorComensal(orderId, s.ctx.slug);
    expect(r.ok).toBe(false);
  });

  it("una cuenta ya cubierta no se divide", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    await dividirPorPersonas(orderId, 2, s.ctx.slug);
    const vivas = await s.subcuentasVivas(orderId);
    // Se cobra una sola sub-cuenta y se re-divide lo que falta.
    expect((await cobrar(orderId, vivas[0].expected_amount_cents, vivas[0].id)).ok).toBe(true);
    const r = await dividirPorPersonas(orderId, 3, s.ctx.slug);
    expect(r.ok).toBe(true);
    const nuevas = await s.subcuentasVivas(orderId);
    expect(nuevas.reduce((n, x) => n + x.expected_amount_cents, 0)).toBe(500_000);
  });
});
