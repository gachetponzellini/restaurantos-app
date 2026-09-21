export type TipoComprobante =
  | "factura_a"
  | "factura_b"
  | "nota_credito_a"
  | "nota_credito_b";

export type InvoiceStatus = "pending" | "authorized" | "failed" | "cancelled";

export type AFIPProvider = "sandbox" | "gateway";

/** Modo fiscal por negocio. En `sandbox` los CAEs son fake (sin valor fiscal). */
export type FiscalMode = "sandbox" | "produccion";

/**
 * Credenciales del ARCA GPSF Gateway, resueltas POR NEGOCIO (server-only).
 * El gateway autentica con UNA API key (`sk_live_...`) por tenant; el CUIT
 * emisor lo determina esa key, no se envía en el payload. El `tenantSlug`
 * arma la URL personalizada del cliente (`/api/t/<slug>/v1`). Nunca se exponen
 * al cliente: viven en la tabla `afip_gateway_credentials` (service-role-only).
 */
export type GatewayCredentials = {
  apiKey: string;
  tenantSlug: string;
  baseUrl: string;
};

export type AFIPConfig = {
  cuit: string;
  puntoVenta: number;
  provider: AFIPProvider;
  defaultTipo: TipoComprobante;
  mode: FiscalMode;
  enabled: boolean;
  /** null cuando el negocio todavía no cargó la credencial del gateway. */
  credentials: GatewayCredentials | null;
};

/**
 * Condición IVA del receptor (RG 5616, obligatoria en el gateway):
 * 1=Responsable Inscripto · 4=Exento · 5=Consumidor Final · 6=Monotributo.
 */
export type CondicionIvaReceptor = 1 | 4 | 5 | 6;

/** Comprobante que ajusta una NC/ND (obligatorio para notas de crédito). */
export type ComprobanteAsociado = {
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
};

export type InvoiceRequest = {
  tipo: TipoComprobante;
  puntoVenta: number;
  cuitEmisor: string;
  cuitReceptor?: string;
  razonSocialReceptor?: string;
  /**
   * Condición de IVA del receptor declarada explícitamente (RG 5616). Cuando
   * está presente, gana sobre el default por tipo. Ausente → fallback histórico
   * (A→RI, B→Consumidor Final). Ver spec 053.
   */
  condicionIvaReceptor?: CondicionIvaReceptor;
  totalCents: number;
  concepto: "productos" | "servicios" | "productos_y_servicios";
  /** NC/ND: comprobante(s) que ajusta. Requerido por el gateway para notas de crédito. */
  comprobantesAsociados?: ComprobanteAsociado[];
  /**
   * Datos nuestros que el gateway persiste tal cual y devuelve en el webhook
   * (spec 088). Hoy no se leen: dejan la correlación lista para cuando el
   * webhook reemplace al polling, sin depender sólo del `job_id`.
   */
  metadata?: Record<string, string>;
};

/** Estado normalizado de un job del provider (mapea los estados del gateway). */
export type JobState = "pending" | "authorized" | "failed";

/** Clasificación del error del provider (para reintentos y UI). */
export type ProviderErrorType =
  | "validation"
  | "arca_down"
  | "auth"
  | "not_found"
  | "unknown";

/**
 * Resultado de una operación del provider (`enqueue` o `getStatus`), normalizado.
 *
 * El gateway es asíncrono: `enqueue` devuelve `state: "pending"` con un `jobId`
 * que se pollea con `getStatus`. El sandbox resuelve de una: `enqueue` ya
 * devuelve `state: "authorized"` (terminal), sin necesidad de polling.
 */
export type ProviderResult = {
  success: boolean;
  state: JobState;
  jobId?: string;
  cae?: string;
  caeVencimiento?: string;
  numero?: number;
  qrUrl?: string;
  error?: string;
  errorType?: ProviderErrorType;
  rawResponse?: unknown;
};

export type Invoice = {
  id: string;
  business_id: string;
  order_id: string | null;
  payment_id: string | null;
  tipo_comprobante: TipoComprobante;
  punto_venta: number;
  numero: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  cuit_receptor: string | null;
  razon_social_receptor: string | null;
  /** Condición IVA del receptor declarada (RG 5616); NULL = default por tipo. Spec 053. */
  condicion_iva_receptor: CondicionIvaReceptor | null;
  /**
   * A quién se le facturó (spec 150 · D5). NULL en las B a consumidor final sin
   * identificar — y en las 14 que ya existían. `on delete set null`: depurar la
   * lista de receptores no borra un comprobante emitido.
   */
  fiscal_entity_id: string | null;
  total_cents: number;
  neto_cents: number;
  iva_cents: number;
  iva_rate: number;
  status: InvoiceStatus;
  error_message: string | null;
  idempotency_key: string | null;
  pdf_url: string | null;
  /** URL del QR de ARCA (RG 4892), presente cuando el gateway autoriza. */
  qr_url: string | null;
  provider: string;
  /** job_id del gateway; se pollea hasta estado terminal. */
  provider_job_id: string | null;
  /** Última consulta del cron de conciliación (0129 · #148 H-43). */
  last_polled_at?: string | null;
  provider_response: unknown;
  created_at: string;
  /** Motivo de anulación (presente cuando `status = 'cancelled'`). */
  cancelled_reason: string | null;
  /** Si la fila ES una nota de crédito, apunta a la factura que anula. */
  cancels_invoice_id: string | null;
  /**
   * Nació del cobro (spec 147), no de un botón. Decide a quién se le avisa
   * cuando termina en `failed`: la manual ya le mostró el error a quien la
   * disparó, la automática no tenía a nadie mirando.
   */
  auto_emitted: boolean;
};

/**
 * Por qué un CAE que acaba de llegar no respalda ninguna venta (#274 · 1).
 *
 * Los dos caminos por los que la venta desaparece mientras el comprobante
 * viaja por el gateway (~28 min de promedio): la mesa se anuló, o el cobro se
 * reembolsó con «Anular cobro» —que NO cancela la orden, la reabre—.
 */
export type VentaSinRespaldo = "orden_anulada" | "cobro_reembolsado";
