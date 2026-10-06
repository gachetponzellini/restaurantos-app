"use server";

import { headers } from "next/headers";

import { actionError, type ActionResult } from "@/lib/actions";
import { limitCreateOrder } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { persistOrder, type CreateOrderResult } from "./persist-order";
import { CreateOrderInput, primerErrorDeValidacion } from "./schema";

export async function createOrder(
  input: unknown,
): Promise<ActionResult<CreateOrderResult>> {
  const parsed = CreateOrderInput.safeParse(input);
  if (!parsed.success) {
    return actionError(primerErrorDeValidacion(parsed.error));
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success: allowed } = await limitCreateOrder(ip);
  if (!allowed) return actionError("Demasiados intentos, esperá un minuto.");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return actionError("Iniciá sesión para hacer el pedido.");
  }

  try {
    return await persistOrder(parsed.data, user.id);
  } catch (err) {
    console.error("createOrder unexpected error", err);
    return actionError("No pudimos crear el pedido. Intentá de nuevo.");
  }
}
