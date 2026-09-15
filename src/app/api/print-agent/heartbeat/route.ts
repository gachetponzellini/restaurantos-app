import { NextResponse } from "next/server";

import { registrarLatido } from "@/lib/print-agent/heartbeat";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { unauthorized, autenticarAgente } from "../agent-auth";

/**
 * POST /api/print-agent/heartbeat
 * Body: { business_id: string }
 *
 * **DEPRECADO desde el agente 2026-09-15** (spec 183 · D1): el latido pasó a
 * viajar adentro del `GET /api/print-agent`, que ya autentica, ya sabe qué
 * agente es y recibe la versión en `x-agent-version`. Un agente nuevo no llama
 * esta ruta.
 *
 * No se toca y no se borra: es lo que siguen llamando los `.exe` instalados
 * —los dos locales tienen `agent_version` NULL, o sea binarios anteriores a
 * set-2026— y mientras haya uno instalado tiene que seguir contestando. El día
 * que `agent_version` diga 2026-09-15 o más en todos los agentes del panel,
 * esta ruta se puede retirar.
 *
 * Latido del print agent on-site (spec 35). Upsertea
 * `print_agent_status.last_seen_at`; operación deriva "conectada" vs "sin
 * conexión hace X" con el umbral de `lib/print-agent/cadence.ts`, que se deriva
 * de la cadencia esperada (ya no son 60 s clavados).
 *
 * Issue #278: el latido trae también la versión del agente. Es opcional a
 * propósito — un agente viejo no la manda, y ese NULL es justamente el dato
 * que interesa: significa "anterior a set-2026", que es cuando el .exe dejó de
 * armar el ticket por su cuenta. El panel lo lee así.
 *
 * Spec 124: una fila POR AGENTE. Antes la PK era sólo `business_id`, así que dos
 * PCs se pisaban el latido y un agente caído se veía conectado porque el otro
 * seguía latiendo. El agente no manda nada nuevo: quién latió sale de su key.
 */
export async function POST(req: Request) {
  let body: { business_id?: string; version?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const businessId = body.business_id;
  // Auth con el business_id ya parseado (spec 046). Spec 124: la key identifica
  // al agente, que es lo que se latea.
  const agente = await autenticarAgente(req, businessId);
  if (!agente) return unauthorized();
  if (!businessId) {
    return NextResponse.json({ error: "missing business_id" }, { status: 400 });
  }

  // El upsert es compartido con el GET (spec 183 · D1): las dos puertas tienen
  // que escribir la MISMA fila con las mismas reglas —incluida la de no pisar
  // la versión guardada— mientras agentes viejos y nuevos convivan.
  const service = createSupabaseServiceClient();
  const { error } = await registrarLatido(service, {
    businessId,
    agentId: agente.id,
    version: body.version,
  });

  if (error) {
    console.error("print-agent heartbeat", error);
    return NextResponse.json({ error: "upsert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
