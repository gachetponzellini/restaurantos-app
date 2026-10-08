// @vitest-environment node
//
// SEC-04 (restaurantos-brain#39) — la superficie RPC que ve quien NO está logueado.
//
// La publishable key viaja en el bundle: cualquiera puede pegarle a
// `/rest/v1/rpc/<función>`. `fn_stock_reversion_item` es SECURITY DEFINER y
// devolvía stock de cualquier línea de pedido sin login (migración 0147). Acá
// se prueba con el JWT real de cada rol, no con el service role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient, type PostgrestError } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey && anonKey);

const TAG = `test-sec04-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = "test-pass-12345";
const UUID_CUALQUIERA = "00000000-0000-4000-8000-000000000000";

/** «No se puede llamar»: permiso denegado o, según el caché de PostgREST, inexistente. */
function esNoLlamable(error: PostgrestError | null) {
  return error !== null && ["42501", "PGRST202"].includes(error.code);
}

describe.skipIf(!dbAvailable)("SEC-04 · superficie RPC sin login (integration)", () => {
  const opts = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient(supabaseUrl!, serviceKey!, opts);
  const anon = createClient(supabaseUrl!, anonKey!, opts);
  const logueado = createClient(supabaseUrl!, anonKey!, opts);
  let userId = "";

  beforeAll(async () => {
    const email = `${TAG}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data?.user) throw new Error(`auth user: ${error?.message}`);
    userId = data.user.id;
    await admin.from("users").upsert({ id: userId, email, full_name: TAG });
    const signIn = await logueado.auth.signInWithPassword({ email, password: PASSWORD });
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  });

  afterAll(async () => {
    if (!userId) return;
    await admin.from("users").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  });

  const cerradasParaAnon: Array<[string, Record<string, unknown>]> = [
    ["fn_stock_reversion_item", { p_order_item_id: UUID_CUALQUIERA }],
    ["is_business_admin", { bid: UUID_CUALQUIERA }],
    ["is_business_manager", { bid: UUID_CUALQUIERA }],
    ["is_business_member", { bid: UUID_CUALQUIERA }],
    ["is_platform_admin", {}],
    ["fn_explode_ingredient", { p_ingredient_id: UUID_CUALQUIERA, p_quantity: 1 }],
    ["fn_ingredient_cost_per_unit", { p_ingredient_id: UUID_CUALQUIERA }],
    ["fn_factor_merma", { p_waste: 0 }],
    ["operating_day", { ts: "2026-10-08T12:00:00-03:00" }],
    ["normalizar_texto_insumo", { p: "Aceite" }],
    ["normalizar_nombre_proveedor", { p: "Proveedor SRL" }],
  ];

  it.each(cerradasParaAnon)("anon no puede llamar %s", async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(esNoLlamable(error), `${fn}: ${error?.code ?? "sin error"}`).toBe(true);
  });

  it("un logueado tampoco puede revertir stock a mano (sólo la disparan los triggers)", async () => {
    const { error } = await logueado.rpc("fn_stock_reversion_item", {
      p_order_item_id: UUID_CUALQUIERA,
    });
    expect(esNoLlamable(error), error?.code ?? "sin error").toBe(true);
  });

  it("un logueado sigue pudiendo evaluar is_business_member (lo usan las policies)", async () => {
    const { data, error } = await logueado.rpc("is_business_member", { bid: UUID_CUALQUIERA });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("el service role sigue normalizando (lo usa actions-client de proveedores)", async () => {
    const { data, error } = await admin.rpc("normalizar_texto_insumo", { p: "Aceite de Oliva" });
    expect(error).toBeNull();
    expect(data).toBe("aceite de oliva");
  });
});
