// @vitest-environment node
//
// `pnpm escenario:demo` — arma «un día de caja» en el negocio demo de la base
// LOCAL y lo deja abierto para cerrarlo a mano:
//
//   1. Si quedó algo del día anterior (mesas abiertas, mozos sin rendir, cajas
//      sin contar), lo cierra como lo haría la encargada.
//   2. Juega los 30 casos de ./escenario.ts con Sofía, Pedro, Lucía y Diego.
//   3. Verifica que cada cuenta y cada número den lo calculado a mano.
//   4. Imprime la hoja con lo que tiene que dar el cierre.
//
// Se puede correr cuantas veces se quiera: cada corrida cierra la anterior y
// arma un día nuevo. Nunca corre contra la base cloud (salvo que se pida
// explícitamente con ESCENARIO_PERMITIR_CLOUD=1).
import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const esLocal = /localhost|127\.0\.0\.1/.test(url);

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

const { cargarNegocioDemo } = await import("./negocio");
const { jugarElDia, totales, pesos } = await import("./escenario");
const { cerrarElDia, esperadoDe, saldosDe, mesasAbiertas, saldarContracargosViejos } = await import("./cierre");

describe("preparar el demo: un día de caja abierto", () => {
  it("arma el día y deja la hoja del cierre", async () => {
    if (!esLocal && process.env.ESCENARIO_PERMITIR_CLOUD !== "1") {
      throw new Error(`La base no es local (${url}). Este escenario escribe datos: sólo corre contra la base local.`);
    }
    const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    // 1 · Arrancar limpio.
    let n = await cargarNegocioDemo(sb);
    const contracargos = await saldarContracargosViejos(n);
    const previo = await cerrarElDia(n);
    const anterior =
      `▸ Día anterior cerrado: ${previo.mesasCobradas} mesas cobradas, ${previo.mesasAnuladas} anuladas, ` +
      `${previo.rendiciones} rendiciones, ${previo.cortes.length} cajas contadas` +
      (contracargos ? `, ${contracargos} contracargo(s) viejo(s) saldado(s).` : ".");
    n = await cargarNegocioDemo(sb); // mesas libres de nuevo
    if (n.mesas.length < 44) throw new Error(`Demo tiene ${n.mesas.length} mesas libres; el escenario usa 44.`);

    const inicio = { principal: await esperadoDe(n, n.cajas.principal), bar: await esperadoDe(n, n.cajas.bar) };

    // 2 · El día.
    const dia = await jugarElDia(n);
    const t = totales(dia);

    // 3 · Que dé lo calculado a mano.
    const malas: string[] = [];
    for (const c of dia.casos) {
      if (!c.orderId || !c.estado) continue;
      const { data: o } = await sb
        .from("orders")
        .select("lifecycle_status, payment_status, total_cents, total_paid_cents")
        .eq("id", c.orderId)
        .single();
      const real = o!.lifecycle_status === "cancelled" ? "cancelada" : o!.lifecycle_status === "closed" ? "cerrada" : "abierta";
      if (real !== c.estado) malas.push(`${c.id}: quedó ${real}, se esperaba ${c.estado}`);
    }
    const ahora = { principal: await esperadoDe(n, n.cajas.principal), bar: await esperadoDe(n, n.cajas.bar) };
    if (ahora.principal !== inicio.principal + t.cajon.principal) malas.push(`Principal: cajón ${ahora.principal}, esperado ${inicio.principal + t.cajon.principal}`);
    if (ahora.bar !== inicio.bar + t.cajon.bar) malas.push(`Bar: cajón ${ahora.bar}, esperado ${inicio.bar + t.cajon.bar}`);

    const nombre = new Map(Object.entries(n.gente).map(([p, id]) => [id, p]));
    const cajaKey = new Map([[n.cajas.principal, "principal"], [n.cajas.bar, "bar"]]);
    const saldos = (await saldosDe(n)).filter((s) => s.saldo_cents !== 0);
    for (const s of saldos) {
      const k = `${nombre.get(s.mozo_id)}|${cajaKey.get(s.caja_id)}`;
      if ((t.saldos.get(k) ?? 0) !== s.saldo_cents) malas.push(`${k}: saldo ${s.saldo_cents}, esperado ${t.saldos.get(k) ?? 0}`);
    }

    // 4 · La hoja.
    const pendientes = dia.casos.filter((c) => c.pendiente);
    const totalPendiente = pendientes.reduce((a, c) => a + c.pendiente!.falta, 0);
    const saldoCaja = (caja: string) =>
      [...t.saldos].filter(([k]) => k.endsWith(`|${caja}`)).reduce((a, [, v]) => a + v, 0);
    const lineas = [
      "",
      "════════════════════════ DÍA DE CAJA ARMADO EN «demo» ════════════════════════",
      anterior,
      "",
      ...dia.casos.map((c) => `  ${c.id}  ${c.titulo}${c.estado === "abierta" ? "   ← QUEDA ABIERTA" : ""}`),
      "",
      "Ahora, antes de cerrar:",
      `  Caja Principal — el cajón debería tener ${pesos(ahora.principal)}`,
      `  Caja Bar       — el cajón debería tener ${pesos(ahora.bar)}`,
      ...saldos.map((s) => `  ${nombre.get(s.mozo_id)!.padEnd(10)} en ${cajaKey.get(s.caja_id) === "bar" ? "la Bar      " : "la Principal"} ${s.saldo_cents < 0 ? "la caja le debe" : "tiene que entregar"} ${pesos(Math.abs(s.saldo_cents))}`),
      ...pendientes.map((c) => `  Mesa sin cobrar (${c.id}): falta ${pesos(c.pendiente!.falta)} — de ${c.pendiente!.quien}`),
      "",
      "Si cobrás las dos mesas en EFECTIVO en la Principal y rendís a todos lo justo:",
      `  Caja Principal debería cerrar en ${pesos(ahora.principal + saldoCaja("principal") + totalPendiente)}`,
      `  Caja Bar       debería cerrar en ${pesos(ahora.bar + saldoCaja("bar"))}`,
      "",
      "Reglas del negocio que usa: tarjeta +10%, transferencia −10%, Diego opera la Caja Bar.",
      "Volver a armarlo (cierra este día y arma otro): pnpm escenario:demo",
      "═══════════════════════════════════════════════════════════════════════════════",
    ];
    // El setup de vitest silencia `console`: la hoja va directo a la terminal y
    // a un archivo para tenerla a mano mientras se cierra.
    const hoja = lineas.join("\n") + "\n";
    process.stdout.write(hoja);
    mkdirSync(".escenarios", { recursive: true });
    writeFileSync(".escenarios/dia-de-caja-demo.txt", hoja);
    expect((await mesasAbiertas(n)).length).toBe(2);
    expect(malas).toEqual([]);
  });
});
