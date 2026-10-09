import type { CuentaAbierta } from "./queries";
import type { CuentaConSaldo } from "./types";

/**
 * Lo que falta cobrar, en UN listado (pedido de Juan, 2026-10-07: dos listas
 * —«mesas abiertas» en el cierre del turno y «cuentas con saldo» arriba de la
 * caja— marean a la encargada).
 *
 * Junta las mesas con la cuenta abierta (frenan el cierre de cualquier caja)
 * con las cuentas que quedaron con saldo: cerradas sin terminar de pagar (una
 * línea anulada, un contracargo de MP) o pedidos sin mesa con un pago parcial.
 * Ésas no frenan el cierre, pero son plata que falta. Una mesa abierta que
 * pagó una parte figura en las dos fuentes: va una sola vez.
 */
export type FilaPorCobrar = {
  orderId: string;
  nombre: string;
  mozo: string | null;
  detalle: string;
  totalCents: number;
  pagadoCents: number;
  faltaCents: number;
  /** Frena el cierre de las cajas (mesa con la cuenta abierta). */
  frena: boolean;
  /** Cerrada con saldo: se puede anular desde la fila (spec 215). */
  anulable: boolean;
  destino: { kind: "mesa"; tableId: string } | { kind: "pedido"; orderNumber: number };
};

export function porCobrar(abiertas: CuentaAbierta[], conSaldo: CuentaConSaldo[]): FilaPorCobrar[] {
  const filas: FilaPorCobrar[] = abiertas.map((a) => {
    const pagado = Math.max(0, a.total_cents - a.pendiente_cents);
    return {
      orderId: a.order_id,
      nombre: `Mesa ${a.table_label}`,
      mozo: a.mozo_name,
      detalle: pagado > 0 ? "Pagó una parte" : "Mesa abierta",
      totalCents: a.total_cents,
      pagadoCents: pagado,
      faltaCents: a.pendiente_cents,
      frena: true,
      anulable: false,
      destino: { kind: "mesa", tableId: a.table_id },
    };
  });
  const ya = new Set(filas.map((f) => f.orderId));
  for (const c of conSaldo) {
    if (ya.has(c.orderId)) continue;
    filas.push({
      orderId: c.orderId,
      nombre: c.tableLabel ? `Mesa ${c.tableLabel}` : `Pedido #${c.dailyNumber ?? c.orderNumber}`,
      mozo: null,
      detalle: c.cerrada ? "Cerrada con saldo: no frena el cierre" : "Pagó una parte",
      totalCents: c.totalCents,
      pagadoCents: c.paidCents,
      faltaCents: c.saldoCents,
      frena: false,
      anulable: c.cerrada,
      destino:
        !c.cerrada && c.tableId ? { kind: "mesa", tableId: c.tableId } : { kind: "pedido", orderNumber: c.orderNumber },
    });
  }
  return filas.sort((a, b) => Number(b.frena) - Number(a.frena));
}
