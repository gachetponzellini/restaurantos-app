"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { closeOrderIfFullyPaid } from "@/lib/billing/cobro-actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCorregirCobro } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  cambiaPlata,
  evaluarGuardas,
  evaluarGuardasDeAnulacion,
  mapCorreccionError,
  validarCorreccion,
  type CorreccionPatch,
  type PagoActual,
} from "./correcciones";
import { getCorreccionesDeLinea, resolverNombresDeCorreccion } from "./queries";
import type { CorreccionLog, PaymentMethod } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericClient = SupabaseClient<any, any, any>;

/**
 * Historial de correcciones de una línea, para el detalle del libro. Es una
 * lectura, pero vive acá (y no en `queries.ts`) porque la pide el cliente al
 * abrir una línea: necesita el mismo gate que la corrección.
 */
export async function verCorrecciones(
  slug: string,
  entityType: "payment" | "movimiento",
  entityId: string,
): Promise<ActionResult<CorreccionLogConNombres[]>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCorregirCobro(ctxResult.data.role)) {
    return actionError("No tenés permiso para ver el historial de la caja.");
  }

  const logs = await getCorreccionesDeLinea(business.id, entityType, entityId);
  const nombres = await resolverNombresDeCorreccion(business.id, logs);
  return actionOk(
    logs.map((l) => ({
      ...l,
      from_label: l.from_value ? nombres.get(l.from_value) ?? null : null,
      to_label: l.to_value ? nombres.get(l.to_value) ?? null : null,
    })),
  );
}

export type CorreccionLogConNombres = CorreccionLog & {
  /** Nombre legible cuando el valor es un id (mozo, caja). */
  from_label: string | null;
  to_label: string | null;
};

export type CorregirCobroInput = {
  paymentId: string;
  slug: string;
  motivo: string;
  method?: PaymentMethod;
  amount_cents?: number;
  tip_cents?: number;
  attributed_mozo_id?: string | null;
  caja_id?: string;
  last_four?: string | null;
  card_brand?: string | null;
  notes?: string | null;
};

type PaymentRow = PagoActual & {
  id: string;
  business_id: string;
  order_id: string;
  split_id: string | null;
  payment_status: string;
  mp_payment_id: string | null;
  created_at: string;
};

/**
 * Fecha del último corte de una caja (o null si nunca se arqueó). Es la
 * frontera del período abierto: lo anterior ya entró en un arqueo firmado.
 */
async function ultimoCorteDe(
  service: GenericClient,
  cajaId: string,
  businessId: string,
): Promise<string | null> {
  const { data } = await service
    .from("caja_cortes")
    .select("created_at")
    .eq("caja_id", cajaId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { created_at: string } | null)?.created_at ?? null;
}

async function estaEnPeriodoAbierto(
  service: GenericClient,
  cajaId: string,
  businessId: string,
  createdAt: string,
): Promise<boolean> {
  const corte = await ultimoCorteDe(service, cajaId, businessId);
  if (!corte) return true;
  return new Date(createdAt).getTime() > new Date(corte).getTime();
}

/** El nombre para el mensaje de error, que sin nombre no explica nada. */
async function nombreDeUsuario(
  service: GenericClient,
  businessId: string,
  userId: string,
): Promise<string> {
  const { data } = await service
    .from("business_users")
    .select("full_name")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { full_name: string | null } | null)?.full_name ?? "ese mozo";
}

/**
 * ¿El pago ya entró en una rendición cerrada de ese mozo? Mover la atribución
 * después de la rendición movería plata de una liquidación que ya se firmó con
 * el mozo delante.
 */
async function tieneRendicionPosterior(
  service: GenericClient,
  businessId: string,
  mozoId: string,
  paymentCreatedAt: string,
): Promise<boolean> {
  const { data } = await service
    .from("mozo_rendiciones")
    .select("id")
    .eq("business_id", businessId)
    .eq("mozo_id", mozoId)
    .gt("created_at", paymentCreatedAt)
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Corrige una línea de cobro ya registrada (spec 070).
 *
 * Corrige, no anula: `anularCobro` deshace la orden entera (pagos, splits,
 * mesa) para arreglar un dato de una línea, y por eso en la práctica nadie lo
 * usa y el dato queda mal. Acá se cambia lo que está mal, con motivo, y queda
 * el rastro en `caja_audit_log`.
 */
export async function corregirCobro(
  input: CorregirCobroInput,
): Promise<ActionResult<{ changedFields: string[] }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canCorregirCobro(ctx.role)) {
    return actionError("Solo encargado o admin pueden corregir un cobro.");
  }

  const motivo = (input.motivo ?? "").trim();
  if (motivo === "") return actionError("La corrección requiere un motivo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: paymentData } = await service
    .from("payments")
    .select(
      "id, business_id, order_id, split_id, payment_status, mp_payment_id, created_at, method, amount_cents, tip_cents, attributed_mozo_id, caja_id, last_four, card_brand, notes",
    )
    .eq("id", input.paymentId)
    .maybeSingle();
  const pago = paymentData as PaymentRow | null;
  if (!pago) return actionError("No se encontró el cobro.");

  const patch: CorreccionPatch = {};
  if (input.method !== undefined) patch.method = input.method;
  if (input.amount_cents !== undefined) patch.amount_cents = input.amount_cents;
  if (input.tip_cents !== undefined) patch.tip_cents = input.tip_cents;
  if (input.attributed_mozo_id !== undefined) {
    patch.attributed_mozo_id = input.attributed_mozo_id;
  }
  if (input.caja_id !== undefined) patch.caja_id = input.caja_id;
  if (input.last_four !== undefined) patch.last_four = input.last_four;
  if (input.card_brand !== undefined) patch.card_brand = input.card_brand;
  if (input.notes !== undefined) patch.notes = input.notes;

  // ── Guardas de contexto ────────────────────────────────────────
  // Los hechos se buscan acá; la decisión la toma `evaluarGuardas` (puro).
  const cambiaCaja =
    patch.caja_id !== undefined && patch.caja_id !== pago.caja_id;

  // spec 160 · mover un cobro a la caja administrativa lo saca del arqueo del
  // turno sin dejar rastro en ninguna pantalla de caja. Es el cuarto camino que
  // recibe un `caja_id` del cliente, y el menos evidente.
  if (cambiaCaja) {
    const { data: destino } = await service
      .from("cajas")
      .select("is_administrative")
      .eq("id", patch.caja_id as string)
      .eq("business_id", business.id)
      .maybeSingle();
    if ((destino as { is_administrative: boolean } | null)?.is_administrative) {
      return actionError("La Caja Mayor no cobra: no se puede mover un cobro ahí.");
    }
  }
  const cambiaMozo =
    patch.attributed_mozo_id !== undefined &&
    patch.attributed_mozo_id !== pago.attributed_mozo_id;

  const [ultimoCorteOrigen, ultimoCorteDestino] = await Promise.all([
    ultimoCorteDe(service, pago.caja_id, business.id),
    cambiaCaja
      ? ultimoCorteDe(service, patch.caja_id as string, business.id)
      : Promise.resolve(null),
  ]);

  const rendicionesPosteriores: Array<{ mozoId: string; nombre: string }> = [];
  // #356 — también si cambia la plata: el mozo rindió contra ese monto.
  if (cambiaMozo || cambiaPlata(patch)) {
    const involucrados = [
      pago.attributed_mozo_id,
      ...(cambiaMozo ? [patch.attributed_mozo_id ?? null] : []),
    ].filter((x): x is string => x !== null);
    for (const mozoId of involucrados) {
      if (
        await tieneRendicionPosterior(service, business.id, mozoId, pago.created_at)
      ) {
        rendicionesPosteriores.push({
          mozoId,
          nombre: await nombreDeUsuario(service, business.id, mozoId),
        });
      }
    }
  }

  const guardas = evaluarGuardas(
    {
      pago,
      businessId: business.id,
      ultimoCorteOrigen,
      ultimoCorteDestino,
      rendicionesPosteriores,
    },
    patch,
  );
  if (!guardas.ok) return actionError(guardas.error);

  const validacion = validarCorreccion(pago, patch, motivo);
  if (!validacion.ok) return actionError(validacion.error);

  // ── Corrección atómica ─────────────────────────────────────────
  const { data: rpcData, error } = await service.rpc("corregir_pago_tx", {
    p_payment_id: pago.id,
    p_business_id: business.id,
    p_by_user_id: ctx.userId,
    p_reason: motivo,
    p_patch: patch,
  });
  if (error) return actionError(mapCorreccionError(error.message));

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { payment: unknown; fully_paid: boolean; changed_fields: string[] }
    | undefined;
  if (!row) return actionError("No se pudo corregir el cobro.");

  // Una corrección hacia arriba puede saldar una orden que había quedado
  // parcialmente pagada: la cierra el mismo camino de siempre (con su
  // transición de mesa), no una copia de esa lógica.
  if (row.fully_paid) {
    await closeOrderIfFullyPaid(service, pago.order_id, input.slug);
  }

  revalidatePath(`/${input.slug}/admin/operacion`);
  revalidatePath(`/${input.slug}/admin/caja/movimientos`);
  return actionOk({ changedFields: row.changed_fields ?? [] });
}

/**
 * Anula UNA línea de cobro (spec 070). No la borra: la marca.
 *
 * Una fila borrada deja el arqueo sin explicación —la plata cambia y no hay
 * rastro de por qué— y contradice el principio del producto: todo peso que
 * entra se registra y se puede auditar. Anulada, la línea deja de sumar pero
 * sigue en el libro, tachada, con motivo y responsable.
 *
 * Distinta de `anularCobro`, que deshace **todos** los pagos de la orden, la
 * reabre y devuelve la mesa: eso sirve cuando se cae el cobro entero, no
 * cuando de tres pagos hay uno que no existió.
 */
export async function anularLineaDeCobro(input: {
  paymentId: string;
  slug: string;
  motivo: string;
}): Promise<ActionResult<{ ordenSaldada: boolean }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canCorregirCobro(ctx.role)) {
    return actionError("Solo encargado o admin pueden anular un cobro.");
  }
  const motivo = (input.motivo ?? "").trim();
  if (motivo === "") return actionError("La anulación requiere un motivo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: paymentData } = await service
    .from("payments")
    .select(
      "id, business_id, order_id, split_id, payment_status, mp_payment_id, created_at, method, amount_cents, tip_cents, attributed_mozo_id, caja_id, last_four, card_brand, notes",
    )
    .eq("id", input.paymentId)
    .maybeSingle();
  const pago = paymentData as PaymentRow | null;
  if (!pago) return actionError("No se encontró el cobro.");

  const ultimoCorteOrigen = await ultimoCorteDe(
    service,
    pago.caja_id,
    business.id,
  );

  // Sacar el cobro le baja la liquidación al mozo atribuido: si ya rindió, la
  // frontera es la misma que para reatribuirlo.
  const rendicionesPosteriores: Array<{ mozoId: string; nombre: string }> = [];
  if (
    pago.attributed_mozo_id &&
    (await tieneRendicionPosterior(
      service,
      business.id,
      pago.attributed_mozo_id,
      pago.created_at,
    ))
  ) {
    rendicionesPosteriores.push({
      mozoId: pago.attributed_mozo_id,
      nombre: await nombreDeUsuario(service, business.id, pago.attributed_mozo_id),
    });
  }

  const guardas = evaluarGuardasDeAnulacion({
    pago,
    businessId: business.id,
    ultimoCorteOrigen,
    ultimoCorteDestino: null,
    rendicionesPosteriores,
  });
  if (!guardas.ok) return actionError(guardas.error);

  const { data: rpcData, error } = await service.rpc("anular_pago_tx", {
    p_payment_id: pago.id,
    p_business_id: business.id,
    p_by_user_id: ctx.userId,
    p_reason: motivo,
  });
  if (error) return actionError(mapCorreccionError(error.message));

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { payment: unknown; fully_paid: boolean }
    | undefined;
  if (!row) return actionError("No se pudo anular el cobro.");

  revalidatePath(`/${input.slug}/admin/operacion`);
  revalidatePath(`/${input.slug}/admin/caja/movimientos`);
  return actionOk({ ordenSaldada: row.fully_paid });
}

export type CorregirMovimientoInput = {
  movimientoId: string;
  slug: string;
  motivo: string;
  /** Ausente = no tocar el monto (por ejemplo, cuando sólo se anula). */
  amount_cents?: number;
  /** true = anular el movimiento (deja de contar para el arqueo). */
  anular?: boolean;
};

/**
 * Corrige o anula una sangría / ingreso. Un movimiento mal cargado mueve el
 * efectivo esperado igual que un cobro, y hasta acá no había forma de
 * deshacerlo. Nunca se borra la fila: se marca.
 */
export async function corregirMovimiento(
  input: CorregirMovimientoInput,
): Promise<ActionResult<{ changedFields: string[] }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canCorregirCobro(ctx.role)) {
    return actionError("Solo encargado o admin pueden corregir un movimiento.");
  }

  const motivo = (input.motivo ?? "").trim();
  if (motivo === "") return actionError("La corrección requiere un motivo.");
  if (input.amount_cents === undefined && !input.anular) {
    return actionError("No hay nada que corregir.");
  }
  if (input.amount_cents !== undefined) {
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      return actionError("El monto tiene que ser mayor a cero.");
    }
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data } = await service
    .from("caja_movimientos")
    .select("id, business_id, caja_id, created_at, cancelled_at")
    .eq("id", input.movimientoId)
    .maybeSingle();
  const mov = data as {
    id: string;
    business_id: string;
    caja_id: string;
    created_at: string;
    cancelled_at: string | null;
  } | null;
  if (!mov) return actionError("No se encontró el movimiento.");
  if (mov.business_id !== business.id) {
    return actionError("Ese movimiento no es de este negocio.");
  }
  if (mov.cancelled_at !== null) {
    return actionError("Ese movimiento ya está anulado.");
  }
  if (!(await estaEnPeriodoAbierto(service, mov.caja_id, business.id, mov.created_at))) {
    return actionError(
      "Ese movimiento ya entró en un arqueo cerrado. Registrá la corrección en el período vigente.",
    );
  }

  const { data: rpcData, error } = await service.rpc("corregir_movimiento_tx", {
    p_movimiento_id: mov.id,
    p_business_id: business.id,
    p_by_user_id: ctx.userId,
    p_reason: motivo,
    p_amount_cents: input.amount_cents ?? null,
    p_cancel: input.anular ?? false,
  });
  if (error) return actionError(mapCorreccionError(error.message));

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { movimiento: unknown; changed_fields: string[] }
    | undefined;
  if (!row) return actionError("No se pudo corregir el movimiento.");

  revalidatePath(`/${input.slug}/admin/operacion`);
  revalidatePath(`/${input.slug}/admin/caja/movimientos`);
  return actionOk({ changedFields: row.changed_fields ?? [] });
}
