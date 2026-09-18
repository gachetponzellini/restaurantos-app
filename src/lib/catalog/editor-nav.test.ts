import { describe, expect, it } from "vitest";

import {
  CLOSED,
  closeEditor,
  goBack,
  neighbors,
  openLinked,
  openRoot,
  stepTo,
} from "./editor-nav";

const ids = ["a", "b", "c"];

describe("neighbors — ‹ › dentro de la lista filtrada (spec 205 · D4)", () => {
  it("da posición, anterior y siguiente", () => {
    expect(neighbors(ids, "b")).toEqual({
      index: 1,
      total: 3,
      prev: "a",
      next: "c",
    });
  });

  it("en los bordes no hay vecino", () => {
    expect(neighbors(ids, "a").prev).toBeNull();
    expect(neighbors(ids, "c").next).toBeNull();
  });

  it("un id que no está en la lista (se filtró mientras editaba) no navega", () => {
    expect(neighbors(ids, "z")).toEqual({
      index: -1,
      total: 3,
      prev: null,
      next: null,
    });
  });
});

describe("pila de editores enlazados (spec 205 · D6)", () => {
  const prod = { kind: "product", id: "p1" } as const;
  const cat = { kind: "category", id: "c1" } as const;
  const ing = { kind: "ingredient", id: "i1" } as const;

  it("abrir desde la lista arranca sin pila", () => {
    expect(openRoot(prod)).toEqual({ current: prod, stack: [] });
  });

  it("abrir un enlace apila el actual y Volver lo recupera", () => {
    let s = openRoot(cat);
    s = openLinked(s, prod);
    s = openLinked(s, ing);
    expect(s).toEqual({ current: ing, stack: [cat, prod] });
    s = goBack(s);
    expect(s).toEqual({ current: prod, stack: [cat] });
    s = goBack(s);
    expect(s).toEqual({ current: cat, stack: [] });
  });

  it("Volver sin pila cierra", () => {
    expect(goBack(openRoot(prod))).toEqual(CLOSED);
  });

  it("abrir un enlace con el editor cerrado es abrir de raíz", () => {
    expect(openLinked(CLOSED, prod)).toEqual({ current: prod, stack: [] });
  });

  it("abrir el mismo que ya está abierto no apila", () => {
    const s = openRoot(prod);
    expect(openLinked(s, { ...prod })).toBe(s);
  });

  it("‹ › sólo funciona en el editor raíz: dentro de un enlace no hay lista", () => {
    const raiz = openRoot(prod);
    expect(stepTo(raiz, "p2")).toEqual({
      current: { kind: "product", id: "p2" },
      stack: [],
    });
    const enlazado = openLinked(raiz, cat);
    expect(stepTo(enlazado, "c2")).toBe(enlazado);
  });

  it("‹ › conserva la sección (Costeo abre en «Precio y costo»)", () => {
    const s = openRoot({ kind: "product", id: "p1", section: "precio" });
    expect(stepTo(s, "p2").current).toEqual({
      kind: "product",
      id: "p2",
      section: "precio",
    });
  });

  it("cerrar vacía todo", () => {
    expect(closeEditor()).toEqual(CLOSED);
  });
});
