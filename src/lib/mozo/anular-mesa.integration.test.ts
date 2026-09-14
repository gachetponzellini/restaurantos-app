// @vitest-environment node
//
// Spec 049 (fix) — Anular una mesa también anula sus comandas ACTIVAS:
// cancela los ítems vivos + marca la comanda anulada + encola la reimpresión
// del ticket "ANULADA" para que cocina se entere. Las comandas ya ENTREGADAS
// se respetan (la comida ya salió; la orden cancelada ya garantiza no-cobro).
// Integración contra la DB cloud real (mismo harness que traslado.integration).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-anular-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const { anularMesa } = await import("./actions");

describe.skipIf(!dbAvailable)(
  "anular mesa · anula sus comandas (integration · spec 049 fix)",
  () => {
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

    /** Comanda con un order_item vivo, linkeados via comanda_items. */
    const seedComanda = async (
      orderId: string,
      status: "pendiente" | "entregado",
    ): Promise<{ comandaId: string; orderItemId: string }> => {
      const { data: item } = await supabase
        .from("order_items")
        .insert({
          order_id: orderId,
          product_name: "Milanesa",
          unit_price_cents: 1000,
          quantity: 1,
          subtotal_cents: 1000,
          station_id: stationId,
          kitchen_status: status === "entregado" ? "delivered" : "pending",
        })
        .select("id")
        .single();
      const orderItemId = item!.id as string;

      const { data: comanda } = await supabase
        .from("comandas")
        .insert({
          order_id: orderId,
          station_id: stationId,
          batch: 1,
          status,
          delivered_at: status === "entregado" ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      const comandaId = comanda!.id as string;

      await supabase
        .from("comanda_items")
        .insert({ comanda_id: comandaId, order_item_id: orderItemId });
      return { comandaId, orderItemId };
    };

    beforeAll(async () => {
      encargadoId = await seedUser("Encargado");
      mozoId = await seedUser("Mozo");

      const { data: biz } = await supabase
        .from("businesses")
        .insert({ slug: TEST_TAG, name: "Anular Test", is_active: true })
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

    it("anula la comanda pendiente: cancela ítems + comanda + encola reimpresión ANULADA + libera mesa", async () => {
      CURRENT_USER_ID = encargadoId;
      const tableId = await seedTable();
      const orderId = await seedOrder(tableId);
      const { comandaId, orderItemId } = await seedComanda(orderId, "pendiente");

      const res = await anularMesa(tableId, "cliente se fue", businessSlug);
      expect(res.ok).toBe(true);

      const { data: order } = await supabase
        .from("orders")
        .select("lifecycle_status")
        .eq("id", orderId)
        .single();
      expect(order!.lifecycle_status).toBe("cancelled");

      const { data: comanda } = await supabase
        .from("comandas")
        .select("cancelled_at, cancelled_reason, reprint_requested_at, status")
        .eq("id", comandaId)
        .single();
      expect(comanda!.cancelled_at).not.toBeNull();
      expect(comanda!.reprint_requested_at).not.toBeNull();
      expect(comanda!.cancelled_reason).toBe("cliente se fue");

      const { data: item } = await supabase
        .from("order_items")
        .select("cancelled_at, cancelled_reason")
        .eq("id", orderItemId)
        .single();
      expect(item!.cancelled_at).not.toBeNull();
      expect(item!.cancelled_reason).toBe("cliente se fue");

      const { data: table } = await supabase
        .from("tables")
        .select("operational_status, current_order_id")
        .eq("id", tableId)
        .single();
      expect(table!.operational_status).toBe("libre");
      expect(table!.current_order_id).toBeNull();
    }, 30_000);

    it("respeta la comanda ya ENTREGADA: no la re-anula ni la reencola a imprimir", async () => {
      CURRENT_USER_ID = encargadoId;
      const tableId = await seedTable();
      const orderId = await seedOrder(tableId);
      const { comandaId } = await seedComanda(orderId, "entregado");

      const res = await anularMesa(tableId, "error de carga", businessSlug);
      expect(res.ok).toBe(true);

      const { data: comanda } = await supabase
        .from("comandas")
        .select("cancelled_at, reprint_requested_at, status")
        .eq("id", comandaId)
        .single();
      expect(comanda!.status).toBe("entregado");
      expect(comanda!.cancelled_at).toBeNull();
      expect(comanda!.reprint_requested_at).toBeNull();

      // La orden igual queda cancelada (anulación sin cobro).
      const { data: order } = await supabase
        .from("orders")
        .select("lifecycle_status")
        .eq("id", orderId)
        .single();
      expect(order!.lifecycle_status).toBe("cancelled");
    }, 30_000);

    // ── issue #296 · la mesa sin cuenta también se cierra ─────────────────
    //
    // Mesa ocupada a la que no se le cargó nada: cerrarla es deshacer un click
    // (spec 071, por eso no se pide motivo). El corte de la spec 096 · H-30
    // estaba escrito contra la *cuenta* en vez de contra el *estado*, así que
    // esta mesa devolvía «La mesa no tiene una cuenta abierta para anular» y
    // quedaba trabada: el plano no ofrece ninguna otra salida.
    it("mesa ocupada sin cuenta abierta: la libera igual, sin pedir motivo", async () => {
      CURRENT_USER_ID = encargadoId;
      const tableId = await seedTable();

      const res = await anularMesa(tableId, "", businessSlug);
      expect(res.ok).toBe(true);

      const { data: table } = await supabase
        .from("tables")
        .select("operational_status, opened_at, current_order_id")
        .eq("id", tableId)
        .single();
      expect(table!.operational_status).toBe("libre");
      expect(table!.opened_at).toBeNull();
      expect(table!.current_order_id).toBeNull();

      // Con su rastro: quién la cerró y el motivo que pone el sistema.
      const { data: audit } = await supabase
        .from("tables_audit_log")
        .select("to_value, reason")
        .eq("table_id", tableId)
        .eq("kind", "status");
      expect(audit).toHaveLength(1);
      expect(audit![0]!.to_value).toBe("libre");
      expect(audit![0]!.reason).toBe("Mesa sin consumo");
    }, 30_000);

    // Lo mismo desde `pidio_cuenta`: el permiso ya lo habilita y el cliente que
    // pidió la cuenta y se fue sin consumir no tiene por qué dejar la mesa presa.
    it("mesa en pidio_cuenta sin cuenta abierta: también se libera", async () => {
      CURRENT_USER_ID = encargadoId;
      const tableId = await seedTable();
      await supabase
        .from("tables")
        .update({ operational_status: "pidio_cuenta" })
        .eq("id", tableId);

      const res = await anularMesa(tableId, "", businessSlug);
      expect(res.ok).toBe(true);

      const { data: table } = await supabase
        .from("tables")
        .select("operational_status")
        .eq("id", tableId)
        .single();
      expect(table!.operational_status).toBe("libre");
    }, 30_000);

    // El caso que H-30 sí tenía que atajar: la mesa ya está libre (el mozo la
    // cobró un segundo antes). Ahí no hay nada que anular, y lo que dolía era
    // el falso «Mesa anulada.» con su audit y su notificación al mozo.
    it("mesa ya libre: no anula ni deja rastro", async () => {
      CURRENT_USER_ID = encargadoId;
      const tableId = await seedTable();
      await supabase
        .from("tables")
        .update({ operational_status: "libre", opened_at: null })
        .eq("id", tableId);

      const res = await anularMesa(tableId, "", businessSlug);
      expect(res.ok).toBe(false);

      const { data: audit } = await supabase
        .from("tables_audit_log")
        .select("id")
        .eq("table_id", tableId);
      expect(audit ?? []).toHaveLength(0);
    }, 30_000);
  },
);
