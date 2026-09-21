import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyInvoiceFailed } from "@/lib/notifications/events";
import { notifyInvoiceIssued } from "@/lib/notifications/invoice-notify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { createGatewayClient } from "./gateway";
import { notifyNotaCreditoPendiente } from "./nc-pendiente-notify";
import type { AFIPProviderClient } from "./provider";
import { type ProviderSelection, selectProvider } from "./provider-config";
import { createSandboxClient } from "./sandbox";
import type {
  AFIPConfig,
  Invoice,
  ProviderResult,
  TipoComprobante,
  VentaSinRespaldo,
} from "./types";

// ============================================================================
// Cierre server-side de las facturas `pending` (spec 088 · #140).
//
// El gateway es asíncrono y lento de verdad: reintenta con backoff 1→5→15→60
// min (5 intentos) y sobre los jobs reales tardó ~28 min en promedio, 85 en el
// peor caso. El polling del cliente corta a los 120s, así que hasta el operador
// que NO cierra la pantalla se queda sin ver el desenlace — y el que la cierra
// deja la factura `pending` para siempre, porque no había nada del lado app que
// fuera a buscar cómo terminó.
//
// Este módulo es `server-only` y NO `"use server"`: nada de acá se expone como
// Server Action. `pollInvoiceStatus` (con auth de usuario) y el cron comparten
// exactamente la misma lógica de persistencia — si divergieran, cada camino
// cerraría la factura a su manera.
// ============================================================================

type GenericClient = SupabaseClient;

/** Ventana que separa el lote "fresco" del "viejo" en el barrido. */
const FRESH_WINDOW_MS = 30 * 60_000;

/** Construye el cliente del provider a partir de la selección por modo fiscal. */
export function buildProvider(
  selection: Exclude<ProviderSelection, { kind: "error" }>,
  businessId: string,
): AFIPProviderClient {
  if (selection.kind === "sandbox") return createSandboxClient(businessId);
  return createGatewayClient(selection.credentials);
}

export async function loadAFIPConfig(
  service: GenericClient,
  businessId: string,
): Promise<AFIPConfig | null> {
  const { data } = await service
    .from("businesses")
    .select(
      "afip_cuit, afip_punto_venta, afip_provider, afip_default_tipo, afip_mode, afip_enabled",
    )
    .eq("id", businessId)
    .single();
  if (!data) return null;
  const row = data as {
    afip_cuit: string | null;
    afip_punto_venta: number | null;
    afip_provider: string | null;
    afip_default_tipo: string | null;
    afip_mode: string | null;
    afip_enabled: boolean | null;
  };
  if (!row.afip_cuit || !row.afip_punto_venta) return null;

  // La credencial del gateway vive en tabla aparte (service-role-only).
  const { data: credData } = await service
    .from("afip_gateway_credentials")
    .select("api_key, tenant_slug, base_url")
    .eq("business_id", businessId)
    .maybeSingle();
  const cred = credData as {
    api_key: string | null;
    tenant_slug: string | null;
    base_url: string | null;
  } | null;

  const hasCreds = Boolean(cred?.api_key && cred?.tenant_slug);

  return {
    cuit: row.afip_cuit,
    puntoVenta: row.afip_punto_venta,
    provider: (row.afip_provider ?? "gateway") as AFIPConfig["provider"],
    defaultTipo: (row.afip_default_tipo ?? "factura_b") as TipoComprobante,
    mode: row.afip_mode === "produccion" ? "produccion" : "sandbox",
    enabled: Boolean(row.afip_enabled),
    credentials: hasCreds
      ? {
          apiKey: cred!.api_key!,
          tenantSlug: cred!.tenant_slug!,
          baseUrl: cred!.base_url ?? "https://arca-gpsf-gateway.vercel.app",
        }
      : null,
  };
}

/** Campos de la fila `invoices` derivados de un resultado terminal del provider. */
export function terminalPatch(result: ProviderResult): Record<string, unknown> {
  return {
    status: result.state === "authorized" ? "authorized" : "failed",
    numero: result.numero ?? null,
    cae: result.cae ?? null,
    cae_vencimiento: result.caeVencimiento ?? null,
    qr_url: result.qrUrl ?? null,
    provider_job_id: result.jobId ?? null,
    error_message: result.error ?? null,
    provider_response: result.rawResponse ?? null,
  };
}

export type ApplyOutcome =
  | "authorized"
  | "failed"
  | "pending"
  /** El gateway no conoce el job (404): la fila queda intacta, para revisar. */
  | "unknown_job";

/**
 * Consulta el desenlace de UNA factura contra el gateway y lo persiste.
 *
 * Es el único lugar donde una `pending` pasa a terminal por polling — lo usan
 * la pantalla (vía `pollInvoiceStatus`) y el cron. El UPDATE lleva
 * `.eq("status","pending")` como guarda optimista: si otro camino ganó la
 * carrera no devuelve fila, y ahí releemos la fresca en vez de pisarla.
 *
 * Un error de red o un 5xx del gateway NO marca la factura como fallida: sólo
 * el desenlace real del gateway (`emitted` / `error`) es terminal. Si no, una
 * credencial rota convertiría facturas vivas en `failed`.
 */
/**
 * ¿La venta que respalda esta factura todavía existe? (spec 092 · #274 · 1)
 *
 * Dos caminos la hacen desaparecer mientras el comprobante viaja, y hasta acá
 * sólo se miraba uno:
 *
 *  - **La orden anulada.** Los dos ejes, siempre: hasta el backfill de la spec
 *    091 una mesa anulada sólo lo decía por `lifecycle_status` y `status` se
 *    quedaba en `pending`.
 *
 *  - **El cobro reembolsado.** Éste es el que faltaba, y es peor porque no
 *    deja rastro donde se lo buscaba: `anularCobro` **no cancela la orden, la
 *    REABRE** (`lifecycle_status: 'open'`, `status: 'preparing'`,
 *    `payment_status: 'pending'`) y marca los pagos `refunded`. Con la orden
 *    reabierta, preguntar por `cancelled` daba false y el cron le mandaba al
 *    cliente, por mail, la factura de una venta que ya se le devolvió en
 *    efectivo. Plata que sale de la caja Y queda declarada como IVA débito.
 *
 * La condición del reembolso es deliberadamente estricta —hay pagos y NINGUNO
 * quedó `paid`— para no confundirla con una corrección de línea, donde se
 * refunda un pago y se registra otro: ahí la venta sigue viva y avisar sería
 * ruido.
 */
async function ventaSinRespaldo(
  service: GenericClient,
  orderId: string | null,
): Promise<VentaSinRespaldo | null> {
  if (!orderId) return null;
  const { data } = await service
    .from("orders")
    .select("status, lifecycle_status")
    .eq("id", orderId)
    .maybeSingle();
  const row = data as {
    status: string;
    lifecycle_status: string;
  } | null;
  if (!row) return null;
  if (row.status === "cancelled" || row.lifecycle_status === "cancelled") {
    return "orden_anulada";
  }

  const { data: pagos } = await service
    .from("payments")
    .select("payment_status")
    .eq("order_id", orderId);
  const rows = (pagos ?? []) as { payment_status: string }[];
  if (rows.length === 0) return null;
  const hayCobroVivo = rows.some((p) => p.payment_status === "paid");
  const hayReembolso = rows.some((p) => p.payment_status === "refunded");
  if (hayReembolso && !hayCobroVivo) return "cobro_reembolsado";

  return null;
}

export async function applyGatewayStatus(
  service: GenericClient,
  invoice: Invoice,
  provider: AFIPProviderClient,
): Promise<{ invoice: Invoice; outcome: ApplyOutcome }> {
  if (invoice.status !== "pending" || !invoice.provider_job_id) {
    return { invoice, outcome: "pending" };
  }

  let result: ProviderResult;
  try {
    result = await provider.getStatus(invoice.provider_job_id);
  } catch {
    // Transitorio consultando: sigue pending, se reintenta en el próximo tick.
    return { invoice, outcome: "pending" };
  }

  if (result.state === "pending") return { invoice, outcome: "pending" };

  // Un 404 del gateway NO es un desenlace fiscal. `gateway.ts` lo mapea a
  // `failed` porque en el camino de la pantalla significaba "job inexistente"
  // (se polleaba un job creado segundos antes, con la misma credencial). Acá
  // no: consultamos jobs de días atrás, cada 2 minutos y sin nadie mirando, así
  // que un `base_url`/`tenant_slug` desactualizado — que devuelve 404 en toda
  // ruta — daría por fallido un backlog entero de facturas que ARCA quizá
  // autorizó. Y una `failed` habilita «Reintentar», que reemite con clave
  // nueva: comprobante duplicado. Sólo `emitted`/`error` del gateway cierran.
  if (result.errorType === "not_found") {
    return { invoice, outcome: "unknown_job" };
  }

  const patch = terminalPatch(result);
  const { data: updated } = await service
    .from("invoices")
    .update({
      ...patch,
      // Preservar lo que ya teníamos si el gateway no lo repite.
      numero: result.numero ?? invoice.numero,
      cae: result.cae ?? invoice.cae,
      cae_vencimiento: result.caeVencimiento ?? invoice.cae_vencimiento,
      qr_url: result.qrUrl ?? invoice.qr_url,
      provider_job_id: result.jobId ?? invoice.provider_job_id,
      provider_response: result.rawResponse ?? invoice.provider_response,
    })
    .eq("id", invoice.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (updated) {
    const row = updated as Invoice;
    if (row.status === "authorized") {
      // spec 092 · H-05 — el CAE es un hecho consumado ante ARCA, así que la
      // factura **se cierra igual**; lo que no corresponde es avisarle al
      // cliente. La ventana es real: el gateway tarda ~28 min de promedio (85
      // en el peor caso) y en el medio la mesa puede haberse anulado. Sin esto,
      // el encargado anulaba la mesa y media hora después al cliente le llegaba
      // por mail la factura de una venta que no ocurrió.
      //
      // `reconcile` no leía la orden en ningún punto — grep de `orders` en este
      // archivo daba cero.
      //
      // #274 · 6 — y el aviso al local tampoco existía: la decisión de la 092
      // («hay que emitir NC») moría en un `console.warn` dentro de un
      // serverless, o sea en ningún lado. La fila queda en Facturación igual
      // que cualquier otra autorizada, con su CAE, y el único aviso fiscal del
      // producto (`factura.emision_fallida`) es para las que FALLAN — ésta sale
      // bien. Así se descubrieron los 14 rechazos de golf-jcr: consultando la
      // base a mano, un mes después.
      const sinRespaldo = await ventaSinRespaldo(service, row.order_id);
      if (sinRespaldo) {
        console.warn(
          "reconcile · factura autorizada sobre venta inexistente, hay que emitir NC",
          { invoiceId: row.id, orderId: row.order_id, motivo: sinRespaldo },
        );
        await notifyNotaCreditoPendiente({
          businessId: row.business_id,
          invoiceId: row.id,
          orderId: row.order_id,
          motivo: sinRespaldo,
          totalCents: row.total_cents,
        }).catch((err) =>
          console.error("reconcile · aviso de NC pendiente", err),
        );
      } else {
        // spec 45 — aviso del comprobante al cliente. Best-effort e idempotente
        // por `customer_message_log`, así que es seguro desde los dos caminos.
        await notifyInvoiceIssued({ invoiceId: row.id });
      }
    }
    if (row.status === "failed" && row.auto_emitted) {
      // spec 147 · D6 — el rechazo que llega tarde. El `.eq("status","pending")`
      // del update de arriba hace que sólo el que ganó la carrera llegue acá,
      // así que el aviso sale una vez aunque el cron y un poll de pantalla
      // miren la misma factura. Sólo para las automáticas: una manual ya le
      // devolvió el error a quien apretó el botón.
      await notifyInvoiceFailed({
        businessId: row.business_id,
        invoiceId: row.id,
      }).catch((err) => console.error("reconcile · aviso de fallo", err));
    }
    return {
      invoice: row,
      outcome: row.status === "authorized" ? "authorized" : "failed",
    };
  }

  // Perdimos la carrera: la fila ya la cerró el otro camino.
  const { data: fresh } = await service
    .from("invoices")
    .select("*")
    .eq("id", invoice.id)
    .maybeSingle();
  const row = (fresh as Invoice | null) ?? invoice;
  return { invoice: row, outcome: row.status === "pending" ? "pending" : "failed" };
}

export type ReconcileResult = {
  /** Facturas levantadas por el barrido. */
  considered: number;
  authorized: number;
  failed: number;
  /** Siguen en proceso en el gateway (o no se pudo consultar). */
  stillPending: number;
  /** Pendientes más viejas que la ventana fresca: se miran, no se cierran. */
  stale: number;
  /** Salteadas sin tocar el gateway (sandbox, sin credencial, sin config). */
  skipped: number;
  /**
   * El gateway devolvió 404 para el job. No se cierra la factura: suele ser
   * credencial/URL desactualizada, no un comprobante inexistente. Si este
   * contador sube, hay que mirar la config del negocio.
   */
  unknownJob: number;
};

type ReconcileDeps = {
  service?: GenericClient;
  /** Resuelve el provider de un negocio. `null` = saltear (sandbox / sin credencial). */
  resolveProvider?: (
    service: GenericClient,
    businessId: string,
  ) => Promise<AFIPProviderClient | null>;
  now?: () => number;
};

async function defaultResolveProvider(
  service: GenericClient,
  businessId: string,
): Promise<AFIPProviderClient | null> {
  const config = await loadAFIPConfig(service, businessId);
  if (!config) return null;
  const selection = selectProvider(config);
  // Sandbox no encola nada (emite terminal en el acto): una `pending` suya no
  // tiene job que consultar. Y sin credencial no hay a quién preguntarle.
  if (selection.kind !== "gateway") return null;
  return buildProvider(selection, businessId);
}

/**
 * Barre las facturas `pending` con job en el gateway y las cierra.
 *
 * Dos lotes para que un backlog viejo no monopolice el tick: primero las
 * recientes (el caso feliz, que se resuelve en segundos), después unas pocas
 * de las viejas. Lo que no entra en un tick entra en el siguiente.
 *
 * Una `pending` vieja NO se marca `failed` por antigüedad: sin respuesta del
 * gateway no sabemos si tiene CAE, y darla por perdida invita a re-facturarla
 * → comprobante fiscal duplicado. Se cuentan como `stale` y se muestran.
 */
export async function reconcilePendingInvoices(
  opts: { freshLimit?: number; staleLimit?: number } & ReconcileDeps = {},
): Promise<ReconcileResult> {
  const {
    freshLimit = 20,
    staleLimit = 5,
    service = createSupabaseServiceClient() as unknown as GenericClient,
    resolveProvider = defaultResolveProvider,
    now = () => Date.now(),
  } = opts;

  const cutoff = new Date(now() - FRESH_WINDOW_MS).toISOString();

  const [freshRes, staleRes] = await Promise.all([
    service
      .from("invoices")
      .select("*")
      .eq("status", "pending")
      .eq("provider", "gateway")
      .not("provider_job_id", "is", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(freshLimit),
    service
      .from("invoices")
      .select("*")
      .eq("status", "pending")
      .eq("provider", "gateway")
      .not("provider_job_id", "is", null)
      .lt("created_at", cutoff)
      // #148 · H-43: rota. Con FIFO fijo por `created_at`, cinco facturas en
      // 404 permanente ocupaban los cinco cupos en cada tick y ninguna otra
      // vieja se volvía a consultar. Primero las que hace más que no se
      // consultan; las nunca consultadas, antes que nada.
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(staleLimit),
  ]);

  const fresh = (freshRes.data ?? []) as Invoice[];
  const stale = (staleRes.data ?? []) as Invoice[];
  const pendientes = [...fresh, ...stale];

  const result: ReconcileResult = {
    considered: pendientes.length,
    authorized: 0,
    failed: 0,
    stillPending: 0,
    stale: stale.length,
    skipped: 0,
    unknownJob: 0,
  };
  if (pendientes.length === 0) return result;

  // Agrupar por negocio: la credencial del gateway es por business, y resolverla
  // una vez por factura sería un round-trip de más por cada una.
  const porNegocio = new Map<string, Invoice[]>();
  for (const inv of pendientes) {
    const arr = porNegocio.get(inv.business_id);
    if (arr) arr.push(inv);
    else porNegocio.set(inv.business_id, [inv]);
  }

  const consultadas: string[] = [];
  for (const [businessId, facturas] of porNegocio) {
    const provider = await resolveProvider(service, businessId);
    if (!provider) {
      result.skipped += facturas.length;
      continue;
    }
    for (const inv of facturas) {
      consultadas.push(inv.id);
      const { outcome } = await applyGatewayStatus(service, inv, provider);
      if (outcome === "authorized") result.authorized += 1;
      else if (outcome === "failed") result.failed += 1;
      else if (outcome === "unknown_job") result.unknownJob += 1;
      else result.stillPending += 1;
    }
  }

  // Sello de «consultada» (H-43): es lo que hace rotar el lote de viejas. Va
  // aparte del estado —no lo toca— y no puede tirar el tick: si falla, lo peor
  // es que el próximo lote repite las mismas.
  if (consultadas.length > 0) {
    const { error } = await service
      .from("invoices")
      .update({ last_polled_at: new Date(now()).toISOString() })
      .in("id", consultadas);
    if (error) console.error("reconcilePendingInvoices · last_polled_at", error);
  }

  return result;
}
