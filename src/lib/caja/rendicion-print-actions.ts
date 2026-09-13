"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canRendirMozo } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Mandar a imprimir el papel de una rendición (spec 178).
 *
 * **A pedido, no automático** (D1): KCC lo pidió con un botón, y en un turno de
 * ocho mozos son ocho papeles que no siempre alguien quiere.
 *
 * **Uno por rendición** (D2): `print_jobs (rendicion_id) where kind='rendicion'`
 * es único. La primera vez inserta; las siguientes vuelven a poner `pendiente`
 * la misma fila con `reprint_requested_at`, y el agente la levanta en el
 * próximo poll marcada `*** REIMPRESION ***`. Es lo que hace que apretar dos
 * veces no imprima dos veces — el mismo patrón que `reimprimirCierre` (139 · D8).
 */
export async function imprimirRendicion(
  rendicionId: string,
  businessSlug: string,
): Promise<ActionResult<{ print_job_id: string; reimpresion: boolean }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  // El mismo círculo que registra la rendición (D5). La terminal no rinde
  // (spec 140), así que tampoco imprime.
  if (!canRendirMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden imprimir una rendición.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  const { data: rendRow } = await service
    .from("mozo_rendiciones")
    .select("id, business_id")
    .eq("id", rendicionId)
    .maybeSingle();
  const rendicion = rendRow as { id: string; business_id: string } | null;
  // Cross-tenant: el caller pasa el negocio, pero la verdad es la fila.
  if (!rendicion || rendicion.business_id !== business.id) {
    return actionError("Rendición no encontrada.");
  }

  const { data: jobRow } = await service
    .from("print_jobs")
    .select("id")
    .eq("rendicion_id", rendicionId)
    .eq("kind", "rendicion")
    .maybeSingle();
  const existente = jobRow as { id: string } | null;

  if (existente) {
    const { error } = await service
      .from("print_jobs")
      .update({
        status: "pendiente",
        reprint_requested_at: new Date().toISOString(),
        requested_by: ctx.userId,
        // Se limpian los sellos del intento anterior: si no, una reimpresión
        // de un papel que había fallado seguiría contando como fallida (033).
        printed_at: null,
        print_failed_at: null,
      })
      .eq("id", existente.id);
    if (error) {
      console.error("imprimirRendicion · reprint", error);
      return actionError("No pudimos mandar la rendición a la impresora.");
    }
    revalidatePath(`/${businessSlug}/admin/operacion`);
    return actionOk({ print_job_id: existente.id, reimpresion: true });
  }

  const { data: nuevo, error } = await service
    .from("print_jobs")
    .insert({
      business_id: business.id,
      kind: "rendicion",
      status: "pendiente",
      rendicion_id: rendicionId,
      requested_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = el único parcial: dos clicks entre el select y el insert. Es el
    // desenlace correcto —el papel ya está en cola—, no un fallo.
    if (error.code === "23505") {
      return imprimirRendicion(rendicionId, businessSlug);
    }
    console.error("imprimirRendicion · insert", error);
    return actionError("No pudimos mandar la rendición a la impresora.");
  }

  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({
    print_job_id: (nuevo as { id: string }).id,
    reimpresion: false,
  });
}
