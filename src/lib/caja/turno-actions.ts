"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { formatCurrency } from "@/lib/currency";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { notifyRendicionPendiente } from "@/lib/notifications/events";
import { canCorregirCobro, canHacerCorte, canRendirMozo, canVerMiTurno } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { traducirErrorDeCaja as traducir } from "./mensajes-caja";

/**
 * Spec 210/211 v2 — las acciones de la caja nueva. Cada una es una RPC de la
 * base (0135–0139), que es la que valida y decide; acá van el permiso, el
 * rol del que opera y los mensajes en castellano.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericClient = SupabaseClient<any, "public", any>;
const db = () => createSupabaseServiceClient() as unknown as GenericClient;

/** Faltante desde el que la entrega de menos se le avisa al dueño (igual que antes). */
const AVISAR_FALTANTE_CENTS = 500_000;

async function contexto(slug: string) {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const ctx = await requireMozoActionContext(business.id);
  if (!ctx.ok) return ctx;
  return actionOk({ business, ...ctx.data });
}

function revalidar(slug: string) {
  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/mozo`);
}

export type ResultadoRendicion = {
  entregado_cents: number;
  propina_pagada_cents: number;
  saldo_restante_cents: number;
  diferencia_cents: number;
};

/** El mozo entrega plata a una caja (o la caja le paga la propina, si le debe). */
export async function rendirMozo(input: {
  slug: string;
  mozoId: string;
  cajaId: string;
  entregadoCents: number;
  notas?: string | null;
  /**
   * El saldo que veía la pantalla al confirmar. Si cambió (cobró otra mesa,
   * otro encargado le registró algo), no se registra sobre un número viejo.
   */
  esperadoCents?: number;
}): Promise<ActionResult<ResultadoRendicion>> {
  const c = await contexto(input.slug);
  if (!c.ok) return c;
  if (!canRendirMozo(c.data.role)) return actionError("Solo encargado o admin pueden registrar una rendición.");
  if (!Number.isSafeInteger(input.entregadoCents) || input.entregadoCents < 0) {
    return actionError("El monto entregado no es válido.");
  }

  if (input.esperadoCents !== undefined) {
    const { data: actual, error: saldoErr } = await db().rpc("saldo_mozo", {
      p_mozo_id: input.mozoId,
      p_caja_id: input.cajaId,
    });
    if (saldoErr) return actionError(traducir(saldoErr.message));
    if (Number(actual) !== input.esperadoCents) {
      return actionError(
        `El saldo cambió mientras lo mirabas: ahora es ${formatCurrency(Number(actual))}. Revisalo y volvé a confirmar.`,
      );
    }
  }

  const { data, error } = await db().rpc("rendir_mozo_tx", {
    p_business_id: c.data.business.id,
    p_mozo_id: input.mozoId,
    p_caja_id: input.cajaId,
    p_entregado_cents: input.entregadoCents,
    p_registrado_por: c.data.userId,
    p_notas: input.notas?.trim() || null,
  });
  if (error) return actionError(traducir(error.message));

  const r = data as {
    rendicion: { delivered_cash_cents: number; propina_pagada_cents: number; difference_cents: number; expected_cash_cents: number };
    saldo_restante: number;
  };
  const resultado: ResultadoRendicion = {
    entregado_cents: Number(r.rendicion.delivered_cash_cents),
    propina_pagada_cents: Number(r.rendicion.propina_pagada_cents),
    saldo_restante_cents: Number(r.saldo_restante),
    diferencia_cents: Number(r.rendicion.difference_cents),
  };

  // Un faltante grande se le avisa al dueño, como antes (best-effort).
  if (resultado.saldo_restante_cents >= AVISAR_FALTANTE_CENTS) {
    const { data: m } = await db()
      .from("business_users")
      .select("full_name")
      .eq("business_id", c.data.business.id)
      .eq("user_id", input.mozoId)
      .maybeSingle();
    await notifyRendicionPendiente({
      businessId: c.data.business.id,
      mozoName: (m as { full_name: string | null } | null)?.full_name ?? "Un mozo",
      estado: "rendida",
      expectedCents: Number(r.rendicion.expected_cash_cents),
      deliveredCents: resultado.entregado_cents,
      differenceCents: -resultado.saldo_restante_cents,
      reason: input.notas?.trim() || null,
      actorUserId: c.data.userId,
    }).catch(() => undefined);
  }

  revalidar(input.slug);
  return actionOk(resultado);
}

/** «No entregó»: la deuda queda reconocida con motivo y se le avisa al dueño. */
export async function reconocerDeuda(input: {
  slug: string;
  mozoId: string;
  cajaId: string;
  motivo: string;
}): Promise<ActionResult<{ deuda_cents: number }>> {
  const c = await contexto(input.slug);
  if (!c.ok) return c;
  if (!canRendirMozo(c.data.role)) return actionError("Solo encargado o admin pueden registrar una rendición.");

  const { data, error } = await db().rpc("reconocer_deuda_tx", {
    p_business_id: c.data.business.id,
    p_mozo_id: input.mozoId,
    p_caja_id: input.cajaId,
    p_motivo: input.motivo,
    p_registrado_por: c.data.userId,
  });
  if (error) return actionError(traducir(error.message));
  const deuda = Number((data as { expected_cash_cents: number }).expected_cash_cents);

  const { data: m } = await db()
    .from("business_users")
    .select("full_name")
    .eq("business_id", c.data.business.id)
    .eq("user_id", input.mozoId)
    .maybeSingle();
  await notifyRendicionPendiente({
    businessId: c.data.business.id,
    mozoName: (m as { full_name: string | null } | null)?.full_name ?? "Un mozo",
    estado: "no_entrego",
    expectedCents: deuda,
    deliveredCents: 0,
    differenceCents: -deuda,
    reason: input.motivo.trim(),
    actorUserId: c.data.userId,
  }).catch(() => undefined);

  revalidar(input.slug);
  return actionOk({ deuda_cents: deuda });
}

/** Deshace una entrega mal registrada: el saldo del mozo vuelve. */
export async function anularEntrega(input: {
  slug: string;
  rendicionId: string;
  motivo: string;
}): Promise<ActionResult<{ saldo_cents: number }>> {
  const c = await contexto(input.slug);
  if (!c.ok) return c;
  if (!canRendirMozo(c.data.role)) return actionError("Solo encargado o admin pueden anular una entrega.");

  const { data, error } = await db().rpc("anular_entrega_tx", {
    p_business_id: c.data.business.id,
    p_rendicion_id: input.rendicionId,
    p_motivo: input.motivo,
    p_anulada_por: c.data.userId,
  });
  if (error) return actionError(traducir(error.message));
  revalidar(input.slug);
  return actionOk({ saldo_cents: Number((data as { saldo: number }).saldo) });
}

/** Cierra el turno: con todas las cajas contadas, libera el salón y abre el siguiente. */
export async function cerrarTurno(input: {
  slug: string;
}): Promise<ActionResult<{ mesasLiberadas: number; mozosLimpiados: number }>> {
  const c = await contexto(input.slug);
  if (!c.ok) return c;
  if (!canHacerCorte(c.data.role)) return actionError("Solo encargado o admin pueden cerrar el turno.");

  const { data, error } = await db().rpc("cerrar_turno_tx", {
    p_business_id: c.data.business.id,
    p_por: c.data.userId,
    p_resumen: null,
  });
  if (error) return actionError(traducir(error.message));
  const r = data as { mesas_liberadas: number; mozos_limpiados: number };
  revalidar(input.slug);
  return actionOk({ mesasLiberadas: Number(r.mesas_liberadas), mozosLimpiados: Number(r.mozos_limpiados) });
}

export type EfectoDeCorreccion = {
  amount_cents: number;
  cajas: { caja_id: string; caja: string; antes: number; despues: number }[];
  mozos: { mozo_id: string; caja_id: string; mozo: string | null; caja: string; antes: number; despues: number }[];
};

/**
 * Vista previa de una corrección (spec 210 · R6): qué le pasa al «debería
 * haber» de cada caja y al saldo de cada mozo. Sólo lectura, con las mismas
 * funciones que van a correr al guardar.
 */
export async function efectoDeCorreccion(input: {
  slug: string;
  paymentId: string;
  patch: {
    method?: string;
    amount_cents?: number;
    tip_cents?: number;
    attributed_mozo_id?: string | null;
    caja_id?: string;
    anular?: boolean;
  };
}): Promise<ActionResult<EfectoDeCorreccion>> {
  const c = await contexto(input.slug);
  if (!c.ok) return c;
  if (!canCorregirCobro(c.data.role)) return actionError("No tenés permiso para corregir cobros.");

  const patch: Record<string, unknown> = { ...input.patch };
  if ("attributed_mozo_id" in patch) patch.attributed_mozo_id = patch.attributed_mozo_id ?? "";
  const { data, error } = await db().rpc("efecto_de_correccion", {
    p_business_id: c.data.business.id,
    p_payment_id: input.paymentId,
    p_patch: patch,
  });
  if (error) return actionError(traducir(error.message));
  const r = data as EfectoDeCorreccion;
  return actionOk({
    amount_cents: Number(r.amount_cents),
    cajas: (r.cajas ?? []).map((x) => ({ ...x, antes: Number(x.antes), despues: Number(x.despues) })),
    mozos: (r.mozos ?? []).map((x) => ({ ...x, antes: Number(x.antes), despues: Number(x.despues) })),
  });
}

export type MiTurno = {
  /** Una fila por caja en la que tiene plata (casi siempre una). */
  cajas: {
    caja_name: string;
    anterior_cents: number;
    efectivo_cents: number;
    propina_tarjeta_cents: number;
    propina_efectivo_cents: number;
    entregado_cents: number;
    pagado_cents: number;
    saldo_cents: number;
    deuda: boolean;
  }[];
  mesas_sin_cobrar: string[];
};

/**
 * Spec 211 · R7 — «Tu turno» en el celular del mozo: lo mismo que ve el
 * encargado (`saldos_mozos`), de él solo. El mozo sale de la sesión.
 */
export async function getMiTurno(slug: string): Promise<ActionResult<MiTurno>> {
  const c = await contexto(slug);
  if (!c.ok) return c;
  if (!canVerMiTurno(c.data.role)) return actionError("No tenés acceso a esto.");
  const { getSaldosMozos } = await import("./turno-queries");
  const { getMesasSinCobrarPorMozo } = await import("./queries");
  const { data: turno } = await db()
    .from("turnos")
    .select("abierto_at")
    .eq("business_id", c.data.business.id)
    .is("cerrado_at", null)
    .maybeSingle();
  const saldos = (
    await getSaldosMozos(c.data.business.id, (turno as { abierto_at: string } | null)?.abierto_at)
  ).filter((m) => m.mozo_id === c.data.userId);
  // Las mesas sin cobrar son del mozo, no de una caja: también las tiene el
  // que todavía no cobró nada (sin fila de saldo).
  const mesas = saldos[0]?.mesas_sin_cobrar ?? (await getMesasSinCobrarPorMozo(c.data.business.id)).get(c.data.userId) ?? [];
  return actionOk({
    cajas: saldos.map((m) => ({
      caja_name: m.caja_name,
      anterior_cents: m.anterior_cents,
      efectivo_cents: m.efectivo_cents,
      propina_tarjeta_cents: m.propina_tarjeta_cents,
      propina_efectivo_cents: m.propina_efectivo_cents,
      entregado_cents: m.entregado_cents,
      pagado_cents: m.pagado_cents,
      saldo_cents: m.saldo_cents,
      deuda: m.deuda,
    })),
    mesas_sin_cobrar: mesas.map((x) => x.tableLabel ?? "?"),
  });
}

// ── La liquidación del mozo (spec 213, #386) ────────────────────────────────

const METODO_LABEL: Record<string, string> = {
  card_manual: "Tarjeta",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  mp_manual: "Mercado Pago",
  transfer: "Transferencia",
  cuenta_corriente: "Cuenta corriente",
  other: "Otro",
};

/**
 * El papel que sale al tocar «Rendir»: cuánto tiene que entregar el mozo en
 * esa caja y cómo sale el número. Guarda la foto de los números en la cola de
 * la comandera (`print_jobs.kind = 'liquidacion'`).
 *
 * Sin `forzar`, si ya se imprimió una con los mismos números no imprime de
 * nuevo (D2): abrir la rendición para mirarla no gasta papel. Si el saldo
 * cambió (cobró otra mesa, entregó una parte) es otra liquidación y sale.
 */
export async function imprimirLiquidacion(input: {
  slug: string;
  mozoId: string;
  cajaId: string;
  /** Con el detalle de cada cobro en efectivo (D3: por defecto, no). */
  conCobros?: boolean;
  /** Reimprimir aunque ya haya salido con estos números. */
  forzar?: boolean;
}): Promise<ActionResult<{ impreso: boolean }>> {
  const c = await contexto(input.slug);
  if (!c.ok) return c;
  if (!canRendirMozo(c.data.role)) return actionError("Solo encargado o admin pueden imprimir la rendición.");
  const businessId = c.data.business.id as string;
  const sb = db();

  const { data: turno } = await sb
    .from("turnos")
    .select("abierto_at")
    .eq("business_id", businessId)
    .is("cerrado_at", null)
    .maybeSingle();
  const desde = (turno as { abierto_at: string } | null)?.abierto_at ?? null;

  const { getSaldosMozos } = await import("./turno-queries");
  const saldo = (await getSaldosMozos(businessId, desde ?? undefined)).find(
    (s) => s.mozo_id === input.mozoId && s.caja_id === input.cajaId,
  );
  if (!saldo) return actionError("Ese mozo no tiene nada para rendir en esta caja.");

  const huella = [
    saldo.anterior_cents, saldo.efectivo_cents, saldo.propina_tarjeta_cents,
    saldo.entregado_cents, saldo.pagado_cents, saldo.saldo_cents,
  ].join("|");

  if (!input.forzar) {
    const { count } = await sb
      .from("print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("kind", "liquidacion")
      .eq("mozo_id", input.mozoId)
      .eq("caja_id", input.cajaId)
      .eq("huella", huella);
    if ((count ?? 0) > 0) return actionOk({ impreso: false });
  }

  // Los cobros de la ventana del turno: el efectivo (para el detalle) y lo que
  // no se rinde (posnet/MP), como referencia.
  let pagos = sb
    .from("payments")
    .select("method, amount_cents, tip_cents, created_at, orders!inner(daily_number, order_number, tables!orders_table_id_fkey(label))")
    .eq("business_id", businessId)
    .eq("rinde_mozo_id", input.mozoId)
    .eq("caja_id", input.cajaId)
    .eq("payment_status", "paid")
    .order("created_at");
  if (desde) pagos = pagos.gt("created_at", desde);
  const { data: filas, error: pagosErr } = await pagos;
  if (pagosErr) return actionError(traducir(pagosErr.message));
  type Fila = {
    method: string;
    amount_cents: number;
    tip_cents: number;
    created_at: string;
    orders: { daily_number: number | null; order_number: number; tables: { label: string } | null } | null;
  };
  const lista = (filas ?? []) as unknown as Fila[];
  const noSeRinden = new Map<string, number>();
  for (const p of lista) {
    if (p.method === "cash") continue;
    const k = METODO_LABEL[p.method] ?? p.method;
    noSeRinden.set(k, (noSeRinden.get(k) ?? 0) + Number(p.amount_cents));
  }

  const [{ data: nombres }, { data: caja }] = await Promise.all([
    sb.from("business_users").select("user_id, full_name").eq("business_id", businessId).in("user_id", [input.mozoId, c.data.userId]),
    sb.from("cajas").select("name").eq("id", input.cajaId).eq("business_id", businessId).single(),
  ]);
  const nombre = new Map(((nombres ?? []) as { user_id: string; full_name: string | null }[]).map((u) => [u.user_id, u.full_name]));
  if (!caja) return actionError("Caja no encontrada.");

  const payload = {
    negocio_name: c.data.business.name as string,
    mozo_name: nombre.get(input.mozoId) ?? saldo.mozo_name,
    caja_name: (caja as { name: string }).name,
    turno_desde: desde,
    impreso_at: new Date().toISOString(),
    impreso_por: nombre.get(c.data.userId) ?? null,
    anterior_cents: saldo.anterior_cents,
    efectivo_cents: saldo.efectivo_cents,
    propina_tarjeta_cents: saldo.propina_tarjeta_cents,
    entregado_cents: saldo.entregado_cents,
    pagado_cents: saldo.pagado_cents,
    saldo_cents: saldo.saldo_cents,
    no_se_rinden: [...noSeRinden].map(([label, cents]) => ({ label, cents })),
    mesas_sin_cobrar: saldo.mesas_sin_cobrar.map((m) => m.tableLabel ?? "?"),
    ...(input.conCobros
      ? {
          cobros: lista
            .filter((p) => p.method === "cash")
            .map((p) => ({
              label: p.orders?.tables?.label
                ? `Mesa ${p.orders.tables.label}`
                : `Pedido #${p.orders?.daily_number ?? p.orders?.order_number ?? "?"}`,
              at: p.created_at,
              efectivo_cents: Number(p.amount_cents) - Number(p.tip_cents),
              propina_efectivo_cents: Number(p.tip_cents),
            })),
        }
      : {}),
    reimpresion: Boolean(input.forzar),
  };

  const { error } = await sb.from("print_jobs").insert({
    business_id: businessId,
    kind: "liquidacion",
    status: "pendiente",
    mozo_id: input.mozoId,
    caja_id: input.cajaId,
    huella,
    payload,
    requested_by: c.data.userId,
  });
  if (error) {
    console.error("imprimirLiquidacion", error);
    return actionError("No pudimos mandar la rendición a la impresora.");
  }
  return actionOk({ impreso: true });
}
