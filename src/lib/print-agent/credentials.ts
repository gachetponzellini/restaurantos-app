import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Un print-agent instalado: quién es y qué impresoras alcanza (spec 124).
 * `printerScope` null = sin restricción (el negocio de un solo agente).
 */
export type PrintAgentCredential = {
  id: string;
  apiKey: string;
  label: string | null;
  printerScope: string[] | null;
};

/**
 * Lookup server-only de las print-agent keys de un negocio (spec 046, ampliado
 * en la 124). La tabla `print_agent_credentials` es service-role-only; esto se
 * llama solo desde el server (auth del endpoint del agente).
 *
 * Devuelve TODAS las credenciales del negocio —no una— porque desde la spec 124
 * un negocio puede tener varios agentes (golf: una PC por caja, en LANs
 * distintas) y es la key la que dice cuál de ellos está llamando.
 *
 * Se traen las keys enteras a propósito, en vez de filtrar por `api_key` en la
 * query: la comparación tiene que ser en tiempo constante (`timingSafeEqual`) y
 * un `where api_key = $1` la haría en el índice. Son un puñado de filas por
 * negocio, no hay nada que optimizar acá.
 */
export async function listPrintAgentCredentials(
  businessId: string,
): Promise<PrintAgentCredential[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("print_agent_credentials")
    .select("id, api_key, label, printer_scope")
    .eq("business_id", businessId);

  // Nunca tira: esto está en el camino de auth del pull, que corre una vez por
  // segundo. Un error de query es "no autenticado" (el endpoint responde 401 y
  // el agente reintenta), no una excepción que tumbe la request.
  if (error) console.error("listPrintAgentCredentials", error);

  const filas = (data ?? []) as {
    id: string;
    api_key: string;
    label: string | null;
    printer_scope: string[] | null;
  }[];

  return filas.map((f) => ({
    id: f.id,
    apiKey: f.api_key,
    label: f.label,
    printerScope: f.printer_scope,
  }));
}

/**
 * Cada cuánto pregunta un print-agent, en ms (spec 183 · D3).
 *
 * Estuvo en 1000 desde la spec 28 y **eso es lo que pagó la factura**: dos
 * agentes a 2 req/s durante las ~7,5 h que las PCs del local están encendidas
 * son 108.000 invocaciones por día, o sea prácticamente todo el tráfico del
 * proyecto. Lo caro no era la invocación ($0.0006) sino los ~9 eventos de
 * observability que arrastra cada una ($0.011): el 70% del resumen (#304).
 *
 * 3000 es el mínimo que se podía hacer sin tocar el binario, que es la
 * restricción real — el `.exe` de cada local se actualiza a mano. El `.exe`
 * lee esto al arrancar y **no tiene default propio**: este objeto es el único
 * lugar donde la cadencia se decide.
 *
 * El costo es que una comanda puede tardar hasta 3s en salir por la comandera
 * en vez de 1s. Nadie en una cocina nota esa diferencia; la diferencia de dos
 * tercios en la factura sí se nota.
 *
 * El final de esta historia es la D2 de la misma spec: que la cadencia la
 * decida el server request a request (`next_poll_ms`) y este número pase a ser
 * sólo el arranque. Hasta entonces, se cambia acá y el local se lo lleva
 * bajando el `config.json` de nuevo del panel.
 */
export const POLL_MS_DEFAULT = 3000;

/** Lo que el instalador escribe al lado del `.exe` (spec 046). */
export type AgentConfig = {
  serverUrl: string;
  printAgentKey: string;
  businessId: string;
  transport: "network";
  pollMs: number;
};

/**
 * El `config.json` que baja el panel, armado aparte de la action para que el
 * contrato con el `.exe` se pueda testear sin Supabase de por medio.
 */
export function buildAgentConfig({
  serverUrl,
  apiKey,
  businessId,
}: {
  serverUrl: string;
  apiKey: string;
  businessId: string;
}): AgentConfig {
  return {
    serverUrl,
    printAgentKey: apiKey,
    businessId,
    transport: "network",
    pollMs: POLL_MS_DEFAULT,
  };
}
