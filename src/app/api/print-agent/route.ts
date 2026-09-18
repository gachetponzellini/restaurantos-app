import { NextResponse } from "next/server";

import { notifyPrintFailed } from "@/lib/notifications/events";
import {
  buildControlTicketContent,
  type ControlTicketData,
} from "@/lib/print/control-ticket";
import {
  buildRendicionContent,
  type RendicionTicketData,
} from "@/lib/print/rendicion-ticket";
import {
  resolveCierrePrinter,
  resolveCuentaPrinter,
} from "@/lib/print/cuenta-printer";
import {
  buildCierreContent,
  type CierreTicketData,
} from "@/lib/print/cierre-ticket";
import type { CierreResumenSnapshot } from "@/lib/caja/types";
import {
  buildCuentaTicketContent,
  type CuentaTicketData,
} from "@/lib/print/cuenta-ticket";
import {
  buildFacturaTicketContent,
  type FacturaTicketData,
} from "@/lib/print/factura-ticket";
import { resolveFiscalPrinter } from "@/lib/print/fiscal-printer";
import { buildTestTicketContent } from "@/lib/print/test-ticket";
import { buildComandaContent, TIMEZONE, toAscii } from "@/lib/print/ticket";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { alcanzaLaImpresora } from "@/lib/print/agent-scope";

import { computeIsOpen, type BusinessHour } from "@/lib/business-hours";
import {
  ACTIVIDAD_RECIENTE_MS,
  POLL_RAPIDO_MS,
  PROBE_MS,
  proximoPollMs,
  retencionMs,
} from "@/lib/print-agent/cadence";
import { registrarLatido } from "@/lib/print-agent/heartbeat";
import type { PrintAgentCredential } from "@/lib/print-agent/credentials";

import { unauthorized, autenticarAgente } from "./agent-auth";
import { buildMozoShortNames } from "@/lib/mozo/mozo-short-name";

/**
 * Sanea texto que va al stream ESC/POS de la comandera: quita bytes de control
 * (ESC 0x1B, GS 0x1D, etc.) que un cliente podría inyectar vía `notes` de un
 * pedido online para mandar comandos crudos a la impresora (corte de papel,
 * apertura de cajón, etc.). Conserva tab y newline. Security review #8.
 */
function sanitizeTicketText(s: string | null | undefined): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex
  const sinControl = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  // …y a ASCII imprimible. El contenido pre-renderizado ya sale en ASCII
  // (`toAscii` en el builder), pero estos campos crudos viajan igual en el
  // payload y un agente anterior a 2026-07-28 renderiza con ellos: sin
  // codepage, la térmica imprime cualquier byte > 0x7e como el símbolo que
  // tenga en su tabla — «Ñoquis» salía como basura. Saneado acá, cualquier
  // versión del agente imprime bien sin recompilar el .exe del local.
  return toAscii(sinControl);
}

/**
 * GET /api/print-agent?business_id=X[&station_id=Y]
 *
 * Devuelve las comandas imprimibles: las `pendiente` (recién marchadas) y las
 * que tienen una reimpresión pedida (`reprint_requested_at`, spec 35) aunque ya
 * hayan avanzado de estado. Así el agente vuelve a imprimir un ticket a demanda
 * sin ningún cambio de su lado (imprime lo que el GET trae).
 * Si se pasa `station_id`, filtra por sector; si no, devuelve todas las del
 * negocio. El print agent llama esto en loop (pull).
 */
/**
 * `HH:MM` del local para la hora de cocina (spec 127). Vive acá y no en
 * `ticket.ts` porque el armador del ticket es puro: recibe texto ya resuelto.
 */
function horaDeCocina(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * La retención de la D5 (spec 183) deja la request abierta hasta 25 s, así que
 * el techo se declara acá en vez de confiar en el default de la plataforma: un
 * timeout más corto que la retención mataría el pull y el agente vería un 504
 * cada vuelta (no pierde comandas —siguen `pendiente`— pero el ahorro se va).
 * El proyecto tiene `functionDefaultTimeout: 300`; 60 s deja lugar de sobra
 * para la retención más el armado del payload.
 */
export const maxDuration = 60;

/**
 * Un papel listo para imprimir, como sale del GET. Sale del propio armador —
 * es la unión de las seis familias (comandas + los cinco `print_jobs`) y lo
 * único que el resto de este archivo necesita saber de ellas es su `printer_ip`.
 */
type Trabajo = NonNullable<Awaited<ReturnType<typeof buildTrabajos>>>[number];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  // Auth con el business_id ya parseado (spec 046). Spec 124: la key dice QUÉ
  // agente es, y de ahí sale su alcance de impresoras.
  const agente = await autenticarAgente(req, businessId);
  if (!agente) return unauthorized();
  if (!businessId) {
    return NextResponse.json({ error: "missing business_id" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const stationId = url.searchParams.get("station_id");

  // ── El latido viaja adentro del pull (spec 183 · D1) ──────────────────────
  // El agente mandaba DOS requests por vuelta: un `POST /heartbeat` y este GET.
  // Acá ya está todo lo que el latido necesita —autenticado, y la key dice qué
  // agente es—, así que se registra como efecto de la misma llamada y la
  // versión viaja en un header en vez de un body aparte.
  //
  // La spec 35 ya decía esto: su docstring afirma que el latido «desacopla la
  // señal de salud del ritmo del poll». El desacople existía en la prosa; el
  // agente lo mandaba en cada tick igual. Atado al pull, el latido contesta
  // exactamente la pregunta que el panel hace: «¿este agente está pidiendo
  // comandas?».
  //
  // Va en paralelo con el armado del payload: es un upsert que no bloquea nada
  // y su error no puede tumbar la impresión (best-effort, como en el POST).
  // `beat=0` no late. Es para el `--dry-run` del agente de referencia, que
  // antes de la D1 simplemente no llamaba al heartbeat: probar desde una
  // máquina de desarrollo no tiene que hacer que el panel del local diga
  // «conectado» mientras el agente de verdad está caído.
  const late = url.searchParams.get("beat") !== "0";

  const [trabajos, latido] = await Promise.all([
    buildTrabajos(service, businessId, agente, stationId),
    late
      ? registrarLatido(service, {
          businessId,
          agentId: agente.id,
          version: req.headers.get("x-agent-version"),
        })
      : Promise.resolve({ error: null }),
  ]);
  if (latido.error) console.error("print-agent GET · latido", latido.error);
  if (trabajos === null) {
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  // ── Retención (spec 183 · D5) ─────────────────────────────────────────────
  // El 99% de las respuestas de este endpoint son «no hay nada para imprimir»,
  // y contestarlas al toque es lo que hacía que el agente preguntara de nuevo
  // 2,4 s después: 3,24M invocaciones por mes, el 70% de la factura de Vercel
  // en eventos de observability (#304).
  //
  // Así que cuando no hay nada, el GET **espera mirando la cola** y contesta
  // apenas aparece algo. Las dos cosas a la vez: el agente ocioso pregunta cada
  // ~30 s —barato— y cuando hay trabajo la comanda sale en ~2 s, o sea MÁS
  // rápido que el período de 10,99 s que golf tiene hoy.
  //
  // Funciona con los dos `.exe` ya instalados (los dos con `agent_version`
  // NULL): su loop espera la respuesta HTTP antes de dormir, así que retener
  // alarga el período sin que el local se entere. Es la única decisión de la
  // spec que no necesita una visita al local.
  //
  // Esperar no se factura: el proyecto está en Fluid, que cobra CPU activa, y
  // un `await` sin trabajo no consume. Si Provisioned Memory sube en el
  // dashboard después de deployar esto, la decisión estaba mal.
  if (trabajos.length === 0) {
    const retenidos = await retenerHastaQueHayaTrabajo(
      req,
      service,
      businessId,
      agente,
      stationId,
      retencionMs(url.searchParams.get("wait_ms")),
    );
    return NextResponse.json({
      comandas: retenidos,
      next_poll_ms: await elegirCadencia(
        service,
        businessId,
        retenidos.length > 0,
      ),
    });
  }

  // ── La cadencia la decide el server (spec 183 · D2) ───────────────────────
  // Campo aditivo: un agente viejo lo ignora y sigue con su `cfg.pollMs`. Este
  // pull trajo trabajo, así que no hace falta preguntarle nada a la base — el
  // servicio está en marcha y el agente vuelve rápido.
  return NextResponse.json({
    comandas: trabajos,
    next_poll_ms: POLL_RAPIDO_MS,
  });
}

/**
 * El `next_poll_ms` de esta respuesta (spec 183 · D2). Con trabajo en la mano
 * no consulta nada; sin trabajo mira dos cosas baratas: si hubo movimiento en
 * los últimos 3 minutos y si el negocio está dentro de su horario.
 *
 * Corre una vez por request —o sea, con la retención, ~2 veces por minuto por
 * agente—, así que las tres queries de acá cuestan menos que una vuelta del
 * loop de antes.
 */
async function elegirCadencia(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
  hayTrabajo: boolean,
): Promise<number> {
  if (hayTrabajo) return POLL_RAPIDO_MS;

  const desde = new Date(Date.now() - ACTIVIDAD_RECIENTE_MS).toISOString();
  const [actividad, negocio, horarios] = await Promise.all([
    // «Hubo alguna comanda hace poco»: un count acotado, sin traer filas. No
    // importa en qué estado está —si la cocina se movió, el agente vuelve
    // rápido—, y la ventana es generosa a propósito: una mesa que pide entrada
    // y después plato entra entera, y equivocarse para el lado rápido no
    // cuesta nada.
    service
      .from("comandas")
      .select("id, orders!inner(business_id)", { head: true, count: "exact" })
      .eq("orders.business_id", businessId)
      .gt("emitted_at", desde)
      .limit(1),
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

  if (actividad.error) {
    // Sin poder saber si hubo movimiento, se elige el lado rápido: el modo de
    // fallar que importa es dejar al local sin imprimir a tiempo.
    console.error("print-agent cadencia · actividad", actividad.error);
    return POLL_RAPIDO_MS;
  }

  const filas = (horarios.data ?? []) as BusinessHour[];
  // Un negocio SIN horarios cargados cuenta como abierto: el horario es una
  // config de la carta online, no del salón, y muchos negocios no la tienen.
  // Tratarlo como cerrado mandaría 20 s en pleno servicio.
  const abierto =
    filas.length === 0 ||
    computeIsOpen(
      filas,
      (negocio.data as { timezone?: string } | null)?.timezone ||
        "America/Argentina/Buenos_Aires",
    );

  return proximoPollMs({
    hayTrabajo: false,
    hayActividadReciente: (actividad.count ?? 0) > 0,
    abierto,
  });
}

/**
 * Cuántas veces se rearma el payload dentro de una misma retención.
 *
 * La sonda es del NEGOCIO y el payload del AGENTE: en un negocio con dos PCs
 * (golf: una por caja), el trabajo del otro agente hace positiva la sonda de
 * este. Sin techo, eso serían 12 reconstrucciones por request —más caro que no
 * retener—. Al agotarse, se contesta vacío y el agente vuelve como siempre:
 * peor caso, el comportamiento de antes de esta spec.
 */
const RECONSTRUCCIONES_MAX = 3;

/**
 * Espera hasta `holdMs` a que aparezca trabajo para ESTE agente, mirando la
 * cola cada `PROBE_MS`. Devuelve lo que encontró, o `[]` si se agotó la
 * retención (que es la respuesta que el agente ya sabe manejar).
 */
async function retenerHastaQueHayaTrabajo(
  req: Request,
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
  agente: PrintAgentCredential,
  stationId: string | null,
  holdMs: number,
): Promise<Trabajo[]> {
  if (holdMs <= 0) return [];

  const limite = Date.now() + holdMs;
  // Marca de agua: sólo despierta la sonda el trabajo que aparezca DESPUÉS de
  // este instante. Sin ella, un `print_job` que quedó `pendiente` sin poder
  // imprimirse nunca —comandera apagada, negocio sin impresora de control—
  // haría positiva cada sonda y rearmaríamos el payload cada 2 s para nada.
  const desde = new Date().toISOString();
  let reconstrucciones = 0;

  while (Date.now() < limite) {
    await new Promise((r) =>
      setTimeout(r, Math.min(PROBE_MS, limite - Date.now())),
    );
    // El agente cortó (timeout de su fetch, o lo pararon en el local): no hay a
    // quién contestarle y seguir sondeando es gastar por gusto.
    if (req.signal?.aborted) return [];

    if (!(await hayTrabajoNuevo(service, businessId, desde))) continue;

    const trabajos = await buildTrabajos(
      service,
      businessId,
      agente,
      stationId,
    );
    if (trabajos && trabajos.length > 0) return trabajos;

    // Apareció trabajo, pero no es para este agente (o es una comanda a medio
    // crear, que se completa en el próximo sondeo). Se reintenta un par de
    // veces y después se contesta vacío.
    if (++reconstrucciones >= RECONSTRUCCIONES_MAX) return [];
  }

  return [];
}

/**
 * ¿Apareció algo para imprimir en este negocio después de `desdeIso`?
 *
 * Es la sonda de la retención: dos `count` con `head` —sin traer filas y sin
 * tocar los seis niveles de join del payload— contra las dos únicas tablas de
 * las que sale papel, `comandas` y `print_jobs`.
 *
 * Mira el timestamp y no sólo el estado a propósito: lo que interesa es el
 * trabajo NUEVO. Una fila `pendiente` que quedó colgada de antes no tiene que
 * despertar la retención en cada sondeo.
 *
 * Ante un error de query contesta `true` —«puede que haya»—. El modo de fallar
 * que importa es el otro: una sonda que dice «no hay» con una comanda
 * esperando deja a la cocina sin el ticket hasta que se agote la retención.
 */
async function hayTrabajoNuevo(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
  desdeIso: string,
): Promise<boolean> {
  // Pendiente o con reimpresión pedida, Y aparecido después de la marca de
  // agua. Dos `.or()` seguidos se combinan con AND en PostgREST, que es
  // exactamente eso. El timestamp va entre comillas porque lleva `:` y `.`.
  const nuevo = `emitted_at.gt."${desdeIso}",reprint_requested_at.gt."${desdeIso}"`;
  const enCola = "status.eq.pendiente,reprint_requested_at.not.is.null";

  const [comandas, jobs] = await Promise.all([
    service
      .from("comandas")
      .select("id, orders!inner(business_id)", { head: true, count: "exact" })
      .eq("orders.business_id", businessId)
      .or(enCola)
      .or(nuevo)
      .limit(1),
    service
      .from("print_jobs")
      .select("id", { head: true, count: "exact" })
      .eq("business_id", businessId)
      .or(enCola)
      .or(nuevo)
      .limit(1),
  ]);

  if (comandas.error || jobs.error) {
    console.error(
      "print-agent sonda de retención",
      comandas.error ?? jobs.error,
    );
    return true;
  }

  return (comandas.count ?? 0) > 0 || (jobs.count ?? 0) > 0;
}

/**
 * El interruptor de comandas de cocina del negocio (spec 185).
 * `businesses.comandas_printer_enabled` en `false` apaga las comandas de TODOS
 * los sectores de una — es un OR por encima de `stations.printer_enabled`, no
 * un reemplazo. No toca control/cuenta/factura/cierre/rendición: esas
 * familias siguen su propio switch, sin enterarse de este. Fail-open como el
 * resto de los switches de impresión (`control_printer_enabled !== false`):
 * un negocio sin fila, o la query caída, imprime igual.
 */
async function isComandaPrintingEnabled(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
): Promise<boolean> {
  const { data } = await service
    .from("businesses")
    .select("comandas_printer_enabled")
    .eq("id", businessId)
    .maybeSingle();
  return (
    (data as { comandas_printer_enabled?: boolean } | null)
      ?.comandas_printer_enabled !== false
  );
}

/**
 * Arma TODO lo que este agente tiene que imprimir ahora: comandas de cocina +
 * las cuatro familias de papel de `print_jobs`, ya filtradas por su alcance.
 *
 * Está separada del handler porque la retención de la D5 (spec 183) la vuelve
 * a llamar cuando la sonda detecta trabajo nuevo: el payload se arma dos veces
 * en la misma request y una sola vez por tick del agente.
 *
 * `null` = la query de comandas falló (→ 500). Un `[]` es «no hay nada», que es
 * un resultado legítimo y el 99% de las respuestas.
 */
async function buildTrabajos(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
  agente: PrintAgentCredential,
  stationId: string | null,
) {
  // `parent:parent_order_item_id(product_name)` — de qué menú viene el plato
  // (spec 145). El embed self-referencial se resuelve por COLUMNA y no por el
  // nombre del constraint: con el hint `order_items_parent_order_item_id_fkey`
  // PostgREST contesta PGRST200, y con `order_items!parent_order_item_id`
  // resuelve la dirección INVERSA (los hijos) y devuelve un array.
  let query = service
    .from("comandas")
    .select(
      `
      id,
      station_id,
      batch,
      status,
      emitted_at,
      notes,
      cancelled_at,
      cancelled_reason,
      reprint_requested_at,
      stations!inner(name, printer_ip, printer_port, printer_enabled),
      orders!inner(
        id,
        business_id,
        daily_number,
        table_id,
        delivery_type,
        kitchen_notes,
        kitchen_at,
        tables!orders_table_id_fkey(label, mozo_id)
      ),
      comanda_items(
        order_item_id,
        order_items!inner(
          id,
          quantity,
          notes,
          unit_price_cents,
          parent_order_item_id,
          parent:parent_order_item_id(product_name),
          products(name),
          order_item_modifiers(modifiers(name))
        )
      )
    `,
    )
    // `pendiente` (recién marchada) OR reimpresión pedida (spec 35). Una
    // comanda `en_preparacion`/`entregado` con `reprint_requested_at` seteado
    // vuelve a aparecerle al agente sin cambiar su estado de cocina.
    .or("status.eq.pendiente,reprint_requested_at.not.is.null")
    .eq("orders.business_id", businessId)
    .order("emitted_at", { ascending: true });

  if (stationId) {
    query = query.eq("station_id", stationId);
  }

  // El flag corre EN PARALELO con la query de arriba (spec 185): no agrega un
  // viaje secuencial al camino de todos los días, que es el negocio con
  // comandas de cocina activas.
  const [{ data: comandas, error }, comandaPrintingEnabled] = await Promise.all(
    [query, isComandaPrintingEnabled(service, businessId)],
  );
  if (error) {
    console.error("print-agent GET", error);
    return null;
  }

  // Con las comandas de cocina apagadas no hace falta ni el «combina con» ni
  // armar el ticket: se descarta acá y no en el fondo del array, para no
  // gastar la query de `otrosPorPedido` en un negocio que la tiene apagada.
  // Control/cuenta/factura/cierre/rendición —más abajo— no se enteran de este
  // flag: siguen su propio switch.
  // #325 — el mozo de la mesa en el ticket, con el mismo nombre corto que el
  // plano. Se busca sólo si hay comandas para imprimir: el GET es el camino que
  // corre cada pocos segundos (spec 183) y casi siempre vuelve vacío.
  const hayParaImprimir = comandaPrintingEnabled && (comandas ?? []).length > 0;
  const nombreDelMozo = hayParaImprimir
    ? await loadNombresDeMozos(service, businessId)
    : new Map<string, string>();

  const otrosPorPedido = comandaPrintingEnabled
    ? await loadItemsPorPedido(service, [
        ...new Set(
          (comandas ?? []).map(
            (c) => (c.orders as unknown as { id: string }).id,
          ),
        ),
      ])
    : new Map<string, ItemDePedido[]>();

  // Una comanda a medio crear NO se le entrega al agente. `enviarComanda` crea
  // la fila de `comandas` y sus `comanda_items` en dos viajes separados a
  // Supabase; el agente pollea cada 1s, así que puede levantarla en el medio,
  // con la lista de items todavía vacía. Ese ticket sale «(sin items)» y —peor—
  // el ACK la pasa a `en_preparacion`, así que nunca se reimprime: la comanda se
  // pierde para cocina (visto en golf el 2026-08-04, mesa R4).
  //
  // Sin items no hay nada que imprimir. Se saltea y sale completa en el próximo
  // poll, un segundo después. También cubre el caso de una comanda cuyos
  // `order_items` ya no existen (el `!inner` del select los descarta).
  const printable = !comandaPrintingEnabled
    ? []
    : (comandas ?? [])
        .filter((c) => ((c.comanda_items ?? []) as unknown[]).length > 0)
        .map((c) => {
          const order = c.orders as unknown as {
            id: string;
            business_id: string;
            daily_number: number | null;
            table_id: string | null;
            delivery_type: string | null;
            kitchen_notes: string | null;
            kitchen_at: string | null;
            tables: { label: string; mozo_id: string | null } | null;
          };
          const station = c.stations as unknown as {
            name: string;
            printer_ip: string | null;
            printer_port: number;
            printer_enabled: boolean;
          };

          const comanda = {
            comanda_id: c.id,
            station_id: c.station_id,
            station_name: sanitizeTicketText(station?.name) ?? "—",
            // Destino de impresión del sector (spec 28). El agente imprime en esta IP
            // sin mapeo local; si es null, saltea la comanda y la deja `pendiente`.
            printer_ip: station?.printer_ip ?? null,
            printer_port: station?.printer_port ?? 9100,
            printer_enabled: station?.printer_enabled ?? true,
            batch: c.batch,
            emitted_at: c.emitted_at,
            // Spec 049: comanda anulada → el agente imprime un ticket «ANULADA».
            // Campos aditivos: un agente viejo los ignora y reimprime el ticket normal.
            cancelled: Boolean(c.cancelled_at),
            cancelled_reason: sanitizeTicketText(
              c.cancelled_reason as string | null,
            ),
            // Reimpresión pedida (spec 35): editar/reimprimir vuelve a mandar la
            // comanda. El agente imprime un ticket «REIMPRESIÓN» para que cocina sepa
            // que reemplaza a uno anterior. Campo aditivo (un agente viejo lo ignora).
            reprint: Boolean(c.reprint_requested_at),
            // El número del pedido del día: lo que cocina usa para juntar los
            // tickets del mismo pedido que salieron por sectores distintos.
            daily_number: order?.daily_number ?? null,
            table_label: sanitizeTicketText(order?.tables?.label) ?? "—",
            // El mozo que tiene la mesa (#325), no quien abrió el pedido: en un
            // local que carga desde la terminal, `orders.mozo_id` es siempre la
            // terminal. Sin mozo asignado, `null` y el renglón no sale.
            mozo_name: order?.tables?.mozo_id
              ? sanitizeTicketText(nombreDelMozo.get(order.tables.mozo_id))
              : null,
            // Destino del pedido: delivery / retiro no tienen mesa (salía «MESA —»).
            delivery_type: (order?.delivery_type ?? null) as
              | "dine_in"
              | "delivery"
              | "pickup"
              | null,
            // Indicación del encargado para cocina («junto con la mesa 5»). NO es
            // `delivery_notes` —la nota del cliente sobre la entrega—, que va al
            // ticket de control y no le sirve a la parrilla.
            kitchen_notes: sanitizeTicketText(order?.kitchen_notes),
            // Para cuándo el plato tiene que estar LISTO (spec 127). Va formateada
            // como `HH:MM` del local: el armador del ticket es puro y no resuelve TZ.
            // Es la que encabeza la comanda; la nota de arriba pasó a ser el renglón
            // de abajo. Campo aditivo — un agente viejo lo ignora.
            kitchen_time: horaDeCocina(order?.kitchen_at ?? null),
            // La observación de la tanda (spec 128): lo que el mozo escribió para
            // este envío, igual en las comandas de todos sus sectores. Campo
            // aditivo — un agente viejo lo ignora e imprime el ticket de siempre.
            comanda_notes: sanitizeTicketText(c.notes as string | null),
            // Con qué combina: lo del MISMO envío que sale de los otros sectores.
            otros_sectores: agruparOtrosSectores(
              otrosPorPedido.get(order?.id) ?? [],
              c.id as string,
              c.station_id as string | null,
              c.emitted_at as string | null,
            ),
            items: ((c.comanda_items ?? []) as unknown[]).map((ci) => {
              const item = ci as {
                order_item_id: string;
                order_items: {
                  id: string;
                  quantity: number;
                  notes: string | null;
                  unit_price_cents: number;
                  parent_order_item_id: string | null;
                  parent: { product_name: string } | null;
                  products: { name: string } | null;
                  order_item_modifiers: {
                    modifiers: { name: string } | null;
                  }[];
                };
              };
              return {
                product_name:
                  sanitizeTicketText(item.order_items?.products?.name) ?? "—",
                quantity: item.order_items?.quantity ?? 1,
                notes: sanitizeTicketText(item.order_items?.notes),
                modifiers: (item.order_items?.order_item_modifiers ?? [])
                  .map((m) => sanitizeTicketText(m.modifiers?.name))
                  .filter(Boolean),
                // De qué menú del día viene el plato (spec 145). El combo se guarda
                // partido: el nombre del menú vive en el PADRE, que no tiene sector y
                // por eso nunca llegó a una comandera. Se sube acá para que el hijo
                // —que sí va a cocina— lo lleve impreso. Es el `product_name` del
                // padre y no `daily_menus.name`: snapshot, como `modifier_name`.
                combo_name: sanitizeTicketText(
                  item.order_items?.parent?.product_name,
                ),
              };
            }),
          };
          // Spec 051: el server pre-renderiza el ticket (ESC/POS en base64 + texto
          // plano). El agente relay lo imprime tal cual; un agente viejo ignora estos
          // campos y renderiza con su lógica local (aditivo → retrocompat).
          const content = buildComandaContent(comanda);
          return {
            ...comanda,
            content_escpos_b64: content.escpos_b64,
            content_plain: content.plain,
          };
        });

  // ── Controles de pedido (spec 063) ────────────────────────────────────────
  // Viajan en el MISMO array que las comandas, con su propio UUID, su IP y su
  // contenido ya renderizado: para el agente instalado en el local son un ítem
  // más de la lista y no hace falta recompilar nada (D2 del spec).
  // Cada familia de papel va aislada: un bug armando el control, la cuenta o la
  // factura NO puede dejar a cocina sin comandas. Es la parte crítica de este
  // endpoint y la única que, si falla, para el local.
  const [controls, cuentas, facturas, cierres, pruebas, rendiciones] =
    await Promise.all([
      safePrintables("control", () =>
        buildPrintableControlTickets(service, businessId),
      ),
      safePrintables("cuenta", () =>
        buildPrintableCuentaTickets(service, businessId),
      ),
      safePrintables("factura", () =>
        buildPrintableFacturaTickets(service, businessId),
      ),
      safePrintables("cierre", () =>
        buildPrintableCierreTickets(service, businessId),
      ),
      safePrintables("prueba", () =>
        buildPrintableTestTickets(service, businessId),
      ),
      safePrintables("rendicion", () =>
        buildPrintableRendicionTickets(service, businessId),
      ),
    ]);

  // ── Alcance del agente (spec 124) ─────────────────────────────────────────
  // Un negocio puede tener varias PCs con print-agent, en LANs distintas: cada
  // una recibe sólo los trabajos cuya impresora puede tocar. El filtro va acá,
  // sobre el `printer_ip` que las cuatro familias ya traen resuelto, en vez de
  // declarar sectores + salones + cajas por separado.
  //
  // Sin esto los dos agentes verían todo y el que no llega reportaría `failed`
  // por cada papel del otro local: `print_failed_at` + aviso a cocina, y encima
  // pisando comandas que el otro ya imprimió bien.
  //
  // Un negocio de un solo agente tiene `printerScope` null y no filtra nada.
  const trabajos = [
    ...printable,
    ...controls,
    ...cuentas,
    ...facturas,
    ...cierres,
    ...pruebas,
    ...rendiciones,
  ].filter((t) => alcanzaLaImpresora(agente.printerScope, t.printer_ip));

  return trabajos;
}

/**
 * Nombre corto de cada mozo del negocio («Pedro», «Juan B.»), el mismo que
 * muestra el plano (#325). Se arma con todo el equipo porque el desempate de
 * dos «Juan» necesita ver a los dos.
 *
 * Los roles son los de `getMozosByBusiness`: la `terminal` no está, porque no
 * es una persona y nunca queda como mozo de una mesa (spec 140 · D1).
 */
async function loadNombresDeMozos(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
): Promise<Map<string, string>> {
  const { data, error } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("role", ["admin", "encargado", "mozo"]);
  if (error) {
    // Sin nombres el ticket sale igual, sin el renglón del mozo.
    console.error("print-agent GET · nombres de mozos", error);
    return new Map();
  }
  return buildMozoShortNames(
    (data ?? []) as { user_id: string; full_name: string | null }[],
  );
}

/** Item de un pedido con su sector, para el bloque «COMBINA CON» de los tickets. */
type ItemDePedido = {
  order_id: string;
  quantity: number;
  product_name: string;
  station_id: string | null;
  stations: { name: string } | null;
  /** El ítem padre si esto es el componente de un menú del día (spec 145). */
  parent: { product_name: string } | null;
  comanda_items:
    | {
        /** Spec 180: para saber si el ítem ya está en ESTA comanda. */
        comanda_id?: string;
        comandas: { emitted_at: string; cancelled_at: string | null } | null;
      }[]
    | null;
};

/**
 * Ventana para considerar que dos comandas salieron en el MISMO envío.
 *
 * `createComandasForItems` crea una comanda por sector en un loop secuencial
 * (dos viajes a Supabase por sector), así que las del mismo envío quedan
 * separadas por cientos de ms — no por un timestamp idéntico. 10 s cubre un
 * envío lento de 5 sectores y, para la cocina, dos envíos separados por menos
 * de 10 s son el mismo momento de servicio igual.
 */
const VENTANA_ENVIO_MS = 10_000;

/**
 * Los items vivos (sin anular y todavía no entregados) de los pedidos dados,
 * indexados por pedido, con el `emitted_at` de la comanda a la que pertenecen.
 * Se saltean los que no pasan por cocina (`station_id` null: las bebidas que
 * sirve el mozo) — no hay nada que coordinar con ellos.
 */
async function loadItemsPorPedido(
  service: ReturnType<typeof createSupabaseServiceClient>,
  orderIds: string[],
): Promise<Map<string, ItemDePedido[]>> {
  const porPedido = new Map<string, ItemDePedido[]>();
  if (orderIds.length === 0) return porPedido;

  const { data, error } = await service
    .from("order_items")
    .select(
      "order_id, quantity, product_name, station_id, stations(name), parent:parent_order_item_id(product_name), comanda_items(comanda_id, comandas(emitted_at, cancelled_at))",
    )
    .in("order_id", orderIds)
    .is("cancelled_at", null)
    .not("station_id", "is", null)
    .neq("kitchen_status", "delivered");
  if (error) {
    // El «combina con» es contexto: si falla, el ticket igual sale con sus ítems.
    console.error("print-agent GET · items del pedido", error);
    return porPedido;
  }

  for (const row of (data ?? []) as unknown as ItemDePedido[]) {
    const bucket = porPedido.get(row.order_id) ?? [];
    bucket.push(row);
    porPedido.set(row.order_id, bucket);
  }
  return porPedido;
}

/**
 * Agrupa por sector los items del MISMO envío que NO son de `stationId`: con qué
 * combina lo que este ticket manda a cocinar. Sin esto, la parrilla no sabe que
 * el entrecot sale con las papas de fritera y cada sector cocina a destiempo.
 *
 * Acotar al envío es la parte delicada. `kitchen_status` sólo llega a
 * `delivered` cuando alguien lo tilda a mano, así que filtrar por eso deja
 * entrar toda tanda anterior que el mozo levantó sin tocar el celular: el
 * ticket del bife listaría la picada que la mesa ya se comió y la parrilla
 * esperaría a coordinar con un plato que no existe. Se resuelve mirando la
 * comanda de cada item:
 *
 * - sin comanda todavía → es el envío en vuelo (los `order_items` se insertan
 *   ANTES que las comandas, así que este es el caso normal del sector que
 *   todavía no se creó). Entra.
 * - con comanda dentro de la ventana → mismo envío. Entra.
 * - con comanda vieja → tanda anterior. Fuera.
 * - con comanda anulada → no se está cocinando. Fuera.
 */
function agruparOtrosSectores(
  items: ItemDePedido[],
  comandaId: string,
  stationId: string | null,
  emittedAt: string | null,
) {
  const ref = emittedAt ? new Date(emittedAt).getTime() : NaN;
  const porSector = new Map<
    string,
    {
      station_name: string;
      items: {
        product_name: string;
        quantity: number;
        combo_name: string | null;
      }[];
    }
  >();
  for (const it of items) {
    if (!it.station_id || it.station_id === stationId) continue;
    // Spec 180 · D3 — lo que ya viaja en ESTE papel no va abajo. Con varias
    // comanderas por producto, las papas de fritera están también en la
    // comanda de cocina como ítem propio: decidirlo por sector las duplicaría.
    if ((it.comanda_items ?? []).some((ci) => ci.comanda_id === comandaId)) {
      continue;
    }

    const comandas = (it.comanda_items ?? [])
      .map((ci) => ci.comandas)
      .filter((c): c is { emitted_at: string; cancelled_at: string | null } =>
        Boolean(c),
      );
    if (comandas.length > 0) {
      const vivas = comandas.filter((c) => !c.cancelled_at);
      if (vivas.length === 0) continue; // toda su comanda está anulada
      const delEnvio =
        Number.isNaN(ref) ||
        vivas.some(
          (c) =>
            Math.abs(new Date(c.emitted_at).getTime() - ref) <=
            VENTANA_ENVIO_MS,
        );
      if (!delEnvio) continue; // tanda anterior: ya se cocinó, no se coordina
    }

    const sector = porSector.get(it.station_id) ?? {
      station_name: sanitizeTicketText(it.stations?.name) ?? "Otro sector",
      items: [],
    };
    sector.items.push({
      product_name: sanitizeTicketText(it.product_name) ?? "—",
      quantity: it.quantity ?? 1,
      // El mismo agujero que arriba (spec 145, D5): sin esto la guarnición del
      // menú sale acá como si fuera un plato suelto de otra mesa.
      combo_name: sanitizeTicketText(it.parent?.product_name),
    });
    porSector.set(it.station_id, sector);
  }
  return [...porSector.values()];
}

/**
 * Corre un armador de papeles y, si explota, devuelve `[]` en vez de tumbar el
 * GET. El resto —sobre todo las comandas de cocina— sigue saliendo.
 */
async function safePrintables<T>(
  label: string,
  build: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await build();
  } catch (e) {
    console.error(`print-agent GET · ${label}`, e);
    return [];
  }
}

/**
 * Los controles de pedido `pendiente` (o con reimpresión pedida) del negocio,
 * con la forma que el agente ya sabe consumir. Devuelve `[]` sin ruido si el
 * negocio no tiene comandera de control configurada o la tiene apagada — el
 * resto de la impresión no se entera.
 */
/**
 * La comandera propia de quien pidió cada papel (spec 181 · D4). Si quien lo
 * pidió tiene una asignada y activa —la USB de su compu—, el papel sale por
 * ésa; si no, el caller cae a la del salón o del negocio.
 *
 * La usan el control y la cuenta de mesa (#342): para el local, el «control»
 * de MaxiRest ES la cuenta de la mesa, así que la USB de la terminal tiene que
 * sacar ese papel.
 *
 * Spec 186 · D3 — no se mira el rol. La 181 aceptaba sólo `terminal` («es un
 * puesto, no una persona»), y eso dejaba sin papel propio a la segunda caja de
 * KCC, que la atiende la encargada con su cuenta. Quién puede tener impresora
 * se decide **al guardarla** (`updateControlPrinter`), no al imprimir.
 */
async function impresorasDePedidores(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
  trabajos: unknown[],
): Promise<Map<string, { ip: string; port: number }>> {
  const pedidores = [
    ...new Set(
      trabajos
        .map((t) => (t as { requested_by?: string | null }).requested_by)
        .filter((u): u is string => Boolean(u)),
    ),
  ];
  const impresoraDelPedidor = new Map<string, { ip: string; port: number }>();
  if (pedidores.length > 0) {
    // Spec 190 — la comandera es una fila de `control_printers` que el usuario
    // eligió, no un string escrito en su ficha. Una desactivada no se usa: cae
    // a la del negocio, que es lo que pasa cuando alguien la apaga sin
    // acordarse de a quién se la había asignado.
    const { data: miembros } = await service
      .from("business_users")
      .select(
        "user_id, control_printers:control_printer_id(printer_ip, printer_port, is_active)",
      )
      .eq("business_id", businessId)
      .in("user_id", pedidores)
      .not("control_printer_id", "is", null);
    for (const u of (miembros ?? []) as unknown as {
      user_id: string;
      control_printers: {
        printer_ip: string | null;
        printer_port: number | null;
        is_active: boolean;
      } | null;
    }[]) {
      const p = u.control_printers;
      const ip = p?.printer_ip?.trim();
      if (ip && p?.is_active) {
        impresoraDelPedidor.set(u.user_id, {
          ip,
          port: p.printer_port ?? 9100,
        });
      }
    }
  }
  return impresoraDelPedidor;
}

async function buildPrintableControlTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const { data: business } = await service
    .from("businesses")
    .select(
      "name, slug, address, phone, control_printer_ip, control_printer_port, control_printer_enabled",
    )
    .eq("id", businessId)
    .maybeSingle();

  const biz = business as {
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    control_printer_ip: string | null;
    control_printer_port: number | null;
    control_printer_enabled: boolean | null;
  } | null;

  if (!biz) return [];

  // Spec 181 · D4 — la comandera del negocio pasa a ser el DEFAULT por
  // trabajo, no un cortocircuito: un negocio puede no tener control central y
  // sí tener dos terminales con la suya (KCC).
  const controlDelNegocio =
    biz.control_printer_ip?.trim() && biz.control_printer_enabled !== false
      ? {
          ip: biz.control_printer_ip.trim(),
          port: biz.control_printer_port ?? 9100,
        }
      : null;

  const { data: tickets, error } = await service
    .from("print_jobs")
    .select(
      `
      id,
      status,
      emitted_at,
      reprint_requested_at,
      requested_by,
      orders!inner(
        daily_number,
        delivery_type,
        customer_name,
        customer_phone,
        delivery_address,
        delivery_notes,
        subtotal_cents,
        delivery_fee_cents,
        discount_cents,
        total_cents,
        payment_method,
        payment_status,
        scheduled_at,
        order_items(
          quantity,
          unit_price_cents,
          notes,
          cancelled_at,
          products(name),
          order_item_modifiers(modifiers(name))
        )
      )
    `,
    )
    .eq("business_id", businessId)
    .eq("kind", "control")
    .or("status.eq.pendiente,reprint_requested_at.not.is.null")
    .order("emitted_at", { ascending: true });

  if (error) {
    // No tumba el GET: las comandas de cocina se devuelven igual.
    console.error("print-agent GET · print_jobs control", error);
    return [];
  }

  // Spec 181 · D4 — si quien lo pidió tiene impresora propia, sale por la suya.
  const impresoraDelPedidor = await impresorasDePedidores(
    service,
    businessId,
    tickets ?? [],
  );

  const out = [];
  for (const t of tickets ?? []) {
    const pedidor =
      (t as { requested_by?: string | null }).requested_by ?? null;
    const printer =
      (pedidor ? impresoraDelPedidor.get(pedidor) : undefined) ??
      controlDelNegocio;
    // Sin destino no se entrega: queda pendiente para cuando lo configuren.
    if (!printer) continue;

    const order = t.orders as unknown as {
      daily_number: number;
      delivery_type: string;
      customer_name: string | null;
      customer_phone: string | null;
      delivery_address: string | null;
      delivery_notes: string | null;
      subtotal_cents: number;
      delivery_fee_cents: number;
      discount_cents: number;
      total_cents: number;
      payment_method: string | null;
      payment_status: string | null;
      scheduled_at: string | null;
      order_items: {
        quantity: number;
        unit_price_cents: number;
        notes: string | null;
        cancelled_at: string | null;
        products: { name: string } | null;
        order_item_modifiers: { modifiers: { name: string } | null }[];
      }[];
    };

    const data: ControlTicketData = {
      control_ticket_id: t.id,
      business_name: sanitizeTicketText(biz.name) ?? "—",
      business_slug: biz.slug,
      business_address: sanitizeTicketText(biz.address),
      business_phone: sanitizeTicketText(biz.phone),
      daily_number: order.daily_number,
      delivery_type: order.delivery_type === "delivery" ? "delivery" : "pickup",
      emitted_at: t.emitted_at,
      scheduled_at: order.scheduled_at,
      customer_name: sanitizeTicketText(order.customer_name),
      customer_phone: sanitizeTicketText(order.customer_phone),
      delivery_address: sanitizeTicketText(order.delivery_address),
      delivery_notes: sanitizeTicketText(order.delivery_notes),
      subtotal_cents: order.subtotal_cents,
      delivery_fee_cents: order.delivery_fee_cents,
      discount_cents: order.discount_cents,
      total_cents: order.total_cents,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      reprint: Boolean(t.reprint_requested_at),
      items: (order.order_items ?? [])
        // Un ítem anulado no se lleva ni se cobra.
        .filter((it) => !it.cancelled_at)
        .map((it) => ({
          product_name: sanitizeTicketText(it.products?.name) ?? "—",
          quantity: it.quantity,
          line_total_cents: it.unit_price_cents * it.quantity,
          // `notes` NO viaja: es la aclaración del mozo para la cocina y este
          // papel lo ve el cliente. Va en la comanda, no acá.
          modifiers: (it.order_item_modifiers ?? [])
            .map((m) => sanitizeTicketText(m.modifiers?.name))
            .filter(Boolean),
        })),
    };

    const content = buildControlTicketContent(data);
    out.push({
      // El agente confirma con este id; el POST lo resuelve contra
      // `print_jobs` cuando no está en `comandas`.
      comanda_id: t.id,
      station_id: null,
      station_name: "CONTROL",
      printer_ip: printer.ip,
      printer_port: printer.port,
      printer_enabled: true,
      batch: 1,
      emitted_at: t.emitted_at,
      cancelled: false,
      cancelled_reason: null,
      reprint: Boolean(t.reprint_requested_at),
      table_label: `#${order.daily_number}`,
      items: data.items ?? [],
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    });
  }
  return out;
}

/**
 * POST /api/print-agent
 * Body: { comanda_id: string, result?: "ok" | "failed", error?: string }
 *
 * - `result:"ok"` (default, retrocompatible): el agente imprimió → transiciona
 *   `pendiente → en_preparacion` y limpia los flags laterales (fallo +
 *   reimpresión pedida). Si la comanda ya estaba avanzada (reimpresión, spec
 *   35), NO regresa el estado: solo limpia `reprint_requested_at`/`print_failed_at`.
 * - `result:"failed"` (spec 33): el agente no pudo imprimir → setea
 *   `print_failed_at` y avisa (notificación `comanda.impresion_fallida`), una sola
 *   vez por comanda (dedup vía `print_failed_at`). La comanda **no** cambia de
 *   estado (sigue `pendiente`, se reintenta).
 */
export async function POST(req: Request) {
  let body: {
    comanda_id?: string;
    business_id?: string;
    result?: "ok" | "failed";
    error?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Auth con el business_id ya parseado (spec 046): acepta key global o del negocio.
  if (!(await autenticarAgente(req, body.business_id))) return unauthorized();

  // `business_id` obligatorio: es la base del check de ownership de abajo. Antes
  // era opcional y el check se salteaba al omitirlo, dejando transicionar
  // comandas de cualquier negocio con la key global (security review #4).
  if (!body.business_id) {
    return NextResponse.json({ error: "missing business_id" }, { status: 400 });
  }

  const comandaId = body.comanda_id;
  if (!comandaId) {
    return NextResponse.json({ error: "missing comanda_id" }, { status: 400 });
  }
  const result = body.result ?? "ok";

  const service = createSupabaseServiceClient();

  const { data: row } = await service
    .from("comandas")
    .select(
      "id, status, cancelled_at, print_failed_at, reprint_requested_at, orders!inner(business_id)",
    )
    .eq("id", comandaId)
    .maybeSingle();

  if (!row) {
    // Specs 063 + 080: puede ser un control de pedido o una cuenta. El agente
    // reporta cualquier impresión con el campo `comanda_id`, así que el id se
    // resuelve contra `print_jobs` antes de dar por perdido el reporte.
    return handlePrintJobReport(
      service,
      comandaId,
      body.business_id,
      result,
      body.error ?? null,
    );
  }

  // Ownership por tenant (spec 36): la key del agente es global, así que
  // validamos que la comanda pertenezca al `business_id` que reporta el agente
  // (el mismo que usa en el GET). Sin esto un agente podría transicionar
  // comandas de OTRO negocio. Se exige cuando el agente lo manda; el agente de
  // referencia lo envía siempre.
  const ownerBusinessId = (row.orders as unknown as { business_id: string })
    .business_id;
  // Incondicional: `business_id` ya es obligatorio (arriba). La comanda debe
  // pertenecer al negocio que el agente reporta.
  if (body.business_id !== ownerBusinessId) {
    return NextResponse.json({ error: "comanda not found" }, { status: 404 });
  }

  // ── Reporte de fallo de impresión (spec 33) ──
  if (result === "failed") {
    // Dedup: si ya quedó marcada como fallida, no re-notificar en cada reintento.
    if (row.print_failed_at) {
      return NextResponse.json({
        status: row.status,
        notified: false,
        alreadyFlagged: true,
      });
    }
    await service
      .from("comandas")
      .update({ print_failed_at: new Date().toISOString() })
      .eq("id", comandaId);
    await notifyPrintFailed({ businessId: ownerBusinessId, comandaId });
    return NextResponse.json({ status: row.status, notified: true });
  }

  // ── Confirmación OK: pendiente → en_preparacion + limpia flags laterales ──
  // Una comanda ya avanzada (reimpresión, spec 35) se confirma sin regresar el
  // estado: solo se limpian `reprint_requested_at` + `print_failed_at`.
  // spec 095 · H-28 — una comanda **anulada** no avanza. El handler ni siquiera
  // seleccionaba `cancelled_at`, así que el acuse de que se imprimió el ticket
  // «ANULADA» era, literalmente, lo que movía la comanda de `pendiente` a
  // `en_preparacion`. En el cloud había 6 comandas con `cancelled_at` y 5 de
  // ellas en `en_preparacion`. Se limpian sólo los flags laterales.
  if (row.cancelled_at) {
    if (row.print_failed_at || row.reprint_requested_at) {
      await service
        .from("comandas")
        .update({ print_failed_at: null, reprint_requested_at: null })
        .eq("id", comandaId);
    }
    return NextResponse.json({ status: row.status, changed: false });
  }

  if (row.status !== "pendiente") {
    if (row.print_failed_at || row.reprint_requested_at) {
      await service
        .from("comandas")
        .update({ print_failed_at: null, reprint_requested_at: null })
        .eq("id", comandaId);
    }
    return NextResponse.json({ status: row.status, changed: false });
  }

  const { error } = await service
    .from("comandas")
    .update({
      status: "en_preparacion",
      print_failed_at: null,
      reprint_requested_at: null,
    })
    .eq("id", comandaId);

  if (error) {
    console.error("print-agent confirm", error);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  return NextResponse.json({ status: "en_preparacion", changed: true });
}

/**
 * Confirmación / fallo de un **print job** — control de pedido (spec 063) o
 * cuenta de mesa (spec 080). Espeja el tratamiento de las comandas: `ok` lo
 * marca impreso y limpia los flags laterales, `failed` setea `print_failed_at`
 * sin cambiar el estado (se reintenta en el próximo pull).
 *
 * A diferencia de la comanda, no notifica: el aviso de impresión fallida (spec
 * 33) está pensado para cocina, y un control o una cuenta que no salieron no
 * bloquean la preparación. Queda el flag para verlo.
 */
async function handlePrintJobReport(
  service: ReturnType<typeof createSupabaseServiceClient>,
  ticketId: string,
  businessId: string,
  result: "ok" | "failed",
  errorMessage?: string | null,
) {
  const { data } = await service
    .from("print_jobs")
    .select("id, business_id, status, print_failed_at, reprint_requested_at")
    .eq("id", ticketId)
    .maybeSingle();

  const ticket = data as {
    business_id: string;
    status: string;
    print_failed_at: string | null;
    reprint_requested_at: string | null;
  } | null;

  // Mismo mensaje que la comanda: no se le confirma al agente que el id existe
  // pero es de otro negocio (ownership por tenant, spec 36).
  if (!ticket || ticket.business_id !== businessId) {
    return NextResponse.json({ error: "comanda not found" }, { status: 404 });
  }

  if (result === "failed") {
    if (ticket.print_failed_at) {
      return NextResponse.json({
        status: ticket.status,
        notified: false,
        alreadyFlagged: true,
      });
    }
    await service
      .from("print_jobs")
      .update({
        print_failed_at: new Date().toISOString(),
        // El motivo, no sólo el timestamp (spec 176): es lo único que le dice a
        // quien probó la comandera QUÉ falló («ECONNREFUSED» = IP equivocada).
        last_error: errorMessage ?? null,
      })
      .eq("id", ticketId);
    return NextResponse.json({ status: ticket.status, notified: false });
  }

  const { error } = await service
    .from("print_jobs")
    .update({
      status: "impreso",
      printed_at: new Date().toISOString(),
      print_failed_at: null,
      last_error: null,
      reprint_requested_at: null,
    })
    .eq("id", ticketId);

  if (error) {
    console.error("print-agent confirm · print_job", error);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  return NextResponse.json({ status: "impreso", changed: true });
}

/**
 * Las cuentas de mesa `pendiente` del negocio, con la forma que el agente ya
 * sabe consumir (spec 080).
 *
 * La comandera se resuelve **por salón** con `resolveCuentaPrinter` — la misma
 * función que usa el action al encolar, así que lo que se le prometió al mozo
 * ("sale en la comandera de la terraza") es lo que efectivamente pasa acá. Un
 * job sin destino se saltea y queda pendiente: si el encargado configura la IP
 * más tarde, sale sola en el próximo poll.
 */
async function buildPrintableCuentaTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const { data: business } = await service
    .from("businesses")
    .select(
      "name, address, phone, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled",
    )
    .eq("id", businessId)
    .maybeSingle();

  const biz = business as {
    name: string;
    address: string | null;
    phone: string | null;
    cuenta_printer_ip: string | null;
    cuenta_printer_port: number | null;
    cuenta_printer_enabled: boolean | null;
  } | null;
  if (!biz) return [];

  const { data: jobs, error } = await service
    .from("print_jobs")
    .select(
      `
      id,
      status,
      emitted_at,
      reprint_requested_at,
      requested_by,
      orders!inner(
        daily_number,
        subtotal_cents,
        discount_cents,
        discount_reason,
        tip_cents,
        total_cents,
        total_paid_cents,
        tables!orders_table_id_fkey(
          label,
          floor_plans!inner(
            name,
            cuenta_printer_ip,
            cuenta_printer_port,
            cuenta_printer_enabled
          )
        ),
        order_items(
          id,
          quantity,
          unit_price_cents,
          notes,
          cancelled_at,
          products(name)
        ),
        order_splits(
          split_index,
          label,
          expected_amount_cents,
          paid_amount_cents,
          status,
          order_split_items(order_item_id)
        )
      )
    `,
    )
    .eq("business_id", businessId)
    .eq("kind", "cuenta")
    .eq("status", "pendiente")
    // spec 095 · H-37 — `imprimirCuenta` exige `lifecycle='open'` **al encolar**,
    // pero el armador del GET no lo repetía y ningún write-site cancela filas de
    // `print_jobs` (el CHECK sólo admite `pendiente|impreso`). Reponían el papel
    // media hora después y salía la cuenta de una mesa ya anulada, con el total
    // viejo, y alguien se la llevaba a los que estaban sentados ahí ahora.
    // Los pedidos online se reimprimen cerrados; la mesa ya exige `open` al encolar.
    .neq("orders.lifecycle_status", "cancelled")
    .order("emitted_at", { ascending: true });

  if (error) {
    // No tumba el GET: las comandas de cocina se devuelven igual.
    console.error("print-agent GET · print_jobs cuenta", error);
    return [];
  }

  // #342 — la cuenta pedida por alguien con comandera propia (la USB de la
  // terminal) sale por la suya, igual que el control.
  const impresoraDelPedidor = await impresorasDePedidores(
    service,
    businessId,
    jobs ?? [],
  );

  const out = [];
  for (const j of jobs ?? []) {
    const order = j.orders as unknown as {
      daily_number: number;
      subtotal_cents: number;
      discount_cents: number;
      discount_reason: string | null;
      tip_cents: number;
      total_cents: number;
      total_paid_cents: number;
      tables: {
        label: string;
        floor_plans: {
          name: string;
          cuenta_printer_ip: string | null;
          cuenta_printer_port: number | null;
          cuenta_printer_enabled: boolean | null;
        } | null;
      } | null;
      order_items: {
        id: string;
        quantity: number;
        unit_price_cents: number;
        notes: string | null;
        cancelled_at: string | null;
        products: { name: string } | null;
      }[];
      order_splits:
        | {
            split_index: number;
            label: string | null;
            expected_amount_cents: number;
            paid_amount_cents: number;
            status: string;
            order_split_items: { order_item_id: string }[] | null;
          }[]
        | null;
    };

    const floorPlan = order.tables?.floor_plans ?? null;
    const pedidor =
      (j as { requested_by?: string | null }).requested_by ?? null;
    const printer =
      (pedidor ? impresoraDelPedidor.get(pedidor) : undefined) ??
      resolveCuentaPrinter(floorPlan, biz);
    // Sin destino no se entrega: queda pendiente para cuando lo configuren.
    if (!printer) continue;

    const data: CuentaTicketData = {
      print_job_id: j.id,
      business_name: sanitizeTicketText(biz.name) ?? "—",
      business_address: sanitizeTicketText(biz.address),
      business_phone: sanitizeTicketText(biz.phone),
      table_label: sanitizeTicketText(order.tables?.label) ?? "—",
      floor_plan_name: sanitizeTicketText(floorPlan?.name),
      daily_number: order.daily_number,
      emitted_at: j.emitted_at,
      subtotal_cents: order.subtotal_cents,
      discount_cents: order.discount_cents,
      discount_reason: sanitizeTicketText(order.discount_reason),
      tip_cents: order.tip_cents,
      total_cents: order.total_cents,
      total_paid_cents: order.total_paid_cents ?? 0,
      reprint: Boolean(j.reprint_requested_at),
      items: (order.order_items ?? [])
        // Un ítem anulado no se le cobra a la mesa, así que no se le muestra.
        .filter((it) => !it.cancelled_at)
        .map((it) => ({
          product_name: sanitizeTicketText(it.products?.name) ?? "—",
          quantity: it.quantity,
          line_total_cents: it.unit_price_cents * it.quantity,
          // `notes` NO viaja: ver el comentario del control de pedido.
        })),
      // Spec 201: la división sale en el mismo papel. Los ítems de cada parte
      // se resuelven acá contra `order_items` (los modos por monto/personas no
      // traen ninguno); un ítem anulado no se lista.
      splits: (order.order_splits ?? []).map((sp) => ({
        split_index: sp.split_index,
        label: sanitizeTicketText(sp.label),
        expected_amount_cents: sp.expected_amount_cents,
        paid_amount_cents: sp.paid_amount_cents,
        status: sp.status,
        items: (sp.order_split_items ?? []).flatMap(({ order_item_id }) => {
          const it = order.order_items.find(
            (x) => x.id === order_item_id && !x.cancelled_at,
          );
          return it
            ? [
                `${it.quantity}x ${sanitizeTicketText(it.products?.name) ?? "—"}`,
              ]
            : [];
        }),
      })),
    };

    const content = buildCuentaTicketContent(data);
    out.push({
      comanda_id: j.id,
      station_id: null,
      station_name: "CUENTA",
      printer_ip: printer.ip,
      printer_port: printer.port,
      printer_enabled: true,
      batch: 1,
      emitted_at: j.emitted_at,
      cancelled: false,
      cancelled_reason: null,
      reprint: Boolean(j.reprint_requested_at),
      table_label: data.table_label,
      items: data.items ?? [],
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    });
  }
  return out;
}

/**
 * Los cierres de caja pendientes de imprimir (spec 139 · Parte B).
 *
 * Sale por la **misma comandera que la cuenta de las mesas** — decisión de Juan
 * (2026-09-03). En golf y kcc esa térmica y la de control son la misma máquina,
 * así que esto precisa la D12 en vez de contradecirla; el fallback está en
 * `resolveCierrePrinter` y ahí se explica por qué hace falta.
 *
 * El contenido se arma **del snapshot congelado** (`caja_cortes.resumen`), no de
 * la base viva: el papel dice lo que el encargado vio al cerrar, y una
 * corrección posterior (spec 070) no lo puede mover. Un corte anterior a la
 * spec no tiene snapshot y **se saltea** — mejor no imprimir que imprimir una
 * reconstrucción que nadie firmó.
 */
async function buildPrintableCierreTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const { data: bizRow } = await service
    .from("businesses")
    .select(
      "name, address, afip_cuit, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled, control_printer_ip, control_printer_port, control_printer_enabled",
    )
    .eq("id", businessId)
    .maybeSingle();
  const biz = bizRow as {
    name: string;
    address: string | null;
    afip_cuit: string | null;
    cuenta_printer_ip: string | null;
    cuenta_printer_port: number | null;
    cuenta_printer_enabled: boolean | null;
    control_printer_ip: string | null;
    control_printer_port: number | null;
    control_printer_enabled: boolean | null;
  } | null;
  if (!biz) return [];

  const printer = resolveCierrePrinter(biz);
  // Sin destino no se entrega: queda pendiente para cuando lo configuren.
  if (!printer) return [];

  const { data: jobs, error } = await service
    .from("print_jobs")
    .select(
      `
      id,
      emitted_at,
      reprint_requested_at,
      caja_cortes!inner(
        numero,
        resumen,
        created_at,
        closing_notes,
        cajas(name)
      )
    `,
    )
    .eq("business_id", businessId)
    .eq("kind", "cierre")
    .eq("status", "pendiente")
    .order("emitted_at", { ascending: true });

  if (error) {
    // No tumba el GET: las comandas de cocina se devuelven igual.
    console.error("print-agent GET · print_jobs cierre", error);
    return [];
  }

  const out = [];
  for (const j of jobs ?? []) {
    const corte = j.caja_cortes as unknown as {
      numero: number | null;
      resumen: CierreResumenSnapshot | null;
      created_at: string;
      closing_notes: string | null;
      cajas: { name: string } | { name: string }[] | null;
    };
    if (!corte?.resumen) continue;
    const r = corte.resumen;
    const caja = Array.isArray(corte.cajas) ? corte.cajas[0] : corte.cajas;

    const data: CierreTicketData = {
      negocio: {
        name: sanitizeTicketText(biz.name) ?? "—",
        address: sanitizeTicketText(biz.address),
        cuit: sanitizeTicketText(biz.afip_cuit),
        // Razón social, sucursal y condición de IVA todavía no viven en
        // `businesses` (issue #134): se omiten en vez de inventarse.
        razon_social: null,
        sucursal: null,
        condicion_iva: null,
      },
      caja_name: sanitizeTicketText(r.caja_name ?? caja?.name) ?? "—",
      numero: corte.numero,
      apertura: r.periodo_desde,
      cierre: corte.created_at,
      encargado_name: sanitizeTicketText(r.encargado_name ?? null),
      movimientos: {
        ingresos: (r.movimientos?.ingresos ?? []).map((m) => ({
          detalle: sanitizeTicketText(m.detalle) ?? "Ingreso",
          total_cents: m.total_cents,
        })),
        egresos: (r.movimientos?.egresos ?? []).map((m) => ({
          detalle: sanitizeTicketText(m.detalle) ?? "Sangría",
          total_cents: m.total_cents,
        })),
      },
      ventas_por_origen: r.ventas_por_origen_lineas ?? [],
      ventas_por_metodo: r.ventas_por_metodo_lineas ?? [],
      resumen: {
        apertura_cents: r.desglose_esperado.apertura_cents,
        efectivo_cents: r.desglose_esperado.efectivo_cents,
        ingresos_cents: r.desglose_esperado.ingresos_cents,
        sangrias_cents: r.desglose_esperado.sangrias_cents,
        // Los cortes anteriores a la spec 177 no lo tienen en su snapshot.
        propinas_pagadas_cents: r.desglose_esperado.propinas_pagadas_cents ?? 0,
        esperado_cents: r.expected_cash_cents,
        contado_cents: r.closing_cash_cents,
        diferencia_cents: r.difference_cents,
        propinas_cents: r.total_propinas_cents,
      },
      notas: sanitizeTicketText(corte.closing_notes),
      reimpresion: Boolean(j.reprint_requested_at),
    };

    const content = buildCierreContent(data);
    out.push({
      comanda_id: j.id,
      station_id: null,
      station_name: "CIERRE",
      printer_ip: printer.ip,
      printer_port: printer.port,
      printer_enabled: true,
      batch: 1,
      emitted_at: j.emitted_at,
      cancelled: false,
      cancelled_reason: null,
      reprint: Boolean(j.reprint_requested_at),
      table_label: data.caja_name,
      items: [],
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    });
  }
  return out;
}

/**
 * Los papeles de rendición pendientes (spec 178).
 *
 * La hermana chica del cierre: misma comandera (`resolveCierrePrinter`) y mismo
 * criterio — se arma del snapshot de `mozo_rendiciones`, no de la base viva. Lo
 * único que se resuelve en vivo son los dos nombres, que no están en la fila.
 */
async function buildPrintableRendicionTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const { data: bizRow } = await service
    .from("businesses")
    .select(
      "name, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled, control_printer_ip, control_printer_port, control_printer_enabled",
    )
    .eq("id", businessId)
    .maybeSingle();
  const biz = bizRow as {
    name: string;
    cuenta_printer_ip: string | null;
    cuenta_printer_port: number | null;
    cuenta_printer_enabled: boolean | null;
    control_printer_ip: string | null;
    control_printer_port: number | null;
    control_printer_enabled: boolean | null;
  } | null;
  if (!biz) return [];

  const printer = resolveCierrePrinter(biz);
  // Sin destino no se entrega: queda pendiente para cuando lo configuren.
  if (!printer) return [];

  const { data: jobs, error } = await service
    .from("print_jobs")
    .select(
      `
      id,
      emitted_at,
      reprint_requested_at,
      mozo_rendiciones!inner(
        mozo_id,
        registered_by,
        estado,
        por_metodo,
        por_canal,
        expected_cash_cents,
        delivered_cash_cents,
        difference_cents,
        propina_pagada_cents,
        notes,
        created_at
      )
    `,
    )
    .eq("business_id", businessId)
    .eq("kind", "rendicion")
    .eq("status", "pendiente")
    .order("emitted_at", { ascending: true });

  if (error) {
    // No tumba el GET: las comandas de cocina se devuelven igual.
    console.error("print-agent GET · print_jobs rendicion", error);
    return [];
  }
  if (!jobs || jobs.length === 0) return [];

  type Fila = {
    mozo_id: string;
    registered_by: string | null;
    estado: "rendida" | "no_entrego";
    por_metodo: Record<string, number> | null;
    por_canal: RendicionTicketData["por_canal"] | null;
    expected_cash_cents: number;
    delivered_cash_cents: number;
    difference_cents: number;
    propina_pagada_cents: number | null;
    notes: string | null;
    created_at: string;
  };

  // Los nombres, de una sola pasada: el del mozo y el de quien registró.
  const ids = new Set<string>();
  for (const j of jobs) {
    const r = j.mozo_rendiciones as unknown as Fila;
    ids.add(r.mozo_id);
    if (r.registered_by) ids.add(r.registered_by);
  }
  const { data: gente } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", [...ids]);
  const nombre = new Map(
    ((gente ?? []) as { user_id: string; full_name: string | null }[]).map(
      (u) => [u.user_id, u.full_name],
    ),
  );

  const out = [];
  for (const j of jobs) {
    const r = j.mozo_rendiciones as unknown as Fila;
    const data: RendicionTicketData = {
      negocio_name: sanitizeTicketText(biz.name) ?? "—",
      mozo_name: sanitizeTicketText(nombre.get(r.mozo_id) ?? null) ?? "Mozo",
      registrado_por: r.registered_by
        ? sanitizeTicketText(nombre.get(r.registered_by) ?? null)
        : null,
      fecha: r.created_at,
      estado: r.estado,
      por_metodo: r.por_metodo ?? {},
      por_canal: r.por_canal ?? {},
      expected_cash_cents: r.expected_cash_cents,
      delivered_cash_cents: r.delivered_cash_cents,
      difference_cents: r.difference_cents,
      propina_pagada_cents: r.propina_pagada_cents ?? 0,
      notes: sanitizeTicketText(r.notes),
      reimpresion: Boolean(j.reprint_requested_at),
    };
    const content = buildRendicionContent(data);
    out.push({
      comanda_id: j.id,
      station_id: null,
      station_name: "RENDICION",
      printer_ip: printer.ip,
      printer_port: printer.port,
      printer_enabled: true,
      batch: 1,
      emitted_at: j.emitted_at,
      cancelled: false,
      cancelled_reason: null,
      reprint: Boolean(j.reprint_requested_at),
      table_label: data.mozo_name,
      items: [],
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    });
  }
  return out;
}

/**
 * Las facturas pendientes de imprimir del negocio (spec 084).
 *
 * La comandera sale de la **caja del pago** de cada factura; sin pago asociado
 * (nota de crédito, comprobante suelto), de la caja por defecto. Un job sin
 * destino se saltea y queda pendiente: si el encargado configura la IP más
 * tarde, sale sola en el próximo poll.
 *
 * El contenido incluye el QR de ARCA como comandos ESC/POS nativos dentro de
 * `content_escpos_b64`, así que el agente del local no necesita cambios.
 */
async function buildPrintableFacturaTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const { data: business } = await service
    .from("businesses")
    .select("name, address, afip_cuit")
    .eq("id", businessId)
    .maybeSingle();
  const biz = business as {
    name: string;
    address: string | null;
    afip_cuit: string | null;
  } | null;
  if (!biz) return [];

  const cajaCols =
    "id, name, fiscal_printer_ip, fiscal_printer_port, fiscal_printer_enabled";

  const [{ data: jobs, error }, { data: defaultCaja }] = await Promise.all([
    service
      .from("print_jobs")
      .select(
        `
        id,
        status,
        emitted_at,
        reprint_requested_at,
        invoices!inner(
          tipo_comprobante,
          punto_venta,
          numero,
          cae,
          cae_vencimiento,
          cuit_receptor,
          razon_social_receptor,
          condicion_iva_receptor,
          neto_cents,
          iva_cents,
          iva_rate,
          total_cents,
          qr_url,
          created_at,
          payments(cajas(${cajaCols}))
        )
      `,
      )
      .eq("business_id", businessId)
      .eq("kind", "factura")
      .eq("status", "pendiente")
      // spec 095 · H-54 — el guard `authorized` estaba sólo al encolar y
      // `anularFactura` no toca `print_jobs`: se anulaba la factura, se emitía
      // la NC, y media hora después alguien enchufaba la comandera fiscal y
      // salía el ticket de la anulada —con CAE y QR— y se lo daban al cliente.
      .eq("invoices.status", "authorized")
      .order("emitted_at", { ascending: true }),
    service
      .from("cajas")
      .select(cajaCols)
      .eq("business_id", businessId)
      .eq("is_default", true)
      .maybeSingle(),
  ]);

  if (error) {
    // No tumba el GET: las comandas de cocina se devuelven igual.
    console.error("print-agent GET · print_jobs factura", error);
    return [];
  }

  const out = [];
  for (const j of jobs ?? []) {
    const inv = j.invoices as unknown as {
      tipo_comprobante: FacturaTicketData["tipo_comprobante"];
      punto_venta: number;
      numero: number | null;
      cae: string | null;
      cae_vencimiento: string | null;
      cuit_receptor: string | null;
      razon_social_receptor: string | null;
      condicion_iva_receptor: FacturaTicketData["condicion_iva_receptor"];
      neto_cents: number;
      iva_cents: number;
      iva_rate: number;
      total_cents: number;
      qr_url: string | null;
      created_at: string;
      payments: { cajas: unknown } | null;
    };

    // El `!inner` lo garantiza en producción, pero una fila sin factura no
    // justifica perder el resto del lote.
    if (!inv) continue;

    const rawCaja = inv.payments?.cajas;
    const caja =
      ((Array.isArray(rawCaja) ? rawCaja[0] : rawCaja) as
        | Parameters<typeof resolveFiscalPrinter>[0]
        | undefined) ?? null;
    const printer =
      resolveFiscalPrinter(caja) ??
      resolveFiscalPrinter(
        (defaultCaja as Parameters<typeof resolveFiscalPrinter>[0]) ?? null,
      );
    if (!printer) continue;

    const data: FacturaTicketData = {
      print_job_id: j.id,
      business_name: sanitizeTicketText(biz.name) ?? "—",
      business_address: sanitizeTicketText(biz.address),
      business_cuit: sanitizeTicketText(biz.afip_cuit),
      tipo_comprobante: inv.tipo_comprobante,
      punto_venta: inv.punto_venta,
      numero: inv.numero,
      // La fecha del comprobante es la de la FACTURA, no la del pedido de
      // impresión: una reimpresión de mañana sigue siendo de hoy.
      emitted_at: inv.created_at,
      cae: sanitizeTicketText(inv.cae),
      cae_vencimiento: inv.cae_vencimiento,
      cuit_receptor: sanitizeTicketText(inv.cuit_receptor),
      razon_social_receptor: sanitizeTicketText(inv.razon_social_receptor),
      condicion_iva_receptor: inv.condicion_iva_receptor,
      neto_cents: inv.neto_cents,
      iva_cents: inv.iva_cents,
      iva_rate: inv.iva_rate,
      total_cents: inv.total_cents,
      qr_url: sanitizeTicketText(inv.qr_url),
      reprint: Boolean(j.reprint_requested_at),
    };

    const content = buildFacturaTicketContent(data);
    out.push({
      comanda_id: j.id,
      station_id: null,
      station_name: "FISCAL",
      printer_ip: printer.ip,
      printer_port: printer.port,
      printer_enabled: true,
      batch: 1,
      emitted_at: j.emitted_at,
      cancelled: false,
      cancelled_reason: null,
      reprint: Boolean(j.reprint_requested_at),
      table_label: `${inv.punto_venta}-${inv.numero ?? "?"}`,
      items: [],
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    });
  }
  return out;
}

/**
 * Ventana de vida de un papel de prueba (spec 176).
 *
 * Una prueba es una pregunta que se hace en el momento —«¿sale por acá?»— y se
 * contesta mirando la impresora. Si el agente está caído, apagado o todavía no
 * se instaló, el papel NO tiene que salir media hora más tarde en medio del
 * servicio, cuando ya nadie está esperándolo: a esa altura es papel confuso al
 * lado de las comandas. Pasada la ventana el job queda `pendiente` para siempre
 * como registro de que se probó y nunca se imprimió.
 */
const VENTANA_PRUEBA_MS = 5 * 60_000;

/**
 * Los papeles de prueba de comandera pendientes (spec 176).
 *
 * A diferencia de las otras cuatro familias, el destino NO se resuelve por
 * configuración: viaja en la fila (`test_printer_ip`), porque lo que se está
 * probando es justamente una IP que puede no estar guardada todavía. Tampoco
 * mira `printer_enabled`: apretar «Probar» ES el permiso.
 */
async function buildPrintableTestTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const desde = new Date(Date.now() - VENTANA_PRUEBA_MS).toISOString();

  const { data: jobs, error } = await service
    .from("print_jobs")
    .select(
      "id, emitted_at, test_printer_ip, test_printer_port, test_label, users:requested_by(full_name), businesses!inner(name)",
    )
    .eq("business_id", businessId)
    .eq("kind", "prueba")
    .eq("status", "pendiente")
    .gte("emitted_at", desde)
    .order("emitted_at", { ascending: true });

  if (error) {
    console.error("print-agent GET · print_jobs prueba", error);
    return [];
  }

  return (jobs ?? [])
    .map((j) => {
      const row = j as unknown as {
        id: string;
        emitted_at: string;
        test_printer_ip: string | null;
        test_printer_port: number | null;
        test_label: string | null;
        users: { full_name: string | null } | null;
        businesses: { name: string } | null;
      };
      if (!row.test_printer_ip?.trim()) return null;

      const label = sanitizeTicketText(row.test_label) ?? "Comandera";
      const content = buildTestTicketContent({
        label,
        printer_ip: row.test_printer_ip,
        printer_port: row.test_printer_port ?? 9100,
        emitted_at: row.emitted_at,
        business_name: sanitizeTicketText(row.businesses?.name) ?? "—",
        requested_by_name: sanitizeTicketText(row.users?.full_name ?? null),
      });

      return {
        // El agente confirma con este id; el POST lo resuelve contra `print_jobs`.
        comanda_id: row.id,
        station_id: null,
        station_name: `PRUEBA · ${label}`,
        printer_ip: row.test_printer_ip,
        printer_port: row.test_printer_port ?? 9100,
        printer_enabled: true,
        batch: 1,
        emitted_at: row.emitted_at,
        cancelled: false,
        cancelled_reason: null,
        reprint: false,
        table_label: label,
        items: [],
        content_escpos_b64: content.escpos_b64,
        content_plain: content.plain,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
}
