import { describe, expect, it } from "vitest";

import { foodCostPercent, foodCostTone } from "./food-cost";

describe("food cost (spec 205) — un solo semáforo para todo el catálogo", () => {
  it("es costo / precio en porcentaje", () => {
    expect(foodCostPercent(1000, 350)).toBe(35);
    expect(foodCostPercent(4000, 8573)).toBeCloseTo(214.3, 1);
  });

  it("sin precio no hay porcentaje", () => {
    expect(foodCostPercent(0, 100)).toBeNull();
  });

  it("mismos cortes que la receta: ≤35 bien, ≤50 ojo, más es malo", () => {
    expect(foodCostTone(35)).toBe("ok");
    expect(foodCostTone(35.1)).toBe("warn");
    expect(foodCostTone(50)).toBe("warn");
    expect(foodCostTone(50.1)).toBe("bad");
    expect(foodCostTone(null)).toBe("none");
  });
});
