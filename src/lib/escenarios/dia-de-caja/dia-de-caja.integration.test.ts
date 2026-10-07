// @vitest-environment node
//
// Regresión de la operación diaria: «un día de caja» entero, con las mismas
// actions que la app, en un negocio descartable. Verifica cada caso, las
// cuentas de cada caja y cada mozo contra lo calculado a mano, que no se pueda
// cerrar con cosas pendientes, y que al cerrar todo dé diferencia $0.
//
// El catálogo de casos está en ./escenario.ts. Para dejar el mismo día armado
// en el negocio demo y cerrarlo a mano: `pnpm escenario:demo`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(url && key);

// La sesión: el usuario que «está usando la app» lo fija el escenario.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: globalThis.__ESCENARIO_ACTOR__ } }, error: null }),
      getUser: async () => ({ data: { user: { id: globalThis.__ESCENARIO_ACTOR__ } }, error: null }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { crearNegocioDePrueba } = await import("./negocio");
const { jugarElDia, totales } = await import("./escenario");
const { cerrarElDia, esperadoDe, saldosDe, mesasAbiertas } = await import("./cierre");
const { cerrarCaja } = await import("@/lib/caja/actions");
const { setActor } = await import("./escenario");

type Negocio = Awaited<ReturnType<typeof crearNegocioDePrueba>>;
type Dia = Awaited<ReturnType<typeof jugarElDia>>;

describe.skipIf(!dbAvailable)("un día de caja (regresión de la operación)", () => {
  const sb = createClient(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });
  let n: Negocio;
  let dia: Dia;
  const inicio = { principal: 0, bar: 0 };

  beforeAll(async () => {
    n = await crearNegocioDePrueba(sb, `test-dia-caja-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    inicio.principal = await esperadoDe(n, n.cajas.principal);
    inicio.bar = await esperadoDe(n, n.cajas.bar);
    dia = await jugarElDia(n);
  }, 240_000);

  afterAll(async () => {
    await n?.teardown();
  }, 60_000);

  it("cada cuenta queda como tiene que quedar", async () => {
    const malas: string[] = [];
    for (const c of dia.casos) {
      if (!c.orderId || !c.estado) continue;
      const { data: o } = await sb
        .from("orders")
        .select("lifecycle_status, payment_status, total_cents, total_paid_cents")
        .eq("id", c.orderId)
        .single();
      const real =
        o!.lifecycle_status === "cancelled" ? "cancelada" : o!.lifecycle_status === "closed" ? "cerrada" : "abierta";
      if (real !== c.estado) malas.push(`${c.id}: quedó ${real}, se esperaba ${c.estado}`);
      if (c.estado === "cerrada" && o!.payment_status !== "paid") malas.push(`${c.id}: cerrada pero ${o!.payment_status}`);
      if (c.pagado !== undefined && o!.total_paid_cents !== c.pagado) {
        malas.push(`${c.id}: pagado ${o!.total_paid_cents}, se esperaba ${c.pagado}`);
      }
      if (c.pendiente && o!.total_cents - o!.total_paid_cents !== c.pendiente.falta) {
        malas.push(`${c.id}: falta ${o!.total_cents - o!.total_paid_cents}, se esperaba ${c.pendiente.falta}`);
      }
    }
    expect(malas).toEqual([]);
  });

  it("el cajón de cada caja espera lo calculado a mano", async () => {
    const t = totales(dia);
    expect(await esperadoDe(n, n.cajas.principal)).toBe(inicio.principal + t.cajon.principal);
    expect(await esperadoDe(n, n.cajas.bar)).toBe(inicio.bar + t.cajon.bar);
  });

  it("cada mozo tiene para entregar lo calculado a mano, en cada caja", async () => {
    const t = totales(dia);
    const quien = new Map(Object.entries(n.gente).map(([p, id]) => [id, p]));
    const caja = new Map([[n.cajas.principal, "principal"], [n.cajas.bar, "bar"]]);
    const real = new Map<string, number>();
    for (const s of await saldosDe(n)) {
      if (s.saldo_cents === 0) continue;
      real.set(`${quien.get(s.mozo_id)}|${caja.get(s.caja_id)}`, s.saldo_cents);
    }
    const esperado = new Map([...t.saldos].filter(([, v]) => v !== 0));
    expect(Object.fromEntries(real)).toEqual(Object.fromEntries(esperado));
  });

  it("con mesas abiertas no cierra ninguna caja", async () => {
    expect((await mesasAbiertas(n)).length).toBe(2);
    setActor(n.gente.encargada);
    const e = await esperadoDe(n, n.cajas.bar);
    const r = await cerrarCaja({
      cajaId: n.cajas.bar, closing_cash_cents: e, closing_notes: null, denomination_count: null,
      retirar: true, businessSlug: n.slug, expected_visto_cents: e,
    });
    expect(r.ok).toBe(false);
  });

  it("al cerrar el día todo cuadra: cada caja con diferencia $0 y el turno cerrado", async () => {
    const t = totales(dia);
    const pendiente = dia.casos.reduce((a, c) => a + (c.pendiente?.falta ?? 0), 0);
    const r = await cerrarElDia(n);
    expect(r.mesasCobradas).toBe(2);
    expect(r.turnoCerrado).toBe(true);
    expect(r.cortes.every((c) => c.diferencia === 0)).toBe(true);
    // Lo que se contó = lo que entró al cajón + lo que entregaron los mozos.
    const contado = r.cortes.reduce((a, c) => a + c.contado, 0);
    const saldosMozos = [...t.saldos.values()].reduce((a, v) => a + v, 0);
    expect(contado).toBe(inicio.principal + inicio.bar + t.cajon.principal + t.cajon.bar + saldosMozos + pendiente);
    expect((await saldosDe(n)).every((s) => s.resuelto)).toBe(true);
  }, 120_000);
});
