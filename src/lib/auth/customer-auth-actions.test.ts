import { beforeEach, describe, expect, it, vi } from "vitest";

// H-04 / H-05 — signInCustomer y signUpCustomer con el cliente Supabase y el
// rate limiter mockeados.

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const limitLogin = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword, signUp },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  limitLogin: (...a: unknown[]) => limitLogin(...a),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { signInCustomer, signUpCustomer } from "./customer-auth";

const signInInput = {
  business_slug: "demo",
  email: "a@b.com",
  password: "secreto123",
};
const signUpInput = { ...signInInput, phone: "11 1234-5678" };

beforeEach(() => {
  vi.clearAllMocks();
  limitLogin.mockResolvedValue({ success: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signInCustomer — H-05 rate limit", () => {
  it("bloquea con mensaje en español y no llega a Supabase", async () => {
    limitLogin.mockResolvedValue({ success: false });
    const r = await signInCustomer(signInInput);
    expect(r).toEqual({
      ok: false,
      error: "Demasiados intentos. Esperá un minuto y probá de nuevo.",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("limita por la IP del primer hop de x-forwarded-for", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    await signInCustomer(signInInput);
    expect(limitLogin).toHaveBeenCalledWith("1.2.3.4");
  });

  it("si el limiter deja pasar, sigue el flujo normal", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    const r = await signInCustomer(signInInput);
    expect(r).toEqual({ ok: false, error: "Email o contraseña incorrectos." });
  });
});

describe("signUpCustomer — H-05 rate limit", () => {
  it("bloquea con mensaje en español y no crea la cuenta", async () => {
    limitLogin.mockResolvedValue({ success: false });
    const r = await signUpCustomer(signUpInput);
    expect(r).toEqual({
      ok: false,
      error: "Demasiados intentos. Esperá un minuto y probá de nuevo.",
    });
    expect(signUp).not.toHaveBeenCalled();
  });
});

describe("signUpCustomer — H-04 Confirm email", () => {
  it("sin sesión y identities vacías → ya existe una cuenta", async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: { identities: [] } },
      error: null,
    });
    const r = await signUpCustomer(signUpInput);
    expect(r).toEqual({
      ok: false,
      error: "Ya existe una cuenta con ese email. Probá ingresar.",
    });
  });

  it("sin sesión y usuario nuevo → ok con aviso de mail de confirmación, sin redirigir", async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: { identities: [{ id: "x" }] } },
      error: null,
    });
    const r = await signUpCustomer(signUpInput);
    expect(r).toEqual({
      ok: true,
      data: { status: "confirm_email", email: "a@b.com" },
    });
  });

  it("con sesión redirige al next seguro", async () => {
    signUp.mockResolvedValue({
      data: { session: { access_token: "t" }, user: { identities: [{}] } },
      error: null,
    });
    await expect(
      signUpCustomer({ ...signUpInput, next: "/demo/reservar" }),
    ).rejects.toThrow("NEXT_REDIRECT:/demo/reservar");
  });

  it.each([
    ["email_address_invalid", "Ese email no es válido."],
    [
      "weak_password",
      "La contraseña es muy débil. Probá con una más larga o con otros caracteres.",
    ],
    [
      "over_email_send_rate_limit",
      "Demasiados intentos, probá en unos minutos.",
    ],
    ["over_request_rate_limit", "Demasiados intentos, probá en unos minutos."],
  ])("error.code %s → mensaje claro", async (code, message) => {
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { code, message: "raw" },
    });
    const r = await signUpCustomer(signUpInput);
    expect(r).toEqual({ ok: false, error: message });
  });

  it("código desconocido → genérico, y loguea error.code en el server", async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: "unexpected_failure", message: "raw" },
    });
    const r = await signUpCustomer(signUpInput);
    expect(r).toEqual({
      ok: false,
      error: "No pudimos completar la operación, probá de nuevo.",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("signUpCustomer"),
      "unexpected_failure",
    );
  });
});
