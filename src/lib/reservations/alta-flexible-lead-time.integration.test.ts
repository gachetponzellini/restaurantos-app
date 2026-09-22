// @vitest-environment node
//
// Auditoría de reservas (prioridad media) · punto 1 — el modo flexible sin
// lead time/horizonte.
//
// `createReservationCommon` (modo estricto) valida `lead_time_min` y
// `advance_days_max` para el cliente final (source !== "admin"), pero
// `createFlexibleReservation` sólo rechazaba horarios ya pasados. Un cliente
// podía reservar para dentro de 2 minutos aunque el negocio pida 60 de
// antelación, en el mismo negocio que en modo estricto sí lo hubiera
// bloqueado.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TAG = `test-leadtime-flex-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { createFlexibleReservation } = await import("./booking-actions");

describe.skipIf(!dbAvailable)("reservas · alta flexible respeta lead time del cliente", () => {
  const db = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tz = "America/Argentina/Buenos_Aires";

  /** Fecha (YYYY-MM-DD) y hora (HH:MM) "ahora" en el huso del negocio. */
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const fecha = `${parts.year}-${parts.month}-${parts.day}`;

  /** HH:MM "ahora" + minutos, sin cruzar de día (el servicio cubre 00:00-23:59). */
  function horaMasMinutos(min: number): string {
    const totalMin = Number(parts.hour) * 60 + Number(parts.minute) + min;
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  let businessId: string;
  let clienteId: string;

  beforeAll(async () => {
    const email = `${TAG}@example.test`;
    const { data: u } = await db.auth.admin.createUser({
      email, password: "test-pass-12345", email_confirm: true,
    });
    clienteId = u!.user!.id;
    CURRENT_USER_ID = clienteId;
    await db.from("users").upsert({ id: clienteId, email, full_name: "Cliente" });

    const { data: biz } = await db
      .from("businesses")
      .insert({ slug: TAG, name: "Lead Time Flex", is_active: true, timezone: tz })
      .select("id").single();
    businessId = biz!.id;
    // Mismo usuario para los dos casos: rol de encargado para poder probar
    // también el walk-in de admin (canManage).
    await db.from("business_users").insert({
      business_id: businessId, user_id: clienteId, role: "encargado", full_name: "Cliente",
    });

    // Lead time de 60 min: cualquier llegada dentro de esa ventana se rechaza.
    await db.from("reservation_settings").upsert(
      { business_id: businessId, mode: "flexible", lead_time_min: 60, advance_days_max: 30 },
      { onConflict: "business_id" },
    );

    // Servicio abierto todo el día de hoy, para no depender de la hora real.
    const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    await db.from("reservation_services").insert({
      business_id: businessId, name: "Todo el día", day_of_week: dow,
      opens_at: "00:00", closes_at: "23:59", soft_capacity: 50,
    });
    // #372 — una mesa, para que el alta web tenga dónde sentar.
    const { data: fp } = await db
      .from("floor_plans")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    await db.from("tables").insert({
      floor_plan_id: fp!.id, label: "1", seats: 4, shape: "circle",
      x: 0, y: 0, width: 80, height: 80,
    });
    // #372 — un servicio de todos los días para probar el horizonte.
    await db.from("reservation_services").insert({
      business_id: businessId, name: "Siempre", day_of_week: null,
      opens_at: "00:00", closes_at: "23:59", soft_capacity: 50,
    });
  });

  afterAll(async () => {
    if (businessId) await db.from("businesses").delete().eq("id", businessId);
    if (clienteId) {
      await db.from("users").delete().eq("id", clienteId);
      await db.auth.admin.deleteUser(clienteId);
    }
  });

  it("un cliente no puede reservar dentro del lead time (source web)", async () => {
    const r = await createFlexibleReservation({
      business_slug: TAG,
      date: fecha,
      service: "Todo el día",
      arrival_time: horaMasMinutos(15),
      party_size: 2,
      customer_name: "Cliente",
      customer_phone: "1122334455",
      source: "web",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/antelación/i);
  });

  // #372 — el calendario ofrece el día `hoy + 30` entero; el alta rechazaba
  // cualquier turno de ese día más tarde que la hora actual (N × 24 h exactas).
  it("el último día del horizonte se puede reservar a última hora; el siguiente no", async () => {
    const sumar = (ymd: string, d: number) => {
      const [y, m, dd] = ymd.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, dd + d)).toISOString().slice(0, 10);
    };
    const base = {
      business_slug: TAG,
      service: "Siempre",
      arrival_time: "23:50",
      party_size: 2,
      customer_name: "Cliente",
      source: "web" as const,
    };
    const ultimo = await createFlexibleReservation({ ...base, date: sumar(fecha, 30), customer_phone: "1122334466" });
    expect(ultimo.ok, ultimo.ok ? "" : ultimo.error).toBe(true);

    const pasado = await createFlexibleReservation({ ...base, date: sumar(fecha, 31), customer_phone: "1122334477" });
    expect(pasado.ok).toBe(false);
    if (!pasado.ok) expect(pasado.error).toMatch(/30 días/);
  });

  it("el walk-in de admin sí puede reservar dentro del lead time", async () => {
    const r = await createFlexibleReservation({
      business_slug: TAG,
      date: fecha,
      service: "Todo el día",
      arrival_time: horaMasMinutos(15),
      party_size: 2,
      customer_name: "Cliente admin",
      customer_phone: "1122334455",
      source: "admin",
      allow_overbook: true,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});
