"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canEditarAsistencia } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  fichadaSePisa,
  validarFichada,
  type FichadaConId,
} from "./asistencia-reglas";

// ════════════════════════════════════════════════════════════════════════
// Corregir, agregar y anular fichadas (spec 179).
//
// Copia el molde de la corrección de caja (070): motivo obligatorio, un
// renglón de audit por campo cambiado, y nunca borrar. Es sueldo — lo que se
// toca tiene que poder reconstruirse.
//
// Las tres pasan por el mismo gate: `canEditarAsistencia` (encargado/admin) y
// la fila del negocio de la sesión. La terminal no entra: es una cuenta
// compartida, y el rastro diría «terminal», no quién.
// ════════════════════════════════════════════════════════════════════════

type Ctx = {
  businessId: string;
  userId: string;
  service: SupabaseClient;
  slug: string;
};

async function gate(businessSlug: string): Promise<ActionResult<Ctx>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");
  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canEditarAsistencia(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden corregir asistencias.");
  }
  return actionOk({
    businessId: business.id,
    userId: ctxResult.data.userId,
    service: createSupabaseServiceClient() as unknown as SupabaseClient,
    slug: businessSlug,
  });
}

function motivoLimpio(reason: string | null | undefined): string | null {
  const m = reason?.trim() ?? "";
  return m === "" ? null : m;
}

type FilaEntry = {
  id: string;
  business_id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  cancelled_at: string | null;
};

async function cargarFichada(
  ctx: Ctx,
  entryId: string,
): Promise<ActionResult<FilaEntry>> {
  const { data } = await ctx.service
    .from("clock_entries")
    .select("id, business_id, user_id, clock_in, clock_out, cancelled_at")
    .eq("id", entryId)
    .maybeSingle();
  const fila = data as FilaEntry | null;
  // Cross-tenant: el caller pasa el negocio, pero la verdad es la fila.
  if (!fila || fila.business_id !== ctx.businessId) {
    return actionError("Fichada no encontrada.");
  }
  return actionOk(fila);
}

/**
 * Las fichadas vivas del empleado con las que una nueva podría pisarse: las
 * de dos días alrededor, más cualquier abierta (que ocupa hasta el infinito,
 * venga de cuando venga).
 */
async function fichadasAlrededor(
  ctx: Ctx,
  userId: string,
  clockIn: string,
  clockOut: string | null,
): Promise<FichadaConId[]> {
  const DOS_DIAS = 2 * 24 * 60 * 60 * 1000;
  const desde = new Date(new Date(clockIn).getTime() - DOS_DIAS).toISOString();
  const hasta = new Date(
    new Date(clockOut ?? Date.now()).getTime() + DOS_DIAS,
  ).toISOString();
  const { data } = await ctx.service
    .from("clock_entries")
    .select("id, clock_in, clock_out")
    .eq("business_id", ctx.businessId)
    .eq("user_id", userId)
    .is("cancelled_at", null)
    .lte("clock_in", hasta)
    .or(`clock_in.gte.${desde},clock_out.is.null`);
  return (data ?? []) as FichadaConId[];
}

async function auditar(
  ctx: Ctx,
  entryId: string,
  renglones: { field: string; from: string | null; to: string | null }[],
  reason: string,
) {
  if (renglones.length === 0) return;
  const { error } = await ctx.service.from("clock_audit_log").insert(
    renglones.map((r) => ({
      business_id: ctx.businessId,
      entry_id: entryId,
      field: r.field,
      from_value: r.from,
      to_value: r.to,
      by_user_id: ctx.userId,
      reason,
    })),
  );
  if (error) console.error("clock_audit_log", error);
}

function refrescar(slug: string) {
  revalidatePath(`/${slug}/admin/rrhh`);
  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/mozo`);
}

// ── Corregir ──────────────────────────────────────────────────────────────

export async function corregirFichada(input: {
  entryId: string;
  clock_in: string;
  clock_out: string | null;
  reason: string;
  slug: string;
}): Promise<ActionResult<{ id: string }>> {
  const g = await gate(input.slug);
  if (!g.ok) return g;
  const ctx = g.data;

  const motivo = motivoLimpio(input.reason);
  if (!motivo) return actionError("Decí por qué se corrige: queda en el rastro.");

  const cargada = await cargarFichada(ctx, input.entryId);
  if (!cargada.ok) return cargada;
  const fila = cargada.data;
  if (fila.cancelled_at) {
    return actionError("Esa fichada está anulada. Agregá una nueva si hace falta.");
  }

  const nueva = { clock_in: input.clock_in, clock_out: input.clock_out };
  const v = validarFichada(nueva);
  if (!v.ok) return actionError(v.error);

  const otras = await fichadasAlrededor(ctx, fila.user_id, nueva.clock_in, nueva.clock_out);
  const pisa = fichadaSePisa(nueva, otras, fila.id);
  if (pisa) {
    return actionError(
      "Se pisa con otra fichada del mismo empleado. Corregí o anulá esa primero.",
    );
  }

  const cambios: { field: string; from: string | null; to: string | null }[] = [];
  const mismoInstante = (a: string | null, b: string | null) =>
    (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  if (!mismoInstante(fila.clock_in, nueva.clock_in)) {
    cambios.push({ field: "clock_in", from: fila.clock_in, to: nueva.clock_in });
  }
  if (!mismoInstante(fila.clock_out, nueva.clock_out)) {
    cambios.push({ field: "clock_out", from: fila.clock_out, to: nueva.clock_out });
  }
  if (cambios.length === 0) return actionError("No cambiaste nada.");

  const { error } = await ctx.service
    .from("clock_entries")
    .update({ clock_in: nueva.clock_in, clock_out: nueva.clock_out })
    .eq("id", fila.id);
  if (error) {
    // 23505 = el único parcial de la 0104: reabrir ésta dejaría dos abiertas.
    if (error.code === "23505") {
      return actionError("Ese empleado ya tiene otra fichada abierta.");
    }
    console.error("corregirFichada", error);
    return actionError("No se pudo guardar la corrección.");
  }

  await auditar(ctx, fila.id, cambios, motivo);
  refrescar(ctx.slug);
  return actionOk({ id: fila.id });
}

// ── Agregar ───────────────────────────────────────────────────────────────

export async function agregarFichada(input: {
  userId: string;
  clock_in: string;
  clock_out: string | null;
  reason: string;
  slug: string;
}): Promise<ActionResult<{ id: string }>> {
  const g = await gate(input.slug);
  if (!g.ok) return g;
  const ctx = g.data;

  const motivo = motivoLimpio(input.reason);
  if (!motivo) return actionError("Decí por qué se agrega: queda en el rastro.");

  // El empleado tiene que ser del negocio y estar activo: cargarle una fichada
  // a alguien dado de baja es sueldo para alguien que no trabaja acá.
  const { data: member } = await ctx.service
    .from("business_users")
    .select("user_id")
    .eq("business_id", ctx.businessId)
    .eq("user_id", input.userId)
    .is("disabled_at", null)
    .maybeSingle();
  if (!member) return actionError("Ese empleado no está activo en este negocio.");

  const nueva = { clock_in: input.clock_in, clock_out: input.clock_out };
  const v = validarFichada(nueva);
  if (!v.ok) return actionError(v.error);

  const otras = await fichadasAlrededor(ctx, input.userId, nueva.clock_in, nueva.clock_out);
  const pisa = fichadaSePisa(nueva, otras);
  if (pisa) {
    return actionError(
      "Se pisa con otra fichada del mismo empleado. Corregí o anulá esa primero.",
    );
  }

  const { data, error } = await ctx.service
    .from("clock_entries")
    .insert({
      business_id: ctx.businessId,
      user_id: input.userId,
      clock_in: nueva.clock_in,
      clock_out: nueva.clock_out,
      // Con valor = la cargó un encargado, no fichó con el PIN (D2).
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return actionError("Ese empleado ya tiene una fichada abierta.");
    }
    console.error("agregarFichada", error);
    return actionError("No se pudo agregar la fichada.");
  }
  const id = (data as { id: string }).id;

  await auditar(
    ctx,
    id,
    [{ field: "created", from: null, to: `${nueva.clock_in} → ${nueva.clock_out ?? "abierta"}` }],
    motivo,
  );
  refrescar(ctx.slug);
  return actionOk({ id });
}

// ── Anular ────────────────────────────────────────────────────────────────

export async function anularFichada(input: {
  entryId: string;
  reason: string;
  slug: string;
}): Promise<ActionResult<{ id: string }>> {
  const g = await gate(input.slug);
  if (!g.ok) return g;
  const ctx = g.data;

  const motivo = motivoLimpio(input.reason);
  if (!motivo) return actionError("Decí por qué se anula: queda en el rastro.");

  const cargada = await cargarFichada(ctx, input.entryId);
  if (!cargada.ok) return cargada;
  const fila = cargada.data;
  if (fila.cancelled_at) return actionError("Esa fichada ya está anulada.");

  const ahora = new Date().toISOString();
  const { error } = await ctx.service
    .from("clock_entries")
    .update({
      cancelled_at: ahora,
      cancelled_reason: motivo,
      cancelled_by: ctx.userId,
    })
    .eq("id", fila.id);
  if (error) {
    console.error("anularFichada", error);
    return actionError("No se pudo anular la fichada.");
  }

  await auditar(ctx, fila.id, [{ field: "cancelled", from: null, to: ahora }], motivo);
  refrescar(ctx.slug);
  return actionOk({ id: fila.id });
}
