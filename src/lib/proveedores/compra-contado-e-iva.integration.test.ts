// @vitest-environment node
//
// Specs 187 y 188 contra la base de verdad.
//
// Los dos pedidos de Rocío del 2026-09-15 tocan cosas que sólo se pueden
// verificar mirando filas: que el contado escriba el pago, la imputación y la
// sangría de la Caja Mayor en una sola operación (187), y que la RPC guarde el
// pie fiscal, la base del precio y las dos columnas que la 172·D6 declaró y
// nunca llenó (188).
//
// Se verifica el EFECTO en la base, no el retorno de la action. Mismo harness
// que `compras-issue-268.integration.test.ts`: negocio propio y descartable.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-iva-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { createSupplierInvoice } = await import("./actions");
const { getRenglonesPorComprobante } = await import("./queries");

describe.skipIf(!dbAvailable)("la compra al contado y su IVA (specs 187 y 188)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let encargadoId: string;
  let supplierId: string;
  let ingredientId: string;
  let presentationId: string;
  let cajaMayorId: string;

  beforeAll(async () => {
    const email = `${TEST_TAG}-enc@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    encargadoId = created!.user!.id;
    await supabase.from("users").upsert({ id: encargadoId, email, full_name: "Encargada" });

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "IVA Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert({
      business_id: businessId,
      user_id: encargadoId,
      role: "encargado",
      full_name: "Encargada",
    });

    /**
     * La Caja Mayor NO se inserta: la crea sola el trigger
     * `caja_administrativa_seed_on_business` (spec 160), y el índice único
     * parcial `cajas_one_administrative_per_business` rechaza la segunda. Que
     * este test la lea en vez de crearla es, de paso, la prueba de que un
     * negocio nuevo nace pudiendo pagar en efectivo.
     */
    const { data: caja } = await supabase
      .from("cajas")
      .select("id")
      .eq("business_id", businessId)
      .eq("is_administrative", true)
      .single();
    cajaMayorId = caja!.id;

    const { data: sup } = await supabase
      .from("suppliers")
      .insert({ business_id: businessId, name: `Carnicería ${TEST_TAG}`, is_active: true })
      .select("id")
      .single();
    supplierId = sup!.id;

    const { data: ing } = await supabase
      .from("ingredients")
      .insert({
        business_id: businessId,
        name: `Entrecot ${TEST_TAG}`,
        unit: "kg",
        stock_quantity: 15.11,
        waste_percent: 0,
      })
      .select("id")
      .single();
    ingredientId = ing!.id;

    const { data: pres } = await supabase
      .from("ingredient_presentations")
      .insert({
        ingredient_id: ingredientId,
        name: "Compra 10kg",
        net_quantity: 10,
        cost_cents: 15_100_00,
        is_default: true,
      })
      .select("id")
      .single();
    presentationId = pres!.id;

    CURRENT_USER_ID = encargadoId;
  }, 30_000);

  afterAll(async () => {
    const { data: invs } = await supabase
      .from("supplier_invoices")
      .select("id")
      .eq("business_id", businessId);
    for (const inv of invs ?? []) {
      await supabase.from("supplier_invoice_items").delete().eq("invoice_id", inv.id);
    }
    await supabase.from("supplier_payment_allocations").delete().eq("business_id", businessId);
    await supabase.from("supplier_payments").delete().eq("business_id", businessId);
    await supabase.from("supplier_invoices").delete().eq("business_id", businessId);
    await supabase.from("caja_movimientos").delete().eq("business_id", businessId);
    await supabase.from("cajas").delete().eq("business_id", businessId);
    await supabase.from("ingredient_consumptions").delete().eq("business_id", businessId);
    await supabase.from("ingredient_presentations").delete().eq("ingredient_id", ingredientId);
    await supabase.from("ingredients").delete().eq("business_id", businessId);
    await supabase.from("suppliers").delete().eq("business_id", businessId);
    await supabase.from("business_users").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
    await supabase.auth.admin.deleteUser(encargadoId);
  }, 30_000);

  // ── spec 187 · el contado ───────────────────────────────────────────────

  it("el contado en efectivo deja pago, imputación y sangría de la Caja Mayor", async () => {
    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `CONTADO-${TEST_TAG}`,
      invoice_date: "2026-09-15",
      total_cents: 482_100_00,
      document_type: "interno",
      payment_condition: "contado",
      payment_method: "cash",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pago).toBe("registrado");

    const { data: pago } = await supabase
      .from("supplier_payments")
      .select("id, amount_cents, method, paid_at, caja_id, caja_movimiento_id")
      .eq("business_id", businessId)
      .eq("supplier_id", supplierId)
      .single();

    expect(pago!.amount_cents).toBe(482_100_00);
    expect(pago!.method).toBe("cash");
    // 187·D4 · el pago se fecha contra el papel.
    expect(pago!.paid_at).toBe("2026-09-15");
    // 160 · el efectivo sale SIEMPRE de la caja administrativa.
    expect(pago!.caja_id).toBe(cajaMayorId);

    // La imputación, que es lo que hace que el saldo derivado no lo muestre
    // impago: sin esto la compra figuraría pagada y debiendo a la vez.
    const { data: imputaciones } = await supabase
      .from("supplier_payment_allocations")
      .select("invoice_id, amount_cents")
      .eq("payment_id", pago!.id);
    expect(imputaciones).toHaveLength(1);
    expect(imputaciones![0]!.invoice_id).toBe(r.data.id);
    expect(imputaciones![0]!.amount_cents).toBe(482_100_00);

    // El egreso, con el `kind` que el arqueo filtra (158·D5).
    const { data: mov } = await supabase
      .from("caja_movimientos")
      .select("caja_id, kind, amount_cents, reason")
      .eq("id", pago!.caja_movimiento_id!)
      .single();
    expect(mov!.caja_id).toBe(cajaMayorId);
    expect(mov!.kind).toBe("sangria");
    expect(mov!.amount_cents).toBe(482_100_00);
    expect(mov!.reason).toContain("Pago a proveedor");
  }, 30_000);

  it("en cuenta corriente no se escribe ningún pago", async () => {
    const antes = await supabase
      .from("supplier_payments")
      .select("id")
      .eq("business_id", businessId);

    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `CTACTE-${TEST_TAG}`,
      invoice_date: "2026-09-15",
      total_cents: 120_000_00,
      document_type: "interno",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pago).toBe("no_aplica");

    const despues = await supabase
      .from("supplier_payments")
      .select("id")
      .eq("business_id", businessId);
    expect(despues.data).toHaveLength((antes.data ?? []).length);
  }, 30_000);

  // ── spec 188 · el IVA ───────────────────────────────────────────────────

  /**
   * El caso de oro de la 172, ahora con su pie: la nota de la carnicería, donde
   * los cinco precios coinciden exacto con el costo por unidad base del sistema.
   */
  it("la factura A guarda el pie fiscal y el renglón queda en base neto", async () => {
    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `FA-${TEST_TAG}`,
      invoice_date: "2026-09-15",
      document_type: "factura_a",
      total_cents: 174_905_50,
      neto_cents: 144_550_00,
      iva_cents: 30_355_50,
      items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 8.26,
          unit_cost_cents: 175_000_00,
          tasa_iva: 21,
          source_text: "ENTRECOT 82,600 kg 17.500 1.445.500",
          match_source: "fuzzy",
        },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: inv } = await supabase
      .from("supplier_invoices")
      .select("neto_cents, iva_cents, percepciones_cents, total_cents")
      .eq("id", r.data.id)
      .single();

    expect(Number(inv!.neto_cents)).toBe(144_550_00);
    expect(Number(inv!.iva_cents)).toBe(30_355_50);
    // Lo que no se leyó llega vacío, nunca en cero (188·D3).
    expect(inv!.percepciones_cents).toBeNull();

    const { data: item } = await supabase
      .from("supplier_invoice_items")
      .select("unit_cost_cents, tasa_iva, price_base, source_text, match_source")
      .eq("invoice_id", r.data.id)
      .single();

    // 188·D2 · la base la decide la RPC leyendo el document_type de la fila.
    expect(item!.price_base).toBe("neto");
    expect(Number(item!.tasa_iva)).toBe(21);
    // El costo NO cambia: sigue siendo el número del papel (188·D1).
    expect(Number(item!.unit_cost_cents)).toBe(175_000_00);
    // 172·D6 · las dos columnas que existían desde la 0092 y nadie llenaba.
    expect(item!.source_text).toBe("ENTRECOT 82,600 kg 17.500 1.445.500");
    expect(item!.match_source).toBe("fuzzy");

    /**
     * Y la query que alimenta el panel de la cuenta corriente devuelve los dos
     * campos nuevos — es el único tramo entre la base y el cartel de IVA del
     * comprobante ya cargado, y `tasa_iva` llega de PostgREST como STRING.
     */
    const porComprobante = await getRenglonesPorComprobante(businessId, [r.data.id]);
    const renglon = porComprobante[r.data.id]?.[0];
    expect(renglon?.priceBase).toBe("neto");
    expect(renglon?.tasaIva).toBe(21);

    // Y el costo que se propagó al insumo es el neto, no el final.
    const { data: pres } = await supabase
      .from("ingredient_presentations")
      .select("cost_cents")
      .eq("id", presentationId)
      .single();
    expect(pres!.cost_cents).toBe(175_000_00);
  }, 30_000);

  it("un ticket deja el renglón en base final", async () => {
    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `TK-${TEST_TAG}`,
      invoice_date: "2026-09-15",
      document_type: "ticket",
      total_cents: 50_000_00,
      items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 1,
          unit_cost_cents: 50_000_00,
          source_text: "ENTRECOT x1",
          match_source: "memoria",
        },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: item } = await supabase
      .from("supplier_invoice_items")
      .select("price_base, tasa_iva, match_source")
      .eq("invoice_id", r.data.id)
      .single();

    expect(item!.price_base).toBe("final");
    // Sin tasa impresa no se inventa ninguna: la herencia es sólo para mostrar.
    expect(item!.tasa_iva).toBeNull();
    expect(item!.match_source).toBe("memoria");
  }, 30_000);

  /**
   * 188 · el signo lo manda el tipo, igual que el total (158·D4). El pie de una
   * nota de crédito está impreso en positivo; lo que resta del saldo es lo que
   * guardamos, o el subdiario sumaría crédito fiscal donde hubo devolución.
   */
  it("la nota de crédito guarda el pie en negativo", async () => {
    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `NC-${TEST_TAG}`,
      invoice_date: "2026-09-15",
      document_type: "nota_credito",
      total_cents: -12_100_00,
      neto_cents: 10_000_00,
      iva_cents: 2_100_00,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: inv } = await supabase
      .from("supplier_invoices")
      .select("neto_cents, iva_cents")
      .eq("id", r.data.id)
      .single();

    expect(Number(inv!.neto_cents)).toBe(-10_000_00);
    expect(Number(inv!.iva_cents)).toBe(-2_100_00);
  }, 30_000);
});
