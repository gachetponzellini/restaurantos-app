import { describe, expect, it } from "vitest";

import type { Notification } from "./queries";
import { viewForNotification } from "./view";

function noti(type: string, payload: Record<string, unknown> = {}): Notification {
  return {
    id: "n1",
    business_id: "b1",
    user_id: null,
    target_role: "encargado",
    type,
    payload,
    read_at: null,
    created_at: new Date().toISOString(),
  };
}

describe("viewForNotification (spec 27)", () => {
  const nuevos = [
    "reserva.nueva",
    "reserva.cancelada_cliente",
    "order.cancelled_by_customer",
    "mesa.pidio_cuenta",
    "item.cancelado",
    // #148 · H-20 + H-45
    "pedido.programado_por_vencer",
    "mp.pago_sobre_cancelado",
  ];

  it("cada tipo nuevo tiene una view específica (no el fallback genérico)", () => {
    for (const type of nuevos) {
      const v = viewForNotification(noti(type));
      // El fallback usa `title === n.type`; una view específica nunca.
      expect(v.title).not.toBe(type);
      expect(v.body).not.toBe("Notificación.");
    }
  });

  it("rellena el payload cuando está disponible", () => {
    const v = viewForNotification(
      noti("item.cancelado", { tableLabel: "7", itemName: "Milanesa", reason: "86" }),
    );
    expect(v.title).toContain("Mesa 7");
    expect(v.body).toContain("Milanesa");
    expect(v.tone).toBe("warning");
  });

  it("un tipo desconocido sí cae al fallback", () => {
    const v = viewForNotification(noti("tipo.inexistente"));
    expect(v.title).toBe("tipo.inexistente");
  });

  // `deliveryType` viene crudo de `orders.delivery_type` (events.ts), donde el
  // retiro en el local es `pickup`. `take_away` nunca se persiste.
  it("order.pending nombra el canal: delivery y retiro se distinguen", () => {
    const del = viewForNotification(
      noti("order.pending", { orderNumber: 12, deliveryType: "delivery" }),
    );
    expect(del.title).toContain("Delivery");

    const pick = viewForNotification(
      noti("order.pending", { orderNumber: 13, deliveryType: "pickup" }),
    );
    expect(pick.title).toContain("Take-away");
  });

  it("el programado por vencer dice cuándo se cancela y cómo evitarlo (#148)", () => {
    const v = viewForNotification(
      noti("pedido.programado_por_vencer", { orderNumber: 42, customerName: "Ana" }),
    );
    expect(v.title).toContain("#42");
    expect(v.body).toMatch(/30 min/);
    expect(v.tone).toBe("warning");
  });

  it("un pago de MP sobre un pedido cancelado pide devolverlo (#148)", () => {
    const v = viewForNotification(
      noti("mp.pago_sobre_cancelado", { orderNumber: 42, amountCents: 1_250_000 }),
    );
    expect(v.title).toContain("#42");
    expect(v.body).toMatch(/devol/i);
    expect(v.tone).toBe("danger");
  });
});
