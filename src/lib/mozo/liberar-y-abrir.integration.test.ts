// @vitest-environment node
//
// Issue #148 · H-47 — el walk-in nuevo no hereda la cuenta del grupo anterior.
//
// (a) Liberar una mesa cancelaba sus órdenes DESPUÉS de marcarla libre, y si la
//     cancelación no se concretaba la mesa quedaba «Libre» con la cuenta viva.
//     Ahora cancela primero y, si queda alguna abierta, no libera.
// (b) `openTable` reusaba cualquier orden `open` de la mesa: con esa cuenta
//     huérfana, el grupo nuevo arrancaba con las milanesas del anterior. Ahora
//     sólo reusa una orden vacía (idempotencia del doble tap).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-liberar-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";
/** Simula que la cancelación no se concreta (la orden sigue `open`). */
let CANCELACION_FALLA = false;

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
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/orders/cancel-order", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/cancel-order")>(
    "@/lib/orders/cancel-order",
  );
  return {
    ...actual,
    cancelarOrden: (...args: Parameters<typeof actual.cancelarOrden>) =>
      CANCELACION_FALLA
        ? Promise.resolve({ cancelled: false, itemsCancelled: 0, comandasCancelled: 0 })
        : actual.cancelarOrden(...args),
  };
});

const { updateTableOperationalStatus } = await import("./actions");
const { openTable } = await import("./open-table");

describe.skipIf(!dbAvailable)("liberar y abrir mesa · H-47 (integration)", () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;
    let businessSlug: string;
    let floorPlanId: string;
    let stationId: string;
    let encargadoId = "";
    let mozoId = "";
    let tableSeq = 0;

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

    const seedTable = async (): Promise<string> => {
      tableSeq += 1;
      const { data } = await supabase
        .from("tables")
        .insert({
          floor_plan_id: floorPlanId,
          label: `T${tableSeq}`,
          seats: 4,
          shape: "circle",
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          operational_status: "ocupada",
          opened_at: new Date(Date.now() - 20 * 60_000).toISOString(),
          mozo_id: mozoId,
        })
        .select("id")
        .single();
      return data!.id as string;
    };

    const seedOrder = async (tableId: string): Promise<string> => {
      const { data } = await supabase
        .from("orders")
        .insert({
          order_number: 0,
          business_id: businessId,
          customer_name: "Mesa test",
          customer_phone: "-",
          delivery_type: "dine_in",
          table_id: tableId,
          mozo_id: mozoId,
          lifecycle_status: "open",
          subtotal_cents: 1000,
          delivery_fee_cents: 0,
          total_cents: 1000,
          payment_method: "cash",
        })
        .select("id")
        .single();
      const orderId = data!.id as string;
      await supabase
        .from("tables")
        .update({ current_order_id: orderId })
        .eq("id", tableId);
      return orderId;
    };


    const seedItem = async (orderId: string) => {
      const { data } = await supabase
        .from("order_items")
        .insert({
          order_id: orderId,
          product_name: "Milanesa",
          unit_price_cents: 1000,
          quantity: 1,
          subtotal_cents: 1000,
          station_id: stationId,
        })
        .select("id")
        .single();
      return data!.id as string;
    };

    const estado = async (tableId: string, orderId: string) => {
      const [{ data: t }, { data: o }] = await Promise.all([
        supabase.from("tables").select("operational_status, current_order_id").eq("id", tableId).single(),
        supabase.from("orders").select("lifecycle_status").eq("id", orderId).single(),
      ]);
      return { mesa: t!.operational_status as string, cuenta: o!.lifecycle_status as string };
    };

    beforeAll(async () => {
      encargadoId = await seedUser("Encargado");
      mozoId = await seedUser("Mozo");

      const { data: biz } = await supabase
        .from("businesses")
        .insert({ slug: TEST_TAG, name: "Liberar Test", is_active: true })
        .select("id, slug")
        .single();
      businessId = biz!.id;
      businessSlug = biz!.slug;

      await supabase.from("business_users").insert([
        {
          business_id: businessId,
          user_id: encargadoId,
          role: "encargado",
          full_name: "Encargado",
        },
        {
          business_id: businessId,
          user_id: mozoId,
          role: "mozo",
          full_name: "Mozo",
        },
      ]);

      const { data: fp } = await supabase
        .from("floor_plans")
        .insert({ business_id: businessId, name: "Salón" })
        .select("id")
        .single();
      floorPlanId = fp!.id;

      const { data: station } = await supabase
        .from("stations")
        .insert({
          business_id: businessId,
          name: "Cocina",
          sort_order: 0,
          is_active: true,
        })
        .select("id")
        .single();
      stationId = station!.id;
    }, 30_000);

    afterAll(async () => {
      if (businessId) {
        await supabase.from("businesses").delete().eq("id", businessId);
      }
      for (const id of [encargadoId, mozoId].filter(Boolean)) {
        await supabase.from("users").delete().eq("id", id);
        await supabase.auth.admin.deleteUser(id);
      }
    }, 30_000);


    it("liberar cancela la cuenta abierta y deja la mesa libre", async () => {
      CURRENT_USER_ID = encargadoId;
      CANCELACION_FALLA = false;
      const tableId = await seedTable();
      const orderId = await seedOrder(tableId);
      await seedItem(orderId);

      const res = await updateTableOperationalStatus(tableId, "libre", businessSlug);
      expect(res.ok).toBe(true);
      expect(await estado(tableId, orderId)).toEqual({ mesa: "libre", cuenta: "cancelled" });
    });

    it("(a) si la cuenta no se pudo cancelar, la mesa NO queda libre", async () => {
      CURRENT_USER_ID = encargadoId;
      CANCELACION_FALLA = true;
      const tableId = await seedTable();
      const orderId = await seedOrder(tableId);
      await seedItem(orderId);

      const res = await updateTableOperationalStatus(tableId, "libre", businessSlug);
      CANCELACION_FALLA = false;
      expect(res.ok).toBe(false);
      expect(await estado(tableId, orderId)).toEqual({ mesa: "ocupada", cuenta: "open" });
    });

    const mesaLibreConHuerfana = async (conConsumo: boolean) => {
      const tableId = await seedTable();
      const orderId = await seedOrder(tableId);
      if (conConsumo) await seedItem(orderId);
      await supabase
        .from("tables")
        .update({ operational_status: "libre", opened_at: null, current_order_id: null })
        .eq("id", tableId);
      const { data: t } = await supabase
        .from("tables")
        .select("id, operational_status, opened_at, mozo_id")
        .eq("id", tableId)
        .single();
      return { table: t as { id: string; operational_status: string; opened_at: string | null; mozo_id: string | null }, orderId };
    };

    it("(b) abrir una mesa con la cuenta vieja CON consumo: no la hereda, avisa y no toca nada", async () => {
      const { table, orderId } = await mesaLibreConHuerfana(true);
      const res = await openTable({
        service: supabase as never, businessId, table, actorUserId: mozoId,
        customerName: "Grupo nuevo", customerPhone: "-", customerId: null, notes: null,
      });
      expect(res.ok).toBe(false);
      expect(await estado(table.id, orderId)).toEqual({ mesa: "libre", cuenta: "open" });
    });

    it("(b) una cuenta vacía sí se reusa (doble tap)", async () => {
      const { table, orderId } = await mesaLibreConHuerfana(false);
      const res = await openTable({
        service: supabase as never, businessId, table, actorUserId: mozoId,
        customerName: "Grupo nuevo", customerPhone: "-", customerId: null, notes: null,
      });
      expect(res.ok && res.data.orderId).toBe(orderId);
      expect(await estado(table.id, orderId)).toEqual({ mesa: "ocupada", cuenta: "open" });
    });
  },
);
