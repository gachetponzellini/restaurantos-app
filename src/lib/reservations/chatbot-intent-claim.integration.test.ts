// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/**
 * Auditoría de reservas del cliente (bug #2) — el doble click en el link de
 * confirmación del bot dispara dos llamadas casi simultáneas a
 * `confirmReservationFromIntent`. Antes del fix, las dos leían el mismo
 * intent (todavía no nulo) y las dos terminaban creando una reserva.
 *
 * Este test prueba la garantía a nivel DB: `claimReservationIntent` hace un
 * `UPDATE ... WHERE reservation_token = $1 AND reservation_intent IS NOT
 * NULL`, que Postgres serializa por fila. De dos llamadas concurrentes contra
 * el MISMO token, sólo una puede ganar.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-intentclaim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { claimReservationIntent, releaseReservationIntent } = await import("./chatbot-actions");

describe.skipIf(!dbAvailable)("claimReservationIntent · consumo atómico (bug #2)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId = "";

  beforeAll(async () => {
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({
        slug: TEST_TAG,
        name: "Intent Claim Test",
        is_active: true,
        timezone: "America/Argentina/Buenos_Aires",
      })
      .select("id")
      .single();
    if (bizErr || !biz) throw new Error(`business: ${bizErr?.message}`);
    businessId = biz.id;
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  // Un contacto nuevo por conversación: hay un unique constraint de "una
  // conversación abierta por contacto" que no viene al caso acá.
  const mkConversation = async (token: string) => {
    const { data: contact, error: contactErr } = await supabase
      .from("chatbot_contacts")
      .insert({
        business_id: businessId,
        channel: "web-test",
        identifier: token,
      })
      .select("id")
      .single();
    if (contactErr || !contact) throw new Error(`contact: ${contactErr?.message}`);

    const { data, error } = await supabase
      .from("chatbot_conversations")
      .insert({
        business_id: businessId,
        contact_id: contact.id,
        reservation_token: token,
        reservation_intent: {
          date: "2027-01-15",
          slot: "20:00",
          party_size: 2,
          customer_name: "Cliente Test",
          customer_phone: "+5491100000000",
        },
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`conversation: ${error?.message}`);
    return data.id as string;
  };

  it("dos llamadas concurrentes al mismo token → sólo una gana el claim", async () => {
    const token = `${TEST_TAG}-tok1`;
    await mkConversation(token);

    const [a, b] = await Promise.all([
      claimReservationIntent(token),
      claimReservationIntent(token),
    ]);

    const results = [a, b].sort();
    expect(results).toEqual([false, true]);

    // El intent quedó limpio (el ganador lo consumió; el perdedor no tocó nada).
    const { data: row } = await supabase
      .from("chatbot_conversations")
      .select("reservation_intent")
      .eq("reservation_token", token)
      .maybeSingle();
    expect(row?.reservation_intent).toBeNull();
  });

  it("token ya consumido → un tercer intento también pierde", async () => {
    const token = `${TEST_TAG}-tok2`;
    await mkConversation(token);

    const first = await claimReservationIntent(token);
    expect(first).toBe(true);

    const second = await claimReservationIntent(token);
    expect(second).toBe(false);
  });

  it("token inexistente → no explota, devuelve false", async () => {
    const claimed = await claimReservationIntent(`${TEST_TAG}-no-existe`);
    expect(claimed).toBe(false);
  });

  // Si la reserva no se pudo crear (se llenó el horario, etc.), el link no
  // puede quedar quemado: el cliente tiene que poder reintentar.
  it("si la reserva falla, el intent se libera y el link vuelve a servir", async () => {
    const token = `${TEST_TAG}-tok3`;
    await mkConversation(token);
    const intent = {
      date: "2027-01-15",
      slot: "20:00",
      party_size: 2,
      customer_name: "Cliente Test",
      customer_phone: "+5491100000000",
    };
    expect(await claimReservationIntent(token)).toBe(true);
    await releaseReservationIntent(token, intent as never);
    expect(await claimReservationIntent(token)).toBe(true);
  });
});
