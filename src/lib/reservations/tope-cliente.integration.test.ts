// @vitest-environment node
//
// Auditoría de reservas · ALTA — una cuenta no puede acaparar el cupo de un día
// con reservas pendientes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-tope-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TZ = "America/Argentina/Buenos_Aires";
const { excedeTopeDeReservas } = await import("./tope-cliente");

describe.skipIf(!dbAvailable)("tope de reservas vivas por cliente y día (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;
  let userId: string;

  const reserva = async (startsAt: string, status: string) => {
    const { error } = await supabase.from("reservations").insert({
      business_id: businessId,
      user_id: userId,
      customer_name: "Cliente",
      customer_phone: "0",
      party_size: 2,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 90 * 60_000).toISOString(),
      status,
    });
    if (error) throw error;
  };
  const excede = (fechaLocal: string) =>
    excedeTopeDeReservas(supabase as never, { businessId, userId, fechaLocal, timezone: TZ });

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Tope Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    const { data: u } = await supabase.auth.admin.createUser({
      email: `${TEST_TAG}@example.test`,
      password: "test-pass-12345",
      email_confirm: true,
    });
    userId = u!.user!.id;
    await supabase.from("users").upsert({ id: userId, email: `${TEST_TAG}@example.test` });
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    if (userId) {
      await supabase.from("users").delete().eq("id", userId);
      await supabase.auth.admin.deleteUser(userId);
    }
  });

  it("con dos vivas ese día (día local AR), la tercera no", async () => {
    await reserva("2030-03-15T16:00:00Z", "confirmed"); // 13:00 AR del 15
    expect(await excede("2030-03-15")).toBe(false);
    await reserva("2030-03-16T01:30:00Z", "pending"); // 22:30 AR del 15
    expect(await excede("2030-03-15")).toBe(true);
    // El 16 AR sigue libre aunque la de 22:30 del 15 caiga el 16 en UTC.
    expect(await excede("2030-03-16")).toBe(false);
  });

  it("las canceladas no cuentan", async () => {
    await reserva("2030-04-10T16:00:00Z", "cancelled");
    await reserva("2030-04-10T23:00:00Z", "cancelled");
    expect(await excede("2030-04-10")).toBe(false);
  });
});
