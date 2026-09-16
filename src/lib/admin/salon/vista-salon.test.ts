import { describe, expect, it } from "vitest";
import { VISTA_TODOS, resolverVistaSalon } from "./vista-salon";

describe("spec 202 · resolverVistaSalon", () => {
  it("«Todos» con varios salones muestra todos los mostrados", () => {
    expect(resolverVistaSalon(["a", "b", "c"], VISTA_TODOS)).toEqual({
      modo: "todos",
      planIds: ["a", "b", "c"],
    });
  });

  it("«Todos» respeta el filtro de salones (spec 065)", () => {
    expect(resolverVistaSalon(["a", "c"], VISTA_TODOS)).toEqual({
      modo: "todos",
      planIds: ["a", "c"],
    });
  });

  it("«Todos» con un solo salón cae a ese salón", () => {
    expect(resolverVistaSalon(["a"], VISTA_TODOS)).toEqual({
      modo: "uno",
      planId: "a",
    });
  });

  it("un salón elegido se respeta", () => {
    expect(resolverVistaSalon(["a", "b"], "b")).toEqual({
      modo: "uno",
      planId: "b",
    });
  });

  it("un id que ya no se muestra cae al primero", () => {
    expect(resolverVistaSalon(["a", "b"], "z")).toEqual({
      modo: "uno",
      planId: "a",
    });
    expect(resolverVistaSalon([], "z")).toEqual({ modo: "uno", planId: null });
  });
});
