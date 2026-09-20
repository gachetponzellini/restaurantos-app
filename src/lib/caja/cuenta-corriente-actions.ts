"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCobrarCuentaCorriente, canFiar } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  getCuentaDeCliente,
  getSaldosDeClientes,
} from "./cuenta-corriente-queries";

type GenericClient = SupabaseClient;
const db = () => createSupabaseServiceClient() as unknown as GenericClient;

/**
 * Habilitar (o deshabilitar) la cuenta corriente de un cliente — spec 141 · US1.
 *
 * Deshabilitar **no borra el saldo**: deja de poder fiar, pero lo que ya debe
 * sigue en la tab hasta que lo pague. Por eso el listado de deudores trae también
 * a los deshabilitados con saldo.
 */
export async function setCuentaCorrienteHabilitada(
  customerId: string,
  habilitada: boolean,
  slug: string,
): Promise<ActionResult<{ credit_enabled: boolean }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  // Quien puede fiar puede habilitar a quién fiarle: es la misma decisión, y
  // separarla obligaría al encargado a pedirle el switch al admin en el momento
  // en que el socio está esperando en el mostrador.
  if (!canFiar(ctxResult.data.role)) {
    return actionError("No tenés permiso para habilitar cuentas corrientes.");
  }

  const service = db();
  const { data: cliente } = await service
    .from("customers")
    .select("id, business_id")
    .eq("id", customerId)
    .maybeSingle();
  const row = cliente as { id: string; business_id: string } | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Cliente no encontrado.");
  }

  // Al apagar, se avisa si queda saldo: no bloquea —puede ser justamente lo que
  // se quiere hacer con un moroso— pero nadie debería enterarse después.
  if (!habilitada) {
    const cuenta = await getCuentaDeCliente(business.id, customerId);
    if (cuenta.saldo_cents > 0) {
      const { error } = await service
        .from("customers")
        .update({ credit_enabled: false })
        .eq("id", customerId);
      if (error) return actionError("No se pudo actualizar el cliente.");
      revalidatePath(`/${slug}/admin/clientes/${customerId}`);
      return actionOk({ credit_enabled: false });
    }
  }

  const { error } = await service
    .from("customers")
    .update({ credit_enabled: habilitada })
    .eq("id", customerId);
  if (error) return actionError("No se pudo actualizar el cliente.");

  revalidatePath(`/${slug}/admin/clientes/${customerId}`);
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk({ credit_enabled: habilitada });
}

/**
 * Registrar un pago del cliente contra su saldo — spec 141 · US4.
 *
 * Si es **efectivo**, además entra a la caja como `ingreso` y queda linkeado
 * (D5): esa plata va al cajón y el arqueo tiene que esperarla. Transferencia o
 * tarjeta quedan sólo en el libro del cliente, que es el mismo tratamiento que
 * el sistema ya le da a esos métodos.
 */
export async function registrarCobranza(input: {
  customerId: string;
  amount_cents: number;
  method: "cash" | "transfer" | "card_manual" | "mp_manual" | "other";
  cajaId: string | null;
  notes?: string | null;
  slug: string;
}): Promise<ActionResult<{ id: string; saldo_cents: number }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  // D7 — `terminal` fía pero no cobra: el ingreso entra a una caja que ese rol
  // no puede ni mirar, y sería plata cayendo en un cajón ciego.
  if (!canCobrarCuentaCorriente(ctx.role)) {
    return actionError("No tenés permiso para cobrar una cuenta corriente.");
  }
  if (input.amount_cents <= 0) {
    return actionError("El monto debe ser mayor a 0.");
  }

  const service = db();
  const { data: cliente } = await service
    .from("customers")
    .select("id, name, business_id")
    .eq("id", input.customerId)
    .maybeSingle();
  const row = cliente as {
    id: string;
    name: string | null;
    business_id: string;
  } | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Cliente no encontrado.");
  }

  // No se acepta cobrar más de lo que debe: el saldo a favor existe como
  // resultado de una anulación, no como algo que se tipea de frente.
  const antes = await getCuentaDeCliente(business.id, input.customerId);
  if (input.amount_cents > antes.saldo_cents) {
    return actionError(
      `Ese cliente debe menos de lo que estás cobrando. Saldo actual: ${(
        antes.saldo_cents / 100
      ).toFixed(2)}.`,
    );
  }

  let cajaMovimientoId: string | null = null;
  if (input.method === "cash") {
    if (!input.cajaId) {
      return actionError("Elegí en qué caja entra el efectivo.");
    }
    const { data: caja } = await service
      .from("cajas")
      .select("id, business_id, is_active, is_administrative")
      .eq("id", input.cajaId)
      .maybeSingle();
    const cajaRow = caja as {
      id: string;
      business_id: string;
      is_active: boolean;
      is_administrative: boolean;
    } | null;
    if (!cajaRow || cajaRow.business_id !== business.id) {
      return actionError("Caja no encontrada.");
    }
    if (!cajaRow.is_active) return actionError("La caja está inactiva.");
    // spec 160 · el cliente paga en el mostrador: esta plata entra al cajón del
    // turno, no a la caja administrativa. La guarda va acá porque el `cajaId`
    // viene del cliente.
    if (cajaRow.is_administrative) {
      return actionError("La cobranza entra a una caja de turno, no a la Caja Mayor.");
    }

    const { data: mov, error: movErr } = await service
      .from("caja_movimientos")
      .insert({
        caja_id: input.cajaId,
        business_id: business.id,
        kind: "ingreso",
        amount_cents: input.amount_cents,
        reason: `Cobro cuenta corriente · ${row.name ?? "cliente"}`,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (movErr || !mov) return actionError("No se pudo registrar el ingreso.");
    cajaMovimientoId = (mov as { id: string }).id;
  }

  const { data: settlement, error } = await service
    .from("customer_credit_settlements")
    .insert({
      business_id: business.id,
      customer_id: input.customerId,
      amount_cents: input.amount_cents,
      method: input.method,
      caja_id: input.cajaId,
      caja_movimiento_id: cajaMovimientoId,
      notes: input.notes?.trim() || null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !settlement) {
    // El movimiento de caja ya entró: se revierte para no dejar plata contada
    // que no corresponde a ninguna cobranza. No hay transacción entre las dos
    // escrituras, así que la compensación es explícita.
    if (cajaMovimientoId) {
      await service
        .from("caja_movimientos")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_reason: "La cobranza no se pudo registrar",
        })
        .eq("id", cajaMovimientoId);
    }
    return actionError("No se pudo registrar la cobranza.");
  }

  const despues = await getCuentaDeCliente(business.id, input.customerId);
  revalidatePath(`/${input.slug}/admin/clientes/${input.customerId}`);
  revalidatePath(`/${input.slug}/admin/operacion`);
  return actionOk({
    id: (settlement as { id: string }).id,
    saldo_cents: despues.saldo_cents,
  });
}

/** Anular una cobranza — nunca se borra, igual que un movimiento de caja. */
export async function anularCobranza(
  settlementId: string,
  motivo: string,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCobrarCuentaCorriente(ctxResult.data.role)) {
    return actionError("No tenés permiso para anular una cobranza.");
  }
  if (!motivo.trim()) return actionError("Decí por qué se anula.");

  const service = db();
  const { data: s } = await service
    .from("customer_credit_settlements")
    .select("id, business_id, caja_movimiento_id, cancelled_at")
    .eq("id", settlementId)
    .maybeSingle();
  const row = s as {
    id: string;
    business_id: string;
    caja_movimiento_id: string | null;
    cancelled_at: string | null;
  } | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Cobranza no encontrada.");
  }
  if (row.cancelled_at) return actionError("Esa cobranza ya está anulada.");

  // Un arqueo firmado no se reescribe (spec 098 · H-35). Si la cobranza fue en
  // efectivo, su ingreso entró al cajón: si ese cajón ya se contó y se cerró,
  // anularla metería un movimiento anulado adentro de un cierre firmado — la
  // misma frontera que ya respetan corregir y anular un cobro.
  if (row.caja_movimiento_id) {
    const { data: mov } = await service
      .from("caja_movimientos")
      .select("caja_id, created_at")
      .eq("id", row.caja_movimiento_id)
      .maybeSingle();
    const m = mov as { caja_id: string; created_at: string } | null;
    if (m) {
      const { data: corte } = await service
        .from("caja_cortes")
        .select("created_at")
        .eq("caja_id", m.caja_id)
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ultimo = (corte as { created_at: string } | null)?.created_at;
      if (ultimo && new Date(m.created_at).getTime() <= new Date(ultimo).getTime()) {
        return actionError(
          "Esa cobranza ya entró en un arqueo cerrado: anularla cambiaría una caja que ya se contó. Si hay que devolverle la plata al cliente, registrala como un movimiento del período actual.",
        );
      }
    }
  }

  const ahora = new Date().toISOString();
  const { error } = await service
    .from("customer_credit_settlements")
    .update({
      cancelled_at: ahora,
      cancelled_by: ctxResult.data.userId,
      cancelled_reason: motivo.trim(),
    })
    .eq("id", settlementId);
  if (error) return actionError("No se pudo anular la cobranza.");

  // El ingreso a la caja se anula con ella: si no, el arqueo seguiría esperando
  // una plata cuya cobranza ya no existe.
  if (row.caja_movimiento_id) {
    await service
      .from("caja_movimientos")
      .update({
        cancelled_at: ahora,
        cancelled_reason: `Cobranza anulada · ${motivo.trim()}`,
      })
      .eq("id", row.caja_movimiento_id);
  }

  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Buscar a quién fiarle, desde el cobro — spec 141 · D2 (revisada 2026-09-03).
 *
 * Busca sobre **todos** los clientes del negocio, no sólo los habilitados. La
 * versión original de la D2 exigía habilitar al cliente desde su ficha antes de
 * poder fiarle, y eso hacía el flujo impracticable: el socio dice «ponelo en mi
 * cuenta» y el encargado tenía que abandonar el cobro, ir a Clientes, buscarlo,
 * prender el switch y volver. En hora pico eso no pasa — se cobra en efectivo y
 * el fiado queda sin registrar, que es exactamente lo que esto viene a evitar.
 *
 * El control no se pierde: nunca estuvo en la lista blanca sino en `canFiar` (el
 * rol) y en el saldo a la vista antes de confirmar. Los que ya tienen cuenta van
 * primero, porque son el caso repetido.
 */
export async function buscarParaFiar(
  slug: string,
  query: string,
): Promise<
  ActionResult<
    {
      id: string;
      name: string | null;
      phone: string;
      saldo_cents: number;
      habilitado: boolean;
    }[]
  >
> {
  const term = query.replace(/[,*()%_]/g, " ").trim();
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canFiar(ctxResult.data.role)) {
    return actionError("No tenés permiso para fiar.");
  }

  const service = db();
  let q = service
    .from("customers")
    .select("id, name, phone, credit_enabled")
    .eq("business_id", business.id);

  // Sin término se muestran los que ya tienen cuenta: es el caso de todos los
  // días, y abrir el buscador con una lista útil evita tipear lo mismo siempre.
  if (term.length >= 2) {
    q = q.or(`name.ilike.*${term}*,phone.ilike.*${term}*`);
  } else {
    q = q.eq("credit_enabled", true);
  }

  const { data, error } = await q.order("name", { ascending: true }).limit(12);
  if (error) {
    console.error("buscarParaFiar", error);
    return actionError("No pudimos buscar clientes.");
  }

  const clientes = (data ?? []) as Array<{
    id: string;
    name: string | null;
    phone: string;
    credit_enabled: boolean;
  }>;
  if (clientes.length === 0) return actionOk([]);

  const saldos = await getSaldosDeClientes(
    business.id,
    clientes.map((c) => c.id),
  );

  return actionOk(
    clientes
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        saldo_cents: saldos.get(c.id) ?? 0,
        habilitado: c.credit_enabled,
      }))
      // Los que ya tienen cuenta primero: es el caso repetido.
      .sort((a, b) => Number(b.habilitado) - Number(a.habilitado)),
  );
}

/**
 * Dar de alta a alguien y fiarle en el mismo gesto — spec 141 · D2 revisada.
 *
 * El teléfono es la clave natural de `customers` (UNIQUE `business_id, phone`),
 * así que un alta con un número que ya existe **no duplica**: devuelve el que
 * había y lo habilita. Es lo que quiere el mostrador — «Pérez, 341…» y listo.
 */
export async function crearClienteParaFiar(input: {
  name: string;
  phone: string;
  slug: string;
}): Promise<ActionResult<{ id: string; name: string | null; phone: string }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canFiar(ctxResult.data.role)) {
    return actionError("No tenés permiso para fiar.");
  }

  const name = input.name.trim();
  const phone = input.phone.replace(/\D/g, "");
  if (!name) return actionError("Poné el nombre.");
  // Sin teléfono no hay cliente: es la identidad de la tabla, y el nombre solo
  // llenaría el padrón de «Juan» sueltos (misma regla que `upsertCustomerByPhone`).
  if (phone.length < 6)
    return actionError("Poné un teléfono, aunque sea corto.");

  const service = db();
  const { data: existente } = await service
    .from("customers")
    .select("id, name, phone")
    .eq("business_id", business.id)
    .eq("phone", phone)
    .maybeSingle();

  if (existente) {
    const row = existente as { id: string; name: string | null; phone: string };
    await service
      .from("customers")
      .update({ credit_enabled: true })
      .eq("id", row.id);
    return actionOk(row);
  }

  const { data, error } = await service
    .from("customers")
    .insert({
      business_id: business.id,
      name,
      phone,
      credit_enabled: true,
    })
    .select("id, name, phone")
    .single();
  if (error || !data) return actionError("No pudimos crear el cliente.");

  return actionOk(data as { id: string; name: string | null; phone: string });
}
