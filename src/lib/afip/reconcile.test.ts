import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyGatewayStatus, reconcilePendingInvoices } from "./reconcile";
import type { AFIPProviderClient } from "./provider";
import type { Invoice, ProviderResult } from "./types";

// Spec 088 (#140) — el cron cierra facturas contra ARCA: toca dinero y estados,
// así que todo lo que sigue fija comportamiento observable, no implementación.
const notifyInvoiceIssued = vi.fn();
vi.mock("@/lib/notifications/invoice-notify", () => ({
  notifyInvoiceIssued: (...args: unknown[]) => notifyInvoiceIssued(...args),
}));
const notifyInvoiceFailed = vi.fn(async (_args: unknown) => {});
vi.mock("@/lib/notifications/events", () => ({
  notifyInvoiceFailed: (args: unknown) => notifyInvoiceFailed(args),
}));
const createNotification = vi.fn(async (_args: unknown) => {});
vi.mock("@/lib/notifications/create", () => ({
  createNotification: (args: unknown) => createNotification(args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => {
    throw new Error("los tests inyectan el service client");
  },
}));

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    business_id: "biz-1",
    order_id: "ord-1",
    payment_id: null,
    tipo_comprobante: "factura_b",
    punto_venta: 1,
    numero: null,
    cae: null,
    cae_vencimiento: null,
    cuit_receptor: null,
    razon_social_receptor: null,
    condicion_iva_receptor: null,
    total_cents: 350_000,
    neto_cents: 289_256,
    iva_cents: 60_744,
    iva_rate: 21,
    status: "pending",
    error_message: null,
    idempotency_key: "ord-1:factura_b",
    pdf_url: null,
    qr_url: null,
    provider: "gateway",
    provider_job_id: "job-1",
    provider_response: null,
    created_at: "2026-08-04T23:00:00Z",
    cancelled_reason: null,
    ...over,
  } as Invoice;
}

function providerWith(result: ProviderResult | Error): AFIPProviderClient {
  return {
    enqueue: vi.fn(),
    getStatus: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as AFIPProviderClient;
}

const AUTHORIZED: ProviderResult = {
  success: true,
  state: "authorized",
  cae: "75123456789012",
  caeVencimiento: "2026-08-20",
  numero: 42,
  qrUrl: "https://arca/qr",
  jobId: "job-1",
} as ProviderResult;

const FAILED: ProviderResult = {
  success: false,
  state: "failed",
  errorType: "validation",
  error: "El certificado no está autorizado para el servicio wsfe en ARCA.",
  jobId: "job-1",
} as ProviderResult;

const PENDING: ProviderResult = {
  success: true,
  state: "pending",
  jobId: "job-1",
} as ProviderResult;

/** Lo que devuelve `gateway.ts` ante un 404: `failed` pero con errorType
 *  `not_found`. NO es un desenlace fiscal — ver el test de abajo. */
const NOT_FOUND: ProviderResult = {
  success: false,
  state: "failed",
  errorType: "not_found",
  error: "HTTP 404 consultando el estado.",
} as ProviderResult;

/** Service client de mentira: registra los updates y devuelve lo que se le diga. */
function fakeService(opts: {
  updateReturns?: Invoice | null;
  fresh?: Invoice;
  fresh_?: never;
  rows?: { fresh: Invoice[]; stale: Invoice[] };
  /** La orden que respalda la factura (spec 092 · #274 · 1). */
  order?: { status: string; lifecycle_status: string } | null;
  /** Los pagos de esa orden: distinguen cobro vivo de cobro reembolsado. */
  payments?: { payment_status: string }[];
}) {
  const updates: Record<string, unknown>[] = [];
  const selects: { table: string; filters: Record<string, unknown> }[] = [];
  /** `order()` de cada consulta, en orden de llamada (H-43). */
  const orders: { col: string; opts: unknown }[][] = [];
  /** Updates por lote (`.in("id", …)`): el sello de «consultada» (H-43). */
  const polled: { patch: Record<string, unknown>; ids: unknown[] }[] = [];
  let selectCall = 0;
  // El resultado del UPDATE se consume una sola vez: la relectura posterior
  // (cuando el update no devolvió fila) tiene que ver la fila fresca.
  let updatePendiente = false;

  const service = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const misOrders: { col: string; opts: unknown }[] = [];
      let patchActual: Record<string, unknown> | null = null;
      const chain: Record<string, unknown> = {
        select() {
          selects.push({ table, filters });
          return chain;
        },
        update(patch: Record<string, unknown>) {
          // El sello de consulta va aparte: no es un cambio de estado.
          if ("last_polled_at" in patch) {
            patchActual = patch;
            return chain;
          }
          updates.push(patch);
          updatePendiente = true;
          return chain;
        },
        in(_col: string, ids: unknown[]) {
          if (patchActual) polled.push({ patch: patchActual, ids });
          return Promise.resolve({ data: null, error: null });
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        not() {
          return chain;
        },
        gte() {
          return chain;
        },
        lt() {
          return chain;
        },
        order(col: string, opts: unknown) {
          if (misOrders.length === 0) orders.push(misOrders);
          misOrders.push({ col, opts });
          return chain;
        },
        limit() {
          // Barrido: primer llamada = lote fresco, segunda = lote viejo.
          const batch = selectCall === 0 ? opts.rows?.fresh : opts.rows?.stale;
          selectCall += 1;
          return Promise.resolve({ data: batch ?? [], error: null });
        },
        maybeSingle() {
          // La orden que lee `ventaSinRespaldo` no es una factura: sale aparte.
          if (table === "orders") {
            return Promise.resolve({ data: opts.order ?? null, error: null });
          }
          // Un update encadenado devuelve `updateReturns`; la relectura, `fresh`.
          if (updatePendiente) {
            updatePendiente = false;
            return Promise.resolve({
              data: opts.updateReturns ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: opts.fresh ?? null, error: null });
        },
        single() {
          return Promise.resolve({ data: opts.fresh ?? null, error: null });
        },
        // Los pagos se leen sin terminador (`select().eq()` y await): el chain
        // tiene que ser thenable para esa forma.
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          return Promise.resolve(
            resolve({ data: opts.payments ?? [], error: null }),
          );
        },
      };
      return chain;
    },
  };
  return { service: service as never, updates, selects, orders, polled };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyGatewayStatus", () => {
  it("un job autorizado cierra la factura con su CAE y avisa al cliente", async () => {
    const closed = invoice({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
    });
    const { service, updates } = fakeService({ updateReturns: closed });

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(AUTHORIZED),
    );

    expect(r.outcome).toBe("authorized");
    expect(updates[0]).toMatchObject({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
      cae_vencimiento: "2026-08-20",
      qr_url: "https://arca/qr",
    });
    expect(notifyInvoiceIssued).toHaveBeenCalledWith({ invoiceId: "inv-1" });
  });

  it("un job rechazado por ARCA queda failed con el motivo, sin avisar al cliente", async () => {
    const failed = invoice({
      status: "failed",
      error_message: FAILED.error ?? null,
    });
    const { service, updates } = fakeService({ updateReturns: failed });

    const r = await applyGatewayStatus(service, invoice(), providerWith(FAILED));

    expect(r.outcome).toBe("failed");
    expect(updates[0]).toMatchObject({
      status: "failed",
      error_message: FAILED.error,
    });
    expect(notifyInvoiceIssued).not.toHaveBeenCalled();
    // Manual: el error ya se lo devolvió la pantalla a quien apretó el botón.
    expect(notifyInvoiceFailed).not.toHaveBeenCalled();
  });

  // Spec 147 · D6 — la mitad que hace segura a la otra. Los 14 rechazos de
  // golf-jcr se descubrieron consultando la base; con emisión automática eso
  // pasa de «alguien facturó y le falló» a «todas las mesas fallan y nadie se
  // entera».
  it("un rechazo de emisión automática avisa adentro, aunque nadie mire", async () => {
    const failed = invoice({
      id: "inv-auto",
      status: "failed",
      auto_emitted: true,
      error_message: FAILED.error ?? null,
    });
    const { service } = fakeService({ updateReturns: failed });

    await applyGatewayStatus(service, invoice({ auto_emitted: true }), providerWith(FAILED));

    expect(notifyInvoiceFailed).toHaveBeenCalledWith({
      businessId: "biz-1",
      invoiceId: "inv-auto",
    });
  });

  it("una automática que SÍ sale con CAE no dispara el aviso de fallo", async () => {
    const ok = invoice({ status: "authorized", auto_emitted: true, numero: 42 });
    const { service } = fakeService({ updateReturns: ok });

    await applyGatewayStatus(service, invoice({ auto_emitted: true }), providerWith(AUTHORIZED));

    expect(notifyInvoiceFailed).not.toHaveBeenCalled();
  });

  // ── La venta que ya no existe (#274 · 1 y 6) ─────────────────────────
  //
  // El gateway tarda ~28 min de promedio (85 en el peor caso). En esa ventana
  // la venta puede desaparecer por dos caminos, y el CAE llega igual: es un
  // hecho consumado ante ARCA. La factura se cierra (spec 092 · H-05), pero
  // alguien tiene que emitir la nota de crédito — y hasta acá ese "alguien"
  // se enteraba por un `console.warn` en un serverless.
  it("factura autorizada sobre una orden anulada: no le llega al cliente y SE AVISA adentro", async () => {
    const cerrada = invoice({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
    });
    const { service } = fakeService({
      updateReturns: cerrada,
      order: { status: "cancelled", lifecycle_status: "cancelled" },
    });

    await applyGatewayStatus(service, invoice(), providerWith(AUTHORIZED));

    expect(notifyInvoiceIssued).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        targetRole: "encargado",
        type: "factura.nc_pendiente",
        payload: expect.objectContaining({
          invoiceId: "inv-1",
          motivo: "orden_anulada",
        }),
      }),
    );
  });

  // El camino del reembolso: `anularCobro` NO cancela la orden, la REABRE
  // (lifecycle_status 'open', status 'preparing') y deja los pagos en
  // `refunded`. Por eso mirar sólo `cancelled` daba false y el cliente recibía
  // por mail el comprobante de una venta ya devuelta.
  it("factura autorizada sobre un cobro reembolsado: tampoco le llega al cliente", async () => {
    const cerrada = invoice({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
    });
    const { service } = fakeService({
      updateReturns: cerrada,
      order: { status: "preparing", lifecycle_status: "open" },
      payments: [
        { payment_status: "refunded" },
        { payment_status: "refunded" },
      ],
    });

    await applyGatewayStatus(service, invoice(), providerWith(AUTHORIZED));

    expect(notifyInvoiceIssued).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "factura.nc_pendiente",
        payload: expect.objectContaining({ motivo: "cobro_reembolsado" }),
      }),
    );
  });

  // La contracara: un reembolso PARCIAL (se corrigió una línea y se volvió a
  // cobrar) sigue siendo una venta viva. Si esto avisara, el aviso sería ruido
  // y en dos semanas nadie lo miraría — que es como muere una notificación.
  it("un reembolso parcial con cobro vivo NO cuenta como venta anulada", async () => {
    const cerrada = invoice({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
    });
    const { service } = fakeService({
      updateReturns: cerrada,
      order: { status: "delivered", lifecycle_status: "closed" },
      payments: [{ payment_status: "refunded" }, { payment_status: "paid" }],
    });

    await applyGatewayStatus(service, invoice(), providerWith(AUTHORIZED));

    expect(notifyInvoiceIssued).toHaveBeenCalledWith({ invoiceId: "inv-1" });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("mientras el gateway sigue encolando NO se toca la fila", async () => {
    const { service, updates } = fakeService({});

    const r = await applyGatewayStatus(service, invoice(), providerWith(PENDING));

    expect(r.outcome).toBe("pending");
    expect(updates).toHaveLength(0);
  });

  // Lo importante acá: un gateway caído o una credencial rota NO puede
  // convertir facturas vivas en `failed`.
  it("un error de red deja la factura pending, sin escribir nada", async () => {
    const { service, updates } = fakeService({});

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(new Error("ECONNRESET")),
    );

    expect(r.outcome).toBe("pending");
    expect(updates).toHaveLength(0);
  });

  it("si el poller de la pantalla ganó la carrera, no se pisa ni se avisa dos veces", async () => {
    // El UPDATE condicional no devuelve fila → la cerró el otro camino.
    const yaCerrada = invoice({ status: "authorized", cae: "999" });
    const { service } = fakeService({ updateReturns: null, fresh: yaCerrada });

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(AUTHORIZED),
    );

    expect(r.invoice.status).toBe("authorized");
    expect(notifyInvoiceIssued).not.toHaveBeenCalled();
  });

  // Un `base_url`/`tenant_slug` desactualizado devuelve 404 en TODA ruta. Si
  // eso cerrara la factura, un backlog entero pasaría a `failed` aunque ARCA
  // le hubiera dado CAE — y `failed` habilita «Reintentar», que reemite con
  // clave nueva: comprobante duplicado.
  it("un 404 del gateway NO cierra la factura: queda pending para revisar", async () => {
    const { service, updates } = fakeService({});

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(NOT_FOUND),
    );

    expect(r.outcome).toBe("unknown_job");
    expect(r.invoice.status).toBe("pending");
    expect(updates).toHaveLength(0);
  });

  it("una factura sin job del gateway (sandbox) no se consulta", async () => {
    const sinJob = invoice({ provider_job_id: null });
    const provider = providerWith(AUTHORIZED);
    const { service } = fakeService({});

    const r = await applyGatewayStatus(service, sinJob, provider);

    expect(r.outcome).toBe("pending");
    expect(provider.getStatus).not.toHaveBeenCalled();
  });

  it("una factura ya terminal no se vuelve a consultar", async () => {
    const provider = providerWith(AUTHORIZED);
    const { service } = fakeService({});

    await applyGatewayStatus(service, invoice({ status: "failed" }), provider);

    expect(provider.getStatus).not.toHaveBeenCalled();
  });
});

describe("reconcilePendingInvoices", () => {
  it("sin pendientes no consulta al gateway", async () => {
    const { service } = fakeService({ rows: { fresh: [], stale: [] } });
    const resolveProvider = vi.fn();

    const r = await reconcilePendingInvoices({ service, resolveProvider });

    expect(r.considered).toBe(0);
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("resuelve el provider UNA vez por negocio, no por factura", async () => {
    const fresh = [
      invoice({ id: "a", business_id: "biz-1" }),
      invoice({ id: "b", business_id: "biz-1" }),
      invoice({ id: "c", business_id: "biz-2" }),
    ];
    const { service } = fakeService({
      rows: { fresh, stale: [] },
      updateReturns: invoice({ status: "authorized" }),
    });
    const resolveProvider = vi.fn(async () => providerWith(AUTHORIZED));

    const r = await reconcilePendingInvoices({ service, resolveProvider });

    expect(r.considered).toBe(3);
    expect(resolveProvider).toHaveBeenCalledTimes(2); // dos negocios
  });

  it("un negocio sin credencial (o sandbox) se saltea sin llamar al gateway", async () => {
    const { service } = fakeService({
      rows: { fresh: [invoice()], stale: [] },
    });
    const resolveProvider = vi.fn(async () => null);

    const r = await reconcilePendingInvoices({ service, resolveProvider });

    expect(r.skipped).toBe(1);
    expect(r.authorized + r.failed + r.stillPending).toBe(0);
  });

  it("cuenta authorized, failed y las que siguen en proceso", async () => {
    const { service } = fakeService({
      rows: { fresh: [invoice()], stale: [] },
      updateReturns: invoice({ status: "authorized" }),
    });
    const r = await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(AUTHORIZED),
    });
    expect(r).toMatchObject({ considered: 1, authorized: 1, failed: 0 });

    const b = fakeService({
      rows: { fresh: [invoice()], stale: [] },
    });
    const r2 = await reconcilePendingInvoices({
      service: b.service,
      resolveProvider: async () => providerWith(PENDING),
    });
    expect(r2).toMatchObject({ considered: 1, stillPending: 1 });
  });

  // Una pendiente vieja se MIRA pero no se cierra por antigüedad: sin respuesta
  // del gateway no sabemos si tiene CAE, y darla por perdida invita a
  // re-facturarla → comprobante duplicado.
  it("cuenta los 404 aparte, sin tocar las filas", async () => {
    const { service, updates } = fakeService({
      rows: { fresh: [invoice()], stale: [] },
    });

    const r = await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(NOT_FOUND),
    });

    expect(r.unknownJob).toBe(1);
    expect(r.failed).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("las viejas se cuentan aparte y no se marcan failed por antigüedad", async () => {
    const vieja = invoice({ id: "old", created_at: "2026-08-01T00:00:00Z" });
    const { service, updates } = fakeService({
      rows: { fresh: [], stale: [vieja] },
    });

    const r = await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(PENDING),
    });

    expect(r.stale).toBe(1);
    expect(r.considered).toBe(1);
    expect(r.failed).toBe(0);
    expect(updates).toHaveLength(0);
  });

  // #148 · H-43 — el lote de viejas era FIFO fijo por `created_at` con limit 5:
  // cinco facturas en 404 permanente ocupaban los cinco cupos en cada tick, y
  // ninguna otra vieja se volvía a consultar. Ahora rota: primero las que hace
  // más que no se consultan (las nunca consultadas, antes que nada).
  it("el lote de viejas rota: ordena por última consulta, las nunca consultadas primero", async () => {
    const { service, orders } = fakeService({ rows: { fresh: [], stale: [] } });
    await reconcilePendingInvoices({ service, resolveProvider: async () => providerWith(PENDING) });

    const viejas = orders[1];
    expect(viejas[0]).toEqual({
      col: "last_polled_at",
      opts: { ascending: true, nullsFirst: true },
    });
  });

  it("sella la hora de consulta de cada factura que le preguntó al gateway", async () => {
    const a = invoice({ id: "a" });
    const b = invoice({ id: "b", created_at: "2026-08-01T00:00:00Z" });
    const { service, polled, updates } = fakeService({ rows: { fresh: [a], stale: [b] } });

    await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(PENDING),
      now: () => Date.parse("2026-09-21T12:00:00Z"),
    });

    expect(polled).toHaveLength(1);
    expect(polled[0].patch).toEqual({ last_polled_at: "2026-09-21T12:00:00.000Z" });
    expect(new Set(polled[0].ids)).toEqual(new Set(["a", "b"]));
    expect(updates).toHaveLength(0); // el estado no se toca
  });

  it("un negocio sin credencial no se sella: no se le preguntó a nadie", async () => {
    const { service, polled } = fakeService({ rows: { fresh: [invoice()], stale: [] } });
    await reconcilePendingInvoices({ service, resolveProvider: async () => null });
    expect(polled).toHaveLength(0);
  });
});
