import type { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Registra el latido de un print-agent (spec 35, por agente desde la 124).
 *
 * Vive acá y no en la ruta del heartbeat porque desde la spec 183 · D1 hay dos
 * caminos que latan: el `GET /api/print-agent` —el pull ES el latido— y el
 * `POST /api/print-agent/heartbeat`, que sigue existiendo para los `.exe`
 * viejos. Las dos tienen que escribir exactamente lo mismo, incluida la regla
 * de la versión: mientras un agente viejo y uno nuevo convivan, la fila tiene
 * que significar lo mismo sin importar por dónde entró el latido.
 *
 * `version` es texto libre que manda el local, así que se acota acá, antes de
 * la base. Vacía cuenta como ausente: un agente que manda "" no dice nada.
 */
export async function registrarLatido(
  service: ReturnType<typeof createSupabaseServiceClient>,
  {
    businessId,
    agentId,
    version,
  }: { businessId: string; agentId: string; version?: string | null },
): Promise<{ error: unknown }> {
  const v = typeof version === "string" ? version.trim().slice(0, 40) : "";

  const { error } = await service.from("print_agent_status").upsert(
    {
      business_id: businessId,
      agent_id: agentId,
      last_seen_at: new Date().toISOString(),
      // Sin versión NO se pisa la que ya había (issue #278): un agente viejo
      // latiendo al lado de uno nuevo no puede borrarle el dato al otro. Cada
      // fila es de un agente, así que el único que la escribe es su dueño.
      ...(v ? { agent_version: v } : {}),
    },
    { onConflict: "business_id,agent_id" },
  );

  return { error };
}
