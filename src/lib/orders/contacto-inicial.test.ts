import { describe, expect, it } from "vitest";

import { contactoInicial } from "./contacto-inicial";

// QA #382 · H-19 — el checkout del primer pedido salía con nombre y teléfono
// vacíos aunque la cuenta los tuviera en `user_metadata`. Supabase devuelve
// `user.phone === ""` (no null) cuando no hay teléfono verificado, y con `??`
// ese string vacío le ganaba al metadata.
const sinPerfil = { name: null, phone: null, email: null };

describe("contactoInicial (H-19)", () => {
  it("sin perfil previo toma el teléfono y el nombre de user_metadata", () => {
    const r = contactoInicial(sinPerfil, {
      phone: "",
      email: "ana@mail.com",
      user_metadata: { phone: "1155551234", full_name: "Ana Pérez" },
    });
    expect(r).toEqual({
      name: "Ana Pérez",
      phone: "1155551234",
      email: "ana@mail.com",
    });
  });

  it("usa `name` si no hay `full_name`", () => {
    const r = contactoInicial(sinPerfil, {
      user_metadata: { name: "Ana" },
    });
    expect(r.name).toBe("Ana");
  });

  it("el perfil del último pedido manda sobre la cuenta", () => {
    const r = contactoInicial(
      { name: "Ana P.", phone: "1100000000", email: "p@mail.com" },
      {
        phone: "1155551234",
        email: "ana@mail.com",
        user_metadata: { phone: "1166666666", full_name: "Ana Pérez" },
      },
    );
    expect(r).toEqual({
      name: "Ana P.",
      phone: "1100000000",
      email: "p@mail.com",
    });
  });

  it("un perfil con strings vacíos o blancos no pisa a la cuenta", () => {
    const r = contactoInicial(
      { name: "", phone: "  ", email: null },
      { user_metadata: { phone: "1155551234", full_name: "Ana" } },
    );
    expect(r.name).toBe("Ana");
    expect(r.phone).toBe("1155551234");
  });

  it("sin nada devuelve strings vacíos", () => {
    expect(contactoInicial(sinPerfil, { user_metadata: {} })).toEqual({
      name: "",
      phone: "",
      email: "",
    });
  });

  it("ignora metadata que no es texto", () => {
    const r = contactoInicial(sinPerfil, {
      user_metadata: { phone: 1155551234, full_name: { x: 1 } },
    });
    expect(r.phone).toBe("");
    expect(r.name).toBe("");
  });
});
