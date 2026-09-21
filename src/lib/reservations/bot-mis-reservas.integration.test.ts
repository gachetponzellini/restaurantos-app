// @vitest-environment node
//
// Auditoría de reservas · MEDIA — «¿tengo reserva?» desde WhatsApp.
// El bot no mostraba las pendientes y no encontraba las hechas en la web con
// el teléfono sin 549: le decía que no tenía y le ofrecía reservar otra vez.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-bot-res-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { listChatbotReservationsByPhone } = await import("./chatbot-actions");

describe.skipIf(!dbAvailable)("bot · mis reservas (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let businessId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Bot Res", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    const en = (dias: number) => new Date(Date.now() + dias * 86400_000).toISOString();
    const { error } = await supabase.from("reservations").insert([
      { business_id: businessId, customer_name: "Ana", customer_phone: "351 1234567", party_size: 2, starts_at: en(2), ends_at: en(2.1), status: "pending" },
      { business_id: businessId, customer_name: "Ana", customer_phone: "0351-1234567", party_size: 4, starts_at: en(3), ends_at: en(3.1), status: "confirmed" },
      { business_id: businessId, customer_name: "Otro", customer_phone: "351 7654321", party_size: 2, starts_at: en(2), ends_at: en(2.1), status: "confirmed" },
    ]);
    if (error) throw error;
  });
  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("desde WhatsApp (549…) ve sus reservas de la web, incluida la pendiente", async () => {
    const r = await listChatbotReservationsByPhone(businessId, "5493511234567");
    expect(r.count).toBe(2);
    expect(r.reservations.map((x) => x.status).sort()).toEqual(["confirmed", "pending"]);
  });
});
