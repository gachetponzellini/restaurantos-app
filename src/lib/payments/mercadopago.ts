import "server-only";

import crypto from "crypto";
import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { vencimientoPreferencia } from "./mp-vencimiento";

export type CreatePreferenceArgs = {
  accessToken: string;
  /**
   * Public site URL (including protocol). Used for back_urls + notification_url.
   * Must be HTTPS-reachable in prod; use ngrok/cloudflared in dev.
   */
  siteUrl: string;
  businessId: string;
  businessSlug: string;
  orderId: string;
  orderNumber: number;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unit_price: number; // pesos, not cents
  }>;
  /** Vencimiento del link; sin él, 90 min (ver `vencimientoPreferencia`). */
  venceEl?: Date;
  payer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
};

export type MpPreferenceResult = {
  preferenceId: string;
  initPoint: string; // URL to redirect the user to
  sandboxInitPoint: string;
};

/**
 * Creates a Checkout Pro preference in the business's MP account and returns
 * the init_point URL the customer must be redirected to.
 */
/** Un 400 de MP que nombra los campos de vencimiento (y nada más amplio). */
function esRechazoDelVencimiento(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const status = (e as { status?: unknown }).status;
  if (status !== 400) return false;
  let texto = "";
  try {
    texto = JSON.stringify(e);
  } catch {
    return false;
  }
  return /expir|date_of_expiration/i.test(texto);
}

export async function createPreference(
  args: CreatePreferenceArgs,
): Promise<MpPreferenceResult> {
  const client = new MercadoPagoConfig({
    accessToken: args.accessToken,
    options: { timeout: 8000 },
  });
  const preferenceApi = new Preference(client);

  const backBase = `${args.siteUrl}/${args.businessSlug}/confirmacion/${args.orderId}`;

  // MP validates both `notification_url` and — when `auto_return` is set —
  // the back URLs must look like public HTTPS endpoints. Localhost fails.
  // In dev we skip auto_return + notification_url; the confirmation page
  // still reconciles via ?payment_id on redirect or, as a fallback, via
  // MP's "search payment by external_reference" API.
  const isHttps = args.siteUrl.startsWith("https://");

  const body = {
    items: args.items.map((it) => ({
      id: it.id,
      title: it.title,
      quantity: it.quantity,
      unit_price: it.unit_price,
      currency_id: "ARS",
    })),
    // Payer intentionally omitted in dev to avoid MP's "self-payment"
    // rejection when the customer's email (e.g. their Google login) equals
    // the seller's MP account email. MP will prompt the user for payer
    // details on the checkout screen instead.
    external_reference: args.orderId,
    // Scoped per-business so the webhook handler knows which access_token
    // to use when fetching payment details. Only set when HTTPS — MP
    // rejects http notification_urls.
    ...(isHttps
      ? {
          notification_url: `${args.siteUrl}/api/mp/webhook?business_id=${args.businessId}`,
        }
      : {}),
    back_urls: {
      success: backBase,
      pending: `${backBase}?mp=pending`,
      failure: `${backBase}?mp=failed`,
    },
    ...(isHttps ? { auto_return: "approved" as const } : {}),
    metadata: {
      order_id: args.orderId,
      order_number: args.orderNumber,
      business_id: args.businessId,
    },
  };

  // #148 · H-20: el link vence a los 90 min (y sus cupones offline), así el
  // barrido que cancela los impagos a las 2 h nunca cancela algo pagable.
  //
  // Se reintenta sin vencimiento **sólo** si MP rechazó explícitamente esos
  // campos (un 400 que los nombra): ahí no se creó nada y el checkout no se
  // rompe. Cualquier otro error —timeout, 5xx— falla como antes: reintentar a
  // ciegas podía dejar una preferencia creada y guardar otra SIN vencimiento.
  let result;
  try {
    result = await preferenceApi.create({
      body: { ...body, ...vencimientoPreferencia(new Date(), args.venceEl) },
    });
  } catch (e) {
    if (!esRechazoDelVencimiento(e)) throw e;
    console.error("MP createPreference · rechazó el vencimiento, sin él", e);
    result = await preferenceApi.create({ body });
  }

  if (!result.id || !result.init_point) {
    throw new Error("MP no devolvió un init_point válido.");
  }

  return {
    preferenceId: result.id,
    initPoint: result.init_point,
    sandboxInitPoint: result.sandbox_init_point ?? result.init_point,
  };
}

export type MpPaymentInfo = {
  id: string;
  status: "approved" | "pending" | "in_process" | "rejected" | "cancelled" | "refunded" | "charged_back" | string;
  statusDetail: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  payerEmail: string | null;
};

/**
 * Fetches a payment from MP using the business's access token.
 * Called from the webhook handler after signature validation.
 */
export async function fetchPayment(
  accessToken: string,
  paymentId: string,
): Promise<MpPaymentInfo> {
  const client = new MercadoPagoConfig({
    accessToken,
    options: { timeout: 8000 },
  });
  const paymentApi = new Payment(client);
  const p = await paymentApi.get({ id: paymentId });

  return {
    id: String(p.id ?? paymentId),
    status: String(p.status ?? "unknown"),
    statusDetail: p.status_detail ?? null,
    externalReference: p.external_reference ?? null,
    transactionAmount: p.transaction_amount ?? null,
    payerEmail: p.payer?.email ?? null,
  };
}

/**
 * Searches payments in the business's MP account filtering by our
 * `external_reference` (which we set to the order id at preference creation).
 *
 * Used when the customer lands on /confirmacion/{id} without MP's redirect
 * params (e.g. closed the tab mid-flow). Returns the id of the most relevant
 * payment — approved first, else the most recent one.
 */
export async function findPaymentByExternalRef(
  accessToken: string,
  externalReference: string,
): Promise<string | null> {
  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("external_reference", externalReference);
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("MP search payments failed", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as {
    results?: Array<{ id: number | string; status?: string }>;
  };
  const results = json.results ?? [];
  if (results.length === 0) return null;
  const approved = results.find((p) => p.status === "approved");
  return String((approved ?? results[0]).id);
}

/**
 * ¿MP ya tiene un pago aprobado o en curso para este pedido? (auditoría de
 * pedidos · MEDIA). El reintento de pago (#368) no puede abrir un segundo
 * cobro mientras el primero sigue vivo: un cupón de Rapipago/Pago Fácil queda
 * `pending` horas, y si se aprobaban los dos entraban dos pagos sin aviso.
 *
 * Si la búsqueda falla devuelve `"desconocido"`: el reintento se bloquea
 * (falla cerrado). Abrir un segundo cobro sin poder ver el primero es justo el
 * riesgo que esto existe para evitar (revisión adversarial).
 */
export async function pagoEnCursoPorReferencia(
  accessToken: string,
  externalReference: string,
): Promise<"aprobado" | "en_proceso" | "desconocido" | null> {
  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("external_reference", externalReference);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("MP · buscar pagos en curso", res.status, await res.text());
      return "desconocido";
    }
    const json = (await res.json()) as { results?: Array<{ status?: string }> };
    const estados = (json.results ?? []).map((p) => p.status);
    if (estados.includes("approved")) return "aprobado";
    if (estados.some((e) => e === "pending" || e === "in_process" || e === "authorized")) {
      return "en_proceso";
    }
    return null;
  } catch (err) {
    console.error("MP · buscar pagos en curso", err);
    return "desconocido";
  }
}

/**
 * Issue a full refund for a MP payment. Used when the customer cancels an
 * order that was already paid.
 *
 * MP's API accepts POST /v1/payments/{id}/refunds with an empty body for
 * full refunds. The X-Idempotency-Key header is important so retries don't
 * create multiple refunds.
 *
 * Returns `{ ok: true }` on success; on failure, `{ ok: false, error: string }`
 * with the MP error body. Callers should log and proceed — cancellation
 * should still succeed so the customer isn't stuck.
 */
export async function refundPayment(
  accessToken: string,
  paymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          // Idempotent across retries within the same cancellation attempt.
          "X-Idempotency-Key": `refund-${paymentId}`,
        },
        body: JSON.stringify({}),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `MP ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Validates the `x-signature` header MP sends on every webhook notification.
 *
 * Per MP docs (https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks),
 * the manifest is:
 *   id:<data.id.value>;request-id:<x-request-id>;ts:<ts>;
 * HMAC-SHA256(manifest, secret) must equal the `v1` token in x-signature.
 *
 * x-signature format: "ts=1234567890,v1=abcdef..."
 */
export function verifySignature({
  xSignature,
  xRequestId,
  dataId,
  secret,
}: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  secret: string;
}): boolean {
  if (!xSignature || !xRequestId || !secret) return false;

  const parts = xSignature.split(",").reduce<Record<string, string>>(
    (acc, part) => {
      const [k, v] = part.split("=").map((s) => s.trim());
      if (k && v) acc[k] = v;
      return acc;
    },
    {},
  );

  const ts = parts.ts;
  const receivedHash = parts.v1;
  if (!ts || !receivedHash) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  // Constant-time compare to resist timing attacks.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
