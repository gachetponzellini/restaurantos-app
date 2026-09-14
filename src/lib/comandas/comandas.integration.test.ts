// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-comandas-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_USER_EMAIL = `${TEST_TAG}@example.test`;
const TEST_ENCARGADO_EMAIL = `${TEST_TAG}-enc@example.test`;
let TEST_USER_ID = "";
let TEST_ENCARGADO_ID = "";
// Mutable so individual tests can swap the "logged-in user" for permission tests.
let CURRENT_AUTH_USER_ID = "";

// Server-only auth client returns our test user. Real production callers go
// through the cookie-based session; the action's cross-tenant defense still
// runs against the real `business_id` we seed below.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // Identidad de las actions del salón: `getClaims` (spec 106).
      // `getUser` queda para el código que todavía lo llama.
      getClaims: async () => ({
        data: { claims: { sub: CURRENT_AUTH_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: CURRENT_AUTH_USER_ID } },
        error: null,
      }),
    },
  }),
}));

// `cache()` from React isn't available in a plain node env. Stub it to a
// passthrough so getBusiness() works.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

// `revalidatePath` requiere static generation store de Next, no disponible en
// node puro.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Imported AFTER the mocks above so they take effect.
const {
  enviarComanda,
  advanceComandaStatus,
  advanceItemKitchenStatus,
  cancelarItem,
} = await import("./actions");

describe.skipIf(!dbAvailable)("comandas (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let otherBusinessId: string;
  let otherBusinessSlug: string;
  let tableId: string;
  let otherTableId: string;
  let stationCocinaId: string;
  let stationParrillaId: string;
  let stationFriteraId: string;
  let stationPostresId: string;
  let prodMilanesaId: string; // → cocina (via category)
  let prodChoriId: string; // → parrilla (via category)
  let prodPapasId: string; // → fritera (via product override sobre cat 'cocina')
  let prodFlanId: string; // → postres (via category)
  let prodSinSectorId: string; // sin station ni en cat ni en producto → debe fallar

  beforeAll(async () => {
    // 1. Auth users de prueba: un mozo y un encargado (cancelarItem requiere
    //    encargado/admin).
    const { data: created, error: authErr } =
      await supabase.auth.admin.createUser({
        email: TEST_USER_EMAIL,
        password: "test-pass-12345",
        email_confirm: true,
      });
    if (authErr || !created?.user) {
      throw new Error(`Could not create test auth user: ${authErr?.message}`);
    }
    TEST_USER_ID = created.user.id;
    CURRENT_AUTH_USER_ID = TEST_USER_ID;
    await supabase.from("users").upsert({
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      full_name: "Mozo Test",
    });

    const { data: createdEnc, error: encErr } =
      await supabase.auth.admin.createUser({
        email: TEST_ENCARGADO_EMAIL,
        password: "test-pass-12345",
        email_confirm: true,
      });
    if (encErr || !createdEnc?.user) {
      throw new Error(
        `Could not create encargado auth user: ${encErr?.message}`,
      );
    }
    TEST_ENCARGADO_ID = createdEnc.user.id;
    await supabase.from("users").upsert({
      id: TEST_ENCARGADO_ID,
      email: TEST_ENCARGADO_EMAIL,
      full_name: "Encargado Test",
    });

    // 2. Business principal + business "otro" para tests de cross-tenant
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Comandas Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    const otherTag = `${TEST_TAG}-other`;
    const { data: other } = await supabase
      .from("businesses")
      .insert({ slug: otherTag, name: "Otro Test", is_active: true })
      .select("id, slug")
      .single();
    otherBusinessId = other!.id;
    otherBusinessSlug = other!.slug;

    // Membership para que las RLS policies no rechacen lecturas del test (no
    // afectan a las actions que usan service client, pero sí a queries que
    // pasen por server client).
    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: TEST_USER_ID, role: "mozo" },
      { business_id: otherBusinessId, user_id: TEST_USER_ID, role: "mozo" },
      {
        business_id: businessId,
        user_id: TEST_ENCARGADO_ID,
        role: "encargado",
      },
      // También encargado en el OTRO negocio: así el test cross-tenant de
      // `advanceComandaStatus` sigue probando el guard de tenant y no se cuelga
      // del gate de rol que sumó la spec 182.
      {
        business_id: otherBusinessId,
        user_id: TEST_ENCARGADO_ID,
        role: "encargado",
      },
    ]);

    // 3. Floor plan + mesa en cada business
    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    const { data: table } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "1",
        seats: 4,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      })
      .select("id")
      .single();
    tableId = table!.id;

    const { data: otherFp } = await supabase
      .from("floor_plans")
      .insert({ business_id: otherBusinessId, name: "Salón B" })
      .select("id")
      .single();
    const { data: otherTable } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: otherFp!.id,
        label: "X",
        seats: 2,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      })
      .select("id")
      .single();
    otherTableId = otherTable!.id;

    // 4. Stations
    const { data: stations } = await supabase
      .from("stations")
      .insert([
        { business_id: businessId, name: "Cocina", sort_order: 1 },
        { business_id: businessId, name: "Parrilla", sort_order: 2 },
        { business_id: businessId, name: "Fritera", sort_order: 3 },
        { business_id: businessId, name: "Postres", sort_order: 4 },
      ])
      .select("id, name");
    const stationByName = new Map(stations!.map((s) => [s.name, s.id]));
    stationCocinaId = stationByName.get("Cocina")!;
    stationParrillaId = stationByName.get("Parrilla")!;
    stationFriteraId = stationByName.get("Fritera")!;
    stationPostresId = stationByName.get("Postres")!;

    // 5. Categorías con station por default
    const { data: catCocina } = await supabase
      .from("categories")
      .insert({
        business_id: businessId,
        name: "Cocina",
        slug: "cocina",
        station_id: stationCocinaId,
      })
      .select("id")
      .single();
    const { data: catParrilla } = await supabase
      .from("categories")
      .insert({
        business_id: businessId,
        name: "Parrilla",
        slug: "parrilla",
        station_id: stationParrillaId,
      })
      .select("id")
      .single();
    const { data: catPostres } = await supabase
      .from("categories")
      .insert({
        business_id: businessId,
        name: "Postres",
        slug: "postres",
        station_id: stationPostresId,
      })
      .select("id")
      .single();
    const { data: catSinSector } = await supabase
      .from("categories")
      .insert({
        business_id: businessId,
        name: "Sin Sector",
        slug: "sin-sector",
      })
      .select("id")
      .single();

    // 6. Productos
    const insertProduct = async (
      name: string,
      slug: string,
      categoryId: string,
      stationOverride: string | null,
      price: number,
    ) => {
      const { data } = await supabase
        .from("products")
        .insert({
          business_id: businessId,
          category_id: categoryId,
          name,
          slug,
          price_cents: price,
          station_id: stationOverride,
        })
        .select("id")
        .single();
      return data!.id;
    };
    prodMilanesaId = await insertProduct(
      "Milanesa",
      "milanesa",
      catCocina!.id,
      null,
      500000,
    );
    prodChoriId = await insertProduct(
      "Chorizo",
      "chorizo",
      catParrilla!.id,
      null,
      300000,
    );
    prodPapasId = await insertProduct(
      "Papas Fritas",
      "papas",
      catCocina!.id,
      stationFriteraId,
      200000,
    );
    prodFlanId = await insertProduct(
      "Flan",
      "flan",
      catPostres!.id,
      null,
      150000,
    );
    prodSinSectorId = await insertProduct(
      "Sin Sector",
      "sin-sector-prod",
      catSinSector!.id,
      null,
      100000,
    );
  });

  afterAll(async () => {
    if (!businessId) return;
    await supabase
      .from("businesses")
      .delete()
      .in("id", [businessId, otherBusinessId].filter(Boolean));
    if (TEST_USER_ID) {
      await supabase.from("users").delete().eq("id", TEST_USER_ID);
      await supabase.auth.admin.deleteUser(TEST_USER_ID);
    }
    if (TEST_ENCARGADO_ID) {
      await supabase.from("users").delete().eq("id", TEST_ENCARGADO_ID);
      await supabase.auth.admin.deleteUser(TEST_ENCARGADO_ID);
    }
  });

  it(
    "envía una comanda con items multi-sector (3 sectores → 3 comandas, batch=1)",
    { timeout: 30_000 },
    async () => {
      const result = await enviarComanda({
        tableId,
        slug: businessSlug,
        items: [
          { product_id: prodMilanesaId, quantity: 2 },
          { product_id: prodChoriId, quantity: 1 },
          { product_id: prodPapasId, quantity: 1 },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.comanda_ids).toHaveLength(3);

      const { data: order } = await supabase
        .from("orders")
        .select(
          "id, lifecycle_status, table_id, mozo_id, subtotal_cents, total_cents",
        )
        .eq("id", result.data.order_id)
        .single();
      expect(order!.lifecycle_status).toBe("open");
      expect(order!.table_id).toBe(tableId);
      expect(order!.mozo_id).toBe(TEST_USER_ID);
      // Milanesa 500000 * 2 + Chori 300000 + Papas 200000 = 1500000
      expect(Number(order!.subtotal_cents)).toBe(1500000);
      expect(Number(order!.total_cents)).toBe(1500000);

      const { data: comandas } = await supabase
        .from("comandas")
        .select("station_id, batch, status")
        .eq("order_id", result.data.order_id);
      expect(comandas).toHaveLength(3);
      for (const c of comandas!) {
        expect(c.batch).toBe(1);
        expect(c.status).toBe("pendiente");
      }
      const stationIds = comandas!.map((c) => c.station_id).sort();
      expect(stationIds).toEqual(
        [stationCocinaId, stationParrillaId, stationFriteraId].sort(),
      );

      const { data: items } = await supabase
        .from("order_items")
        .select("product_name, station_id, loaded_by, kitchen_status")
        .eq("order_id", result.data.order_id);
      expect(items).toHaveLength(3);
      for (const i of items!) {
        expect(i.loaded_by).toBe(TEST_USER_ID);
        expect(i.kitchen_status).toBe("pending");
        expect(i.station_id).not.toBeNull();
      }

      const { data: tableRow } = await supabase
        .from("tables")
        .select("operational_status, current_order_id, opened_at, mozo_id")
        .eq("id", tableId)
        .single();
      expect(tableRow!.operational_status).toBe("ocupada");
      expect(tableRow!.current_order_id).toBe(result.data.order_id);
      expect(tableRow!.opened_at).not.toBeNull();
      // Spec 111 · FR-012 — este envío es el que abre la mesa (se entra a cargar
      // sin pasar por el walk-in), así que también tiene que dejarla asignada:
      // sin mozo no aparece en el plano, la distribución ni la rendición.
      expect(tableRow!.mozo_id).toBe(TEST_USER_ID);
    },
  );

  it("dos envíos sucesivos a la misma mesa: misma order, batch incrementa por sector", async () => {
    const second = await enviarComanda({
      tableId,
      slug: businessSlug,
      items: [{ product_id: prodMilanesaId, quantity: 1 }],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const { data: orders } = await supabase
      .from("orders")
      .select("id")
      .eq("table_id", tableId)
      .eq("lifecycle_status", "open");
    expect(orders).toHaveLength(1);

    const { data: cocinaComandas } = await supabase
      .from("comandas")
      .select("batch")
      .eq("order_id", second.data.order_id)
      .eq("station_id", stationCocinaId)
      .order("batch");
    expect(cocinaComandas!.map((c) => c.batch)).toEqual([1, 2]);

    const { data: parrillaComandas } = await supabase
      .from("comandas")
      .select("batch")
      .eq("order_id", second.data.order_id)
      .eq("station_id", stationParrillaId);
    // Parrilla no tuvo segundo envío → sigue en batch 1.
    expect(parrillaComandas!.map((c) => c.batch)).toEqual([1]);
  });

  it(
    "idempotencia (spec 42): reenviar la misma línea (client_line_key) no duplica order_items ni comandas",
    { timeout: 30_000 },
    async () => {
      // Mesa nueva para aislarnos del estado de los tests previos.
      const { data: fp } = await supabase
        .from("floor_plans")
        .insert({ business_id: businessId, name: "Salón idempotencia" })
        .select("id")
        .single();
      const { data: tableRow } = await supabase
        .from("tables")
        .insert({
          floor_plan_id: fp!.id,
          label: "IDEM",
          seats: 2,
          shape: "circle",
          x: 0,
          y: 0,
          width: 80,
          height: 80,
        })
        .select("id")
        .single();
      const idemTableId = tableRow!.id as string;

      // Mismo payload con el MISMO client_line_key = doble-submit del mozo.
      const lineKey = randomUUID();
      const items = [
        { product_id: prodMilanesaId, quantity: 2, client_line_key: lineKey },
      ];

      const first = await enviarComanda({
        tableId: idemTableId,
        slug: businessSlug,
        items,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.comanda_ids).toHaveLength(1);

      // Segundo envío idéntico (retry / doble-tap).
      const second = await enviarComanda({
        tableId: idemTableId,
        slug: businessSlug,
        items,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      // Misma orden.
      expect(second.data.order_id).toBe(first.data.order_id);

      // NO se duplicó el order_item de esa línea.
      const { data: itemRows } = await supabase
        .from("order_items")
        .select("id")
        .eq("order_id", first.data.order_id)
        .eq("client_line_key", lineKey);
      expect(itemRows).toHaveLength(1);

      // NO se creó una comanda extra.
      const { data: comandas } = await supabase
        .from("comandas")
        .select("id")
        .eq("order_id", first.data.order_id);
      expect(comandas).toHaveLength(1);

      // Total de la orden = 1 milanesa x2 (no se dobló).
      const { data: order } = await supabase
        .from("orders")
        .select("total_cents")
        .eq("id", first.data.order_id)
        .single();
      expect(Number(order!.total_cents)).toBe(1000000);

      // Respuesta idempotente: el reenvío devuelve la misma comanda.
      expect(second.data.comanda_ids).toEqual(first.data.comanda_ids);
    },
  );

  it(
    "items sin sector resoluble: se insertan con station_id=null y NO generan comanda",
    { timeout: 30_000 },
    async () => {
      // Creamos una mesa nueva para aislarnos de las comandas previas del test.
      const { data: fp } = await supabase
        .from("floor_plans")
        .insert({ business_id: businessId, name: "Salón aux" })
        .select("id")
        .single();
      const { data: tableForOrphan } = await supabase
        .from("tables")
        .insert({
          floor_plan_id: fp!.id,
          label: "AUX",
          seats: 2,
          shape: "circle",
          x: 0,
          y: 0,
          width: 80,
          height: 80,
        })
        .select("id")
        .single();

      const result = await enviarComanda({
        tableId: tableForOrphan!.id,
        slug: businessSlug,
        items: [
          // Uno con sector resoluble, otro sin.
          { product_id: prodMilanesaId, quantity: 1 },
          { product_id: prodSinSectorId, quantity: 1 },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Solo se creó UNA comanda (la del item con sector). El item sin sector
      // entra al order_items pero no se rutea.
      expect(result.data.comanda_ids).toHaveLength(1);

      const { data: items } = await supabase
        .from("order_items")
        .select("product_id, station_id")
        .eq("order_id", result.data.order_id);
      expect(items).toHaveLength(2);
      const orphan = items!.find((i) => i.product_id === prodSinSectorId);
      expect(orphan!.station_id).toBeNull();
      const cocina = items!.find((i) => i.product_id === prodMilanesaId);
      expect(cocina!.station_id).not.toBeNull();
    },
  );

  it(
    "advanceComandaStatus: pendiente → en_preparacion → entregado, espeja kitchen_status",
    { timeout: 30_000 },
    async () => {
      // Tomamos una comanda fresca de Postres con un solo item.
      const fresh = await enviarComanda({
        tableId,
        slug: businessSlug,
        items: [{ product_id: prodFlanId, quantity: 1 }],
      });
      expect(fresh.ok).toBe(true);
      if (!fresh.ok) return;

      const { data: cmd } = await supabase
        .from("comandas")
        .select("id")
        .eq("order_id", fresh.data.order_id)
        .eq("station_id", stationPostresId)
        .order("batch", { ascending: false })
        .limit(1)
        .single();
      const cmdId = cmd!.id;

      // Spec 182 · D2 — «Empezar» es de cocina: `advanceComandaStatus` pide
      // encargado/admin. El mozo del test avanza en la mesa, no en el kanban.
      const comoMozo = await advanceComandaStatus(cmdId, businessSlug);
      expect(comoMozo.ok).toBe(false);
      if (!comoMozo.ok) expect(comoMozo.error).toMatch(/encargado o admin/i);

      CURRENT_AUTH_USER_ID = TEST_ENCARGADO_ID;
      let r = await advanceComandaStatus(cmdId, businessSlug);
      expect(r.ok && r.data.status).toBe("en_preparacion");

      r = await advanceComandaStatus(cmdId, businessSlug);
      expect(r.ok && r.data.status).toBe("entregado");
      CURRENT_AUTH_USER_ID = TEST_USER_ID;

      const { data: delivered } = await supabase
        .from("comandas")
        .select("delivered_at, status")
        .eq("id", cmdId)
        .single();
      expect(delivered!.delivered_at).not.toBeNull();
      expect(delivered!.status).toBe("entregado");

      // kitchen_status de los items espejado.
      const { data: items } = await supabase
        .from("order_items")
        .select("kitchen_status, comanda_items!inner(comanda_id)")
        .eq("comanda_items.comanda_id", cmdId);
      for (const i of items!) {
        expect(i.kitchen_status).toBe("delivered");
      }
    },
  );

  it(
    "advanceItemKitchenStatus: auto-promueve la comanda cuando todos los items quedan delivered",
    { timeout: 30_000 },
    async () => {
      const fresh = await enviarComanda({
        tableId,
        slug: businessSlug,
        items: [
          { product_id: prodFlanId, quantity: 1 },
          { product_id: prodFlanId, quantity: 1 },
        ],
      });
      expect(fresh.ok).toBe(true);
      if (!fresh.ok) return;

      const { data: cmd } = await supabase
        .from("comandas")
        .select("id, comanda_items(order_item_id)")
        .eq("order_id", fresh.data.order_id)
        .eq("station_id", stationPostresId)
        .order("batch", { ascending: false })
        .limit(1)
        .single();
      type CmdWithLinks = {
        id: string;
        comanda_items: { order_item_id: string }[];
      };
      const cmdData = cmd as unknown as CmdWithLinks;
      const itemIds = cmdData.comanda_items.map((l) => l.order_item_id);
      expect(itemIds.length).toBeGreaterThanOrEqual(2);

      // Avanzamos manualmente cada item de pending a delivered.
      for (const itemId of itemIds) {
        await advanceItemKitchenStatus(itemId, businessSlug); // pending → preparing
        await advanceItemKitchenStatus(itemId, businessSlug); // preparing → ready
        await advanceItemKitchenStatus(itemId, businessSlug); // ready → delivered
      }

      const { data: cmdAfter } = await supabase
        .from("comandas")
        .select("status, delivered_at")
        .eq("id", cmdData.id)
        .single();
      expect(cmdAfter!.status).toBe("entregado");
      expect(cmdAfter!.delivered_at).not.toBeNull();
    },
  );

  it(
    "cancelarItem por encargado: marca flag, recalcula subtotal, no rompe la comanda",
    { timeout: 30_000 },
    async () => {
      const fresh = await enviarComanda({
        tableId,
        slug: businessSlug,
        items: [
          { product_id: prodChoriId, quantity: 1 },
          { product_id: prodChoriId, quantity: 1 },
        ],
      });
      expect(fresh.ok).toBe(true);
      if (!fresh.ok) return;

      const { data: items } = await supabase
        .from("order_items")
        .select("id")
        .eq("order_id", fresh.data.order_id)
        .is("cancelled_at", null);
      const choriItem = items!.find((_, idx) => idx === 0)!;

      const before = await supabase
        .from("orders")
        .select("subtotal_cents")
        .eq("id", fresh.data.order_id)
        .single();

      // Switch al encargado: solo encargado/admin puede cancelar.
      CURRENT_AUTH_USER_ID = TEST_ENCARGADO_ID;
      const r = await cancelarItem(choriItem.id, "Sin stock", businessSlug);
      CURRENT_AUTH_USER_ID = TEST_USER_ID;
      expect(r.ok).toBe(true);

      const { data: cancelled } = await supabase
        .from("order_items")
        .select("cancelled_at, cancelled_reason, cancelled_by")
        .eq("id", choriItem.id)
        .single();
      expect(cancelled!.cancelled_at).not.toBeNull();
      expect(cancelled!.cancelled_reason).toBe("Sin stock");
      // spec 34 — se persiste el responsable de la anulación (el encargado actor).
      expect(cancelled!.cancelled_by).toBe(TEST_ENCARGADO_ID);

      const after = await supabase
        .from("orders")
        .select("subtotal_cents")
        .eq("id", fresh.data.order_id)
        .single();
      expect(Number(after.data!.subtotal_cents)).toBeLessThan(
        Number(before.data!.subtotal_cents),
      );
    },
  );

  it("cancelarItem por mozo: action falla con permiso denegado", async () => {
    const fresh = await enviarComanda({
      tableId,
      slug: businessSlug,
      items: [{ product_id: prodChoriId, quantity: 1 }],
    });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;

    const { data: items } = await supabase
      .from("order_items")
      .select("id")
      .eq("order_id", fresh.data.order_id)
      .is("cancelled_at", null)
      .limit(1);
    const target = items![0]!;

    // CURRENT_AUTH_USER_ID es TEST_USER_ID (rol mozo) por default.
    const r = await cancelarItem(target.id, "Test", businessSlug);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/encargado|admin|permis/i);

    // El item NO debe quedar cancelado.
    const { data: still } = await supabase
      .from("order_items")
      .select("cancelled_at")
      .eq("id", target.id)
      .single();
    expect(still!.cancelled_at).toBeNull();
  });

  it("rechaza enviar item con modifier_group required sin selección", async () => {
    // Creamos un grupo required sobre Milanesa: "Punto" min=1, max=1.
    const { data: group } = await supabase
      .from("modifier_groups")
      .insert({
        business_id: businessId,
        product_id: prodMilanesaId,
        name: "Punto",
        min_selection: 1,
        max_selection: 1,
        is_required: true,
        sort_order: 0,
      })
      .select("id")
      .single();
    await supabase.from("modifiers").insert([
      {
        group_id: group!.id,
        name: "Jugoso",
        price_delta_cents: 0,
        sort_order: 0,
      },
      {
        group_id: group!.id,
        name: "A punto",
        price_delta_cents: 0,
        sort_order: 1,
      },
    ]);

    const r = await enviarComanda({
      tableId,
      slug: businessSlug,
      items: [{ product_id: prodMilanesaId, quantity: 1 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Punto|elegí/i);
  });

  it("cross-tenant: enviarComanda con tableId ajeno y slug propio falla", async () => {
    const result = await enviarComanda({
      tableId: otherTableId,
      slug: businessSlug,
      items: [{ product_id: prodMilanesaId, quantity: 1 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/mesa/i);
  });

  it("cross-tenant: advanceComandaStatus con comanda ajena falla", async () => {
    const { data: someCmd } = await supabase
      .from("comandas")
      .select("id")
      .eq("station_id", stationCocinaId)
      .limit(1)
      .single();

    // Como encargado del OTRO negocio: el rol alcanza, lo que no alcanza es la
    // pertenencia de la comanda.
    CURRENT_AUTH_USER_ID = TEST_ENCARGADO_ID;
    const result = await advanceComandaStatus(someCmd!.id, otherBusinessSlug);
    CURRENT_AUTH_USER_ID = TEST_USER_ID;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no encontrada/i);
  });

  it("partial unique index: no se puede tener 2 orders open en la misma mesa", async () => {
    const { error } = await supabase.from("orders").insert({
      order_number: 0,
      business_id: businessId,
      customer_name: "Manual",
      customer_phone: "-",
      delivery_type: "dine_in",
      table_id: tableId,
      lifecycle_status: "open",
      subtotal_cents: 0,
      delivery_fee_cents: 0,
      total_cents: 0,
      payment_method: "cash",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  // Va al final a propósito: manda una comanda más y los tests de arriba
  // cuentan tandas sobre esta misma mesa.
  it("mesa que ya tenía mozo: el envío NO se la reasigna (spec 111)", async () => {
    // La asignación es del que abre la mesa. Una vez asignada sólo la mueve
    // «Transferir mozo»: si no, cualquier encargado que cargue un ítem de paso
    // se quedaría con la mesa —y con la propina— del que la está atendiendo.
    await supabase
      .from("tables")
      .update({ mozo_id: TEST_ENCARGADO_ID })
      .eq("id", tableId);

    const r = await enviarComanda({
      tableId,
      slug: businessSlug,
      items: [{ product_id: prodPapasId, quantity: 1 }],
    });
    expect(r.ok).toBe(true);

    const { data: tableRow } = await supabase
      .from("tables")
      .select("mozo_id")
      .eq("id", tableId)
      .single();
    expect(tableRow!.mozo_id).toBe(TEST_ENCARGADO_ID);
  });
});
