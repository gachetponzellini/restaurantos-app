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
  /** Spec 181: la comandera de control de ESTA terminal. Sólo rol `terminal`. */
  control_printer_ip: string | null;
  control_printer_port: number | null;
};

export async function listBusinessMembers(
  businessId: string,
  opts?: { includeDisabled?: boolean },
): Promise<BusinessMember[]> {
  const service = db();
  let query = service
    .from("business_users")
    .select(
      "user_id, role, created_at, disabled_at, full_name, phone, pin, control_printer_ip, control_printer_port, users:user_id(email)",
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
    control_printer_ip: m.control_printer_ip ?? null,
    control_printer_port: m.control_printer_port ?? null,
  }));
}
