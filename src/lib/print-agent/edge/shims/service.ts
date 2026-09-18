/**
 * `@/lib/supabase/service` para la Edge Function: el service role y la URL los
 * inyecta Supabase en el entorno de toda función.
 */
import { createClient } from "@supabase/supabase-js";

declare const Deno: { env: { get(k: string): string | undefined } };

export function createSupabaseServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
