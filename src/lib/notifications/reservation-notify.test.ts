import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría de reservas del cliente (bug #4) — con `customer_channel: 'whatsapp'`
 * y sin forma real de mandarlo (sin credenciales, o sin template para el
 * evento), el aviso tiene que caer a email si el cliente lo tiene. Antes del
 * fix, `dispatchCustomerMessage` sólo intentaba el canal configurado y el
 * cliente se quedaba sin NINGÚN aviso.
 */

let reservationRow: Record<string, unknown> | null = null;
let businessRow: Record<string, unknown> | null = null;
let templateRow: Record<string, unknown> | null = null;
let whatsappConnected = false;
let channelFromDb: "whatsapp" | "email" | "both" = "whatsapp";

function tableData(table: string): unknown {
  if (table === "reservations") return reservationRow;
  if (table === "businesses") return businessRow;
  if (table === "reservation_message_templates") return templateRow;
  return null;
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      const data = tableData(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("./whatsapp-sender", () => ({
  isWhatsappConnected: vi.fn(async () => whatsappConnected),
}));

vi.mock("./customer-dispatch", () => ({
  resolveCustomerChannel: vi.fn(async () => channelFromDb),
  dispatchCustomerMessage: vi.fn(async () => {}),
}));

const { dispatchCustomerMessage } = await import("./customer-dispatch");
const {
  notifyReservationConfirmed,
  notifyReservationRequested,
  notifyReservationReminder,
} = await import("./reservation-notify");

function baseReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    business_id: "biz-1",
    customer_name: "Ana",
    customer_email: "ana@example.com",
    customer_phone: "+5491100000000",
    party_size: 2,
    starts_at: new Date().toISOString(),
    status: "confirmed",
    confirm_token: "tok-1",
    ...overrides,
  };
}

function baseBusiness(overrides: Record<string, unknown> = {}) {
  return {
    name: "Golf House",
    slug: "golf-house",
    timezone: "America/Argentina/Buenos_Aires",
    logo_url: null,
    address: null,
    phone: null,
    settings: {},
    ...overrides,
  };
}

beforeEach(() => {
  reservationRow = baseReservation();
  businessRow = baseBusiness();
  templateRow = null; // sin template de WhatsApp cargado para el evento
  whatsappConnected = false;
  channelFromDb = "whatsapp";
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyReservationConfirmed · fallback WhatsApp → email (bug #4)", () => {
  it("canal whatsapp sin template ni credenciales, con email → despacha por email", async () => {
    await notifyReservationConfirmed({ reservationId: "res-1" });

    expect(dispatchCustomerMessage).toHaveBeenCalledTimes(1);
    const call = (dispatchCustomerMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.channel).toBe("email");
  });

  it("canal whatsapp sin template ni credenciales, SIN email → no hay a dónde caer, mantiene whatsapp", async () => {
    reservationRow = baseReservation({ customer_email: null });

    await notifyReservationConfirmed({ reservationId: "res-1" });

    expect(dispatchCustomerMessage).toHaveBeenCalledTimes(1);
    const call = (dispatchCustomerMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.channel).toBe("whatsapp");
  });

  it("canal whatsapp CONECTADO y con template → no hace fallback, manda por whatsapp", async () => {
    whatsappConnected = true;
    templateRow = {
      body: "Hola {cliente}",
      enabled: true,
      template_name: "reserva_confirmada",
      template_lang: "es_AR",
    };

    await notifyReservationConfirmed({ reservationId: "res-1" });

    const call = (dispatchCustomerMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.channel).toBe("whatsapp");
  });

  it("canal email → no toca whatsapp, se manda tal cual", async () => {
    channelFromDb = "email";

    await notifyReservationConfirmed({ reservationId: "res-1" });

    const call = (dispatchCustomerMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.channel).toBe("email");
  });
});

describe("notifyReservationRequested · mismo fallback", () => {
  it("canal whatsapp no deliverable, con email → cae a email", async () => {
    await notifyReservationRequested({ reservationId: "res-1" });

    const call = (dispatchCustomerMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.channel).toBe("email");
  });
});

describe("notifyReservationReminder · el recordatorio no tiene WhatsApp propio", () => {
  it("canal whatsapp, con email → antes se quedaba sin aviso; ahora cae a email", async () => {
    await notifyReservationReminder({ reservationId: "res-1" });

    expect(dispatchCustomerMessage).toHaveBeenCalledTimes(1);
    const call = (dispatchCustomerMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.channel).toBe("email");
  });
});
