"use server";

import { randomBytes } from "node:crypto";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { buildAgentConfig } from "@/lib/print-agent/credentials";
import { normalizarScope } from "@/lib/print/agent-scope";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

const EXE_BUCKET = "print-agent-releases";
// Instalador de un clic (spec 046 fase 2): el objeto del bucket es un ZIP con el
// relay `print-agent.exe` + `instalar.bat` (registra el arranque automático) +
// `iniciar-agente.bat` + `LEEME.txt`. El `config.json` (key por-negocio) NO va
// adentro: se baja aparte y el usuario lo deja en la carpeta antes de instalar.
const ZIP_PATH = "print-agent.zip";

/** Nombre del primer agente de un negocio, y de los que vienen de la spec 046. */
const LABEL_POR_DEFECTO = "Agente principal";

/** Key opaca del agente. `pak_live_` para reconocerla de un vistazo. */
function generateAgentKey(): string {
  return `pak_live_${randomBytes(24).toString("base64url")}`;
}

/** URL base del deploy actual (whatever host desde el que se abre el panel). */
async function currentServerUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

/** Un agente instalado, sin el secreto. Lo que ve el panel. */
export type PrintAgentSummary = {
  id: string;
  label: string;
  printerScope: string[] | null;
  lastSeenAt: string | null;
  /**
   * Versión que declara el agente en el latido (issue #278). `null` = todavía
   * no la reporta, o sea: es anterior a set-2026, cuando el .exe dejó de armar
   * el ticket por su cuenta. El panel lo dice con esas palabras.
   */
  agentVersion: string | null;
};

/** Gate admin + negocio. Centraliza el chequeo que hacen todas las actions. */
async function ensureAdminBusiness(
  slug: string,
  accion: string,
): Promise<{ id: string } | { error: string }> {
  const business = await getBusiness(slug);
  if (!business) return { error: "Negocio no encontrado." };

  const ctx = await ensureAdminAccess(business.id, slug);
  if (!canManageBusiness(ctx)) {
    return { error: `No tenés permisos para ${accion}.` };
  }
  return { id: business.id };
}

/**
 * Marca el flag no-sensible de `businesses`: hay al menos una key cargada.
 * Desde la spec 124 significa "≥ 1 agente", no "el agente".
 */
async function marcarKeySeteada(businessId: string) {
  const service = createSupabaseServiceClient();
  await service
    .from("businesses")
    .update({ print_agent_key_set: true })
    .eq("id", businessId);
}

/**
 * Devuelve el agente pedido, o —si no se pide ninguno— el único del negocio,
 * creándolo lazily si todavía no existe.
 *
 * El camino sin `agentId` es el de la spec 046 y el que sigue usando cualquier
 * negocio de un solo agente: entrás a Configuración, bajás el instalador y listo.
 * Sólo cuando hay más de uno se vuelve ambiguo, y ahí se exige elegir.
 */
async function resolverAgente(
  businessId: string,
  agentId?: string,
): Promise<{ id: string; apiKey: string; label: string } | { error: string }> {
  const service = createSupabaseServiceClient();

  if (agentId) {
    // El `business_id` en el where no es decorativo: antes el scoping venía
    // gratis porque la PK era el negocio. Ahora la PK es el agente, así que sin
    // esto un id de otro negocio pasaría el gate de admin de ESTE.
    const { data } = await service
      .from("print_agent_credentials")
      .select("id, api_key, label")
      .eq("id", agentId)
      .eq("business_id", businessId)
      .maybeSingle();
    const fila = data as { id: string; api_key: string; label: string } | null;
    if (!fila) return { error: "Ese agente no existe en este negocio." };
    return { id: fila.id, apiKey: fila.api_key, label: fila.label };
  }

  const { data } = await service
    .from("print_agent_credentials")
    .select("id, api_key, label")
    .eq("business_id", businessId);
  const filas = (data ?? []) as { id: string; api_key: string; label: string }[];

  if (filas.length > 1) {
    return { error: "Hay más de un agente: elegí cuál." };
  }
  if (filas.length === 1) {
    return {
      id: filas[0].id,
      apiKey: filas[0].api_key,
      label: filas[0].label,
    };
  }

  const key = generateAgentKey();
  const { data: creada, error } = await service
    .from("print_agent_credentials")
    .insert({ business_id: businessId, api_key: key, label: LABEL_POR_DEFECTO })
    .select("id")
    .single();
  if (error || !creada) {
    return { error: `Error creando la key: ${error?.message ?? "sin detalle"}` };
  }
  await marcarKeySeteada(businessId);
  return {
    id: (creada as { id: string }).id,
    apiKey: key,
    label: LABEL_POR_DEFECTO,
  };
}

/**
 * Los agentes del negocio con su último latido, para el panel. **Nunca devuelve
 * la `api_key`**: el secreto sólo sale al crear o rotar, una vez.
 */
export async function listPrintAgents(
  slug: string,
): Promise<ActionResult<PrintAgentSummary[]>> {
  const gate = await ensureAdminBusiness(slug, "ver los agentes de impresión");
  if ("error" in gate) return actionError(gate.error);

  const service = createSupabaseServiceClient();
  // Dos queries y el join a mano, a propósito: el embed de PostgREST
  // (`print_agent_status(last_seen_at)`) necesita la FK entre las dos tablas, y
  // esa FK recién entra en la migración 0048 —después del deploy—. Con el embed,
  // el panel se rompería justo en la ventana que todo este trabajo trata de
  // dejar sin baches.
  const [{ data, error }, { data: latidos }] = await Promise.all([
    service
      .from("print_agent_credentials")
      .select("id, label, printer_scope")
      .eq("business_id", gate.id)
      .order("created_at", { ascending: true }),
    service
      .from("print_agent_status")
      .select("agent_id, last_seen_at, agent_version")
      .eq("business_id", gate.id),
  ]);

  if (error) return actionError(`Error leyendo los agentes: ${error.message}`);

  const filas = (data ?? []) as {
    id: string;
    label: string | null;
    printer_scope: string[] | null;
  }[];
  const porAgente = new Map(
    (
      (latidos ?? []) as {
        agent_id: string | null;
        last_seen_at: string;
        agent_version: string | null;
      }[]
    )
      .filter((l) => l.agent_id)
      .map((l) => [l.agent_id as string, l]),
  );

  return actionOk(
    filas.map((f) => ({
      id: f.id,
      label: f.label ?? LABEL_POR_DEFECTO,
      printerScope: f.printer_scope,
      lastSeenAt: porAgente.get(f.id)?.last_seen_at ?? null,
      agentVersion: porAgente.get(f.id)?.agent_version ?? null,
    })),
  );
}

/**
 * Da de alta otra PC con print-agent (spec 124). Devuelve la key en claro UNA
 * sola vez. El alcance puede venir vacío: significa "sin restricción", y es lo
 * que hay que corregir apenas se sepa en qué LAN vive.
 */
export async function createPrintAgent(
  slug: string,
  input: { label: string; printerScope?: string | null },
): Promise<ActionResult<{ id: string; key: string }>> {
  const gate = await ensureAdminBusiness(slug, "agregar un agente de impresión");
  if ("error" in gate) return actionError(gate.error);

  const label = input.label.trim();
  if (!label) return actionError("Poné un nombre para reconocer esta PC.");

  let printerScope: string[] | null;
  try {
    printerScope = normalizarScope(input.printerScope);
  } catch (e) {
    return actionError((e as Error).message);
  }

  const key = generateAgentKey();
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("print_agent_credentials")
    .insert({
      business_id: gate.id,
      api_key: key,
      label,
      printer_scope: printerScope,
    })
    .select("id")
    .single();

  if (error) {
    // Hay DOS únicos que pueden tirar 23505 acá, y confundirlos manda al que
    // configura a renombrar en loop sin enterarse de qué pasa. Se discrimina por
    // el texto del error porque `PostgrestError` no expone `constraint`.
    if (error.code === "23505") {
      const detalle = `${error.message} ${error.details ?? ""}`;
      // El único de `business_id` lo repone la 0047 a propósito, para que no se
      // pueda crear la segunda credencial mientras el código viejo siga vivo.
      if (detalle.includes("print_agent_credentials_business_id_key")) {
        return actionError(
          "Todavía no se puede agregar una segunda PC: falta aplicar la migración 0048 (cierre del modelo).",
        );
      }
      // El único de (business_id, label) —desde la 0048— evita dos «Caja principal».
      if (detalle.includes("business_label")) {
        return actionError(`Ya hay un agente que se llama «${label}».`);
      }
    }
    return actionError(`Error creando el agente: ${error.message}`);
  }

  await marcarKeySeteada(gate.id);
  revalidatePath(`/${slug}/admin/configuracion/local`);
  return actionOk({ id: (data as { id: string }).id, key });
}

/**
 * Cambia el alcance de un agente: qué impresoras puede tocar.
 *
 * Vacío → `null` (sin restricción), nunca `[]`. Un `[]` leído como "no alcanza
 * nada" dejaría al local sin papel en silencio.
 */
export async function updatePrintAgentScope(
  slug: string,
  agentId: string,
  printerScope: string | null,
): Promise<ActionResult<{ printerScope: string[] | null }>> {
  const gate = await ensureAdminBusiness(slug, "cambiar el alcance del agente");
  if ("error" in gate) return actionError(gate.error);

  let scope: string[] | null;
  try {
    scope = normalizarScope(printerScope);
  } catch (e) {
    return actionError((e as Error).message);
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("print_agent_credentials")
    .update({ printer_scope: scope })
    .eq("id", agentId)
    .eq("business_id", gate.id);

  if (error) return actionError(`Error guardando el alcance: ${error.message}`);

  revalidatePath(`/${slug}/admin/configuracion/local`);
  return actionOk({ printerScope: scope });
}

/**
 * Genera el instalador del print-agent para UN agente (spec 046 + 124): el
 * `config.json` ya rellenado (con su key, creada lazily si el negocio no tenía
 * ninguna) + una signed URL del `.zip` instalador (best-effort; null si el
 * binario no está publicado). Gate admin. La key sólo viaja acá, dentro de la
 * sesión admin — nunca al cliente sin gate; por eso tampoco puede ir dentro del
 * ZIP (que es único para todos).
 */
export async function getPrintAgentInstaller(
  slug: string,
  agentId?: string,
): Promise<
  ActionResult<{ configJson: string; zipUrl: string | null; label: string }>
> {
  const gate = await ensureAdminBusiness(slug, "instalar el agente de impresión");
  if ("error" in gate) return actionError(gate.error);

  const agente = await resolverAgente(gate.id, agentId);
  if ("error" in agente) return actionError(agente.error);

  const serverUrl = await currentServerUrl();
  const config = buildAgentConfig({
    serverUrl,
    apiKey: agente.apiKey,
    businessId: gate.id,
  });
  const configJson = JSON.stringify(config, null, 2) + "\n";

  // El ZIP vive en Storage (fuera de Vercel por el límite de 4.5MB). Si el
  // bucket/binario no está publicado todavía, devolvemos null y la UI lo avisa.
  let zipUrl: string | null = null;
  const service = createSupabaseServiceClient();
  const { data } = await service.storage
    .from(EXE_BUCKET)
    // `download` fuerza Content-Disposition: attachment → el browser lo baja
    // (no navega), así un <a> lo descarga sin depender de window.open.
    .createSignedUrl(ZIP_PATH, 3600, { download: "print-agent.zip" });
  zipUrl = data?.signedUrl ?? null;

  // `resolverAgente` pudo haber creado la primera credencial recién ahora (alta
  // lazy de la spec 046). Sin esto la card se queda en «todavía no hay ningún
  // agente instalado» hasta que alguien recargue a mano: ninguna otra cosa marca
  // la página como stale, porque el resto de las actions revalidan y ésta no.
  revalidatePath(`/${slug}/admin/configuracion/local`);
  return actionOk({ configJson, zipUrl, label: agente.label });
}

/**
 * Regenera la key de UN agente (spec 046, US4; por-agente desde la 124):
 * invalida la anterior. Devuelve la key en claro UNA sola vez para mostrarla;
 * nunca se vuelve a poder leer. Gate admin.
 *
 * El `update … where id` reemplaza al `upsert onConflict: business_id` de antes:
 * con varios agentes, ese upsert le pisaba la key al otro y lo dejaba mudo.
 */
export async function rotatePrintAgentKey(
  slug: string,
  agentId?: string,
): Promise<ActionResult<{ key: string }>> {
  const gate = await ensureAdminBusiness(slug, "regenerar la key");
  if ("error" in gate) return actionError(gate.error);

  const agente = await resolverAgente(gate.id, agentId);
  if ("error" in agente) return actionError(agente.error);

  const key = generateAgentKey();
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("print_agent_credentials")
    .update({ api_key: key })
    .eq("id", agente.id)
    .eq("business_id", gate.id);
  if (error) return actionError(`Error generando la key: ${error.message}`);

  await marcarKeySeteada(gate.id);
  revalidatePath(`/${slug}/admin/configuracion/local`);
  return actionOk({ key });
}

/**
 * Borra un agente. Su latido se va con él (FK on delete cascade), así que el
 * panel no queda mostrando como caída una PC que ya no existe.
 */
export async function deletePrintAgent(
  slug: string,
  agentId: string,
): Promise<ActionResult<null>> {
  const gate = await ensureAdminBusiness(slug, "borrar un agente de impresión");
  if ("error" in gate) return actionError(gate.error);

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("print_agent_credentials")
    .delete()
    .eq("id", agentId)
    .eq("business_id", gate.id);

  if (error) return actionError(`Error borrando el agente: ${error.message}`);

  revalidatePath(`/${slug}/admin/configuracion/local`);
  return actionOk(null);
}
