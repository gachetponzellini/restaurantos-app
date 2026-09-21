// @vitest-environment node
//
// Auditoría de pedidos · ALTA — el cliente vuelve de MP antes que el webhook.
//
// La conciliación del regreso (`reconcileMpPayment`) marcaba la orden `paid`
// pero no asentaba el pago en la caja ni la mandaba a cocina; cuando llegaba el
// webhook veía ese pago «ya procesado» y cortaba. Resultado: pedido pagado,
// quieto en «Nuevos», sin comanda y fuera del arqueo — en el camino normal.
//
// Ahora los efectos de «pagado» viven en un solo lugar y los dispara quien
// llegue primero; el índice único de `payments (business_id, mp_payment_id)`
// es la llave de «una sola vez».
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-efectos-mp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const routeOrderToCocina = vi.fn(async () => ({ ok: true as const, data: undefined }));
vi.mock("@/lib/orders/route-to-cocina", () => ({
  routeOrderToCocina: (...a: unknown[]) => routeOrderToCocina(...(a as [])),
}));
const notifyScheduledConfirmed = vi.fn(async () => {});
vi.mock("@/lib/notifications/delivery-notify", () => ({
  notifyScheduledConfirmed: (...a: unknown[]) => notifyScheduledConfirmed(...(a as [])),
}));
const notifyPagoSobrePedidoCancelado = vi.fn(async () => {});
const notifyPagoDuplicado = vi.fn(async () => {});
vi.mock("@/lib/notifications/events", () => ({
  notifyPagoSobrePedidoCancelado: (...a: unknown[]) =>
    notifyPagoSobrePedidoCancelado(...(a as [])),
  notifyPagoDuplicado: (...a: unknown[]) => notifyPagoDuplicado(...(a as [])),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
const fetchPayment = vi.fn();
vi.mock("@/lib/payments/mercadopago", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/mercadopago")>(
    "@/lib/payments/mercadopago",
  );
  return { ...actual, fetchPayment: (...a: unknown[]) => fetchPayment(...(a as [])) };
});

const { aplicarPagoMpAprobado } = await import("./efectos-pago-mp");
const { reconcileMpPayment } = await import("./reconcile");

describe.skipIf(!dbAvailable)("efectos del pago MP aprobado (integration · auditoría)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;

  const pedido = async (over: Record<string, unknown> = {}) => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: "Cliente web",
        customer_phone: "0",
        delivery_type: "pickup",
        subtotal_cents: 1_000_000,
        total_cents: 1_000_000,
        lifecycle_status: "open",
        status: "pending",
        payment_status: "pending",
        payment_method: "mp",
        ...over,
      })
      .select("id, business_id, status, scheduled_at, total_cents")
      .single();
    if (error) throw error;
    return data!;
  };
  const filasEnCaja = async (orderId: string) => {
    const { count } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("payment_status", "paid");
    return count;
  };

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Efectos MP", is_active: true, mp_access_token: "APP_USR-x" })
      .select("id")
      .single();
    businessId = biz!.id;
    await supabase.from("cajas").insert({ business_id: businessId, name: "Caja" });
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });
  beforeEach(() => {
    routeOrderToCocina.mockClear();
    notifyScheduledConfirmed.mockClear();
    notifyPagoSobrePedidoCancelado.mockClear();
    notifyPagoDuplicado.mockClear();
    fetchPayment.mockReset();
  });

  it("dos llamadas (regreso + webhook) asientan una vez y marchan una vez", async () => {
    const o = await pedido();
    await aplicarPagoMpAprobado(supabase as never, { order: o, paymentId: "mp-1" });
    await aplicarPagoMpAprobado(supabase as never, { order: o, paymentId: "mp-1" });

    expect(await filasEnCaja(o.id)).toBe(1);
    expect(routeOrderToCocina).toHaveBeenCalledTimes(1);
  });

  it("el regreso de MP con pago aprobado ya asienta en caja y marcha (sin esperar al webhook)", async () => {
    const o = await pedido();
    fetchPayment.mockResolvedValue({
      id: "mp-2",
      status: "approved",
      statusDetail: null,
      externalReference: o.id,
      transactionAmount: 10_000,
      payerEmail: null,
    });

    const r = await reconcileMpPayment({ orderId: o.id, businessId, paymentId: "mp-2" });
    expect(r.ok).toBe(true);
    expect(await filasEnCaja(o.id)).toBe(1);
    expect(routeOrderToCocina).toHaveBeenCalledTimes(1);
  });

  it("programado para más tarde: confirma el agendado, no marcha", async () => {
    const o = await pedido({ scheduled_at: new Date(Date.now() + 3 * 3600_000).toISOString() });
    await aplicarPagoMpAprobado(supabase as never, { order: o, paymentId: "mp-3" });
    expect(notifyScheduledConfirmed).toHaveBeenCalledTimes(1);
    expect(routeOrderToCocina).not.toHaveBeenCalled();
  });

  it("pedido cancelado: asienta la plata, no cocina y avisa para devolver", async () => {
    const o = await pedido({ status: "cancelled", lifecycle_status: "cancelled" });
    await aplicarPagoMpAprobado(supabase as never, { order: o, paymentId: "mp-4" });
    expect(await filasEnCaja(o.id)).toBe(1);
    expect(routeOrderToCocina).not.toHaveBeenCalled();
    expect(notifyPagoSobrePedidoCancelado).toHaveBeenCalledTimes(1);
  });

  // Revisión adversarial — dos pagos aprobados del mismo pedido (link viejo +
  // reintento). La plata entró las dos veces: se asienta, pero no se vuelve a
  // cocinar y se avisa para devolver el segundo.
  it("un segundo pago aprobado del mismo pedido: se asienta, no re-marcha y avisa", async () => {
    const o = await pedido();
    await aplicarPagoMpAprobado(supabase as never, { order: o, paymentId: "mp-5a" });
    await aplicarPagoMpAprobado(supabase as never, { order: o, paymentId: "mp-5b" });
    expect(await filasEnCaja(o.id)).toBe(2);
    expect(routeOrderToCocina).toHaveBeenCalledTimes(1);
    expect(notifyPagoDuplicado).toHaveBeenCalledTimes(1);
  });
});

describe.skipIf(!dbAvailable)("efectos del pago MP · negocio sin caja (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: `${TEST_TAG}-sincaja`, name: "Sin caja", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  // Sin caja no hay llave en `payments`: la repetición la corta quien llama,
  // que sabe si el pago ya estaba registrado (reentrega del webhook de MP).
  it("una reentrega (ya registrado) no repite marcha ni avisos", async () => {
    routeOrderToCocina.mockClear();
    const { data: o } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "pickup", subtotal_cents: 1000, total_cents: 1000,
        lifecycle_status: "open", status: "pending", payment_status: "paid", payment_method: "mp",
      })
      .select("id, business_id, status, scheduled_at, total_cents")
      .single();
    await aplicarPagoMpAprobado(supabase as never, { order: o!, paymentId: "mp-6", yaRegistrado: true });
    expect(routeOrderToCocina).not.toHaveBeenCalled();
    await aplicarPagoMpAprobado(supabase as never, { order: o!, paymentId: "mp-6", yaRegistrado: false });
    expect(routeOrderToCocina).toHaveBeenCalledTimes(1);
  });
});
