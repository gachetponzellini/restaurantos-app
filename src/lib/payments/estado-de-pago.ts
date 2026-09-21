/**
 * Qué `payment_status` escribir en una orden cuando MP informa un pago
 * (auditoría de pedidos · MEDIA).
 *
 * Con el reintento de pago (#368) una orden puede tener varios pagos de MP. Un
 * «rechazado» tardío del intento 1 que llegaba después del «aprobado» del
 * intento 2 la dejaba `failed` estando cobrada. Regla: una orden `paid` no baja
 * — salvo a `refunded`, y sólo si el reembolso es del MISMO pago que la dejó
 * pagada. `null` = no tocar.
 */
export function estadoDePagoAEscribir(
  orden: { actual: string | null; actualPaymentId: string | null },
  mp: { siguiente: string; paymentId: string },
): string | null {
  // Revisión adversarial — reembolsada también es terminal: un «approved»
  // tardío de otro pago no la resucita. Esa plata la trata
  // `aplicarPagoMpAprobado` (aviso para devolverla).
  if (orden.actual === "refunded") return null;
  if (orden.actual !== "paid") return mp.siguiente;
  if (mp.siguiente === "paid") return "paid";
  if (mp.siguiente === "refunded" && orden.actualPaymentId === mp.paymentId) {
    return "refunded";
  }
  return null;
}
