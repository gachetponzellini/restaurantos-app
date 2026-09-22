/**
 * La preferencia de Mercado Pago cobra lo que dice la orden — issue #269.
 *
 * Viajaban sólo los platos: ni el envío ni el descuento del cupón. El cliente
 * pagaba $10.000 por un pedido de $10.800 y la caja asentaba los $10.800, así
 * que el arqueo cerraba contra sí mismo y el envío se perdía en cada delivery
 * pagado online. Con cupón el error va para el otro lado: el cliente paga de
 * más.
 *
 * Antes este archivo probaba una copia local del armado; desde #372 prueba el
 * armador real (`itemsDePreferenciaPedido`), que es el que usa `persistOrder`.
 */
import { describe, expect, it } from "vitest";

import { itemsDePreferenciaPedido } from "@/lib/payments/items-preferencia";

const armar = (
  lines: { unit_price_cents: number; quantity: number }[],
  envioCents: number,
  descuentoCents: number,
) =>
  itemsDePreferenciaPedido({
    lineas: lines.map((l, i) => ({
      id: `p${i}`,
      titulo: "Plato",
      cantidad: l.quantity,
      unitarioCents: l.unit_price_cents,
    })),
    envioCents,
    descuentoCents,
    totalCents:
      lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0) +
      envioCents -
      descuentoCents,
    numeroPedido: 1,
  });

const totalDe = (items: ReturnType<typeof armar>) =>
  items.reduce((n, i) => n + i.unit_price * i.quantity, 0);

describe("la preferencia de MP y el total de la orden", () => {
  it("con envío, el cliente paga el envío", () => {
    // Pedido de $10.000 + $800 de envío = $10.800, que es lo que la caja asienta.
    const items = armar([{ unit_price_cents: 1_000_000, quantity: 1 }], 80_000, 0);
    expect(totalDe(items)).toBe(10_800);
    expect(items.some((i) => i.id === "envio")).toBe(true);
  });

  it("con cupón, el cliente paga el total con descuento y sin precios negativos", () => {
    const items = armar([{ unit_price_cents: 1_000_000, quantity: 1 }], 80_000, 200_000);
    expect(totalDe(items)).toBe(8_800);
    expect(items.every((i) => i.unit_price > 0)).toBe(true);
  });

  it("sin envío ni descuento, la preferencia no lleva líneas de más", () => {
    const items = armar([{ unit_price_cents: 1_000_000, quantity: 2 }], 0, 0);
    expect(items).toHaveLength(1);
    expect(totalDe(items)).toBe(20_000);
  });
});
