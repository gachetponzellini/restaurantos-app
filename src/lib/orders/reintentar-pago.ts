/**
 * ¿Se le puede ofrecer al cliente volver a pagar con Mercado Pago? (#368)
 *
 * El cliente que cerró MP sin pagar quedaba mirando «Procesando tu pago» para
 * siempre, sin forma de reintentar. Ahora se le ofrece un link nuevo mientras
 * el pedido siga siendo pagable.
 *
 * El link vence a los 90 min de generado, pero **nunca después de los 110 min
 * de creado el pedido**: el barrido de impagos lo cancela a las 2 h (#148), y
 * un link vivo sobre un pedido cancelado es plata que hay que devolver. Si
 * quedan menos de 5 min, ya no vale la pena: venció.
 */
export const REINTENTO_LINK_MIN = 90;
export const REINTENTO_LIMITE_DESDE_CREADO_MIN = 110;
export const REINTENTO_MINIMO_UTIL_MIN = 5;

export type EvaluacionReintento =
  | { puede: true; venceEl: Date }
  | { puede: false; motivo: "no_mp" | "pagado" | "cancelado" | "no_disponible" | "vencido" };

export function evaluarReintentoPago(
  o: {
    payment_method: string | null;
    payment_status: string | null;
    status: string;
    lifecycle_status: string;
    created_at: string;
  },
  now: Date,
): EvaluacionReintento {
  if (o.payment_method !== "mp") return { puede: false, motivo: "no_mp" };
  if (o.payment_status === "paid") return { puede: false, motivo: "pagado" };
  if (o.status === "cancelled" || o.lifecycle_status === "cancelled") {
    return { puede: false, motivo: "cancelado" };
  }
  // Aceptado o en curso: ya no es un pedido esperando el pago.
  if (o.status !== "pending" || o.lifecycle_status !== "open") {
    return { puede: false, motivo: "no_disponible" };
  }

  const limite = new Date(
    new Date(o.created_at).getTime() + REINTENTO_LIMITE_DESDE_CREADO_MIN * 60_000,
  );
  if (limite.getTime() - now.getTime() < REINTENTO_MINIMO_UTIL_MIN * 60_000) {
    return { puede: false, motivo: "vencido" };
  }
  const porLink = new Date(now.getTime() + REINTENTO_LINK_MIN * 60_000);
  return { puede: true, venceEl: porLink < limite ? porLink : limite };
}
