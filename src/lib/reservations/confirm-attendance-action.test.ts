import { beforeEach, describe, expect, it, vi } from "vitest";

// H-08 (parcial) — el token de confirmación sólo vale bajo el slug del negocio
// dueño de la reserva.

type Row = Record<string, unknown>;
const tables: Record<string, Row | null> = {};
const updates: Row[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: tables[table] ?? null }),
        update: (v: Row) => {
          updates.push(v);
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
  }),
}));

import {
  confirmReservationAttendance,
  getReservationByConfirmToken,
} from "./confirm-attendance-action";

const TOKEN = "tok-12345678";

beforeEach(() => {
  updates.length = 0;
  tables.reservations = {
    id: "r1",
    business_id: "b-demo",
    party_size: 2,
    starts_at: "2026-10-07T00:00:00.000Z",
    status: "confirmed",
    client_confirmed_at: null,
  };
  tables.businesses = {
    id: "b-demo",
    slug: "demo",
    name: "Demo",
    timezone: "America/Argentina/Buenos_Aires",
  };
});

describe("getReservationByConfirmToken — slug del negocio", () => {
  it("devuelve la reserva si el slug es el del negocio", async () => {
    const r = await getReservationByConfirmToken(TOKEN, "demo");
    expect(r?.businessName).toBe("Demo");
  });

  it("devuelve null (igual que un token inválido) si el slug es de otro negocio", async () => {
    expect(await getReservationByConfirmToken(TOKEN, "kcc")).toBeNull();
  });
});

describe("confirmReservationAttendance — slug del negocio", () => {
  it("confirma bajo el slug correcto", async () => {
    const r = await confirmReservationAttendance(TOKEN, "demo");
    expect(r).toEqual({ ok: true, alreadyConfirmed: false });
    expect(updates).toHaveLength(1);
  });

  it("bajo otro slug responde como si la reserva no existiera y no escribe", async () => {
    const r = await confirmReservationAttendance(TOKEN, "kcc");
    expect(r).toEqual({ ok: false, error: "No encontramos la reserva." });
    expect(updates).toHaveLength(0);
  });
});

describe("confirmReservationAttendance — estado de la reserva", () => {
  it("una reserva pendiente no se confirma y se explica que el local aún no la aceptó", async () => {
    tables.reservations = { ...tables.reservations!, status: "pending" };
    const r = await confirmReservationAttendance(TOKEN, "demo");
    expect(r).toEqual({
      ok: false,
      error: "El local todavía no confirmó tu reserva. Te avisamos cuando lo haga.",
    });
    expect(updates).toHaveLength(0);
  });

  it("una reserva cancelada sigue diciendo que ya no está activa", async () => {
    tables.reservations = { ...tables.reservations!, status: "cancelled" };
    const r = await confirmReservationAttendance(TOKEN, "demo");
    expect(r).toEqual({ ok: false, error: "Esta reserva ya no está activa." });
  });
});
