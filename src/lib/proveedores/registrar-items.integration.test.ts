// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/**
 * `registrar_items_comprobante_tx` — spec 165, cubierta recién en la 172.
 *
 * El proceso de QA P13 («llegó la mercadería», issue #268) lo dejó escrito:
 * **«`registrar_items_comprobante_tx` no tiene ni un test»**. Es la función que
 * mueve stock, escribe el consumo con su costo y **pisa
 * `ingredient_presentations.cost_cents`**, que se propaga a todas las recetas
 * que usan el insumo. Y anular devuelve el stock pero **no** el precio (165·D4),
 * así que lo que escribe mal no se deshace.
 *
 * Los unitarios del módulo stubean `rpc` genéricamente
 * (`anular-comprobante.test.ts`), o sea que la aritmética de adentro nunca corrió
 * en un test. Con el lector de facturas de la 172 esta función pasa de usarse a
 * mano a usarse de a diez renglones por foto.
 *
 * El escenario de la nota de crédito —que hoy SUMA stock en vez de restarlo,
 * hallazgo 1 de #268— lo arregla la migración `0085` y se testea junto con ella.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TAG = `test-items-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let db: SupabaseClient;
let businessId = "";
let otroBusinessId = "";
let supplierId = "";
let ingredientId = "";
let presentationId = "";

async function nuevoNegocio(slug: string): Promise<string> {
  const { data } = await db
    .from("businesses")
    .insert({ name: slug, slug })
    .select("id")
    .single();
  return data?.id ?? "";
}

async function nuevoComprobante(bId: string, sId: string): Promise<string> {
  const { data } = await db
    .from("supplier_invoices")
    .insert({
      business_id: bId,
      supplier_id: sId,
      invoice_date: "2026-09-08",
      total_cents: 1_000_00,
      document_type: "interno",
    })
    .select("id")
    .single();
  return data?.id ?? "";
}

const stockDe = async (id: string) =>
  Number(
    (await db.from("ingredients").select("stock_quantity").eq("id", id).single())
      .data?.stock_quantity,
  );

const costoDe = async (id: string) =>
  Number(
    (
      await db
        .from("ingredient_presentations")
        .select("cost_cents")
        .eq("id", id)
        .single()
    ).data?.cost_cents,
  );

/**
 * El setup va en top-level await y NO en `beforeAll`: `it.skipIf` evalúa su
 * condición durante la fase de COLECCIÓN, antes de que corra cualquier hook, así
 * que un `ready` que se setea en `beforeAll` llega siempre en `false` y la suite
 * entera se saltea en silencio. Es el patrón que ya usa
 * `chatbot-handoff.integration.test.ts`.
 */
async function preparar(): Promise<boolean> {
  if (!supabaseUrl || !serviceKey) return false;
  db = createClient(supabaseUrl, serviceKey);

  // Sonda: sin stack levantado esto falla y la suite se saltea, que es el patrón
  // del repo (`describe.skipIf`) — los integration fallan con ECONNREFUSED si no
  // levantaste el local, y es ruido conocido.
  const probe = await db.from("businesses").select("id").limit(1);
  if (probe.error) return false;

  businessId = await nuevoNegocio(`${TAG}`);
  otroBusinessId = await nuevoNegocio(`${TAG}-otro`);
  if (!businessId || !otroBusinessId) return false;

  const { data: sup } = await db
    .from("suppliers")
    .insert({ business_id: businessId, name: "Proveedor de prueba" })
    .select("id")
    .single();
  supplierId = sup?.id ?? "";

  // Entrecot: kg de unidad base, envase de 10 kg a $150.000 — los números de la
  // nota de pedido real de la carnicería, que es el caso con ground truth.
  const { data: ing } = await db
    .from("ingredients")
    .insert({ business_id: businessId, name: "Entrecot", unit: "kg", stock_quantity: 0 })
    .select("id")
    .single();
  ingredientId = ing?.id ?? "";

  const { data: pres } = await db
    .from("ingredient_presentations")
    .insert({
      ingredient_id: ingredientId,
      name: "Compra 10kg",
      net_quantity: 10,
      cost_cents: 150_000_00,
      is_default: true,
    })
    .select("id")
    .single();
  presentationId = pres?.id ?? "";

  return Boolean(supplierId && ingredientId && presentationId);
}

const ready = await preparar();

afterAll(async () => {
  if (!ready) return;
  // `on delete cascade` desde businesses se lleva todo lo de abajo.
  await db.from("businesses").delete().in("id", [businessId, otroBusinessId]);
});

describe.skipIf(!ready)("registrar_items_comprobante_tx", () => {
  it(
    "convierte envases a unidad base con el net_quantity de la presentación",
    async () => {
      const invoiceId = await nuevoComprobante(businessId, supplierId);
      const antes = await stockDe(ingredientId);

      // 82,600 kg de la factura ÷ envase de 10 kg = 8,26 envases.
      const { data: n, error } = await db.rpc("registrar_items_comprobante_tx", {
        p_business_id: businessId,
        p_invoice_id: invoiceId,
        p_created_by: null,
        p_items: [
          {
            ingredient_id: ingredientId,
            presentation_id: presentationId,
            units: 8.26,
            unit_cost_cents: 175_000_00,
          },
        ],
      });

      expect(error).toBeNull();
      expect(n).toBe(1);
      // El número que importa: 8,26 × 10 = 82,6 kg, lo que dice el papel.
      expect(await stockDe(ingredientId)).toBeCloseTo(antes + 82.6, 3);

      const { data: linea } = await db
        .from("supplier_invoice_items")
        .select("units, quantity_base, unit_cost_cents")
        .eq("invoice_id", invoiceId)
        .single();
      expect(Number(linea?.units)).toBeCloseTo(8.26, 3);
      expect(Number(linea?.quantity_base)).toBeCloseTo(82.6, 3);
      expect(Number(linea?.unit_cost_cents)).toBe(175_000_00);
    },
  );

  it(
    "escribe el consumo con el costo REAL por unidad base, no con 0",
    async () => {
      const invoiceId = await nuevoComprobante(businessId, supplierId);

      await db.rpc("registrar_items_comprobante_tx", {
        p_business_id: businessId,
        p_invoice_id: invoiceId,
        p_created_by: null,
        p_items: [
          {
            ingredient_id: ingredientId,
            presentation_id: presentationId,
            units: 2,
            unit_cost_cents: 200_000_00,
          },
        ],
      });

      // Por `quantity` y no por el último `created_at`: los otros tests de este
      // archivo escriben consumos del mismo insumo, y ordenar por fecha trae el
      // que toque. 2 envases × 10 kg = 20 kg, que no lo produce ningún otro.
      const { data: consumos } = await db
        .from("ingredient_consumptions")
        .select("quantity, cost_cents_snapshot, kind")
        .eq("business_id", businessId)
        .eq("kind", "compra")
        .eq("quantity", 20);

      expect(consumos).toHaveLength(1);
      // `ingresarStockCocina` escribía 0 acá — es la spec 165 entera.
      //
      // El número es la plata del MOVIMIENTO entero: 2 envases × $200.000 =
      // $400.000. La 0073 escribía el costo por unidad base ($20.000 el kilo) y
      // la 0085 lo corrigió: es la convención de todos los otros escritores de
      // esta columna (`fn_stock_reversion_item`, `fn_stock_delta_on_item_edit`),
      // y es la que suma el CMV. Dejar dos unidades distintas en la misma
      // columna era la bomba de tiempo.
      expect(Number(consumos?.[0]?.cost_cents_snapshot)).toBe(400_000_00);
    },
  );

  it("la compra reescribe el costo del envase y deja histórico", async () => {
    const invoiceId = await nuevoComprobante(businessId, supplierId);
    const costoAntes = await costoDe(presentationId);
    const nuevo = costoAntes + 33_000_00;

    await db.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_created_by: null,
      p_items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 1,
          unit_cost_cents: nuevo,
        },
      ],
    });

    expect(await costoDe(presentationId)).toBe(nuevo);

    const { data: log } = await db
      .from("ingredient_price_log")
      .select("old_cost_cents, new_cost_cents")
      .eq("presentation_id", presentationId)
      .order("recorded_at", { ascending: false })
      .limit(1);
    expect(Number(log?.[0]?.new_cost_cents)).toBe(nuevo);
    expect(Number(log?.[0]?.old_cost_cents)).toBe(costoAntes);
  });

  it("no toca el costo si el precio no cambió", async () => {
    const invoiceId = await nuevoComprobante(businessId, supplierId);
    const costo = await costoDe(presentationId);
    const { count: antes } = await db
      .from("ingredient_price_log")
      .select("*", { count: "exact", head: true })
      .eq("presentation_id", presentationId);

    await db.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_created_by: null,
      p_items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 1,
          unit_cost_cents: costo,
        },
      ],
    });

    const { count: despues } = await db
      .from("ingredient_price_log")
      .select("*", { count: "exact", head: true })
      .eq("presentation_id", presentationId);

    // El `and cost_cents <> v_costo` de la RPC: sin él, cada compra al mismo
    // precio ensuciaría el histórico con una fila que no dice nada.
    expect(despues).toBe(antes);
  });

  it(
    "sin presentación, units ya viene en unidad base y el costo por unidad llega a la default",
    async () => {
      const invoiceId = await nuevoComprobante(businessId, supplierId);
      const antes = await stockDe(ingredientId);

      const { error } = await db.rpc("registrar_items_comprobante_tx", {
        p_business_id: businessId,
        p_invoice_id: invoiceId,
        p_created_by: null,
        p_items: [
          {
            ingredient_id: ingredientId,
            presentation_id: null,
            units: 5,
            unit_cost_cents: 21_000_00,
          },
        ],
      });
      expect(error).toBeNull();

      // Sin envase no hay factor de conversión: 5 son 5 kg, no 50.
      expect(await stockDe(ingredientId)).toBeCloseTo(antes + 5, 3);
      // 0124 — antes el precio quedaba intacto, y una compra a granel dejaba a
      // todas las recetas del insumo costeadas con un precio viejo. El precio
      // viene por unidad base ($21.000 el kilo): el envase default, de 10 kg,
      // pasa a costar $210.000.
      expect(await costoDe(presentationId)).toBe(210_000_00);
    },
  );

  it("rechaza un insumo de otro negocio y no mueve nada", async () => {
    const invoiceId = await nuevoComprobante(businessId, supplierId);
    const { data: ajeno } = await db
      .from("ingredients")
      .insert({ business_id: otroBusinessId, name: "Ajeno", unit: "kg", stock_quantity: 0 })
      .select("id")
      .single();

    const { error } = await db.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_created_by: null,
      p_items: [
        { ingredient_id: ajeno?.id, presentation_id: null, units: 1, unit_cost_cents: 100 },
      ],
    });

    expect(error?.message).toContain("INSUMO_DE_OTRO_NEGOCIO");
    expect(await stockDe(String(ajeno?.id))).toBe(0);
  });

  it("anular devuelve el stock pero NO el precio", async () => {
    const invoiceId = await nuevoComprobante(businessId, supplierId);
    const stockAntes = await stockDe(ingredientId);
    const precioDeLaCompra = (await costoDe(presentationId)) + 7_000_00;

    await db.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_created_by: null,
      p_items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 3,
          unit_cost_cents: precioDeLaCompra,
        },
      ],
    });
    expect(await stockDe(ingredientId)).toBeCloseTo(stockAntes + 30, 3);

    const { error } = await db.rpc("revertir_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
    });
    expect(error).toBeNull();

    // El stock vuelve porque la mercadería nunca entró...
    expect(await stockDe(ingredientId)).toBeCloseTo(stockAntes, 3);
    // ...y el precio se queda, porque es un hecho histórico: el proveedor cobró
    // eso (165·D4). Es lo que hace que un renglón mal matcheado sea caro.
    expect(await costoDe(presentationId)).toBe(precioDeLaCompra);

    const { count } = await db
      .from("supplier_invoice_items")
      .select("*", { count: "exact", head: true })
      .eq("invoice_id", invoiceId);
    expect(count).toBe(0);
  });

  it(
    "comprar otra presentación también le actualiza el costo a la default (0124)",
    async () => {
      // La receta cuesta con la presentación `default`. Si el proveedor trae el
      // insumo en otro envase —o a granel— el costo de la receta no se
      // enteraba nunca: se seguía costeando con el precio de la última vez que
      // se compró justo ese envase.
      const { data: chica } = await db
        .from("ingredient_presentations")
        .insert({
          ingredient_id: ingredientId,
          name: "Bandeja 2kg",
          net_quantity: 2,
          cost_cents: 30_000_00,
          is_default: false,
        })
        .select("id")
        .single();
      const invoiceId = await nuevoComprobante(businessId, supplierId);

      // La bandeja de 2 kg a $50.000 → $25.000 el kilo.
      const { error } = await db.rpc("registrar_items_comprobante_tx", {
        p_business_id: businessId,
        p_invoice_id: invoiceId,
        p_created_by: null,
        p_items: [
          {
            ingredient_id: ingredientId,
            presentation_id: chica!.id,
            units: 3,
            unit_cost_cents: 50_000_00,
          },
        ],
      });
      expect(error).toBeNull();
      expect(await costoDe(chica!.id)).toBe(50_000_00);
      // El envase default es de 10 kg: $25.000 × 10.
      expect(await costoDe(presentationId)).toBe(250_000_00);
    },
  );

  it("una compra a granel (sin presentación) lleva su precio por unidad a la default", async () => {
    const invoiceId = await nuevoComprobante(businessId, supplierId);
    // 5 kg sueltos a $30.000 el kilo.
    const { error } = await db.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_created_by: null,
      p_items: [{ ingredient_id: ingredientId, units: 5, unit_cost_cents: 30_000_00 }],
    });
    expect(error).toBeNull();
    expect(await costoDe(presentationId)).toBe(300_000_00);
  });

  it("un renglón de más de $21 millones entra: la plata ya no es de 32 bits (0124)", async () => {
    const invoiceId = await nuevoComprobante(businessId, supplierId);
    const { error } = await db.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_created_by: null,
      // 100 envases a $300.000: $30.000.000 en un renglón.
      p_items: [
        { ingredient_id: ingredientId, presentation_id: presentationId, units: 100, unit_cost_cents: 300_000_00 },
      ],
    });
    expect(error).toBeNull();
    const { error: facturaErr } = await db
      .from("supplier_invoices")
      .update({ total_cents: 3_000_000_000 })
      .eq("id", invoiceId);
    expect(facturaErr).toBeNull();
  });
});
