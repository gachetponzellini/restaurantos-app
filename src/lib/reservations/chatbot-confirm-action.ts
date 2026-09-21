"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createReservationFromCustomer } from "@/lib/reservations/booking-actions";
import {
  consumeReservationIntent,
  getReservationIntentByToken,
} from "@/lib/reservations/chatbot-actions";
import { getBusinessBySlug, getReservationSettings } from "@/lib/reservations/queries";

/**
 * Server action invoked by the chatbot-handoff confirmation page
 * (`/[slug]/reservar/[token]`). Wraps `createReservationFromCustomer` so the
 * caller doesn't need to know the intent layout: we resolve the intent here,
 * forward to the canonical reservation creator (same race/exclusion handling
 * as the standard `/reservar` flow), and clear the intent on success.
 *
 * If the intent has already been consumed (NULL after a prior success), we
 * still return an error so the UI shows the "already used" state.
 */

const InputSchema = z.object({
  business_slug: z.string().min(1),
  token: z.string().min(8).max(64),
  customer_name: z.string().trim().min(1).max(80),
  customer_phone: z.string().trim().min(4).max(40),
  notes: z.string().trim().max(500).optional(),
});

export async function confirmReservationFromIntent(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const intent = await getReservationIntentByToken(parsed.data.token);
  if (!intent) {
    return actionError("Este link ya no es válido. Pedí uno nuevo al chatbot.");
  }

  // Spec 077 — el intent guarda un `slot` del modelo estricto. Si el negocio
  // pasó a flexible mientras tanto, crearlo por este camino metería una reserva
  // con otro modelo y sin pasar por el cupo del servicio.
  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (business) {
    const settings = await getReservationSettings(business.id, { useService: true });
    if (settings.mode === "flexible") {
      return actionError(
        "Este local cambió cómo toma las reservas. Hacela desde la página de reservas del local.",
      );
    }
  }

  const result = await createReservationFromCustomer({
    business_slug: parsed.data.business_slug,
    date: intent.intent.date,
    slot: intent.intent.slot,
    party_size: intent.intent.party_size,
    customer_name: parsed.data.customer_name,
    customer_phone: parsed.data.customer_phone,
    // `CreateReservationInputSchema.notes` es `.optional()` (no `.nullable()`):
    // zod 4 rechaza `null` con "Invalid input" y la reserva no se crea cuando
    // el cliente confirma el link del bot sin dejar notas.
    notes: parsed.data.notes || undefined,
    // Marca el canal: la reserva nace del handoff del chatbot (spec 22).
    source: "chatbot",
    // Forward the salón the chatbot chose (if any). Intents creados antes de
    // multi-salón no tienen el campo y caen al comportamiento legacy.
    ...(intent.intent.floor_plan_id
      ? { floor_plan_id: intent.intent.floor_plan_id }
      : {}),
  });

  if (result.ok) {
    await consumeReservationIntent(parsed.data.token);
    revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
    revalidatePath(`/${parsed.data.business_slug}/perfil/reservas`);
  }
  return result;
}
