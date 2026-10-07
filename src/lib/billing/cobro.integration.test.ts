// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cobro-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // Identidad de las actions del salón: `getClaims` (spec 106).
      // `getUser` queda para el código que todavía lo llama.
      getClaims: async () => ({
        data: { claims: { sub: CURRENT_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: CURRENT_USER_ID } },
        error: null,
      }),
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { dividirPorPersonas } = await import("./cuenta-actions");
const {
  iniciarCobro,
  registrarPago,
  forzarPago,
  anularCobro,
  cancelarSplit,
  closeOrderIfFullyPaid,
} = await import("./cobro-actions");

describe.skipIf(!dbAvailable)("billing/cobro (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let mozoId: string;
  let encargadoId: string;
  let cajaId: string;
  let tableId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = created!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  const newOrder = async (label: string, total = 10_000) => {
    const { data: fp } = await supabase
      .from("floor_plans")
      .select("id")
      .eq("business_id", businessId)
      .single();
    const { data: t } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label,
        seats: 2,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
        operational_status: "pidio_cuenta",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: `M${label}`,
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: t!.id,
        subtotal_cents: total,
        total_cents: total,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_name: "Item",
      unit_price_cents: total,
      quantity: 1,
      subtotal_cents: total,
      loaded_by: mozoId,
    });
    return { tableId: t!.id, orderId: order!.id };
  };

  beforeAll(async () => {
    mozoId = await seedUser("Mozo");
    encargadoId = await seedUser("Encargado");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cobro Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
    ]);

    await supabase.from("floor_plans").insert({ business_id: businessId, name: "S" });

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja1" })
      .select("id")
      .single();
    cajaId = caja!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
    for (const id of [mozoId, encargadoId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("iniciarCobro con caja activa → devuelve cajas disponibles", { timeout: 30_000 }, async () => {
    const fake = await newOrder("X");
    CURRENT_USER_ID = mozoId;
    const r = await iniciarCobro(fake.orderId, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cajas.length).toBeGreaterThan(0);
    tableId = fake.tableId;
  });

  it("1 split implícito cash → paid + order closed + mesa limpiar", { timeout: 30_000 }, async () => {
    const { tableId: tid, orderId } = await newOrder("A");
    CURRENT_USER_ID = mozoId;

    const init = await iniciarCobro(orderId, businessSlug);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    expect(init.data.hasImplicitSplit).toBe(true);

    const r = await registrarPago({
      orderId,
      splitId: null,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.orderClosed).toBe(true);

    const { data: ord } = await supabase
      .from("orders")
      .select("lifecycle_status, closed_at, total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(ord!.lifecycle_status).toBe("closed");
    expect(ord!.total_paid_cents).toBe(10_000);

    const { data: tbl } = await supabase
      .from("tables")
      .select("operational_status")
      .eq("id", tid)
      .single();
    expect(tbl!.operational_status).toBe("libre");
  });

  it("mixto cash + card_manual → 2 splits paid → order closed", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("B");
    CURRENT_USER_ID = mozoId;
    await dividirPorPersonas(orderId, 2, businessSlug);

    const init = await iniciarCobro(orderId, businessSlug);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    expect(init.data.splits).toHaveLength(2);
    // Invariante anti-regresión (bug 2026-06-19): con una división activa, el
    // cobro NUNCA debe armar un pago único (implicit split).
    expect(init.data.hasImplicitSplit).toBe(false);

    const [s1, s2] = init.data.splits;
    const r1 = await registrarPago({
      orderId,
      splitId: s1.id,
      method: "cash",
      amount_cents: s1.expected_amount_cents,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.data.orderClosed).toBe(false);

    const r2 = await registrarPago({
      orderId,
      splitId: s2.id,
      method: "card_manual",
      amount_cents: s2.expected_amount_cents,
      tip_cents: 1_000,
      last_four: "1234",
      card_brand: "visa",
      caja_id: cajaId,
      slug: businessSlug,
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data.orderClosed).toBe(true);
  });

  it("registrarPago con MP debe pedir iniciarPagoMp", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("C");
    const r = await registrarPago({
      orderId,
      splitId: null,
      method: "mp_link",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/iniciarPagoMp/);
  });

  it("forzarPago como encargado: payment pending → paid + order closed", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("D");

    // Insert manual de un payment pending (simulando MP que se quedó colgado).
    const { data: paymentRow } = await supabase
      .from("payments")
      .insert({
        order_id: orderId,
        business_id: businessId,
        caja_id: cajaId,
        method: "mp_qr",
        amount_cents: 10_000,
        tip_cents: 0,
        payment_status: "pending",
      })
      .select("id")
      .single();

    CURRENT_USER_ID = encargadoId;
    const r = await forzarPago(paymentRow!.id, "MP timeout", businessSlug);
    expect(r.ok).toBe(true);

    const { data: ord } = await supabase
      .from("orders")
      .select("lifecycle_status")
      .eq("id", orderId)
      .single();
    expect(ord!.lifecycle_status).toBe("closed");
  });

  it("anularCobro: la mesa vuelve al plano OCUPADA con su cuenta (spec 100)", { timeout: 30_000 }, async () => {
    const { tableId: tid, orderId } = await newOrder("E");
    CURRENT_USER_ID = mozoId;
    await registrarPago({
      orderId,
      splitId: null,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });

    CURRENT_USER_ID = encargadoId;
    const r = await anularCobro(orderId, "cliente reclamó", businessSlug);
    expect(r.ok).toBe(true);

    const { data: ord } = await supabase
      .from("orders")
      .select("lifecycle_status, total_paid_cents, created_at, bill_requested_at")
      .eq("id", orderId)
      .single();
    expect(ord!.lifecycle_status).toBe("open");
    expect(ord!.total_paid_cents).toBe(0);
    // No se inventa un pedido de cuenta que nunca ocurrió.
    expect(ord!.bill_requested_at).toBeNull();

    const { data: tbl } = await supabase
      .from("tables")
      .select("operational_status, current_order_id, opened_at")
      .eq("id", tid)
      .single();
    // Esta cuenta nunca pidió la cuenta: la cobraron por error.
    expect(tbl!.operational_status).toBe("ocupada");
    // El puntero es lo que la pone de vuelta en el plano con sus ítems.
    expect(tbl!.current_order_id).toBe(orderId);
    // Y el reloj de la mesa es el de la cuenta, no el de la anulación.
    expect(new Date(tbl!.opened_at as string).getTime()).toBe(
      new Date(ord!.created_at as string).getTime(),
    );

    const { data: payments } = await supabase
      .from("payments")
      .select("payment_status")
      .eq("order_id", orderId);
    expect(payments!.every((p) => p.payment_status === "refunded")).toBe(true);
  });

  it("anularCobro: el parcial de una cuenta abierta también vuelve a cero (#188)", { timeout: 30_000 }, async () => {
    // El reset de `total_paid_cents` vivía adentro de la rama de reapertura, así
    // que anular un cobro parcial —la orden nunca se cerró— dejaba la cuenta
    // diciendo que ya había cobrado esa plata. El ticket lo imprime crudo:
    // "Pagado / RESTA" sobre una mesa que no pagó un peso.
    const { orderId } = await newOrder("E5", 20_000);
    CURRENT_USER_ID = mozoId;
    await registrarPago({
      orderId,
      splitId: null,
      method: "card_manual",
      amount_cents: 8_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });

    const { data: antes } = await supabase
      .from("orders")
      .select("lifecycle_status, total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(antes!.lifecycle_status).toBe("open");
    expect(antes!.total_paid_cents).toBe(8_000);

    CURRENT_USER_ID = encargadoId;
    const r = await anularCobro(orderId, "se equivocó de mesa", businessSlug);
    expect(r.ok).toBe(true);

    const { data: ord } = await supabase
      .from("orders")
      .select("lifecycle_status, total_paid_cents, payment_status")
      .eq("id", orderId)
      .single();
    expect(ord!.lifecycle_status).toBe("open");
    expect(ord!.total_paid_cents).toBe(0);
    expect(ord!.payment_status).toBe("pending");
  });

  it("registrarPago: en efectivo se cobra lo que se debe, no el billete (#188)", { timeout: 30_000 }, async () => {
    // Cuenta de $200, el cliente paga con $500: la caja tiene que esperar $200.
    const { orderId } = await newOrder("E6", 20_000);
    CURRENT_USER_ID = mozoId;
    const r = await registrarPago({
      orderId,
      splitId: null,
      method: "cash",
      amount_cents: 50_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });
    expect(r.ok).toBe(true);

    const { data: pagos } = await supabase
      .from("payments")
      .select("amount_cents")
      .eq("order_id", orderId);
    expect(pagos!.map((p) => p.amount_cents)).toEqual([20_000]);

    const { data: ord } = await supabase
      .from("orders")
      .select("total_paid_cents, lifecycle_status")
      .eq("id", orderId)
      .single();
    expect(ord!.total_paid_cents).toBe(20_000);
    expect(ord!.lifecycle_status).toBe("closed");
  });

  it("anularCobro: si la cuenta ya se había pedido, vuelve a pidio_cuenta", { timeout: 30_000 }, async () => {
    const { tableId: tid, orderId } = await newOrder("E2");
    const pedidaAt = new Date(Date.now() - 20 * 60_000).toISOString();
    await supabase
      .from("orders")
      .update({ bill_requested_at: pedidaAt })
      .eq("id", orderId);

    CURRENT_USER_ID = mozoId;
    await registrarPago({
      orderId,
      splitId: null,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });

    CURRENT_USER_ID = encargadoId;
    expect((await anularCobro(orderId, "error de caja", businessSlug)).ok).toBe(
      true,
    );

    const { data: tbl } = await supabase
      .from("tables")
      .select("operational_status, current_order_id")
      .eq("id", tid)
      .single();
    expect(tbl!.operational_status).toBe("pidio_cuenta");
    expect(tbl!.current_order_id).toBe(orderId);

    // El pedido de cuenta original se conserva; no se pisa con `now()`.
    const { data: ord } = await supabase
      .from("orders")
      .select("bill_requested_at")
      .eq("id", orderId)
      .single();
    expect(new Date(ord!.bill_requested_at as string).getTime()).toBe(
      new Date(pedidaAt).getTime(),
    );
  });

  it("anularCobro: con factura autorizada se rechaza y NO devuelve un peso (spec 100)", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("E3");
    CURRENT_USER_ID = mozoId;
    await registrarPago({
      orderId,
      splitId: null,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });

    await supabase.from("invoices").insert({
      business_id: businessId,
      order_id: orderId,
      tipo_comprobante: "factura_b",
      punto_venta: 3,
      numero: 1234,
      cae: "75000000000001",
      total_cents: 10_000,
      neto_cents: 8_264,
      iva_cents: 1_736,
      status: "authorized",
      provider: "sandbox",
    });

    CURRENT_USER_ID = encargadoId;
    const r = await anularCobro(orderId, "cliente reclamó", businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("0003-00001234");
      expect(r.error).toContain("nota de crédito");
    }

    // Nada se movió: ni la orden, ni la plata.
    const { data: ord } = await supabase
      .from("orders")
      .select("lifecycle_status, total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(ord!.lifecycle_status).toBe("closed");
    expect(ord!.total_paid_cents).toBe(10_000);

    const { data: payments } = await supabase
      .from("payments")
      .select("payment_status")
      .eq("order_id", orderId);
    expect(payments!.every((p) => p.payment_status === "paid")).toBe(true);
  });

  it("anularCobro: con la factura todavía PENDING en el gateway, tampoco", { timeout: 30_000 }, async () => {
    // La emisión contra ARCA es asíncrona: entre que se encola y que vuelve el
    // CAE la fila está `pending`, y ahí la guarda miraba sólo `authorized` y se
    // abría. Se devolvía la plata, el cron autorizaba la factura igual y al
    // cliente le llegaba el comprobante de una venta reembolsada.
    const { orderId } = await newOrder("E4");
    CURRENT_USER_ID = mozoId;
    await registrarPago({
      orderId,
      splitId: null,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });

    await supabase.from("invoices").insert({
      business_id: businessId,
      order_id: orderId,
      tipo_comprobante: "factura_b",
      punto_venta: 3,
      // Sin CAE y sin número: todavía no volvió del gateway.
      numero: null,
      total_cents: 10_000,
      neto_cents: 8_264,
      iva_cents: 1_736,
      status: "pending",
      provider: "sandbox",
    });

    CURRENT_USER_ID = encargadoId;
    const r = await anularCobro(orderId, "cliente reclamó", businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // El mensaje tiene que decir la verdad: no hay número que citar todavía.
      expect(r.error).toContain("emitiéndose");
    }

    // Y sobre todo: no se devolvió un peso.
    const { data: ord } = await supabase
      .from("orders")
      .select("lifecycle_status, total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(ord!.lifecycle_status).toBe("closed");
    expect(ord!.total_paid_cents).toBe(10_000);

    const { data: payments } = await supabase
      .from("payments")
      .select("payment_status")
      .eq("order_id", orderId);
    expect(payments!.every((p) => p.payment_status === "paid")).toBe(true);
  });

  it("cancelarSplit sin pagos: status=cancelled + redistribución", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("F");
    CURRENT_USER_ID = mozoId;
    await dividirPorPersonas(orderId, 2, businessSlug);
    const { data: splits } = await supabase
      .from("order_splits")
      .select("id, expected_amount_cents")
      .eq("order_id", orderId)
      .order("split_index", { ascending: true });

    CURRENT_USER_ID = encargadoId;
    const r = await cancelarSplit(splits![0].id, "se fue uno", businessSlug);
    expect(r.ok).toBe(true);

    const { data: after } = await supabase
      .from("order_splits")
      .select("id, status, expected_amount_cents")
      .eq("order_id", orderId)
      .order("split_index", { ascending: true });
    expect(after![0].status).toBe("cancelled");
    expect(after![1].status).toBe("pending");
    // El split activo absorbió todo el expected.
    expect(after![1].expected_amount_cents).toBe(10_000);
  });

  it("cross-tenant: registrarPago en order de otro business → falla", { timeout: 30_000 }, async () => {
    const { data: otherBiz } = await supabase
      .from("businesses")
      .insert({
        slug: `${TEST_TAG}-other`,
        name: "Otro",
        is_active: true,
      })
      .select("id, slug")
      .single();

    const { data: ofp } = await supabase
      .from("floor_plans")
      .insert({ business_id: otherBiz!.id, name: "S" })
      .select("id")
      .single();
    const { data: ot } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: ofp!.id,
        label: "Z",
        seats: 2,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
      })
      .select("id")
      .single();
    const { data: oord } = await supabase
      .from("orders")
      .insert({
        business_id: otherBiz!.id,
        customer_name: "Otro",
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: ot!.id,
        subtotal_cents: 5_000,
        total_cents: 5_000,
        lifecycle_status: "open",
      })
      .select("id")
      .single();

    CURRENT_USER_ID = mozoId; // mozo del business "Cobro Test"
    const r = await registrarPago({
      orderId: oord!.id,
      splitId: null,
      method: "cash",
      amount_cents: 5_000,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    });
    expect(r.ok).toBe(false);

    await supabase.from("businesses").delete().eq("id", otherBiz!.id);
  });

  it("closeOrderIfFullyPaid sigue closed_at + transición a limpiar (helper directo)", { timeout: 30_000 }, async () => {
    const { tableId: tid, orderId } = await newOrder("G");
    // Insert manual de payment paid sin splits (escenario limpio).
    await supabase.from("payments").insert({
      order_id: orderId,
      business_id: businessId,
      caja_id: cajaId,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      payment_status: "paid",
    });

    const r = await closeOrderIfFullyPaid(
      supabase as unknown as Parameters<typeof closeOrderIfFullyPaid>[0],
      orderId,
      businessSlug,
    );
    expect(r.orderClosed).toBe(true);

    const { data: tbl } = await supabase
      .from("tables")
      .select("operational_status")
      .eq("id", tid)
      .single();
    expect(tbl!.operational_status).toBe("libre");
  });

  // ── Anti doble-submit (bug #58) ─────────────────────────────────────
  it("doble-submit con el MISMO request_id → un solo pago (idempotente)", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("H");
    CURRENT_USER_ID = mozoId;
    await dividirPorPersonas(orderId, 2, businessSlug); // 2 splits de 5.000 → la order queda open tras pagar uno
    const init = await iniciarCobro(orderId, businessSlug);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const [s1] = init.data.splits;

    const pago = {
      orderId,
      splitId: s1.id,
      method: "cash" as const,
      amount_cents: s1.expected_amount_cents,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
      requestId: crypto.randomUUID(),
    };
    const r1 = await registrarPago(pago);
    const r2 = await registrarPago(pago); // segundo tap, mismo request_id

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Idempotente: el 2º devuelve el pago ya creado, no uno nuevo.
    if (r1.ok && r2.ok) expect(r2.data.payment.id).toBe(r1.data.payment.id);

    const { data: pays } = await supabase
      .from("payments")
      .select("id")
      .eq("order_id", orderId)
      .eq("split_id", s1.id);
    expect(pays).toHaveLength(1);
  });

  it("doble-submit del bug real: split saldado + otro request_id → rechazo, un solo pago", { timeout: 30_000 }, async () => {
    const { orderId } = await newOrder("I");
    CURRENT_USER_ID = mozoId;
    await dividirPorPersonas(orderId, 2, businessSlug);
    const init = await iniciarCobro(orderId, businessSlug);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const [s1] = init.data.splits;

    const base = {
      orderId,
      splitId: s1.id,
      method: "cash" as const,
      amount_cents: s1.expected_amount_cents,
      tip_cents: 0,
      caja_id: cajaId,
      slug: businessSlug,
    };
    const r1 = await registrarPago({ ...base, requestId: crypto.randomUUID() });
    expect(r1.ok).toBe(true);

    // Segundo tap con request_id distinto (como el caso real golf-jcr: 3 pagos al mismo split).
    const r2 = await registrarPago({ ...base, requestId: crypto.randomUUID() });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/cobrad|saldad/i);

    const { data: pays } = await supabase
      .from("payments")
      .select("id")
      .eq("order_id", orderId)
      .eq("split_id", s1.id)
      .eq("payment_status", "paid");
    expect(pays).toHaveLength(1);
  });
});
