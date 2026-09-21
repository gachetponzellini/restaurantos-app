// @vitest-environment node
//
// Spec 048 — Trasladar una mesa completa a otra mesa (Fase 1: destino libre).
// Integración contra la DB cloud real (mismo harness que asignacion.integration).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-traslado-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const { trasladarMesa } = await import("./actions");
const { closeOrderIfFullyPaid } = await import("@/lib/billing/cobro-actions");

describe.skipIf(!dbAvailable)("traslado de mesa (integration · spec 048)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let floorPlanId: string;
  let cajaId: string;
  let otherBusinessId: string;
  let otherTableId: string;

  let encargadoId = "";
  let mozoAId = "";

  let tableSeq = 0;

  const seedUser = async (label: string, role: string) => {
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

  const seedTable = async (
    opts: {
      status?: "libre" | "ocupada" | "pidio_cuenta";
      isBar?: boolean;
      mozoId?: string | null;
      openedAt?: string | null;
      currentOrderId?: string | null;
      floorPlan?: string;
    } = {},
  ): Promise<string> => {
    tableSeq += 1;
    const { data } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: opts.floorPlan ?? floorPlanId,
        label: `T${tableSeq}`,
        seats: 4,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        operational_status: opts.status ?? "libre",
        opened_at: opts.openedAt ?? null,
        mozo_id: opts.mozoId ?? null,
        current_order_id: opts.currentOrderId ?? null,
        is_bar: opts.isBar ?? false,
      })
      .select("id")
      .single();
    return data!.id as string;
  };

  const seedOrder = async (
    tableId: string,
    opts: { billRequested?: boolean; totalCents?: number; mozoId?: string | null } = {},
  ): Promise<string> => {
    const total = opts.totalCents ?? 1000;
    const { data } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Mesa test",
        customer_phone: "-",
        delivery_type: "dine_in",
        table_id: tableId,
        mozo_id: opts.mozoId ?? mozoAId,
        lifecycle_status: "open",
        subtotal_cents: total,
        delivery_fee_cents: 0,
        total_cents: total,
        payment_method: "cash",
        bill_requested_at: opts.billRequested ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    const orderId = data!.id as string;
    await supabase.from("tables").update({ current_order_id: orderId }).eq("id", tableId);
    return orderId;
  };

  /** Mesa ocupada con orden abierta lista para trasladar. */
  const seedOccupied = async (
    opts: { billRequested?: boolean; openedAt?: string; totalCents?: number } = {},
  ) => {
    const openedAt = opts.openedAt ?? new Date(Date.now() - 30 * 60_000).toISOString();
    const tableId = await seedTable({
      status: opts.billRequested ? "pidio_cuenta" : "ocupada",
      mozoId: mozoAId,
      openedAt,
    });
    const orderId = await seedOrder(tableId, {
      billRequested: opts.billRequested,
      totalCents: opts.totalCents,
    });
    return { tableId, orderId, openedAt };
  };

  beforeAll(async () => {
    encargadoId = await seedUser("Encargado", "encargado");
    mozoAId = await seedUser("MozoA", "mozo");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Traslado Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    const { data: other } = await supabase
      .from("businesses")
      .insert({ slug: `${TEST_TAG}-other`, name: "Otro", is_active: true })
      .select("id")
      .single();
    otherBusinessId = other!.id;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
      { business_id: businessId, user_id: mozoAId, role: "mozo", full_name: "MozoA" },
    ]);

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    floorPlanId = fp!.id;

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    cajaId = caja!.id;

    const { data: otherFp } = await supabase
      .from("floor_plans")
      .insert({ business_id: otherBusinessId, name: "Salón B" })
      .select("id")
      .single();
    const { data: otherTable } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: otherFp!.id,
        label: "Z",
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
  });

  afterAll(async () => {
    if (businessId) {
      await supabase
        .from("businesses")
        .delete()
        .in("id", [businessId, otherBusinessId].filter(Boolean));
    }
    for (const id of [encargadoId, mozoAId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("ruta feliz: mueve la orden A→B libre, limpia A, ocupa B heredando opened_at y mozo", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A, orderId, openedAt } = await seedOccupied();
    const B = await seedTable({ status: "libre" });

    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(true);

    const { data: order } = await supabase
      .from("orders")
      .select("table_id")
      .eq("id", orderId)
      .single();
    expect(order!.table_id).toBe(B);

    const { data: tA } = await supabase
      .from("tables")
      .select("operational_status, current_order_id, opened_at, mozo_id")
      .eq("id", A)
      .single();
    expect(tA!.operational_status).toBe("libre");
    expect(tA!.current_order_id).toBeNull();
    expect(tA!.opened_at).toBeNull();
    expect(tA!.mozo_id).toBeNull();

    const { data: tB } = await supabase
      .from("tables")
      .select("operational_status, current_order_id, opened_at, mozo_id")
      .eq("id", B)
      .single();
    expect(tB!.operational_status).toBe("ocupada");
    expect(tB!.current_order_id).toBe(orderId);
    // opened_at se hereda de A (mismo instante; el formato de string difiere
    // entre el toISOString del seed y el de PostgREST, comparamos el instante).
    expect(new Date(tB!.opened_at!).getTime()).toBe(new Date(openedAt).getTime());
    expect(tB!.mozo_id).toBe(mozoAId);

    const { data: audit } = await supabase
      .from("tables_audit_log")
      .select("table_id, kind, from_value, to_value")
      .eq("kind", "move")
      .in("table_id", [A, B]);
    expect(audit).toHaveLength(2);
    for (const row of audit!) {
      expect(row.from_value).toBe(A);
      expect(row.to_value).toBe(B);
    }
  });

  it("contenido y plata intactos: order_items y payment siguen por order_id, total sin cambios", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A, orderId } = await seedOccupied({ totalCents: 5000 });
    const B = await seedTable({ status: "libre" });

    await supabase.from("order_items").insert({
      order_id: orderId,
      product_name: "Milanesa",
      unit_price_cents: 5000,
      quantity: 1,
      subtotal_cents: 5000,
    });
    await supabase.from("payments").insert({
      order_id: orderId,
      business_id: businessId,
      caja_id: cajaId,
      method: "cash",
      amount_cents: 2000,
      payment_status: "paid",
    });

    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(true);

    const { count: itemCount } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    expect(itemCount).toBe(1);

    const { data: pays } = await supabase
      .from("payments")
      .select("amount_cents, caja_id")
      .eq("order_id", orderId);
    expect(pays).toHaveLength(1);
    expect(pays![0].amount_cents).toBe(2000);
    expect(pays![0].caja_id).toBe(cajaId);

    const { data: order } = await supabase
      .from("orders")
      .select("total_cents, total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(order!.total_cents).toBe(5000);
  });

  it("la cuenta ya pedida viaja: A en pidio_cuenta → B queda pidio_cuenta", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A, orderId } = await seedOccupied({ billRequested: true });
    const B = await seedTable({ status: "libre" });

    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(true);

    const { data: tB } = await supabase
      .from("tables")
      .select("operational_status")
      .eq("id", B)
      .single();
    expect(tB!.operational_status).toBe("pidio_cuenta");

    const { data: order } = await supabase
      .from("orders")
      .select("bill_requested_at")
      .eq("id", orderId)
      .single();
    expect(order!.bill_requested_at).not.toBeNull();
  });

  it("destino a barra libre (is_bar) → permitido", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A, orderId } = await seedOccupied();
    const bar = await seedTable({ status: "libre", isBar: true });

    const res = await trasladarMesa(A, bar, businessSlug);
    expect(res.ok).toBe(true);
    const { data: order } = await supabase
      .from("orders")
      .select("table_id")
      .eq("id", orderId)
      .single();
    expect(order!.table_id).toBe(bar);
  });

  it("destino OCUPADO → DESTINATION_OCCUPIED, cero cambios de estado", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A, orderId: orderA } = await seedOccupied();
    const { tableId: B, orderId: orderB } = await seedOccupied();

    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ocupada/i);

    // Nada cambió: cada orden sigue en su mesa.
    const { data: oa } = await supabase.from("orders").select("table_id").eq("id", orderA).single();
    const { data: ob } = await supabase.from("orders").select("table_id").eq("id", orderB).single();
    expect(oa!.table_id).toBe(A);
    expect(ob!.table_id).toBe(B);
  });

  it("destino ocupada SIN cuenta abierta (recién sentados) → DESTINATION_OCCUPIED (#148 · H-53)", async () => {
    // La RPC sólo miraba si el destino tenía orden abierta; una mesa ocupada
    // que todavía no cargó nada pasaba, y el traslado le pisaba el estado,
    // el mozo y el opened_at al grupo que ya estaba sentado ahí.
    CURRENT_USER_ID = encargadoId;
    const { tableId: A, orderId: orderA } = await seedOccupied();
    const B = await seedTable({ status: "ocupada", mozoId: mozoAId, openedAt: new Date().toISOString() });

    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ocupada/i);

    const { data: oa } = await supabase.from("orders").select("table_id").eq("id", orderA).single();
    const { data: tb } = await supabase.from("tables").select("operational_status, current_order_id").eq("id", B).single();
    expect(oa!.table_id).toBe(A);
    expect(tb).toEqual({ operational_status: "ocupada", current_order_id: null });
  });

  it("misma mesa (A===A) → error", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A } = await seedOccupied();
    const res = await trasladarMesa(A, A, businessSlug);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/distinta/i);
  });

  it("mesa origen sin cuenta abierta → error", async () => {
    CURRENT_USER_ID = encargadoId;
    const A = await seedTable({ status: "libre" });
    const B = await seedTable({ status: "libre" });
    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cuenta abierta/i);
  });

  it("mozo no puede trasladar (solo encargado/admin)", async () => {
    CURRENT_USER_ID = mozoAId;
    const { tableId: A } = await seedOccupied();
    const B = await seedTable({ status: "libre" });
    const res = await trasladarMesa(A, B, businessSlug);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/encargado|admin/i);
  });

  it("cross-tenant: destino de otro negocio → error", async () => {
    CURRENT_USER_ID = encargadoId;
    const { tableId: A } = await seedOccupied();
    const res = await trasladarMesa(A, otherTableId, businessSlug);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no encontrada/i);
  });

  // Co-requisito crítico (FR-009): closeOrderIfFullyPaid libera la mesa dueña
  // ACTUAL de la orden (current_order_id), no order.table_id stale. Simulamos el
  // estado que deja un traslado concurrente: la orden apunta (stale) a A, pero
  // quien la posee es B. Sin el fix, se liberaría A y B quedaría "ocupada"
  // apuntando a una orden ya cerrada = mesa fantasma.
  it("co-requisito: cobro cierra la mesa dueña actual (current_order_id), no la stale", async () => {
    CURRENT_USER_ID = encargadoId;
    // Orden totalmente paga.
    const A = await seedTable({ status: "libre" }); // ya vaciada por el "move"
    const B = await seedTable({ status: "ocupada", mozoId: mozoAId, openedAt: new Date().toISOString() });
    const orderId = await seedOrder(A, { totalCents: 1000 }); // order.table_id = A (stale)
    // Simular el post-move: B es la dueña real, A quedó libre sin puntero.
    await supabase.from("tables").update({ current_order_id: null, operational_status: "libre" }).eq("id", A);
    await supabase.from("tables").update({ current_order_id: orderId, operational_status: "ocupada" }).eq("id", B);
    await supabase.from("payments").insert({
      order_id: orderId,
      business_id: businessId,
      caja_id: cajaId,
      method: "cash",
      amount_cents: 1000,
      payment_status: "paid",
    });

    const service = supabase as unknown as Parameters<typeof closeOrderIfFullyPaid>[0];
    const { orderClosed } = await closeOrderIfFullyPaid(service, orderId, businessSlug);
    expect(orderClosed).toBe(true);

    // B (dueña real) queda libre; A no se toca; ninguna mesa ocupada apunta a la
    // orden cerrada.
    const { data: tB } = await supabase
      .from("tables")
      .select("operational_status, current_order_id")
      .eq("id", B)
      .single();
    expect(tB!.operational_status).toBe("libre");
    expect(tB!.current_order_id).toBeNull();

    const { data: ghosts } = await supabase
      .from("tables")
      .select("id")
      .eq("current_order_id", orderId);
    expect(ghosts ?? []).toHaveLength(0);
  });

  it.skipIf(!anonKey)(
    "seguridad: RPC trasladar_mesa_tx no es invocable por rol authenticated (REVOKE)",
    async () => {
      const anon = createClient(supabaseUrl!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await anon.rpc("trasladar_mesa_tx", {
        p_business_id: businessId,
        p_from_table_id: otherTableId,
        p_to_table_id: otherTableId,
        p_expected_order_id: businessId,
        p_actor_user_id: encargadoId,
        p_reason: null,
      });
      expect(error).not.toBeNull();
    },
  );
});
