import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Marca como reembolsados los cobros vivos de una orden, y deja el rastro.
 *
 * ## Por qué esto vive en un solo lugar (issue #272)
 *
 * La caja no lee `orders.payment_status`: lee `payments`. `calculateExpectedCash`
 * suma las filas con `payment_status = 'paid'` y `getCajaStatsEnVentana` arma
 * con ellas el «cobrado en el período».
 *
 * `anularCobro` siempre lo hizo bien. Los otros dos caminos que devuelven plata
 * —rechazar un pedido (spec 139) y la cancelación del propio cliente— marcaban
 * únicamente `orders.payment_status = 'refunded'` y dejaban las filas de
 * `payments` intactas. Resultado: se le devolvía la plata al cliente por Mercado
 * Pago y **la caja la seguía contando para siempre**. Y en la peor dirección:
 * «Ingresos hoy» bajaba porque la orden queda cancelada, mientras el arqueo
 * seguía esperando ese efectivo. Los dos números divergían, y nada los limpiaba.
 *
 * Era el patrón de siempre: la misma regla escrita en un solo lado. Por eso se
 * extrae acá en vez de copiarla dos veces más.
 *
 * ## Qué NO hace
 *
 * No devuelve la plata: eso ya lo hizo el gateway antes de llamar a esto. Acá se
 * asienta la consecuencia contable. Y no borra nada — un movimiento que
 * desaparece es un movimiento que nadie audita (misma regla que la spec 070).
 */
export async function marcarPagosReembolsados(
  service: GenericClient,
  params: {
    orderId: string;
    businessId: string;
    motivo: string;
    /** Quién lo provocó. `null` cuando fue el propio cliente desde la web. */
    actorUserId: string | null;
    /**
     * Sólo el cobro de ESTE pago de Mercado Pago (#372). Un reembolso hecho
     * desde MP devuelve un pago puntual: si el pedido tuvo dos (duplicado),
     * el otro sigue en la caja. Sin esto se marcan todos los cobros vivos.
     */
    mpPaymentId?: string;
  },
): Promise<{ reembolsados: number; centavos: number }> {
  let query = service
    .from("payments")
    .update({
      payment_status: "refunded",
      refunded_at: new Date().toISOString(),
      refunded_reason: params.motivo,
    })
    .eq("order_id", params.orderId)
    .eq("payment_status", "paid");
  if (params.mpPaymentId) query = query.eq("mp_payment_id", params.mpPaymentId);
  const { data: refundados } = await query.select("id, caja_id, amount_cents");

  const filas = (refundados ?? []) as Array<{
    id: string;
    caja_id: string | null;
    amount_cents: number;
  }>;
  if (filas.length === 0) return { reembolsados: 0, centavos: 0 };

  // spec 098 · H-35 — el rastro va al mismo libro donde ya escriben las
  // correcciones de línea, que es donde el encargado mira. `payments` no tiene
  // `refunded_by`, así que sin esto la plata sale del arqueo sin dueño.
  const { error: auditErr } = await service.from("caja_audit_log").insert(
    filas.map((p) => ({
      business_id: params.businessId,
      caja_id: p.caja_id,
      entity_type: "payment",
      entity_id: p.id,
      field: "payment_status",
      from_value: "paid",
      to_value: "refunded",
      by_user_id: params.actorUserId,
      reason: params.motivo,
    })),
  );
  // El audit no bloquea el reembolso, pero su ausencia se loguea fuerte: un
  // reembolso sin rastro es justo lo que la spec 098 vino a arreglar.
  if (auditErr) console.error("marcarPagosReembolsados · caja_audit_log", auditErr);

  return {
    reembolsados: filas.length,
    centavos: filas.reduce((n, p) => n + Number(p.amount_cents || 0), 0),
  };
}
