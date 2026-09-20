// @vitest-environment node
//
// P11 · issue #264 — el período de la rendición tiene techo.
//
// `getRendicionPendienteMozo` tenía piso (la última rendición) pero **no
// techo**, y la fila se insertaba con el `now()` del server. Entre la lectura y
// el insert hay un round-trip contra la base, y lo que cayera en ese hueco
// quedaba huérfano: no lo cubría esta rendición —se leyó antes— ni la
// siguiente, cuyo piso es el `created_at` de esta fila.
//
// Sin techo la falla tiene además una segunda cara, que es la que se testea acá
// porque es determinista: un pago con `created_at` POSTERIOR al corte se contaba
// en esta rendición **y** volvía a contarse en la próxima.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-ventana-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

const { registrarRendicionMozo } = await import("./actions");
const { getRendicionPendienteMozo } = await import("./queries");

describe.skipIf(!dbAvailable)("caja · la ventana de la rendición (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ANTES = 40_000;
  const DESPUES = 12_000;

  let businessId: string;
  let businessSlug: string;
  let mozoId: string;
  let encargadoId: string;
  let cajaId: string;
  let orderId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data } = await supabase.auth.admin.createUser({
      email, password: "test-pass-12345", email_confirm: true,
    });
    const id = data!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  const cobro = async (cents: number, createdAt?: string) => {
    const { error } = await supabase.from("payments").insert({
      order_id: orderId, business_id: businessId, caja_id: cajaId,
      operated_by: mozoId, attributed_mozo_id: mozoId, method: "cash",
      amount_cents: cents, tip_cents: 0, payment_status: "paid",
      ...(createdAt ? { created_at: createdAt } : {}),
    });
    if (error) throw new Error(`cobro: ${error.message}`);
  };

  beforeAll(async () => {
    mozoId = await seedUser("Mozo");
    encargadoId = await seedUser("Encargado");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Ventana Test", is_active: true })
      .select("id, slug").single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
    ]);

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja1", is_default: true })
      .select("id").single();
    cajaId = caja!.id;

    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "dine_in", subtotal_cents: 100_000, total_cents: 100_000,
        lifecycle_status: "open",
      })
      .select("id").single();
    orderId = order!.id;
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    for (const id of [mozoId, encargadoId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it(
    "un cobro que la rendición no puede ubicar en su período la frena, y no se pierde",
    { timeout: 30_000 },
    async () => {
      // Historia: el #264 le puso un techo (la hora de Node) a la lectura, para
      // que un cobro que cayera «en la ventana» no quedara huérfano. La 0124
      // cerró el residual que eso dejaba —dependía de que Node y Postgres
      // tuvieran la misma hora—: ahora la RPC vuelve a contar bajo su lock, con
      // el reloj de la base, y si no ve los mismos cobros que la action leyó,
      // rechaza. Un cobro fechado en el futuro es la forma de forzarlo acá.
      await cobro(ANTES);
      await cobro(DESPUES, new Date(Date.now() + 60_000).toISOString());

      CURRENT_USER_ID = encargadoId;
      const r = await registrarRendicionMozo(mozoId, ANTES + DESPUES, null, businessSlug);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Entró un cobro/);

      // No se guardó una rendición a medias…
      const { count } = await supabase
        .from("mozo_rendiciones")
        .select("id", { count: "exact", head: true })
        .eq("mozo_id", mozoId);
      expect(count).toBe(0);

      // …y la plata sigue entera esperando que se rinda: no se perdió nada.
      const siguiente = await getRendicionPendienteMozo(mozoId, businessId, "Mozo");
      expect(siguiente.efectivo_cents).toBe(ANTES + DESPUES);
    },
  );
});
