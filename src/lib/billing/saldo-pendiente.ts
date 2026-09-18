/**
 * Cuentas con saldo pendiente — issue #339.
 *
 * Dos formas de que a una cuenta le falte plata:
 *
 *  - **Abierta con cobro parcial:** entró algo pero no todo. Es normal mientras
 *    la mesa sigue sentada, pero tiene que verse: en #338 un pago parcial que la
 *    pantalla no mostraba terminó cargado dos veces.
 *  - **Cerrada con saldo:** se anularon líneas de cobro después de cerrar (la
 *    corrección de caja lo permite) y la orden quedó cerrada con plata de menos.
 *    Nadie la ve en el salón —la mesa ya está libre— y hasta #339 no se podía
 *    volver a cobrar.
 *
 * `registrar_pago_tx` (migración 0113) aplica la misma regla que
 * `esCuentaCerradaConSaldo`: si cambia una, cambia la otra.
 */

export type OrdenParaSaldo = {
  lifecycle_status: "open" | "closed" | "cancelled";
  status: string;
  total_cents: number;
  total_paid_cents: number;
};

export function saldoCents(o: OrdenParaSaldo): number {
  return Math.max(0, o.total_cents - o.total_paid_cents);
}

/** Cerrada, no cancelada y con plata de menos: se puede cobrar el saldo. */
export function esCuentaCerradaConSaldo(o: OrdenParaSaldo): boolean {
  return (
    o.lifecycle_status === "closed" &&
    o.status !== "cancelled" &&
    o.total_cents > 0 &&
    saldoCents(o) > 0
  );
}

/** ¿El cobro de esta orden está habilitado? Abierta, o cerrada con saldo. */
export function admiteCobro(o: OrdenParaSaldo): boolean {
  if (o.status === "cancelled") return false;
  return o.lifecycle_status === "open" || esCuentaCerradaConSaldo(o);
}

/** Lo que el aviso de Caja tiene que mostrar. */
export function tieneSaldoPendiente(o: OrdenParaSaldo): boolean {
  if (o.status === "cancelled") return false;
  if (o.lifecycle_status === "open") {
    return o.total_paid_cents > 0 && saldoCents(o) > 0;
  }
  return esCuentaCerradaConSaldo(o);
}
