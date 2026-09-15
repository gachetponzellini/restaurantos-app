import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0045_rrhh applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

export type BusinessMember = {
  user_id: string;
  email: string;
  role: "admin" | "encargado" | "mozo" | "terminal" | "personal";
  created_at: string;
  disabled_at: string | null;
  full_name: string | null;
  phone: string | null;
  pin: string | null;
  /**
   * Spec 190: la comandera de control que eligió, de la lista del negocio.
   * `null` = la del negocio. Reemplaza al string por usuario de las 181/186.
   */
  control_printer_id: string | null;
  control_printer_name: string | null;
};

export async function listBusinessMembers(
  businessId: string,
  opts?: { includeDisabled?: boolean },
): Promise<BusinessMember[]> {
  const service = db();
  let query = service
    .from("business_users")
    .select(
      "user_id, role, created_at, disabled_at, full_name, phone, pin, control_printer_id, control_printers:control_printer_id(name), users:user_id(email)",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (!opts?.includeDisabled) {
    query = query.is("disabled_at", null);
  }
  const { data } = await query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((m: any) => ({
    user_id: m.user_id,
    email: m.users?.email ?? "—",
    role: m.role as BusinessMember["role"],
    created_at: m.created_at,
    disabled_at: m.disabled_at,
    full_name: m.full_name,
    phone: m.phone,
    pin: m.pin,
    control_printer_id: m.control_printer_id ?? null,
    control_printer_name: m.control_printers?.name ?? null,
  }));
}
