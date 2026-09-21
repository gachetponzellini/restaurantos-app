// @vitest-environment node
//
// Auditoría de pedidos · ALTA — la identidad del cliente del checkout.
//
// El alta era un upsert por `(business_id, phone)` que le pegaba el `user_id`
// del que estaba logueado: tipear el teléfono de otro te daba su ficha (su
// historial, sus pedidos para cancelar, sus cupones). Y cambiar el propio
// teléfono chocaba con la unique `(business_id, user_id)` y no dejaba pedir.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cliente-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { resolverClienteDelPedido } = await import("./resolver-cliente");

describe.skipIf(!dbAvailable)("resolverClienteDelPedido (integration · auditoría)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  const usuarios: string[] = [];

  const usuario = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = data!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    usuarios.push(id);
    return id;
  };
  const ficha = async (id: string) => {
    const { data } = await supabase
      .from("customers")
      .select("user_id, phone, name")
      .eq("id", id)
      .single();
    return data;
  };
  const resolver = (userId: string | null, phone: string, name = "Cliente") =>
    resolverClienteDelPedido(supabase as never, {
      businessId,
      userId,
      phoneKey: phone,
      name,
      email: null,
    });

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cliente Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    for (const id of usuarios) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("tipear el teléfono de otro cliente NO te da su ficha", async () => {
    const ana = await usuario("ana");
    const intruso = await usuario("intruso");
    const r1 = await resolver(ana, "3511111111", "Ana");
    expect(r1.ok).toBe(true);

    const r2 = await resolver(intruso, "3511111111", "Intruso");
    expect(r2.ok).toBe(false);
    if (r1.ok) expect(await ficha(r1.id)).toMatchObject({ user_id: ana, name: "Ana" });
  });

  it("cambiar el propio teléfono no bloquea el pedido: se actualiza la ficha", async () => {
    const beto = await usuario("beto");
    const r1 = await resolver(beto, "3512222222");
    const r2 = await resolver(beto, "3513333333");
    expect(r2.ok && r1.ok && r2.id === r1.id).toBe(true);
    if (r2.ok) expect((await ficha(r2.id))?.phone).toBe("3513333333");
  });

  it("si el teléfono nuevo es de otra ficha, se usa la propia sin cambiarle el teléfono", async () => {
    const caro = await usuario("caro");
    const dani = await usuario("dani");
    const rCaro = await resolver(caro, "3514444444");
    await resolver(dani, "3515555555");
    const r = await resolver(caro, "3515555555");
    expect(r.ok && rCaro.ok && r.id === rCaro.id).toBe(true);
    if (r.ok) expect((await ficha(r.id))?.phone).toBe("3514444444");
  });

  it("una ficha sin cuenta (cargada por el staff) se liga al que pide con ese teléfono", async () => {
    const r0 = await resolver(null, "3516666666", "Walk-in");
    const eli = await usuario("eli");
    const r = await resolver(eli, "3516666666", "Eli");
    expect(r.ok && r0.ok && r.id === r0.id).toBe(true);
    if (r.ok) expect((await ficha(r.id))?.user_id).toBe(eli);
  });

  it("sin usuario (staff), sigue siendo por teléfono y no toca la cuenta ligada", async () => {
    const fede = await usuario("fede");
    const r1 = await resolver(fede, "3517777777");
    const r2 = await resolver(null, "3517777777", "Fede por teléfono");
    expect(r2.ok && r1.ok && r2.id === r1.id).toBe(true);
    if (r2.ok) expect((await ficha(r2.id))?.user_id).toBe(fede);
  });
});
