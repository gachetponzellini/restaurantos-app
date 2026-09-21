// Auditoría de pedidos · baja — la vista previa de cupones tiene techo por IP
// (sin él se podían probar códigos por fuerza bruta).
import { describe, expect, it, vi } from "vitest";

const validatePromoCode = vi.fn();
vi.mock("./validate", () => ({ validatePromoCode: (...a: unknown[]) => validatePromoCode(...(a as [])) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }) }));
vi.mock("@/lib/rate-limit", () => ({ limitCreateOrder: async () => ({ success: false }) }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));

const { previewPromoCode } = await import("./preview-action");

describe("previewPromoCode · rate-limit", () => {
  it("con el techo alcanzado, ni consulta el código", async () => {
    const r = await previewPromoCode({ business_slug: "kcc", code: "PRUEBA", subtotal_cents: 1000, delivery_fee_cents: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Demasiados intentos/);
    expect(validatePromoCode).not.toHaveBeenCalled();
  });
});
