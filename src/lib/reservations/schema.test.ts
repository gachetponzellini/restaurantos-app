import { describe, expect, it } from "vitest";

import {
  AvailabilityQuerySchema,
  CreateFlexibleReservationInputSchema,
  CreateReservationInputSchema,
} from "@/lib/reservations/schema";

// H-20 — los mensajes de Zod que ve el cliente van en español.
const base = {
  business_slug: "demo",
  date: "2026-10-07",
  slot: "21:00",
  party_size: 2,
  customer_name: "Ana",
  customer_phone: "1112345678",
};

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : (result.error?.issues[0]?.message ?? null);
}

describe("CreateReservationInputSchema — mensajes en español (H-20)", () => {
  it("acepta un input válido", () => {
    expect(CreateReservationInputSchema.safeParse(base).success).toBe(true);
  });

  it("party_size 0", () => {
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, party_size: 0 }))).toBe(
      "Tiene que ser al menos 1 persona.",
    );
  });

  it("party_size > 100", () => {
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, party_size: 101 }))).toBe(
      "Máximo 100 personas por reserva.",
    );
  });

  it("party_size no numérico", () => {
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, party_size: "abc" }))).toBe(
      "Indicá cuántas personas son.",
    );
  });

  it("date y slot inválidos", () => {
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, date: "7/10" }))).toBe(
      "Elegí una fecha válida.",
    );
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, slot: "9pm" }))).toBe(
      "Elegí un horario válido.",
    );
  });

  it("nombre vacío y teléfono corto", () => {
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, customer_name: " " }))).toBe(
      "Ingresá tu nombre.",
    );
    expect(firstMessage(CreateReservationInputSchema.safeParse({ ...base, customer_phone: "12" }))).toBe(
      "Ingresá un teléfono válido.",
    );
  });

  it("notas demasiado largas", () => {
    expect(
      firstMessage(CreateReservationInputSchema.safeParse({ ...base, notes: "x".repeat(501) })),
    ).toBe("Las notas pueden tener hasta 500 caracteres.");
  });

  it("campos ausentes no devuelven «expected string»", () => {
    const r = CreateReservationInputSchema.safeParse({ business_slug: "demo" });
    expect(r.success).toBe(false);
    if (!r.success) {
      for (const i of r.error.issues) expect(i.message).not.toMatch(/expected|Invalid input/i);
    }
  });
});

describe("CreateFlexibleReservationInputSchema / AvailabilityQuerySchema — español (H-20)", () => {
  it("flexible: party_size 0 y nombre vacío", () => {
    const r = CreateFlexibleReservationInputSchema.safeParse({
      business_slug: "demo",
      date: "2026-10-07",
      service: "Cena",
      arrival_time: "21:00",
      party_size: 0,
      customer_name: "",
      customer_phone: "1112345678",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain("Tiene que ser al menos 1 persona.");
      expect(msgs).toContain("Ingresá tu nombre.");
    }
  });

  it("disponibilidad: party_size 0", () => {
    expect(
      firstMessage(
        AvailabilityQuerySchema.safeParse({ business_slug: "demo", date: "2026-10-07", party_size: 0 }),
      ),
    ).toBe("Tiene que ser al menos 1 persona.");
  });
});
