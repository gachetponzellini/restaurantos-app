import "server-only";

import { ChatAnthropic } from "@langchain/anthropic";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import { currentDayOfWeek, dayOfWeekName } from "@/lib/day-of-week";
import { limitChatbotTurn } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  checkAvailabilityForChatbot,
  confirmReservationByChatbot,
  createReservationIntent,
  getReservationPolicyForChatbot,
  listChatbotReservationsByPhone,
  listSalonesForChatbot,
  normalizePhone,
} from "@/lib/reservations/chatbot-actions";
import {
  buildEnabledToolsList,
  buildEnabledToolsMarkdown,
  isToolEnabled,
  TOOL_METADATA,
  type ToolOverrides,
} from "@/lib/chatbot/tools-metadata";
import {
  ChatbotNotConfiguredError,
  isAnthropicKeyConfigured,
  resolveChatbotState,
} from "@/lib/chatbot/config-state";

export type ToolTraceEntry = {
  name: string;
  args: Record<string, unknown>;
  result: string;
};

export type ChatbotChannel = "whatsapp" | "web-test";

type Role = "user" | "assistant" | "system";

type StoredMessage = {
  role: Role;
  content: string;
};

/** Resultado de intentar entregarle la respuesta al cliente. */
export type ChatbotDeliveryResult = { ok: true } | { ok: false; error: string };

export type RunChatbotInput = {
  businessId: string;
  businessSlug: string;
  businessName: string;
  channel: ChatbotChannel;
  contactIdentifier: string;
  contactDisplayName?: string;
  userMessage: string;
  /**
   * Entrega la respuesta al cliente (en WhatsApp, `sendWhatsapp`). Va acá y no
   * en el caller para que la burbuja del bot se persista **sólo si el envío
   * salió bien**, que es la misma regla que ya aplicaba `sendStaffMessage`
   * ("para no dejar mensajes fantasma"). Cuando el webhook mandaba después de
   * que `runChatbot` había persistido, un rechazo de Gupshup dejaba la bandeja
   * mostrando una conversación contestada que el cliente nunca recibió.
   * Sin `deliver` (panel de prueba del admin) no hay nada que entregar.
   */
  deliver?: (text: string) => Promise<ChatbotDeliveryResult>;
};

export type RunChatbotResult = {
  conversationId: string;
  assistantMessage: string;
  toolTrace: ToolTraceEntry[];
  /**
   * `false` sólo cuando había una respuesta y `deliver` la rechazó. Sin
   * respuesta que mandar (handoff, bot mudo) o sin `deliver`, es `true`.
   */
  delivered: boolean;
};

/**
 * Error tipado cuando un turno se rechaza por rate-limit (spam por contacto o
 * techo de costo por negocio). El entrypoint decide qué hacer: la ruta de test
 * lo mapea a un 429 legible; el webhook futuro puede ackear y descartar sin
 * responder (para no spamear de vuelta). Se lanza ANTES de instanciar el modelo.
 */
export class ChatbotRateLimitedError extends Error {
  constructor() {
    super("Estás enviando mensajes muy seguido. Esperá unos segundos y volvé a intentar.");
    this.name = "ChatbotRateLimitedError";
  }
}

export const DEFAULT_SYSTEM_PROMPT = `# Asistente virtual de {{businessName}}

## Identidad
Sos el asistente de **{{businessName}}**. Atendés por WhatsApp. Tu trabajo es ayudar con dos cosas: (1) **pedidos** — tomar el pedido del cliente y pasarle un link para terminarlo en la web; (2) **reservas** — proponer un horario para reservar mesa y pasarle un link para que confirme. Sos útil, claro y directo.

El sistema te identifica al cliente por su teléfono (su número de WhatsApp), así que para listar o confirmar sus reservas no hace falta pedirle el teléfono — ya lo tenés.

## Estilo
- Español rioplatense informal (vos, dale, bárbaro). Nunca "usted".
- Respuestas cortas (2–4 líneas). Listados de productos: una línea por ítem.
- Formato WhatsApp: sin títulos, sin tablas. Podés usar *asteriscos* para resaltar y saltos de línea para separar. Emojis con moderación (máx. 1 por mensaje).

## Primer mensaje de la conversación
Si es el **primer** mensaje que te manda el cliente (el historial de la conversación está vacío antes de su mensaje), tu respuesta SIEMPRE sigue esta estructura de 2 partes:

1. **Saludo cálido** mencionando al negocio por nombre. Ej: *"¡Hola! 👋 Bienvenido/a a {{businessName}}"*.
2. **Invitación abierta**: una pregunta corta que abra a pedir o reservar. Ej: *"¿En qué te puedo ayudar?"*, *"¿Querés pedir algo o reservar mesa?"*, *"Contame qué necesitás"*.

Variá las palabras exactas entre conversaciones para no sonar robótico, pero respetá siempre las 2 partes. En los mensajes siguientes ya no saludes.

**Importante**: NO menciones horarios ni si el local está abierto/cerrado en el saludo inicial. Solo llamá \`check_business_status\` si el cliente pregunta explícitamente por horarios, si están abiertos, o si pueden pedir ahora.

## Flujo del pedido (después del primer mensaje)
1. **Explorar**: si el cliente pregunta "qué tenés" o por una categoría, \`search_products\` con términos amplios y mostrale 3–5 opciones.
3. **Detallar**: antes de agregar al carrito un producto con opciones, llamá \`get_product_details\` y preguntá por las opciones requeridas (toppings, tamaño, etc.).
4. **Agregar**: \`add_to_cart\` con product_id, cantidad y los modifier_ids correctos. Confirmá con una frase corta: "*Listo, sumé una muzza con aceitunas* 🍕".
5. **Iterar**: "¿Querés agregar algo más?" hasta que el cliente diga que cerró.
6. **Revisar + link**: \`get_cart\` para mostrar resumen + total. Si alcanza el mínimo (para delivery), \`generate_checkout_link\` y pasá el link con la frase de cierre (ver más abajo).

## Flujo de reserva (paralelo al de pedido)
Si el cliente dice "quiero reservar mesa", "tienen para X personas el viernes", "quiero ir a comer mañana" o similar:
1. **Recolectar terna**: necesitás **fecha + cantidad de personas** para arrancar. Si falta, preguntá.
2. **Consultar disponibilidad**: \`check_reservation_availability(date, party_size)\` con la fecha en formato YYYY-MM-DD y la cantidad.
   - Si la tool devuelve \`party_size_too_large\`, decile el máximo y pedí otra cantidad.
   - Si \`slots\` viene vacío, ofrecé otra fecha cercana.
   - Si trae slots, mostrale **3–5 opciones** al cliente (no la lista entera si son muchos).
3. **Confirmar la terna**: que el cliente te diga explícitamente el horario que prefiere. No avances hasta tener fecha + hora + cantidad confirmadas.
4. **Generar link**: \`generate_reservation_link({ date, slot, party_size, customer_name?, notes? })\`. Pasá el nombre solo si el cliente ya lo mencionó.
   - Si devuelve \`slot_no_longer_available\` con \`available_slots\`, avisale al cliente y ofrecé los nuevos slots.
5. **Pasar el link** con una frase corta: *"Listo, reservá acá 👉 [url] — vas a iniciar sesión y confirmar tus datos."*

Si el cliente pregunta "¿qué reservas tengo?" / "¿tengo reserva para hoy?":
- Llamá \`list_my_reservations\` (no le pidas el teléfono, ya lo tenés).
- Si la tool dice \`requires_phone: true\`, indicale que mire en \`/${"{"}slug${"}"}/perfil/reservas\`.
- Si \`count\` es 0, ofrecele reservar.

Si el bot pregunta "¿confirmás tu reserva de hoy?" y el cliente responde que sí:
- Primero \`list_my_reservations\` para obtener el \`reservation_id\` correcto.
- Después \`confirm_reservation(reservation_id)\`.

Para **cancelar** una reserva: NO existe tool para eso. Derivá al cliente a \`/${"{"}slug${"}"}/perfil/reservas\`, donde puede cancelarla. Para **cambiarla** (día, hora o personas) tampoco hay tool y el perfil NO permite editar: decile que la cancele desde ahí y haga una nueva, o que le escriba al local.

## Herramientas disponibles
Tenés acceso a: {{enabled_tools_list}}.

{{enabled_tools_markdown}}

## Reglas duras
1. **Nunca** inventes productos, precios, modifiers, horarios, slots de reserva ni IDs. Todo sale de las tools.
2. **Nunca** llames \`generate_checkout_link\` sin haber mostrado el carrito antes.
3. **Nunca** llames \`generate_reservation_link\` sin haber llamado primero \`check_reservation_availability\` y tener confirmación explícita del cliente sobre fecha, hora y cantidad.
4. **Nunca** pidas nombre, dirección, teléfono ni forma de pago para el pedido. Eso se completa en la web al clickear el link. Si el cliente pregunta "¿cómo pago?" o "¿a dónde mandás?", respondé: *"Todo eso lo cargás en el link al final — elegís delivery o pickup, dirección y forma de pago."*
5. Si el carrito no alcanza el mínimo para delivery, avisá cuánto falta antes de generar el link.
6. Si el local está cerrado y el cliente está por pedir, avisá y preguntá si quiere igual dejar armado el pedido para después.
7. **Nunca** ofrezcas modificar o cancelar reservas vos: para cancelar, derivá a \`/${"{"}slug${"}"}/perfil/reservas\`; para cambiarla, que la cancele ahí y haga una nueva (o que le escriba al local).

## Qué sabés y qué NO sabés
**Sabés**: catálogo, modifiers, horarios, info de delivery (fee, mínimo, estimado), dirección del local.
**NO sabés**: estado de pedidos ya hechos, promociones específicas, datos del cliente. Si preguntan, sé honesto.

## Fuera de alcance
Si preguntan algo no relacionado con el negocio, redirigí en una línea:
> "De eso no te puedo ayudar jeje 😅 ¿Querés que veamos algo del menú?"

## Cierre con link
Cuando mandes el link, usá esta estructura:
> "Listo, tenés esto:
> *1× Muzza con aceitunas — $5.500*
> *1× Coca 1.5L — $2.800*
> *Total: $8.300*
>
> Terminá tu pedido acá 👉 [url]
> Ahí cargás dirección y forma de pago."`;

// Max iterations of the tool-calling loop — guard against runaway calls.
// With cart tools the bot may chain search → details → add → get_cart → link
// in a single turn, so we allow a bit more headroom.
const MAX_TOOL_ITERATIONS = 8;

// Override via CHATBOT_MODEL in .env.local. Default: Claude Sonnet 4.6 — el
// punto justo de precio/velocidad para un bot de tool-calling por WhatsApp.
// Opus consumía demasiado para este caso de uso (respuestas cortas, flujo
// simple), así que dejó de ser el default. Para máxima latencia/costo mínimos,
// CHATBOT_MODEL=claude-haiku-4-5; si se quiere más capacidad puntual,
// claude-opus-4-8. Todos soportan adaptive thinking y prompt caching.
const CHATBOT_MODEL = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";

// Cap on the assistant's per-response output. Anthropic requires this be
// explicit; we keep it small because messages are short (WhatsApp-style).
// If the bot ever needs to send long structured output (rare in this product),
// bump this in env via CHATBOT_MAX_TOKENS.
const CHATBOT_MAX_TOKENS = Number(process.env.CHATBOT_MAX_TOKENS ?? 4096);

// Auto-cierre lazy por inactividad (sin cron): si la última conversación abierta
// de un contacto superó este umbral, `getOrOpenConversation` la cierra y abre
// una fresca. Evita que un cliente habitual arrastre meses de historial en una
// sola conversación (costo de tokens + contexto viejo). Configurable por env.
const CONVERSATION_TTL_HOURS = Number(
  process.env.CHATBOT_CONVERSATION_TTL_HOURS ?? 8,
);

// Tope duro de mensajes del historial que se mandan al modelo por turno.
// Backstop del prompt, independiente del TTL. El resto del historial queda en la
// DB (la vista de cliente lo sigue mostrando completo). Configurable por env.
const HISTORY_WINDOW = Number(process.env.CHATBOT_HISTORY_WINDOW ?? 20);

/**
 * Lee el flag `chatbot_enabled` del negocio. Sin fila en `chatbot_configs` →
 * false (el bot arranca apagado hasta que el dueño lo prende desde el panel).
 */
async function loadChatbotEnabled(
  service: Service,
  businessId: string,
): Promise<boolean> {
  const { data } = await service
    .from("chatbot_configs")
    .select("chatbot_enabled")
    .eq("business_id", businessId)
    .maybeSingle();
  return Boolean(data?.chatbot_enabled);
}

export async function runChatbot(
  input: RunChatbotInput,
): Promise<RunChatbotResult> {
  const service = createSupabaseServiceClient();

  // `web-test` es el panel de prueba del admin: un ensayo cuyo error se ve en
  // pantalla al instante y donde no hay nada que rescatar. Ahí seguimos cortando
  // ANTES de escribir, para no llenar la bandeja de conversaciones de prueba.
  const isDryRun = input.channel === "web-test";

  const enabled = await loadChatbotEnabled(service, input.businessId);
  const configState = resolveChatbotState({
    hasApiKey: isAnthropicKeyConfigured(),
    enabled,
  });
  if (isDryRun && !configState.ready) {
    throw new ChatbotNotConfiguredError(configState.reason);
  }

  // Persistir el entrante es lo PRIMERO en un canal real. Los gates de
  // configuración y de rate-limit corrían arriba de todo y se llevaban puesto el
  // mensaje: el webhook ya había devuelto 200 y ya había quemado la fila de
  // dedupe, así que ese WhatsApp no existía para nadie —ni en la bandeja ni para
  // un reintento de Gupshup—. Y el estado en el que más se pierde es el default:
  // `chatbot_enabled` arranca en `false`, o sea que apagar el bot para atender a
  // mano era justo lo que hacía desaparecer los mensajes a atender.
  const { conversationId, messageId: inboundMessageId } =
    await persistInbound(service, input);

  if (!configState.ready) {
    throw new ChatbotNotConfiguredError(configState.reason);
  }

  // Rate-limit: lo que protege es el gasto del modelo, no la bandeja, así que
  // corre DESPUÉS de persistir. El techo por negocio (240 turnos/hora) se
  // tragaba los mensajes de TODOS los clientes durante el resto de la ventana,
  // no sólo los del que abusó.
  if (!isDryRun) {
    const { success } = await limitChatbotTurn(
      input.businessId,
      input.contactIdentifier,
    );
    if (!success) throw new ChatbotRateLimitedError();
  }

  // Handoff humano (spec 32): si el staff apagó el agente para ESTA conversación
  // desde la bandeja, el bot no responde. El entrante ya quedó persistido arriba.
  // Fail-CLOSED: ante error de lectura NO respondemos (un turno no enviado es
  // recuperable; un WhatsApp ya enviado no). La invariante dura es "no se pisan".
  const agentEnabled = await loadConversationAgentEnabled(
    service,
    input.businessId,
    conversationId,
  );
  if (!agentEnabled) {
    return {
      conversationId,
      assistantMessage: "",
      toolTrace: [],
      delivered: true,
    };
  }

  // El historial excluye el mensaje que acabamos de insertar: viaja aparte como
  // `userMessage` y si no, el modelo lo vería dos veces.
  const history = await fetchHistory(service, conversationId, inboundMessageId);
  const { enabledTools, toolOverrides } = await loadToolConfig(
    service,
    input.businessId,
  );
  const systemPrompt = await resolveSystemPrompt(
    service,
    input.businessId,
    input.businessName,
    enabledTools,
    toolOverrides,
  );

  const { assistantMessage, toolTrace } = await invokeLlm({
    businessId: input.businessId,
    businessSlug: input.businessSlug,
    conversationId,
    contactIdentifier: input.contactIdentifier,
    channel: input.channel,
    enabledTools,
    systemPrompt,
    history,
    userMessage: input.userMessage,
  });

  // Re-check de handoff (TOCTOU, spec 32): el turno del LLM dura varios segundos
  // y el staff pudo tomar la conversación en ese lapso (tomarla al ver el
  // entrante ES el flujo de la feature). Si el agente se apagó durante el turno,
  // descartamos la respuesta del bot para no pisar al humano — el entrante ya
  // quedó persistido arriba. Con el envío adentro de esta función, la ventana se
  // cierra entera: antes quedaba el gap hasta el `sendWhatsapp` del webhook.
  const stillEnabled = await loadConversationAgentEnabled(
    service,
    input.businessId,
    conversationId,
  );
  if (!stillEnabled) {
    await touchConversation(service, conversationId);
    return {
      conversationId,
      assistantMessage: "",
      toolTrace,
      delivered: true,
    };
  }

  // Envío ANTES de persistir: la burbuja del bot en la bandeja significa "esto
  // le llegó al cliente". Si Gupshup rechaza (saldo, número inválido, 500), no
  // dejamos la burbuja: el hilo queda arriba de todo y sin responder, que es
  // exactamente lo que pasó, y la encargada puede contestarlo a mano.
  if (assistantMessage.trim() && input.deliver) {
    const delivery = await input.deliver(assistantMessage);
    if (!delivery.ok) {
      return {
        conversationId,
        assistantMessage: "",
        toolTrace,
        delivered: false,
      };
    }
  }

  await insertMessage(service, conversationId, "assistant", assistantMessage);
  await touchConversation(service, conversationId);

  return { conversationId, assistantMessage, toolTrace, delivered: true };
}

/**
 * Deja el entrante del cliente en la bandeja: contacto, conversación abierta,
 * fila en `chatbot_messages` y bump del hilo. Sin gates de ningún tipo — es lo
 * que tiene que pasar sí o sí, porque el webhook ya ackeó 200 y ya quemó la
 * fila de dedupe: lo que no se escriba acá no existe para nadie.
 *
 * El bump va pegado al insert (y no al final del turno) porque la bandeja
 * ordena por `updated_at desc`: si el turno se cae en el medio, el hilo tiene
 * que subir igual, con el mensaje sin responder adentro.
 */
async function persistInbound(
  service: Service,
  input: RunChatbotInput,
): Promise<{ conversationId: string; messageId: string }> {
  const contactId = await upsertContact(service, input);
  const conversationId = await getOrOpenConversation(
    service,
    input.businessId,
    contactId,
  );
  const messageId = await insertMessage(
    service,
    conversationId,
    "user",
    input.userMessage,
  );
  await touchConversation(service, conversationId);
  return { conversationId, messageId };
}

/**
 * Anota en la bandeja un entrante que el bot no va a procesar (audio, foto,
 * ubicación). No corre gates ni invoca al modelo: sólo deja el rastro para que
 * un humano lo atienda. Antes el webhook cortaba antes de cualquier escritura y
 * esos mensajes no existían para el sistema, con el cliente viendo el tilde de
 * entregado y esperando respuesta.
 */
export async function persistInboundMessage(input: {
  businessId: string;
  businessSlug: string;
  businessName: string;
  channel: ChatbotChannel;
  contactIdentifier: string;
  contactDisplayName?: string;
  userMessage: string;
}): Promise<{ conversationId: string }> {
  const service = createSupabaseServiceClient();
  const { conversationId } = await persistInbound(service, input);
  return { conversationId };
}

export async function closeConversation(
  conversationId: string,
  businessId: string,
): Promise<{ ok: boolean }> {
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("chatbot_conversations")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("business_id", businessId);
  if (error) throw new Error(`Failed to close conversation: ${error.message}`);
  return { ok: true };
}

// ---------------- internals ----------------

type Service = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Contacto del canal (teléfono de WhatsApp). Exportada para poder testear la
 * carrera del primer mensaje sin depender del scheduler.
 */
export async function upsertContact(
  service: Service,
  input: RunChatbotInput,
): Promise<string> {
  const leer = () =>
    service
      .from("chatbot_contacts")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("channel", input.channel)
      .eq("identifier", input.contactIdentifier)
      .maybeSingle();

  const { data: existing } = await leer();
  if (existing?.id) return existing.id;

  const { data: created, error } = await service
    .from("chatbot_contacts")
    .insert({
      business_id: input.businessId,
      channel: input.channel,
      identifier: input.contactIdentifier,
      display_name: input.contactDisplayName ?? null,
    })
    .select("id")
    .single();
  if (created?.id) return created.id;

  // Cliente nuevo que manda dos mensajes pegados: los dos turnos leen sin
  // encontrar fila y los dos insertan. La constraint UNIQUE (business_id,
  // channel, identifier) hace que el perdedor reciba 23505 — y sin esta rama
  // ese turno moría entero, así que el primer mensaje de un cliente nuevo se
  // perdía. Es la misma guarda que `getOrOpenConversation` ya tenía treinta
  // líneas más abajo: estaba escrita en un solo lado de los dos.
  if (error?.code === "23505") {
    const { data: raced } = await leer();
    if (raced?.id) return raced.id;
  }
  throw new Error(`Failed to upsert contact: ${error?.message ?? "unknown"}`);
}

async function getOrOpenConversation(
  service: Service,
  businessId: string,
  contactId: string,
): Promise<string> {
  const { data: open } = await service
    .from("chatbot_conversations")
    .select("id, updated_at, agent_enabled")
    .eq("contact_id", contactId)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // El handoff se hereda al reciclar. La conversación nueva nacía con
  // `agent_enabled` en su default (`true`), así que el "lo atiendo yo" de la
  // encargada caducaba solo a las 8 h de silencio —de un servicio de noche al
  // mediodía siguiente— sin que nadie lo decidiera ni lo viera: el bot volvía a
  // contestar por encima de lo que el humano ya había acordado a mano. Se pierde
  // que el handoff ahora es indefinido: para que el bot vuelva, alguien lo tiene
  // que prender desde la bandeja.
  let heredaHandoff = false;

  if (open?.id) {
    const ageMs = Date.now() - new Date(open.updated_at).getTime();
    if (ageMs < CONVERSATION_TTL_HOURS * 3_600_000) return open.id;
    heredaHandoff = open.agent_enabled === false;
    // Vencida por inactividad → cerrarla y caer a abrir una nueva.
    await service
      .from("chatbot_conversations")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", open.id);
  }

  const { data: created, error } = await service
    .from("chatbot_conversations")
    .insert({
      business_id: businessId,
      contact_id: contactId,
      ...(heredaHandoff ? { agent_enabled: false } : {}),
    })
    .select("id")
    .single();
  if (created?.id) return created.id;

  // El índice único parcial (mig 0068) garantiza una sola conversación abierta
  // por contacto. Si dos turnos concurrentes intentaron abrir a la vez, el
  // INSERT perdedor viola el índice (23505): en vez de fallar, re-leemos la
  // conversación que ganó la carrera.
  if (error?.code === "23505") {
    const { data: raced } = await service
      .from("chatbot_conversations")
      .select("id")
      .eq("contact_id", contactId)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (raced?.id) return raced.id;
  }
  throw new Error(
    `Failed to open conversation: ${error?.message ?? "unknown"}`,
  );
}

/**
 * Decide el gate de handoff (spec 32) a partir del resultado de la lectura.
 * Pura y testeable sin DB. **Fail-CLOSED ante error**: si no podemos confirmar
 * el estado, el bot NO responde (un turno no enviado es recuperable; un WhatsApp
 * ya enviado no; la invariante dura es "bot y humano no se pisan"). Fila ausente
 * SIN error = conversación nueva legítima → el bot responde (la columna es
 * NOT NULL DEFAULT true).
 */
export function decideAgentEnabled(
  row: { agent_enabled: boolean } | null,
  error: unknown,
): boolean {
  if (error) return false;
  if (!row) return true;
  return row.agent_enabled;
}

/**
 * Lee el flag de handoff de la conversación (spec 32). `false` = el staff está
 * atendiendo y el bot no debe responder. Scopeado por `business_id` (defensa
 * cross-tenant, en línea con `loadConversationScoped` del lado admin).
 */
async function loadConversationAgentEnabled(
  service: Service,
  businessId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("chatbot_conversations")
    .select("agent_enabled")
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .maybeSingle();
  return decideAgentEnabled(
    data as { agent_enabled: boolean } | null,
    error,
  );
}

async function fetchHistory(
  service: Service,
  conversationId: string,
  excludeMessageId?: string,
): Promise<StoredMessage[]> {
  // Últimos HISTORY_WINDOW mensajes (desc + limit) y luego revertidos a orden
  // cronológico ascendente para el prompt. Acota lo que ve el modelo sin borrar
  // nada de la DB. `excludeMessageId` saca el entrante de este turno, que ahora
  // se persiste antes de armar el prompt y viaja aparte como `userMessage`.
  let q = service
    .from("chatbot_messages")
    .select("role, content")
    .eq("conversation_id", conversationId);
  if (excludeMessageId) q = q.neq("id", excludeMessageId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  if (error) throw new Error(`Failed to load history: ${error.message}`);
  return ((data ?? []) as StoredMessage[]).reverse();
}

async function insertMessage(
  service: Service,
  conversationId: string,
  role: Role,
  content: string,
): Promise<string> {
  const { data, error } = await service
    .from("chatbot_messages")
    .insert({ conversation_id: conversationId, role, content })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert message: ${error?.message ?? "unknown"}`);
  }
  return data.id;
}

async function touchConversation(service: Service, conversationId: string) {
  await service
    .from("chatbot_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/**
 * Bloque «## Contexto temporal» que se le pega al system prompt.
 *
 * Sin esto el LLM no sabe qué día es hoy y resuelve mal las fechas relativas
 * ("mañana", "el sábado") en reservas. Se computa en la zona horaria del
 * negocio, no en la del server. Sólo fecha + día de semana (no la hora) para no
 * romper el prompt caching cada minuto — la hora exacta la da
 * `check_business_status` cuando hace falta.
 */
export function buildDateContext(now: Date, tz: string): string {
  const todayIso = formatInTimeZone(now, tz, "yyyy-MM-dd");
  // El nombre del día sale del MISMO reloj que la fecha (`formatInTimeZone`,
  // vía `currentDayOfWeek`). Antes se leía con `toZonedTime(now, tz).getUTCDay()`,
  // que sólo acierta si el proceso corre en UTC: en un server en UTC-3 el prompt
  // decía "Hoy es sábado 2026-09-11" cuando el 11 era viernes, y el modelo
  // resolvía "el sábado" a hoy → reserva tomada para el día equivocado.
  const todayDow = currentDayOfWeek(tz, now);
  return `\n\n## Contexto temporal\nHoy es ${nombreDelDia(todayDow)} ${todayIso} (zona horaria ${tz}). Usá esta fecha para resolver referencias relativas como "hoy", "mañana" o "el sábado". Las fechas que pases a las herramientas van siempre en formato YYYY-MM-DD.`;
}

async function resolveSystemPrompt(
  service: Service,
  businessId: string,
  businessName: string,
  enabledTools: string[] | null,
  toolOverrides: ToolOverrides,
): Promise<string> {
  const [{ data }, { data: business }] = await Promise.all([
    service
      .from("chatbot_configs")
      .select("system_prompt")
      .eq("business_id", businessId)
      .maybeSingle(),
    service
      .from("businesses")
      .select("timezone")
      .eq("id", businessId)
      .maybeSingle(),
  ]);

  const template =
    data?.system_prompt && data.system_prompt.trim().length > 0
      ? data.system_prompt
      : DEFAULT_SYSTEM_PROMPT;

  const tz = business?.timezone || "America/Argentina/Buenos_Aires";
  const dateContext = buildDateContext(new Date(), tz);

  return (
    template
      .replaceAll("{{businessName}}", businessName)
      .replaceAll("{{enabled_tools_list}}", buildEnabledToolsList(enabledTools))
      .replaceAll(
        "{{enabled_tools_markdown}}",
        buildEnabledToolsMarkdown(enabledTools, toolOverrides),
      ) + dateContext
  );
}

async function loadToolConfig(
  service: Service,
  businessId: string,
): Promise<{ enabledTools: string[] | null; toolOverrides: ToolOverrides }> {
  const { data } = await service
    .from("chatbot_configs")
    .select("enabled_tools, tool_overrides")
    .eq("business_id", businessId)
    .maybeSingle();
  return {
    enabledTools: (data?.enabled_tools as string[] | null | undefined) ?? null,
    toolOverrides:
      (data?.tool_overrides as ToolOverrides | null | undefined) ?? {},
  };
}

// ---------------- tools ----------------

function buildSearchProductsTool(businessId: string) {
  return tool(
    async ({ query }: { query: string }) => {
      const service = createSupabaseServiceClient();
      const trimmed = query.trim();
      if (!trimmed) {
        return JSON.stringify({ error: "empty query" });
      }
      // Escape ILIKE wildcards in the user-provided fragment so a literal
      // '%' doesn't become a free-for-all match.
      const pattern = `%${trimmed.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

      const { data, error } = await service
        .from("products")
        .select(
          "id, name, description, price_cents, is_available, categories(name)",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        .or(`name.ilike.${pattern},description.ilike.${pattern}`)
        .order("sort_order", { ascending: true })
        .limit(10);

      if (error) {
        return JSON.stringify({ error: error.message });
      }

      const products = (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        price_cents: p.price_cents,
        price_ars: `$${(Number(p.price_cents) / 100).toFixed(2)}`,
        available: p.is_available,
        category:
          (Array.isArray(p.categories)
            ? p.categories[0]?.name
            : (p.categories as { name: string } | null)?.name) ?? null,
      }));

      return JSON.stringify({ query: trimmed, count: products.length, products });
    },
    {
      name: "search_products",
      description:
        "Busca productos activos del catálogo de este negocio por coincidencia parcial en nombre o descripción. Úsala cuando el cliente pregunte por productos, precios o disponibilidad. Devuelve hasta 10 resultados con nombre, descripción, precio (en centavos y formateado en ARS), disponibilidad y categoría.",
      schema: z.object({
        query: z
          .string()
          .describe(
            "Fragmento de texto a buscar. Ej: 'pizza', 'muzzarella', 'hamburguesa doble', 'bebida'.",
          ),
      }),
    },
  );
}

/**
 * El nombre del día para el prompt y para el JSON de las tools, en minúscula
 * (van embebidos en prosa). La tabla vive en `@/lib/day-of-week` — acá había una
 * copia, y con la copia se copiaba también la forma equivocada de calcular el
 * índice.
 */
function nombreDelDia(dow: number): string {
  return dayOfWeekName(dow).toLowerCase();
}

function parseTimeToMinutes(hms: string): number | null {
  // Accept HH:MM or HH:MM:SS.
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hms);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatMinutesAsHHMM(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Ubica "ahora" en el eje semanal del negocio: minutos 0..10079 contando desde
 * el domingo 00:00 de su zona horaria. Es lo que usa `check_business_status`
 * para decidir si estamos dentro de una ventana de `business_hours`.
 */
export function positionInBusinessWeek(
  now: Date,
  tz: string,
): { dow: number; dayMinutes: number; weekMinutes: number } {
  // Todo el eje se lee con `formatInTimeZone`, que no depende del TZ del
  // proceso. El código anterior hacía `toZonedTime(now, tz).getUTC*()` con un
  // comentario que afirmaba lo contrario ("toZonedTime returns a Date whose
  // *UTC* methods reflect the target-zone wall clock"): eso es cierto sólo si el
  // proceso corre en UTC. `toZonedTime` devuelve un Date pensado para leerse con
  // los getters LOCALES, así que en un server en UTC-3 el eje se corría +1 día y
  // +3 horas — un viernes 21:00 se leía como sábado 00:00. El JSON de
  // `check_business_status` quedaba contradiciéndose solo: `current_time` salía
  // bien (formatInTimeZone) y el día y los `today_hours`, del día siguiente.
  const dow = currentDayOfWeek(tz, now);
  const dayMinutes =
    Number(formatInTimeZone(now, tz, "H")) * 60 +
    Number(formatInTimeZone(now, tz, "m"));
  return { dow, dayMinutes, weekMinutes: dow * 1440 + dayMinutes };
}

function buildBusinessStatusTool(businessId: string) {
  return tool(
    async () => {
      const service = createSupabaseServiceClient();
      const [{ data: business }, { data: hours }] = await Promise.all([
        service
          .from("businesses")
          .select("timezone")
          .eq("id", businessId)
          .maybeSingle(),
        service
          .from("business_hours")
          .select("day_of_week, opens_at, closes_at")
          .eq("business_id", businessId),
      ]);

      if (!business) {
        return JSON.stringify({ error: "business not found" });
      }
      const tz = business.timezone || "America/Argentina/Buenos_Aires";
      const now = new Date();
      const currentTime = formatInTimeZone(now, tz, "HH:mm");

      if (!hours || hours.length === 0) {
        return JSON.stringify({
          has_hours: false,
          timezone: tz,
          current_time: currentTime,
          message: "El negocio no tiene horarios configurados.",
        });
      }

      const { dow: currentDow, weekMinutes: currentWeekMin } =
        positionInBusinessWeek(now, tz);

      type Window = {
        startMin: number;
        endMin: number;
        dow: number;
        opensAt: string;
        closesAt: string;
      };

      const windows: Window[] = [];
      for (const h of hours) {
        const opens = parseTimeToMinutes(h.opens_at);
        const closes = parseTimeToMinutes(h.closes_at);
        if (opens == null || closes == null || opens === closes) continue;
        const startMin = h.day_of_week * 1440 + opens;
        const duration =
          closes > opens ? closes - opens : 1440 - opens + closes;
        windows.push({
          startMin,
          endMin: startMin + duration,
          dow: h.day_of_week,
          opensAt: formatMinutesAsHHMM(opens),
          closesAt: formatMinutesAsHHMM(closes),
        });
      }

      // Is any window currently active? Check k=-1,0 to cover cross-week wrap.
      let openWindow: Window | null = null;
      let closeAtWeekMin = 0;
      for (const w of windows) {
        for (const k of [-1, 0]) {
          const s = w.startMin + k * 10080;
          const e = w.endMin + k * 10080;
          if (s <= currentWeekMin && currentWeekMin < e) {
            openWindow = w;
            closeAtWeekMin = e;
            break;
          }
        }
        if (openWindow) break;
      }

      const todayHours = windows
        .filter((w) => w.dow === currentDow)
        .map((w) => ({ opens_at: w.opensAt, closes_at: w.closesAt }));

      if (openWindow) {
        const minutesToClose = closeAtWeekMin - currentWeekMin;
        return JSON.stringify({
          is_open: true,
          current_time: currentTime,
          current_day: nombreDelDia(currentDow),
          timezone: tz,
          closes_at: openWindow.closesAt,
          closes_in_minutes: minutesToClose,
          today_hours: todayHours,
        });
      }

      // Closed — find next opening across this week / next week wrap.
      let best: { delta: number; dow: number; at: string } | null = null;
      for (const w of windows) {
        for (const k of [0, 1]) {
          const s = w.startMin + k * 10080;
          if (s <= currentWeekMin) continue;
          const delta = s - currentWeekMin;
          if (!best || delta < best.delta) {
            best = { delta, dow: w.dow, at: w.opensAt };
          }
        }
      }

      if (!best) {
        return JSON.stringify({
          is_open: false,
          current_time: currentTime,
          current_day: nombreDelDia(currentDow),
          timezone: tz,
          today_hours: todayHours,
          message: "No se encontraron próximos horarios.",
        });
      }

      const dowDiff = (best.dow - currentDow + 7) % 7;
      const relative =
        dowDiff === 0 ? "hoy" : dowDiff === 1 ? "mañana" : nombreDelDia(best.dow);

      return JSON.stringify({
        is_open: false,
        current_time: currentTime,
        current_day: nombreDelDia(currentDow),
        timezone: tz,
        today_hours: todayHours,
        opens_next: {
          day: nombreDelDia(best.dow),
          relative,
          at: best.at,
          in_minutes: best.delta,
        },
      });
    },
    {
      name: "check_business_status",
      description:
        "Consulta si el negocio está abierto ahora mismo, a qué hora cierra hoy, y si está cerrado cuándo abre la próxima vez. Úsala siempre que el cliente pregunte por horarios, si están abiertos, o si pueden pasar/pedir ahora. Respeta la timezone del negocio. Devuelve `is_open`, hora actual, horarios de hoy y (si está abierto) `closes_at` + `closes_in_minutes`, o (si está cerrado) `opens_next` con día (hoy/mañana/día de la semana), hora y minutos faltantes.",
      schema: z.object({}),
    },
  );
}

// ---------------- cart helpers ----------------

type CartModifier = {
  modifier_id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
};

type CartItem = {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  notes?: string;
  image_url?: string | null;
  modifiers: CartModifier[];
};

type CartState = { items: CartItem[] };

type BotCtx = {
  businessId: string;
  businessSlug: string;
  conversationId: string;
  /**
   * Identity of the conversation contact (phone for WhatsApp, opaque string
   * for `web-test`). Reservation tools use this as weak auth ("show / confirm
   * the reservations whose `customer_phone` matches this identifier").
   */
  contactIdentifier: string;
  channel: ChatbotChannel;
};

function readCart(raw: unknown): CartState {
  if (raw && typeof raw === "object" && "items" in raw) {
    const items = (raw as { items: unknown }).items;
    if (Array.isArray(items)) return { items: items as CartItem[] };
  }
  return { items: [] };
}

function lineSubtotalCents(item: CartItem): number {
  const mods = item.modifiers.reduce((a, m) => a + m.price_delta_cents, 0);
  return (item.unit_price_cents + mods) * item.quantity;
}

function formatArs(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function getConversationCart(
  service: Service,
  conversationId: string,
): Promise<CartState> {
  const { data, error } = await service
    .from("chatbot_conversations")
    .select("cart_state")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`cart read failed: ${error.message}`);
  return readCart(data?.cart_state);
}

async function writeConversationCart(
  service: Service,
  conversationId: string,
  cart: CartState,
): Promise<void> {
  const { error } = await service
    .from("chatbot_conversations")
    // supabase expects the Json union; CartState serializes cleanly so this cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ cart_state: cart as any })
    .eq("id", conversationId);
  if (error) throw new Error(`cart write failed: ${error.message}`);
}

function summarizeCart(
  cart: CartState,
  minOrderCents: number | null,
): Record<string, unknown> {
  const subtotal = cart.items.reduce((a, i) => a + lineSubtotalCents(i), 0);
  const minRequired = minOrderCents ?? 0;
  return {
    items: cart.items.map((i) => ({
      id: i.id,
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price_ars: formatArs(i.unit_price_cents),
      line_subtotal_cents: lineSubtotalCents(i),
      line_subtotal_ars: formatArs(lineSubtotalCents(i)),
      modifiers: i.modifiers.map((m) => ({
        name: m.name,
        price_delta_ars:
          m.price_delta_cents === 0 ? null : formatArs(m.price_delta_cents),
      })),
      notes: i.notes ?? null,
    })),
    subtotal_cents: subtotal,
    subtotal_ars: formatArs(subtotal),
    item_count: cart.items.reduce((a, i) => a + i.quantity, 0),
    min_order_cents: minRequired,
    min_order_ars: minRequired > 0 ? formatArs(minRequired) : null,
    meets_minimum: subtotal >= minRequired,
    missing_for_minimum_ars:
      subtotal >= minRequired ? null : formatArs(minRequired - subtotal),
  };
}

// ---------------- product details + delivery info tools ----------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidProductIdResponse(given: string) {
  return JSON.stringify({
    error: "product_id_invalid",
    instruction:
      "Ese product_id no existe. Probablemente lo inventaste o usaste un placeholder. Llamá `search_products` con el nombre del producto que pidió el cliente, tomá el `id` que viene en el resultado, y reintentá. NO le digas al cliente que hubo un error — simplemente buscá y reintentá.",
    given_product_id: given,
  });
}

function invalidModifierIdResponse(given: string[]) {
  return JSON.stringify({
    error: "modifier_id_invalid",
    instruction:
      "Alguno de los modifier_ids no es un UUID válido (probablemente lo inventaste). Llamá `get_product_details` con el product_id correcto para obtener los ids reales de los modifiers, y reintentá add_to_cart con esos. NO le digas al cliente que hubo un error.",
    given_modifier_ids: given,
  });
}

function buildProductDetailsTool(businessId: string) {
  return tool(
    async ({ product_id }: { product_id: string }) => {
      if (!UUID_RE.test(product_id)) {
        return invalidProductIdResponse(product_id);
      }
      const service = createSupabaseServiceClient();
      const { data: product, error: pErr } = await service
        .from("products")
        .select(
          "id, name, description, price_cents, is_available, is_active, category_id, image_url",
        )
        .eq("id", product_id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (pErr) return JSON.stringify({ error: pErr.message });
      if (!product || !product.is_active) {
        return invalidProductIdResponse(product_id);
      }

      const { data: groups, error: gErr } = await service
        .from("modifier_groups")
        .select(
          "id, name, min_selection, max_selection, is_required, sort_order, modifiers(id, name, price_delta_cents, is_available, sort_order)",
        )
        .eq("business_id", businessId)
        .eq("product_id", product_id)
        .order("sort_order", { ascending: true });
      if (gErr) return JSON.stringify({ error: gErr.message });

      const modifierGroups = (groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        min_selection: g.min_selection,
        max_selection: g.max_selection,
        is_required: g.is_required,
        modifiers: (
          (Array.isArray(g.modifiers) ? g.modifiers : []) as Array<{
            id: string;
            name: string;
            price_delta_cents: number;
            is_available: boolean;
            sort_order: number;
          }>
        )
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => ({
            id: m.id,
            name: m.name,
            price_delta_cents: m.price_delta_cents,
            price_delta_ars:
              m.price_delta_cents === 0
                ? null
                : formatArs(m.price_delta_cents),
            is_available: m.is_available,
          })),
      }));

      return JSON.stringify({
        id: product.id,
        name: product.name,
        description: product.description,
        price_cents: product.price_cents,
        price_ars: formatArs(product.price_cents),
        is_available: product.is_available,
        image_url: product.image_url,
        modifier_groups: modifierGroups,
      });
    },
    {
      name: "get_product_details",
      description:
        "Devuelve los detalles completos de un producto, incluyendo sus grupos de opciones (modifiers) con reglas (min/max, requerido). Úsala antes de agregar al carrito un producto que pueda tener opciones, para preguntarle al cliente qué elige.",
      schema: z.object({
        product_id: z
          .string()
          .describe(
            "UUID del producto. Se obtiene del resultado de search_products o add_to_cart.",
          ),
      }),
    },
  );
}

function buildDeliveryInfoTool(businessId: string) {
  return tool(
    async () => {
      const service = createSupabaseServiceClient();
      const { data: b, error } = await service
        .from("businesses")
        .select(
          "address, delivery_fee_cents, min_order_cents, estimated_delivery_minutes, mp_accepts_payments, phone",
        )
        .eq("id", businessId)
        .maybeSingle();
      if (error || !b) {
        return JSON.stringify({ error: "business info unavailable" });
      }
      return JSON.stringify({
        delivery_fee_cents: b.delivery_fee_cents ?? 0,
        delivery_fee_ars: formatArs(b.delivery_fee_cents ?? 0),
        min_order_cents: b.min_order_cents ?? 0,
        min_order_ars:
          (b.min_order_cents ?? 0) > 0
            ? formatArs(b.min_order_cents ?? 0)
            : null,
        estimated_delivery_minutes: b.estimated_delivery_minutes ?? null,
        pickup_address: b.address ?? null,
        business_phone: b.phone ?? null,
        accepts_cash: true,
        accepts_mp: Boolean(b.mp_accepts_payments),
      });
    },
    {
      name: "get_delivery_info",
      description:
        "Devuelve info de delivery del negocio: costo de envío, mínimo de pedido, tiempo estimado, dirección para pickup, formas de pago aceptadas. Úsala cuando el cliente pregunte por envío, mínimo, dirección del local, cuánto tarda, o formas de pago.",
      schema: z.object({}),
    },
  );
}

// ---------------- cart tools ----------------

async function fetchMinOrderCents(
  service: Service,
  businessId: string,
): Promise<number> {
  const { data } = await service
    .from("businesses")
    .select("min_order_cents")
    .eq("id", businessId)
    .maybeSingle();
  return data?.min_order_cents ?? 0;
}

function buildGetCartTool(ctx: BotCtx) {
  return tool(
    async () => {
      const service = createSupabaseServiceClient();
      const cart = await getConversationCart(service, ctx.conversationId);
      const minOrder = await fetchMinOrderCents(service, ctx.businessId);
      return JSON.stringify(summarizeCart(cart, minOrder));
    },
    {
      name: "get_cart",
      description:
        "Muestra el estado actual del carrito: líneas con nombre/cantidad/modifiers, subtotal, y si alcanza el mínimo de delivery. Úsala cuando el cliente pregunte por el estado del pedido, los totales, o antes de generar el link de checkout.",
      schema: z.object({}),
    },
  );
}

function buildAddToCartTool(ctx: BotCtx) {
  return tool(
    async ({
      product_id,
      quantity,
      modifier_ids,
      notes,
    }: {
      product_id: string;
      quantity: number;
      modifier_ids?: string[];
      notes?: string;
    }) => {
      const service = createSupabaseServiceClient();

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return JSON.stringify({ error: "quantity debe ser entero entre 1 y 99" });
      }

      // 0) Validate UUID format BEFORE hitting the DB (Postgres rejects with
      // an unhelpful "invalid input syntax" that the LLM can't recover from).
      if (!UUID_RE.test(product_id)) {
        return invalidProductIdResponse(product_id);
      }
      const selectedIds = modifier_ids ?? [];
      const badMods = selectedIds.filter((id) => !UUID_RE.test(id));
      if (badMods.length > 0) {
        return invalidModifierIdResponse(badMods);
      }

      // 1) Validate product.
      const { data: product, error: pErr } = await service
        .from("products")
        .select("id, name, price_cents, is_active, is_available, image_url")
        .eq("id", product_id)
        .eq("business_id", ctx.businessId)
        .maybeSingle();
      if (pErr) return JSON.stringify({ error: pErr.message });
      if (!product || !product.is_active) {
        return invalidProductIdResponse(product_id);
      }
      if (!product.is_available) {
        return JSON.stringify({
          error: `el producto "${product.name}" no está disponible ahora`,
        });
      }

      // 2) Load product's modifier groups.
      const { data: groups } = await service
        .from("modifier_groups")
        .select(
          "id, name, min_selection, max_selection, is_required, modifiers(id, name, price_delta_cents, is_available, group_id)",
        )
        .eq("business_id", ctx.businessId)
        .eq("product_id", product_id);

      const modifierSnapshots: CartModifier[] = [];

      if (groups && groups.length > 0) {
        // Build lookup of modifier_id -> (modifier, group) for fast checks.
        const flat = new Map<
          string,
          {
            mod: {
              id: string;
              name: string;
              price_delta_cents: number;
              is_available: boolean;
              group_id: string;
            };
            group: { id: string; name: string; max_selection: number };
          }
        >();
        for (const g of groups) {
          const mods = (Array.isArray(g.modifiers) ? g.modifiers : []) as Array<{
            id: string;
            name: string;
            price_delta_cents: number;
            is_available: boolean;
            group_id: string;
          }>;
          for (const m of mods) {
            flat.set(m.id, {
              mod: m,
              group: { id: g.id, name: g.name, max_selection: g.max_selection },
            });
          }
        }

        // Validate selected ids exist and are available.
        const selectedByGroup = new Map<string, string[]>();
        for (const id of selectedIds) {
          const match = flat.get(id);
          if (!match) {
            return JSON.stringify({
              error: `modifier ${id} no pertenece a este producto`,
            });
          }
          if (!match.mod.is_available) {
            return JSON.stringify({
              error: `la opción "${match.mod.name}" no está disponible`,
            });
          }
          const list = selectedByGroup.get(match.group.id) ?? [];
          list.push(id);
          selectedByGroup.set(match.group.id, list);
          modifierSnapshots.push({
            modifier_id: match.mod.id,
            group_id: match.group.id,
            name: match.mod.name,
            price_delta_cents: match.mod.price_delta_cents,
          });
        }

        // Validate min/max per group. If anything is missing/over, respond
        // with `needs_options: true` (NOT "error") and include all the groups
        // + available modifiers so the model can ask the user without
        // another tool call.
        type MissingGroup = {
          id: string;
          name: string;
          min: number;
          max: number;
          required: boolean;
          reason: "missing" | "too_many";
          modifiers: Array<{
            id: string;
            name: string;
            price_delta_cents: number;
            price_delta_ars: string | null;
          }>;
        };
        const missing: MissingGroup[] = [];
        for (const g of groups) {
          const count = (selectedByGroup.get(g.id) ?? []).length;
          const needsMin = g.is_required
            ? Math.max(1, g.min_selection)
            : g.min_selection;
          let reason: "missing" | "too_many" | null = null;
          if (count < needsMin) reason = "missing";
          else if (count > g.max_selection) reason = "too_many";
          if (!reason) continue;

          const mods = (
            (Array.isArray(g.modifiers) ? g.modifiers : []) as Array<{
              id: string;
              name: string;
              price_delta_cents: number;
              is_available: boolean;
            }>
          )
            .filter((m) => m.is_available)
            .map((m) => ({
              id: m.id,
              name: m.name,
              price_delta_cents: m.price_delta_cents,
              price_delta_ars:
                m.price_delta_cents === 0
                  ? null
                  : formatArs(m.price_delta_cents),
            }));
          missing.push({
            id: g.id,
            name: g.name,
            min: needsMin,
            max: g.max_selection,
            required: g.is_required,
            reason,
            modifiers: mods,
          });
        }
        if (missing.length > 0) {
          return JSON.stringify({
            needs_options: true,
            product_id: product.id,
            product_name: product.name,
            message:
              "Este producto requiere elegir opciones. Pregúntale al cliente qué prefiere usando los datos de `groups` y después volvé a llamar add_to_cart con los modifier_ids correspondientes. NO le digas al cliente que hubo un error — es solo que faltan opciones.",
            groups: missing,
          });
        }
      } else if (selectedIds.length > 0) {
        return JSON.stringify({
          error: "este producto no acepta opciones",
        });
      }

      // 3) Load current cart, append, save.
      const cart = await getConversationCart(service, ctx.conversationId);
      const lineId = globalThis.crypto.randomUUID();
      cart.items.push({
        id: lineId,
        product_id: product.id,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity,
        notes: notes?.trim() || undefined,
        image_url: product.image_url ?? null,
        modifiers: modifierSnapshots,
      });
      await writeConversationCart(service, ctx.conversationId, cart);

      const minOrder = await fetchMinOrderCents(service, ctx.businessId);
      return JSON.stringify({
        ok: true,
        added_line_id: lineId,
        cart: summarizeCart(cart, minOrder),
      });
    },
    {
      name: "add_to_cart",
      description:
        "Agrega un producto al carrito con cantidad, modifiers opcionales y notas. Valida modifiers contra el producto. Si falla, te dice qué falta. Si tiene éxito, devuelve el carrito actualizado.",
      schema: z.object({
        product_id: z.string().describe("UUID del producto."),
        quantity: z.number().int().min(1).max(99),
        modifier_ids: z
          .array(z.string())
          .optional()
          .describe(
            "IDs de modifiers elegidos por el cliente (obtenidos de get_product_details). Respeta min/max por grupo.",
          ),
        notes: z
          .string()
          .max(200)
          .optional()
          .describe("Notas opcionales del cliente para esta línea."),
      }),
    },
  );
}

function buildRemoveFromCartTool(ctx: BotCtx) {
  return tool(
    async ({ line_id }: { line_id: string }) => {
      const service = createSupabaseServiceClient();
      const cart = await getConversationCart(service, ctx.conversationId);
      const before = cart.items.length;
      cart.items = cart.items.filter((i) => i.id !== line_id);
      if (cart.items.length === before) {
        return JSON.stringify({ error: "no se encontró esa línea en el carrito" });
      }
      await writeConversationCart(service, ctx.conversationId, cart);
      const minOrder = await fetchMinOrderCents(service, ctx.businessId);
      return JSON.stringify({ ok: true, cart: summarizeCart(cart, minOrder) });
    },
    {
      name: "remove_from_cart",
      description:
        "Quita una línea del carrito por su line_id (el `id` que devolvió get_cart o add_to_cart).",
      schema: z.object({
        line_id: z.string().describe("ID de la línea del carrito a remover."),
      }),
    },
  );
}

function buildGenerateCheckoutLinkTool(ctx: BotCtx) {
  return tool(
    async () => {
      const service = createSupabaseServiceClient();
      const { data: conv, error } = await service
        .from("chatbot_conversations")
        .select("cart_state, cart_token, closed_at")
        .eq("id", ctx.conversationId)
        .maybeSingle();
      if (error || !conv) {
        return JSON.stringify({ error: "conversation not found" });
      }
      const cart = readCart(conv.cart_state);
      if (cart.items.length === 0) {
        return JSON.stringify({ error: "el carrito está vacío" });
      }

      let token = conv.cart_token;
      if (!token) {
        token = globalThis.crypto
          .randomUUID()
          .replace(/-/g, "")
          .slice(0, 16);
        const { error: updErr } = await service
          .from("chatbot_conversations")
          .update({ cart_token: token })
          .eq("id", ctx.conversationId);
        if (updErr) {
          return JSON.stringify({
            error: `failed to persist token: ${updErr.message}`,
          });
        }
      }

      const base =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
        "http://localhost:3000";
      const url = `${base}/${ctx.businessSlug}/cart/${token}`;
      return JSON.stringify({ url, token });
    },
    {
      name: "generate_checkout_link",
      description:
        "Genera el link al checkout web con el carrito actual pre-cargado. Llamala solo cuando el cliente confirmó que terminó de armar el pedido y llamaste get_cart en el mensaje previo. Devuelve la URL que tenés que mandar al cliente para que complete dirección y pago.",
      schema: z.object({}),
    },
  );
}

// ---------------- Reservations tools ----------------

function buildReservationInfoTool(ctx: BotCtx) {
  return tool(
    async () => {
      const info = await getReservationPolicyForChatbot(ctx.businessId);
      return JSON.stringify(info);
    },
    {
      name: "get_reservation_info",
      description:
        "Devuelve la política de reservas del negocio: máximo de comensales, anticipación, duración del turno y días abiertos. Usala cuando el cliente pregunte por restricciones o disponibilidad general antes de elegir un día.",
      schema: z.object({}),
    },
  );
}

function buildListReservationSalonesTool(ctx: BotCtx) {
  return tool(
    async () => {
      const result = await listSalonesForChatbot(ctx.businessId);
      return JSON.stringify(result);
    },
    {
      name: "list_reservation_salones",
      description:
        "Devuelve los salones del negocio que aceptan reservas (con al menos una mesa activa) y un flag `multi_salon`. Si `multi_salon` es true, preguntale al cliente en qué salón quiere reservar y pasá su `id` como `floor_plan_id` en las tools siguientes. Si es false, ignoralo.",
      schema: z.object({}),
    },
  );
}

/**
 * Normaliza un `floor_plan_id` que viene del LLM. Los modelos suelen
 * rellenar campos opcionales con `null`, `""`, `"null"` o `"undefined"`
 * en vez de omitirlos. Los mapeamos a null. Si el valor no parece un UUID,
 * también devolvemos null y dejamos que la capa de datos resuelva (cae al
 * primer floor_plan, comportamiento legacy). Reusamos `UUID_RE` (definido
 * arriba para product_id / modifier_id).
 */
function normalizeFloorPlanId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (
    trimmed === "" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "undefined"
  ) {
    return null;
  }
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function buildCheckReservationAvailabilityTool(ctx: BotCtx) {
  return tool(
    async ({
      date,
      party_size,
      floor_plan_id,
    }: {
      date: string;
      party_size: number;
      floor_plan_id?: string;
    }) => {
      const result = await checkAvailabilityForChatbot(
        ctx.businessId,
        date,
        party_size,
        normalizeFloorPlanId(floor_plan_id),
      );
      return JSON.stringify(result);
    },
    {
      name: "check_reservation_availability",
      description:
        "Lista los horarios (slots HH:MM) disponibles para reservar en una fecha (YYYY-MM-DD) y cantidad de personas. Siempre úsala antes de generate_reservation_link. Si el negocio tiene varios salones (averigualo con list_reservation_salones), pasá el `floor_plan_id` elegido por el cliente.",
      schema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato YYYY-MM-DD")
          .describe(
            "Fecha local del negocio en formato YYYY-MM-DD (ej. '2026-06-15').",
          ),
        party_size: z
          .number()
          .int()
          .min(1)
          .describe("Cantidad de comensales. Entero ≥ 1."),
        // No usamos `.uuid()` acá: el LLM a veces manda `null`, `""` o el
        // string "null" en campos opcionales y `.uuid()` los rechazaría
        // (z.preprocess no se puede serializar a JSON Schema, que es lo que
        // LangChain le manda a Claude). Validamos / normalizamos abajo.
        floor_plan_id: z
          .string()
          .optional()
          .describe(
            "Id del salón elegido (UUID). Obligatorio si list_reservation_salones devolvió multi_salon=true; omitilo si no.",
          ),
      }),
    },
  );
}

function buildGenerateReservationLinkTool(ctx: BotCtx) {
  return tool(
    async ({
      date,
      slot,
      party_size,
      customer_name,
      notes,
      floor_plan_id,
    }: {
      date: string;
      slot: string;
      party_size: number;
      customer_name?: string;
      notes?: string;
      floor_plan_id?: string;
    }) => {
      const phone = normalizePhone(ctx.contactIdentifier);
      const result = await createReservationIntent({
        businessId: ctx.businessId,
        conversationId: ctx.conversationId,
        date,
        slot,
        partySize: party_size,
        customerName: customer_name ?? null,
        customerPhone: phone || null,
        notes: notes ?? null,
        floorPlanId: normalizeFloorPlanId(floor_plan_id),
      });
      if (!result.ok) {
        return JSON.stringify({
          error: result.error,
          ...(result.available_slots
            ? { available_slots: result.available_slots }
            : {}),
        });
      }
      const base =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
        "http://localhost:3000";
      const url = `${base}/${ctx.businessSlug}/reservar/${result.token}`;
      return JSON.stringify({ url, token: result.token });
    },
    {
      name: "generate_reservation_link",
      description:
        "Crea una intención de reserva con los datos elegidos y devuelve la URL que el cliente abre para confirmar en la web (después de loguearse). Llamala solo después de check_reservation_availability y de tener confirmación explícita del cliente sobre fecha, hora y cantidad.",
      schema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato YYYY-MM-DD")
          .describe("Fecha de la reserva en formato YYYY-MM-DD."),
        slot: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora en formato HH:MM")
          .describe(
            "Horario elegido en formato HH:MM. Tiene que ser uno de los que devolvió check_reservation_availability.",
          ),
        party_size: z
          .number()
          .int()
          .min(1)
          .describe("Cantidad de comensales."),
        customer_name: z
          .string()
          .optional()
          .describe(
            "Nombre del cliente si lo dijo en la conversación. Opcional — la web lo pide al confirmar.",
          ),
        notes: z
          .string()
          .optional()
          .describe(
            "Pedidos especiales o notas (cumpleaños, alergias, etc.). Opcional.",
          ),
        floor_plan_id: z
          .string()
          .optional()
          .describe(
            "Id del salón elegido (UUID). Debe coincidir con el `floor_plan_id` usado en check_reservation_availability cuando hay más de un salón.",
          ),
      }),
    },
  );
}

function buildListMyReservationsTool(ctx: BotCtx) {
  return tool(
    async () => {
      const phone = normalizePhone(ctx.contactIdentifier);
      if (!phone) {
        return JSON.stringify({
          requires_phone: true,
          message:
            "El contactIdentifier no parece un teléfono. Pedile al cliente que escriba a /perfil/reservas para ver sus reservas.",
        });
      }
      const result = await listChatbotReservationsByPhone(
        ctx.businessId,
        phone,
      );
      return JSON.stringify(result);
    },
    {
      name: "list_my_reservations",
      description:
        "Devuelve las reservas próximas (status confirmed o seated, starts_at en el futuro) del cliente actual identificado por su teléfono.",
      schema: z.object({}),
    },
  );
}

function buildConfirmReservationTool(ctx: BotCtx) {
  return tool(
    async ({ reservation_id }: { reservation_id: string }) => {
      const result = await confirmReservationByChatbot(
        ctx.businessId,
        reservation_id,
        ctx.contactIdentifier,
      );
      return JSON.stringify(result);
    },
    {
      name: "confirm_reservation",
      description:
        "Marca una reserva existente como confirmada por el cliente. Llamala solo si el cliente respondió afirmativamente a una pregunta del tipo '¿confirmás tu reserva?'. El reservation_id viene de list_my_reservations.",
      schema: z.object({
        reservation_id: z
          .string()
          .uuid()
          .describe(
            "UUID de la reserva a confirmar. Sale de list_my_reservations.",
          ),
      }),
    },
  );
}

// ---------------- LLM loop ----------------

// Registry: maps a tool name to its builder. Each builder takes the unified
// BotCtx so the registry stays homogeneous.
const TOOL_BUILDERS: Record<string, (ctx: BotCtx) => StructuredToolInterface> = {
  search_products: (ctx) => buildSearchProductsTool(ctx.businessId),
  check_business_status: (ctx) => buildBusinessStatusTool(ctx.businessId),
  get_product_details: (ctx) => buildProductDetailsTool(ctx.businessId),
  get_delivery_info: (ctx) => buildDeliveryInfoTool(ctx.businessId),
  get_cart: (ctx) => buildGetCartTool(ctx),
  add_to_cart: (ctx) => buildAddToCartTool(ctx),
  remove_from_cart: (ctx) => buildRemoveFromCartTool(ctx),
  generate_checkout_link: (ctx) => buildGenerateCheckoutLinkTool(ctx),
  get_reservation_info: (ctx) => buildReservationInfoTool(ctx),
  list_reservation_salones: (ctx) => buildListReservationSalonesTool(ctx),
  check_reservation_availability: (ctx) =>
    buildCheckReservationAvailabilityTool(ctx),
  generate_reservation_link: (ctx) => buildGenerateReservationLinkTool(ctx),
  list_my_reservations: (ctx) => buildListMyReservationsTool(ctx),
  confirm_reservation: (ctx) => buildConfirmReservationTool(ctx),
};

async function invokeLlm({
  businessId,
  businessSlug,
  conversationId,
  contactIdentifier,
  channel,
  enabledTools,
  systemPrompt,
  history,
  userMessage,
}: {
  businessId: string;
  businessSlug: string;
  conversationId: string;
  contactIdentifier: string;
  channel: ChatbotChannel;
  enabledTools: string[] | null;
  systemPrompt: string;
  history: StoredMessage[];
  userMessage: string;
}): Promise<{ assistantMessage: string; toolTrace: ToolTraceEntry[] }> {
  const ctx: BotCtx = {
    businessId,
    businessSlug,
    conversationId,
    contactIdentifier,
    channel,
  };
  const toolTrace: ToolTraceEntry[] = [];

  // Build only the enabled tools (null = all enabled).
  const tools: StructuredToolInterface[] = TOOL_METADATA.filter((meta) =>
    isToolEnabled(meta.name, enabledTools),
  )
    .map((meta) => TOOL_BUILDERS[meta.name]?.(ctx))
    .filter((t): t is StructuredToolInterface => Boolean(t));

  const toolsByName: Record<string, StructuredToolInterface> =
    Object.fromEntries(tools.map((t) => [t.name, t]));

  // `thinking: disabled` minimiza latencia en respuestas tipo WhatsApp; subir a
  // `{ type: "adaptive" }` si se quiere que el modelo razone en turnos complejos.
  // No seteamos `temperature` (no hace falta para este flujo).
  // `ANTHROPIC_API_KEY` se lee de env automáticamente por el wrapper.
  const baseLlm = new ChatAnthropic({
    model: CHATBOT_MODEL,
    maxTokens: CHATBOT_MAX_TOKENS,
    thinking: { type: "disabled" },
  });
  // bindTools with an empty list confuses some providers; only bind when we have any.
  const llm = tools.length > 0 ? baseLlm.bindTools(tools) : baseLlm;

  // Prompt caching: marcamos el system prompt como `ephemeral`. Anthropic
  // hace prefix-match en (tools → system → messages); cachear el último
  // bloque del system también cachea las tool definitions que lo preceden.
  // Lectura del cache cuesta ~0.1x, escritura ~1.25x, y vive 5 min por default.
  // Ojo: el cache se invalida si cambian las tools habilitadas, el prompt
  // resuelto (placeholders), o el modelo — ver wiki/decisiones/prompt-caching.
  const messages: BaseMessage[] = [
    new SystemMessage({
      content: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
    }),
  ];

  // When the conversation history is empty, nudge the model so it doesn't fall
  // back to a generic "¿en qué te ayudo?" reply. The prompt has a "Primer
  // mensaje" section but short user inputs like "buenas" tend to override it
  // unless we flag the turn explicitly.
  if (history.length === 0) {
    messages[0] = new SystemMessage({
      content: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: "\n\n[turn:first] Este es el PRIMER mensaje del cliente en esta conversación. Tu respuesta tiene que seguir obligatoriamente la estructura de 2 partes definida en la sección 'Primer mensaje de la conversación': (1) saludo mencionando al negocio, (2) invitación a pedir. NO menciones horarios ni si el local está abierto en este saludo. No respondas con un mensaje genérico tipo '¿en qué te ayudo?'.",
        },
      ],
    });
  }

  for (const m of history) {
    if (m.role === "user") messages.push(new HumanMessage(m.content));
    else if (m.role === "assistant") messages.push(new AIMessage(m.content));
  }
  messages.push(new HumanMessage(userMessage));

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await llm.invoke(messages);
    messages.push(response);

    const calls = response.tool_calls ?? [];
    if (calls.length === 0) {
      return { assistantMessage: extractText(response.content), toolTrace };
    }

    for (const call of calls) {
      const target = toolsByName[call.name];
      let resultText: string;
      if (!target) {
        resultText = JSON.stringify({
          error: "tool_disabled_or_unknown",
          instruction: `La tool "${call.name}" no está disponible en este negocio. No la vuelvas a llamar. Respondé con lo que sabés sin esa herramienta.`,
        });
      } else {
        try {
          const result = await target.invoke(call);
          resultText =
            typeof result === "string"
              ? result
              : typeof result?.content === "string"
                ? result.content
                : JSON.stringify(result);
        } catch (err) {
          resultText = JSON.stringify({
            error: err instanceof Error ? err.message : "tool failed",
          });
        }
      }
      toolTrace.push({
        name: call.name,
        args: (call.args ?? {}) as Record<string, unknown>,
        result: resultText,
      });
      console.log(
        `[chatbot] tool=${call.name} args=${JSON.stringify(call.args)} → ${resultText.slice(0, 400)}`,
      );
      messages.push(
        new ToolMessage({
          content: resultText,
          tool_call_id: call.id ?? "",
        }),
      );
    }
  }

  // Safety net: if we exhausted iterations without a final answer, ask the
  // model one more time explicitly for a plain-text response.
  messages.push(
    new HumanMessage(
      "(Se alcanzó el límite de llamadas a herramientas. Respondé ahora con lo que sepas, sin llamar más herramientas.)",
    ),
  );
  const finalLlm = new ChatAnthropic({
    model: CHATBOT_MODEL,
    maxTokens: CHATBOT_MAX_TOKENS,
    thinking: { type: "disabled" },
  });
  const final = await finalLlm.invoke(messages);
  return { assistantMessage: extractText(final.content), toolTrace };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}
