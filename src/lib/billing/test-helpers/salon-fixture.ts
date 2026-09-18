// Fixture de salón para tests de integración que pasan por las server actions
// (epic #361): negocio, mozo y encargado reales, plano, caja y mesas con su
// orden. Los `vi.mock` de sesión viven en cada archivo de test (vitest los
// hoistea); acá sólo se siembra.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

export const dbAvailable = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export function crearSalon(tag: string) {
  const sb: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const ctx = {
    businessId: "",
    slug: "",
    mozoId: "",
    encargadoId: "",
    cajaId: "",
    floorPlanId: "",
  };

  async function seedUser(label: string) {
    const email = `${tag}-${label}@example.test`;
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    if (error) throw error;
    const id = data.user!.id;
    await sb.from("users").upsert({ id, email, full_name: label });
    return id;
  }

  async function setup() {
    ctx.mozoId = await seedUser("Mozo");
    ctx.encargadoId = await seedUser("Encargado");
    const { data: biz, error } = await sb
      .from("businesses")
      .insert({ slug: tag, name: "Salon Test", is_active: true })
      .select("id, slug")
      .single();
    if (error) throw error;
    ctx.businessId = biz!.id;
    ctx.slug = biz!.slug;
    await sb.from("business_users").insert([
      { business_id: ctx.businessId, user_id: ctx.mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: ctx.businessId, user_id: ctx.encargadoId, role: "encargado", full_name: "Encargado" },
    ]);
    const { data: fp } = await sb
      .from("floor_plans")
      .insert({ business_id: ctx.businessId, name: "S" })
      .select("id")
      .single();
    ctx.floorPlanId = fp!.id;
    // Puede existir ya (trigger de caja por defecto): se usa la que haya.
    const { data: existente } = await sb
      .from("cajas")
      .select("id")
      .eq("business_id", ctx.businessId)
      .eq("is_administrative", false)
      .limit(1)
      .maybeSingle();
    if (existente) {
      ctx.cajaId = existente.id;
    } else {
      const { data: caja, error: cajaErr } = await sb
        .from("cajas")
        .insert({ business_id: ctx.businessId, name: "Caja1", is_default: true })
        .select("id")
        .single();
      if (cajaErr) throw cajaErr;
      ctx.cajaId = caja!.id;
    }
  }

  async function teardown() {
    if (ctx.businessId) await sb.from("businesses").delete().eq("id", ctx.businessId);
    for (const id of [ctx.mozoId, ctx.encargadoId].filter(Boolean)) {
      await sb.from("users").delete().eq("id", id);
      await sb.auth.admin.deleteUser(id);
    }
  }

  let n = 0;
  /** Mesa ocupada con una orden abierta; un ítem por monto. */
  async function mesa(montos: number[], opts: { tip?: number } = {}) {
    n += 1;
    const { data: t, error: tErr } = await sb
      .from("tables")
      .insert({
        floor_plan_id: ctx.floorPlanId,
        label: `T${n}`,
        seats: 4,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        operational_status: "pidio_cuenta",
        opened_at: new Date().toISOString(),
        mozo_id: ctx.mozoId,
      })
      .select("id")
      .single();
    if (tErr) throw tErr;
    const subtotal = montos.reduce((a, b) => a + b, 0);
    const tip = opts.tip ?? 0;
    const { data: order, error } = await sb
      .from("orders")
      .insert({
        business_id: ctx.businessId,
        customer_name: `M${n}`,
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: t!.id,
        subtotal_cents: subtotal,
        tip_cents: tip,
        total_cents: subtotal + tip,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    if (error) throw error;
    await sb.from("tables").update({ current_order_id: order!.id }).eq("id", t!.id);
    const { data: items } = await sb
      .from("order_items")
      .insert(
        montos.map((m) => ({
          order_id: order!.id,
          product_name: "Item",
          unit_price_cents: m,
          quantity: 1,
          subtotal_cents: m,
          loaded_by: ctx.mozoId,
        })),
      )
      .select("id");
    return {
      tableId: t!.id as string,
      orderId: order!.id as string,
      itemIds: ((items ?? []) as { id: string }[]).map((i) => i.id),
    };
  }

  async function orden(orderId: string) {
    const { data } = await sb
      .from("orders")
      .select("total_cents, total_paid_cents, tip_cents, lifecycle_status, payment_status, status")
      .eq("id", orderId)
      .single();
    return data as {
      total_cents: number;
      total_paid_cents: number;
      tip_cents: number;
      lifecycle_status: string;
      payment_status: string;
      status: string;
    };
  }

  async function subcuentasVivas(orderId: string) {
    const { data } = await sb
      .from("order_splits")
      .select("id, expected_amount_cents, tip_cents, paid_amount_cents, status, split_index")
      .eq("order_id", orderId)
      .neq("status", "cancelled")
      .order("split_index");
    return (data ?? []) as Array<{
      id: string;
      expected_amount_cents: number;
      tip_cents: number;
      paid_amount_cents: number;
      status: string;
    }>;
  }

  async function pagosVivos(orderId: string) {
    const { data } = await sb
      .from("payments")
      .select("id, amount_cents, tip_cents, method, created_at, attributed_mozo_id")
      .eq("order_id", orderId)
      .eq("payment_status", "paid");
    return (data ?? []) as Array<{
      id: string;
      amount_cents: number;
      tip_cents: number;
      method: string;
      created_at: string;
      attributed_mozo_id: string | null;
    }>;
  }

  return { sb, ctx, setup, teardown, mesa, orden, subcuentasVivas, pagosVivos };
}
