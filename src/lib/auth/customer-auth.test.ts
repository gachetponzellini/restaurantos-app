import { describe, expect, it } from "vitest";

import {
  safeNextPath,
  SignInCustomerInput,
  SignUpCustomerInput,
} from "./customer-auth-shared";

describe("safeNextPath", () => {
  it("devuelve next cuando es same-origin", () => {
    expect(safeNextPath("/demo/checkout", "demo")).toBe("/demo/checkout");
  });

  it("rechaza next con doble slash (open redirect)", () => {
    expect(safeNextPath("//evil.com", "demo")).toBe("/demo/menu");
  });

  it("rechaza next externo con http://", () => {
    expect(safeNextPath("http://evil.com", "demo")).toBe("/demo/menu");
  });

  it("usa fallback cuando next es undefined", () => {
    expect(safeNextPath(undefined, "demo")).toBe("/demo/menu");
  });

  it("usa fallback cuando next es cadena vacía", () => {
    expect(safeNextPath("", "demo")).toBe("/demo/menu");
  });
});

describe("safeNextPath — H-02 (open redirect)", () => {
  const casos: Array<[string, string]> = [
    ["/\\evil.example", "backslash tras la barra (/%5Cevil.example decodificado)"],
    ["/\\\\evil.example", "doble backslash"],
    ["//evil", "doble slash"],
    ["https://evil", "esquema https"],
    ["javascript:alert(1)", "esquema javascript"],
    ["/\t/evil", "tab entre las barras (el navegador lo elimina → //evil)"],
    ["/\n/evil", "salto de línea"],
    ["/\r/evil", "retorno de carro"],
    ["/ok\\evil", "backslash en cualquier posición"],
    ["/ok\u0000x", "carácter de control"],
    ["evil.example", "sin barra inicial"],
  ];
  it.each(casos)("rechaza %j (%s)", (next) => {
    expect(safeNextPath(next, "demo")).toBe("/demo/menu");
  });

  it.each([
    "/demo/checkout",
    "/demo/reservar?fecha=2026-10-07",
    "/demo/perfil/reservas#top",
    "/",
  ])("acepta el path same-origin %j", (next) => {
    expect(safeNextPath(next, "demo")).toBe(next);
  });
});

describe("SignInCustomerInput — schema", () => {
  it("acepta email y contraseña válidos", () => {
    const r = SignInCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "cualquiera",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza email inválido", () => {
    const r = SignInCustomerInput.safeParse({
      business_slug: "demo",
      email: "no-es-email",
      password: "123",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza contraseña vacía", () => {
    const r = SignInCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("SignUpCustomerInput — schema", () => {
  it("acepta datos válidos y normaliza teléfono a dígitos", () => {
    const r = SignUpCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "password123",
      phone: "+54 9 11 1234-5678",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("5491112345678");
  });

  it("rechaza contraseña de menos de 8 caracteres", () => {
    const r = SignUpCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "short",
      phone: "1112345678",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain("8 caracteres");
    }
  });

  it("rechaza teléfono vacío", () => {
    const r = SignUpCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "password123",
      phone: "",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza teléfono con menos de 8 dígitos reales", () => {
    const r = SignUpCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "password123",
      phone: "1234",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain("teléfono válido");
    }
  });

  it("rechaza email inválido", () => {
    const r = SignUpCustomerInput.safeParse({
      business_slug: "demo",
      email: "no-es-email",
      password: "password123",
      phone: "1112345678",
    });
    expect(r.success).toBe(false);
  });

  it("acepta teléfono solo con dígitos y suficiente longitud", () => {
    const r = SignUpCustomerInput.safeParse({
      business_slug: "demo",
      email: "user@mail.com",
      password: "password123",
      phone: "1112345678",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("1112345678");
  });
});
