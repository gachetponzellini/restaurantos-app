import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría de reservas del cliente — bug #1 (notas vacías del bot).
 *
 * `CreateReservationInputSchema.notes` es `.optional()`, no `.nullable()`:
 * zod 4 rechaza `null` con "Invalid input". El cliente que confirma el link
 * del bot sin dejar notas mandaba `notes: null` y la reserva nunca se creaba.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  getReservationIntentByTokenMock,
  claimReservationIntentMock,
  getBusinessBySlugMock,
  getReservationSettingsMock,
  createReservationFromCustomerMock,
} = vi.hoisted(() => ({
  getReservationIntentByTokenMock: vi.fn((_token: string) => Promise.resolve<unknown>(null)),
  claimReservationIntentMock: vi.fn((_token: string) => Promise.resolve(true)),
  getBusinessBySlugMock: vi.fn((_slug: string) => Promise.resolve<unknown>(null)),
  getReservationSettingsMock: vi.fn((_businessId: string, _opts?: unknown) =>
    Promise.resolve<unknown>(null),
  ),
  createReservationFromCustomerMock: vi.fn((_input: unknown) =>
    Promise.resolve({ ok: true as const, data: { id: "res-1" } }),
  ),
}));

vi.mock("./chatbot-actions", () => ({
  getReservationIntentByToken: getReservationIntentByTokenMock,
  claimReservationIntent: claimReservationIntentMock,
}));

vi.mock("./queries", () => ({
  getBusinessBySlug: getBusinessBySlugMock,
  getReservationSettings: getReservationSettingsMock,
}));

vi.mock("./booking-actions", () => ({
  createReservationFromCustomer: createReservationFromCustomerMock,
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
  claimReservationIntentMock.mockResolvedValue(true);
  // El negocio del link es el del intent (auditoría de reservas · baja).
  getBusinessBySlugMock.mockResolvedValue({ id: "b1" });
  getReservationSettingsMock.mockResolvedValue({ mode: "estricto" });
});

describe("confirmReservationFromIntent · negocio del link (auditoría · baja)", () => {
  it("un token de OTRO negocio no crea la reserva", async () => {
    getBusinessBySlugMock.mockResolvedValue({ id: "otro-negocio" });
    const res = await confirmReservationFromIntent({
      business_slug: "otro-slug",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
    });
    expect(res.ok).toBe(false);
    expect(claimReservationIntentMock).not.toHaveBeenCalled();
    expect(createReservationFromCustomerMock).not.toHaveBeenCalled();
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

describe("confirmReservationFromIntent · consumo atómico del intent (bug #2)", () => {
  it("pierde la carrera del claim → no crea la reserva y avisa 'ya fue usado'", async () => {
    claimReservationIntentMock.mockResolvedValue(false);

    const res = await confirmReservationFromIntent({
      business_slug: "biz-test",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ya fue usado");
    expect(claimReservationIntentMock).toHaveBeenCalledWith("abcd12345678");
    // La garantía central del fix: sin claim ganado, jamás se llega a crear.
    expect(createReservationFromCustomerMock).not.toHaveBeenCalled();
  });

  it("gana el claim → crea la reserva normalmente", async () => {
    const res = await confirmReservationFromIntent({
      business_slug: "biz-test",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
    });

    expect(res.ok).toBe(true);
    expect(claimReservationIntentMock).toHaveBeenCalledWith("abcd12345678");
    expect(createReservationFromCustomerMock).toHaveBeenCalledTimes(1);
  });

  it("el claim se intenta DESPUÉS de leer el intent pero ANTES de crear la reserva", async () => {
    const order: string[] = [];
    getReservationIntentByTokenMock.mockImplementation(async () => {
      order.push("read-intent");
      return {
        conversationId: "c1",
        businessId: "b1",
        intent: { date: "2027-01-15", slot: "20:00", party_size: 2 },
      };
    });
    claimReservationIntentMock.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    createReservationFromCustomerMock.mockImplementation(async () => {
      order.push("create");
      return { ok: true, data: { id: "res-1" } };
    });

    await confirmReservationFromIntent({
      business_slug: "biz-test",
      token: "abcd12345678",
      customer_name: "Ana",
      customer_phone: "+5491100000000",
    });

    expect(order).toEqual(["read-intent", "claim", "create"]);
  });
});
