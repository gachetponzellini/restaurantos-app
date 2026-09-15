"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { isValidPrinterHost } from "@/lib/catalog/schemas";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * ABM de las comanderas de control (spec 190).
 *
 * El mismo gate que el resto de la config de comanderas
 * (`setControlPrinter`): `canManageBusiness`. Configurar impresoras no es
 * operar el turno.
 */

const DestinoInput = z.object({
  business_slug: z.string().min(1),
  name: z.string().trim().min(1, "Poné un nombre.").max(60),
  printer_ip: z.string().trim().min(1, "Poné un destino."),
  printer_port: z.number().int().min(1).max(65535).default(9100),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => createSupabaseServiceClient() as unknown as any;

async function gate(slug: string) {
  const business = await getBusiness(slug);
  if (!business) return { ok: false as const, error: "Negocio no encontrado." };
  const ctx = await ensureAdminAccess(business.id, slug);
  if (!canManageBusiness(ctx)) {
    return {
      ok: false as const,
      error: "No tenés permisos para configurar las comanderas.",
    };
  }
  return { ok: true as const, businessId: business.id };
}

function revalidar(slug: string) {
  revalidatePath(`/${slug}/admin/configuracion/local`);
  revalidatePath(`/${slug}/admin/empleados`);
}

/** El destino, validado igual que el de un sector: IP, host o `local:NOMBRE`. */
function destinoInvalido(ip: string): string | null {
  return isValidPrinterHost(ip)
    ? null
    : "Destino inválido: una IP privada (192.168.…), un nombre de red, o `local:NOMBRE` para una impresora USB.";
}

export async function createControlPrinter(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DestinoInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, name, printer_ip, printer_port } = parsed.data;

  const g = await gate(business_slug);
  if (!g.ok) return actionError(g.error);

  const malo = destinoInvalido(printer_ip);
  if (malo) return actionError(malo);

  const { data, error } = await svc()
    .from("control_printers")
    .insert({
      business_id: g.businessId,
      name,
      printer_ip,
      printer_port,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = el índice único por nombre. Es el error del usuario, no un fallo.
    if ((error as { code?: string }).code === "23505") {
      return actionError(`Ya hay una comandera que se llama «${name}».`);
    }
    console.error("createControlPrinter", error);
    return actionError("No pudimos crear la comandera.");
  }

  revalidar(business_slug);
  return actionOk({ id: (data as { id: string }).id });
}

export async function updateControlPrinterRow(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = DestinoInput.extend({
    id: z.string().uuid(),
    is_active: z.boolean(),
  }).safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, id, name, printer_ip, printer_port, is_active } =
    parsed.data;

  const g = await gate(business_slug);
  if (!g.ok) return actionError(g.error);

  const malo = destinoInvalido(printer_ip);
  if (malo) return actionError(malo);

  // El `.eq("business_id")` es la guarda cross-tenant: un id ajeno no matchea.
  const { error, count } = await svc()
    .from("control_printers")
    .update({ name, printer_ip, printer_port, is_active }, { count: "exact" })
    .eq("id", id)
    .eq("business_id", g.businessId);

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return actionError(`Ya hay una comandera que se llama «${name}».`);
    }
    console.error("updateControlPrinterRow", error);
    return actionError("No pudimos guardar la comandera.");
  }
  if (count === 0) return actionError("Comandera no encontrada.");

  revalidar(business_slug);
  return actionOk(null);
}

export async function deleteControlPrinter(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = z
    .object({ business_slug: z.string().min(1), id: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { business_slug, id } = parsed.data;

  const g = await gate(business_slug);
  if (!g.ok) return actionError(g.error);

  // Borrar una comandera en uso dejaría a esa gente sin saberlo imprimiendo por
  // la del negocio (la FK es `on delete set null`). Se avisa en vez de hacerlo
  // en silencio: desasignala vos, o desactivala.
  const { count } = await svc()
    .from("business_users")
    .select("user_id", { count: "exact", head: true })
    .eq("business_id", g.businessId)
    .eq("control_printer_id", id);
  if ((count ?? 0) > 0) {
    return actionError(
      count === 1
        ? "Hay 1 persona que imprime acá. Cambiásela primero, o desactivá la comandera."
        : `Hay ${count} personas que imprimen acá. Cambiásela primero, o desactivá la comandera.`,
    );
  }

  const { error } = await svc()
    .from("control_printers")
    .delete()
    .eq("id", id)
    .eq("business_id", g.businessId);
  if (error) {
    console.error("deleteControlPrinter", error);
    return actionError("No pudimos borrar la comandera.");
  }

  revalidar(business_slug);
  return actionOk(null);
}
