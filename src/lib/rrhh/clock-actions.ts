"use server";

import { headers } from "next/headers";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { limitClockPunch } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  clientIpFromForwarded,
  isOriginAllowed,
  maskPin,
} from "./ip-allowlist";

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0045_rrhh applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

export type ClockResult = {
  type: "in" | "out";
  employeeName: string;
  time: string;
  durationMinutes?: number;
};

export async function clockPunch(
  businessSlug: string,
  pin: string,
): Promise<ActionResult<ClockResult>> {
  if (!/^\d{4}$/.test(pin)) {
    return actionError("PIN inválido.");
  }

  const service = db();

  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .maybeSingle();
  if (!business) return actionError("Negocio no encontrado.");

  const h = await headers();
  const ip = clientIpFromForwarded(h.get("x-forwarded-for"));

  // ── Techo de intentos por IP ───────────────────────────────────────
  // Esto es un kiosco sin sesión y el PIN es la credencial, así que sin techo
  // el espacio de 10.000 PINs se barre solo — y un acierto no devuelve un
  // "sí": ficha entrada o salida de una persona real. El login ya se defendía
  // así (`limitLogin`, spec 142) citando justamente que "un PIN válido sirve
  // para fichar por otro"; faltaba el otro lado de esa misma puerta.
  //
  // Va ANTES de buscar el PIN para que el rechazo no dependa de si el PIN
  // existe, y se registra en la misma tabla que los bloqueos de origen: sin
  // allowlist cargada, barrer el padrón no dejaba una sola fila en ningún lado.
  const { success: dentroDelTecho } = await limitClockPunch(ip ?? "unknown");
  if (!dentroDelTecho) {
    await service.from("clock_blocked_attempts").insert({
      business_id: business.id,
      ip: ip ?? "unknown",
      pin_masked: maskPin(pin),
      reason: "rate_limit",
    });
    return actionError("Demasiados intentos. Esperá un momento y probá de nuevo.");
  }

  // ── Enforcement de origen (spec 11) ────────────────────────────────
  // Si el negocio configuró una allowlist, sólo se ficha desde un origen
  // autorizado de la LAN del local. Allowlist vacía = sin enforcement
  // (back-compat). Se evalúa ANTES de buscar el PIN para no permitir que el
  // endpoint confirme desde afuera si un PIN existe.
  const { data: origins } = await service
    .from("clock_allowed_origins")
    .select("cidr")
    .eq("business_id", business.id);
  const cidrs = (origins ?? []).map((o) => o.cidr as string);
  if (cidrs.length > 0) {
    if (!isOriginAllowed(ip, cidrs)) {
      await service.from("clock_blocked_attempts").insert({
        business_id: business.id,
        ip: ip ?? "unknown",
        pin_masked: maskPin(pin),
        reason: "origin",
      });
      return actionError(
        "El fichaje sólo está habilitado desde las computadoras del local.",
      );
    }
  }

  const { data: member } = await service
    .from("business_users")
    .select("user_id, full_name, disabled_at")
    .eq("business_id", business.id)
    .eq("pin", pin)
    .is("disabled_at", null)
    .maybeSingle();

  if (!member) return actionError("PIN no reconocido.");

  // Spec 179 — una anulada no es una abierta, y el único parcial de la 0104
  // garantiza que acá haya a lo sumo una: el `maybeSingle` ya no puede
  // reventar por datos.
  const { data: openEntry } = await service
    .from("clock_entries")
    .select("id, clock_in")
    .eq("business_id", business.id)
    .eq("user_id", member.user_id)
    .is("clock_out", null)
    .is("cancelled_at", null)
    .maybeSingle();

  if (!openEntry) {
    const { data: entry, error } = await service
      .from("clock_entries")
      .insert({ business_id: business.id, user_id: member.user_id })
      .select("clock_in")
      .single();
    if (error) return actionError("Error al registrar entrada.");
    return actionOk({
      type: "in" as const,
      employeeName: member.full_name ?? "Empleado",
      time: entry.clock_in,
    });
  }

  const now = new Date().toISOString();
  const { error } = await service
    .from("clock_entries")
    .update({ clock_out: now })
    .eq("id", openEntry.id);
  if (error) return actionError("Error al registrar salida.");

  const clockInDate = new Date(openEntry.clock_in);
  const durationMinutes = Math.floor(
    (Date.now() - clockInDate.getTime()) / 60000,
  );

  return actionOk({
    type: "out" as const,
    employeeName: member.full_name ?? "Empleado",
    time: now,
    durationMinutes,
  });
}

export type PresentEmployee = {
  userId: string;
  name: string;
  role: string;
  clockIn: string;
};

export async function getCurrentPresent(
  businessSlug: string,
): Promise<PresentEmployee[]> {
  const service = db();

  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .maybeSingle();
  if (!business) return [];

  const { data: entries } = await service
    .from("clock_entries")
    .select("user_id, clock_in")
    .eq("business_id", business.id)
    .is("clock_out", null)
    .is("cancelled_at", null)
    .order("clock_in", { ascending: true });

  if (!entries || entries.length === 0) return [];

  const userIds = entries.map((e) => e.user_id);
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", business.id)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  return entries.map((e) => {
    const m = memberMap.get(e.user_id);
    return {
      userId: e.user_id,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      clockIn: e.clock_in,
    };
  });
}
