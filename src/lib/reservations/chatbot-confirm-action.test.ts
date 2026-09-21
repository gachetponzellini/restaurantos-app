import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría de reservas del cliente — bug #1 (notas vacías del bot).
 *
 * `CreateReservationInputSchema.notes` es `.optional()`, no `.nullable()`:
 * zod 4 rechaza `null` con "Invalid input". El cliente que confirma el link
 * del bot sin dejar notas mandaba `notes: null` y la reserva nunca se creaba.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getReservationIntentByTokenMock = vi.fn();
const consumeReservationIntentMock = vi.fn(async () => {});
vi.mock("./chatbot-actions", () => ({
  getReservationIntentByToken: (...args: unknown[]) =>
    getReservationIntentByTokenMock(...args),
  consumeReservationIntent: (...args: unknown[]) =>
    consumeReservationIntentMock(...args),
}));

const getBusinessBySlugMock = vi.fn(async () => null);
const getReservationSettingsMock = vi.fn();
vi.mock("./queries", () => ({
  getBusinessBySlug: (...args: unknown[]) => getBusinessBySlugMock(...args),
  getReservationSettings: (...args: unknown[]) =>
    getReservationSettingsMock(...args),
}));

const createReservationFromCustomerMock = vi.fn(async () => ({
  ok: true,
  data: { id: "res-1" },
}));
vi.mock("./booking-actions", () => ({
  createReservationFromCustomer: (...args: unknown[]) =>
    createReservationFromCustomerMock(...args),
}));

const { confirmReservationFromIntent } = await import("./chatbot-confirm-action");
const { CreateReservationInputSchema } = await import("./schema");

beforeEach(() => {
  vi.clearAllMocks();
  createReservationFromCustomerMock.mockResolvedValue({
    ok: true,
    data: { id: "res-1" },
  });
  getReservationIntentByTokenMock.mockResolvedValue({
    conversationId: "c1",
    businessId: "b1",
    intent: { date: "2027-01-15", slot: "20:00", party_size: 2 },
  });
});

describe("confirmReservationFromIntent · sin notas (bug #1)", () => {
  it("cliente sin notas → no reenvía notes:null, el payload pasa el schema real", async () => {
    const res = await confirmReservationFromIntent({
      business_slug: "biz-test",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
      // notes ausente, como manda la página de confirmación sin campo lleno.
    });

    expect(res.ok).toBe(true);
    expect(createReservationFromCustomerMock).toHaveBeenCalledTimes(1);
    const forwarded = createReservationFromCustomerMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(forwarded.notes).toBeUndefined();

    // El payload real que arma la action tiene que pasar el schema de
    // producción — antes del fix, `notes: null` lo rechazaba.
    const parsed = CreateReservationInputSchema.safeParse(forwarded);
    expect(parsed.success).toBe(true);
  });

  it("cliente con notas en blanco (\"   \") → tampoco manda null", async () => {
    const res = await confirmReservationFromIntent({
      business_slug: "biz-test",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
      notes: "   ",
    });

    expect(res.ok).toBe(true);
    const forwarded = createReservationFromCustomerMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(forwarded.notes).toBeUndefined();
    expect(CreateReservationInputSchema.safeParse(forwarded).success).toBe(true);
  });

  it("cliente con notas reales → las reenvía tal cual", async () => {
    await confirmReservationFromIntent({
      business_slug: "biz-test",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
      notes: "Mesa cerca de la ventana",
    });

    const forwarded = createReservationFromCustomerMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(forwarded.notes).toBe("Mesa cerca de la ventana");
    expect(CreateReservationInputSchema.safeParse(forwarded).success).toBe(true);
  });
});
