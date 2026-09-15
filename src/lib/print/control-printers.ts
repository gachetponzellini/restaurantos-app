import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Las comanderas de control del negocio (spec 190).
 *
 * Antes de esta spec la comandera era un **string repetido**: uno en el
 * negocio y, desde las specs 181/186, uno más por cada usuario que tuviera la
 * suya. En KCC la `192.168.10.210` ya estaba escrita cinco veces. Un typo no se
 * veía hasta que no salía el papel.
 *
 * Acá es una fila con nombre, y el usuario la **elige**.
 *
 * Los tipos generados todavía no conocen la tabla (`database.types.ts` lo
 * mantiene otra sesión); se castea igual que `members-query.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

export type ControlPrinter = {
  id: string;
  name: string;
  printer_ip: string;
  printer_port: number;
  is_active: boolean;
  /** Cuántos usuarios imprimen su control acá. Para no borrar una en uso. */
  usuarios: number;
};

export async function listControlPrinters(
  businessId: string,
): Promise<ControlPrinter[]> {
  const service = db();
  const [{ data: rows }, { data: usos }] = await Promise.all([
    service
      .from("control_printers")
      .select("id, name, printer_ip, printer_port, is_active")
      .eq("business_id", businessId)
      .order("name", { ascending: true }),
    service
      .from("business_users")
      .select("control_printer_id")
      .eq("business_id", businessId)
      .not("control_printer_id", "is", null),
  ]);

  const porComandera = new Map<string, number>();
  for (const u of (usos ?? []) as { control_printer_id: string }[]) {
    porComandera.set(
      u.control_printer_id,
      (porComandera.get(u.control_printer_id) ?? 0) + 1,
    );
  }

  return ((rows ?? []) as Omit<ControlPrinter, "usuarios">[]).map((r) => ({
    ...r,
    usuarios: porComandera.get(r.id) ?? 0,
  }));
}
