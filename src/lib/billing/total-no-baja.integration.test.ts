// @vitest-environment node
//
// #357 — el total de una cuenta nunca queda por debajo de lo que ya se cobró.
//
// Sacar un ítem, bajar la propina o aplicar un descuento después de un cobro
// parcial podía dejar `total < pagado`: la cuenta quedaba abierta para siempre
// (ningún camino la cerraba: cobrar daba «ya está pagada») y trababa el cierre
// de caja. La guarda vive en la base, así cubre todos los caminos que tocan
// ítems o totales; las actions además la anticipan con un mensaje claro.
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

const { cancelarItemEnCuenta, aplicarPropinaYDescuento } = await import("./cuenta-actions");
const { registrarPago } = await import("./cobro-actions");

const s = crearSalon(`test-totalnobaja-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

const cobrar = (orderId: string, amount: number) =>
  registrarPago({
    orderId,
    splitId: null,
    method: "card_manual",
    amount_cents: amount,
    tip_cents: 0,
    caja_id: s.ctx.cajaId,
    slug: s.ctx.slug,
    requestId: crypto.randomUUID(),
  });

describe.skipIf(!dbAvailable)("el total no baja de lo cobrado (integration · #357)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("sacar un ítem que deja el total por debajo de lo cobrado se rechaza y no saca nada", async () => {
    const { orderId, itemIds } = await s.mesa([500_000, 500_000]);
    expect((await cobrar(orderId, 800_000)).ok).toBe(true);

    const r = await cancelarItemEnCuenta(itemIds[1], "no lo pidieron", s.ctx.slug);
    expect(r.ok).toBe(false);
    const { data: item } = await s.sb
      .from("order_items")
      .select("cancelled_at")
      .eq("id", itemIds[1])
      .single();
    expect(item!.cancelled_at).toBeNull();
    expect((await s.orden(orderId)).total_cents).toBe(1_000_000);
  });

  it("sacar el ítem que no se pagó, con lo cobrado justo, cierra la cuenta", async () => {
    const { orderId, itemIds } = await s.mesa([500_000, 500_000]);
    expect((await cobrar(orderId, 500_000)).ok).toBe(true);

    const r = await cancelarItemEnCuenta(itemIds[1], "no lo pidieron", s.ctx.slug);
    expect(r.ok).toBe(true);
    const o = await s.orden(orderId);
    expect(o.total_cents).toBe(500_000);
    expect(o.lifecycle_status).toBe("closed");
    expect(o.payment_status).toBe("paid");
  });

  it("con cobros registrados se puede SUBIR la propina o descontar, mientras la cuenta no quede bajo lo cobrado", async () => {
    // La primera versión de #357 bloqueaba cualquier cambio con cobros. Era
    // demasiado: el descuento se guarda en pesos pero la pantalla lo maneja en
    // %, así que agregar un plato después de un pago parcial lo «ensuciaba» y
    // «Pasar a cobro» quedaba trabado pidiendo anular el cobro. La regla real
    // es la de la base: el total no baja de lo cobrado, y la propina no baja de
    // la que ya viajó en un pago.
    const { orderId } = await s.mesa([1_000_000]);
    expect((await cobrar(orderId, 300_000)).ok).toBe(true);

    const sube = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 100_000, discount_cents: 0, discount_reason: null },
      s.ctx.slug,
    );
    expect(sube.ok).toBe(true);
    expect((await s.orden(orderId)).total_cents).toBe(1_100_000);

    const descuenta = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 100_000, discount_cents: 200_000, discount_reason: "cliente frecuente" },
      s.ctx.slug,
    );
    expect(descuenta.ok).toBe(true);
    expect((await s.orden(orderId)).total_cents).toBe(900_000);
  });

  it("un descuento que deja la cuenta bajo lo cobrado se rechaza con motivo", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    expect((await cobrar(orderId, 900_000)).ok).toBe(true);
    // El 25 % es el techo del encargado, y alcanza para pasarse.
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 250_000, discount_reason: "error" },
      s.ctx.slug,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/por debajo de lo que ya se cobró/);
    expect((await s.orden(orderId)).total_cents).toBe(1_000_000);
  });

  it("la propina no baja de la que ya viajó en un pago", async () => {
    const { orderId } = await s.mesa([1_000_000], { tip: 100_000 });
    // Pago que cubre la propina entera (la base se la asigna, #353).
    expect((await cobrar(orderId, 500_000)).ok).toBe(true);
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 20_000, discount_cents: 0, discount_reason: null },
      s.ctx.slug,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/propina/i);
  });

  it("la base rechaza bajar el total de una cuenta por debajo de lo cobrado, venga de donde venga", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    expect((await cobrar(orderId, 800_000)).ok).toBe(true);
    const { error } = await s.sb
      .from("orders")
      .update({ discount_cents: 500_000, total_cents: 500_000 })
      .eq("id", orderId);
    expect(error?.message).toContain("TOTAL_BELOW_PAID");
  });

  it("cancelar la cuenta entera no choca con la guarda", async () => {
    const { orderId } = await s.mesa([1_000_000]);
    const { error } = await s.sb
      .from("orders")
      .update({ status: "cancelled", total_cents: 0 })
      .eq("id", orderId);
    expect(error).toBeNull();
  });
});
