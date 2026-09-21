// @vitest-environment node
//
// Auditoría de reservas · baja — el cliente no cancela una reserva en la que
// ya está sentado.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cancel-res-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { cancelOwnReservation } = await import("./booking-actions");

describe.skipIf(!dbAvailable)("cancelar la reserva propia (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cancel Res", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: u } = await supabase.auth.admin.createUser({
      email: `${TEST_TAG}@example.test`, password: "test-pass-12345", email_confirm: true,
    });
    CURRENT_USER_ID = u!.user!.id;
    await supabase.from("users").upsert({ id: CURRENT_USER_ID, email: `${TEST_TAG}@example.test` });
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    if (CURRENT_USER_ID) {
      await supabase.from("users").delete().eq("id", CURRENT_USER_ID);
      await supabase.auth.admin.deleteUser(CURRENT_USER_ID);
    }
  });

  it("sentada: no se cancela", async () => {
    const inicio = new Date(Date.now() + 3 * 3600_000).toISOString();
    const { data: r } = await supabase
      .from("reservations")
      .insert({
        business_id: businessId, user_id: CURRENT_USER_ID, customer_name: "Ana", customer_phone: "0",
        party_size: 2, starts_at: inicio, ends_at: new Date(Date.now() + 5 * 3600_000).toISOString(), status: "seated",
      })
      .select("id")
      .single();
    const res = await cancelOwnReservation({ business_slug: TEST_TAG, id: r!.id });
    expect(res.ok).toBe(false);
    const { data } = await supabase.from("reservations").select("status").eq("id", r!.id).single();
    expect(data!.status).toBe("seated");
  });
});
