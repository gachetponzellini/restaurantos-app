/**
 * Cerrar el día como lo haría la encargada: cobrar lo que quedó abierto, rendir
 * a cada mozo lo justo, contar cada caja (lo que dice que debería haber) y
 * cerrar el turno. Con las mismas actions que la pantalla.
 *
 * Lo usan el test de regresión (para verificar que todo cierra en $0) y la
 * preparación del demo (para arrancar el día limpio).
 */
import { randomUUID } from "node:crypto";

import { registrarPago } from "@/lib/billing/cobro-actions";
import { anularMesa } from "@/lib/mozo/actions";
import { cerrarCaja } from "@/lib/caja/actions";
import { rendirMozo, cerrarTurno } from "@/lib/caja/turno-actions";

import type { Negocio } from "./negocio";
import { setActor } from "./escenario";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
function ok<T>(r: ActionResult<T>, que: string): T {
  if (!r.ok) throw new Error(`${que}: ${r.error}`);
  return r.data;
}

export type ResultadoCierre = {
  mesasCobradas: number;
  mesasAnuladas: number;
  rendiciones: number;
  cortes: { caja: string; esperado: number; contado: number; diferencia: number }[];
  turnoCerrado: boolean;
};

export async function esperadoDe(n: Negocio, cajaId: string): Promise<number> {
  const { data, error } = await n.sb.rpc("efectivo_esperado_caja", {
    p_caja_id: cajaId,
    p_hasta: new Date(Date.now() + 1000).toISOString(),
  });
  if (error) throw error;
  return Number(data);
}

export async function saldosDe(n: Negocio) {
  const { data, error } = await n.sb.rpc("saldos_mozos", { p_business_id: n.businessId });
  if (error) throw error;
  return (data ?? []) as { mozo_id: string; caja_id: string; saldo_cents: number; resuelto: boolean }[];
}

/** Mesas con la cuenta abierta (lo que bloquea cerrar una caja). */
export async function mesasAbiertas(n: Negocio) {
  const { data } = await n.sb
    .from("orders")
    .select("id, table_id, mozo_id, total_cents, total_paid_cents, tables!orders_table_id_fkey(mozo_id)")
    .eq("business_id", n.businessId)
    .eq("lifecycle_status", "open")
    .not("table_id", "is", null);
  return (data ?? []) as unknown as {
    id: string;
    table_id: string;
    mozo_id: string | null;
    total_cents: number;
    total_paid_cents: number;
    tables: { mozo_id: string | null } | null;
  }[];
}

/**
 * El C43 deja una cuenta cerrada con saldo (contracargo de MP): es lo que hace
 * la app, y en el día queda a la vista en el aviso de «cuentas con saldo». Al
 * re-armar el demo, las de corridas anteriores se saldan como se saldaría una
 * de verdad (el cliente vuelve y paga en efectivo) ANTES de cerrar ese día, así
 * no se acumulan.
 */
export async function saldarContracargosViejos(n: Negocio): Promise<number> {
  const { data } = await n.sb
    .from("orders")
    .select("id, total_cents, total_paid_cents")
    .eq("business_id", n.businessId)
    .eq("customer_name", "Devolución Prueba")
    .eq("lifecycle_status", "closed")
    .neq("payment_status", "paid");
  let saldadas = 0;
  setActor(n.gente.encargada);
  for (const o of (data ?? []) as { id: string; total_cents: number; total_paid_cents: number }[]) {
    const falta = o.total_cents - o.total_paid_cents;
    if (falta <= 0) continue;
    ok(
      await registrarPago({
        orderId: o.id,
        splitId: null,
        method: "cash",
        amount_cents: falta,
        tip_cents: 0,
        caja_id: n.cajas.principal,
        slug: n.slug,
        requestId: randomUUID(),
      }),
      "saldar contracargo viejo",
    );
    saldadas++;
  }
  return saldadas;
}

export async function cerrarElDia(n: Negocio): Promise<ResultadoCierre> {
  const r: ResultadoCierre = { mesasCobradas: 0, mesasAnuladas: 0, rendiciones: 0, cortes: [], turnoCerrado: false };

  // 1 · Lo que quedó abierto: lo cobra en efectivo el mozo de la mesa; una
  //     cuenta vacía se anula.
  for (const o of await mesasAbiertas(n)) {
    const falta = o.total_cents - o.total_paid_cents;
    if (falta <= 0 && o.total_paid_cents === 0) {
      setActor(n.gente.encargada);
      ok(await anularMesa(o.table_id, "Cierre del día: mesa vacía", n.slug), "anular mesa vacía");
      r.mesasAnuladas++;
      continue;
    }
    setActor(o.tables?.mozo_id ?? o.mozo_id ?? n.gente.encargada);
    ok(
      await registrarPago({
        orderId: o.id,
        splitId: null,
        method: "cash",
        amount_cents: falta,
        tip_cents: 0,
        caja_id: n.cajas.principal,
        slug: n.slug,
        requestId: randomUUID(),
      }),
      "cobrar lo que faltaba",
    );
    r.mesasCobradas++;
  }

  // 2 · Rendir: cada mozo entrega lo justo; si la caja le debe, se le paga.
  setActor(n.gente.encargada);
  for (const s of await saldosDe(n)) {
    if (s.resuelto) continue;
    ok(
      await rendirMozo({
        slug: n.slug,
        mozoId: s.mozo_id,
        cajaId: s.caja_id,
        entregadoCents: Math.max(0, s.saldo_cents),
        esperadoCents: s.saldo_cents,
      }),
      "rendir",
    );
    r.rendiciones++;
  }

  // 3 · Contar cada caja con movimiento: lo que debería haber, justo.
  const { data: sinContar, error } = await n.sb.rpc("cajas_sin_contar", { p_business_id: n.businessId });
  if (error) throw error;
  for (const c of (sinContar ?? []) as { caja_id: string; caja_name: string }[]) {
    const esperado = await esperadoDe(n, c.caja_id);
    const corte = ok(
      await cerrarCaja({
        cajaId: c.caja_id,
        closing_cash_cents: Math.max(0, esperado),
        closing_notes: "Cierre del escenario «día de caja»",
        denomination_count: null,
        retirar: true,
        businessSlug: n.slug,
        expected_visto_cents: esperado,
      }),
      `cerrar ${c.caja_name}`,
    ) as { corte: { expected_cash_cents: number; closing_cash_cents: number; difference_cents: number } };
    r.cortes.push({
      caja: c.caja_name,
      esperado: corte.corte.expected_cash_cents,
      contado: corte.corte.closing_cash_cents,
      diferencia: corte.corte.difference_cents,
    });
  }

  // 4 · El turno.
  ok(await cerrarTurno({ slug: n.slug }), "cerrar el turno");
  r.turnoCerrado = true;
  return r;
}
