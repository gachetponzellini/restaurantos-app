import { describe, expect, it } from "vitest";

import { orderTitle } from "./order-title";

describe("orderTitle (#339)", () => {
  it("una orden de mesa se llama por su mesa", () => {
    expect(
      orderTitle({ customer_name: "Mesa", delivery_type: "dine_in", table_label: "4" }),
    ).toBe("Mesa 4");
  });

  it("si la mesa tiene un nombre de verdad, va al lado", () => {
    expect(
      orderTitle({
        customer_name: "Gutiérrez",
        delivery_type: "dine_in",
        table_label: "12",
      }),
    ).toBe("Mesa 12 · Gutiérrez");
  });

  it("dine_in sin mesa es venta de mostrador", () => {
    expect(orderTitle({ customer_name: "Mesa", delivery_type: "dine_in" })).toBe(
      "Mostrador",
    );
  });

  it("delivery y retiro siguen con el nombre del cliente", () => {
    expect(orderTitle({ customer_name: "Ana", delivery_type: "delivery" })).toBe("Ana");
    expect(orderTitle({ customer_name: "", delivery_type: "pickup" })).toBe(
      "Sin nombre",
    );
  });
});
