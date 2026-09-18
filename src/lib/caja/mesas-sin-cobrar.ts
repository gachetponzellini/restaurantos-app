import { saldoCents } from "@/lib/billing/saldo-pendiente";

/**
 * Qué mesas le traban la rendición a cada mozo (#351).
 *
 * Un mozo no rinde mientras tenga una mesa suya sin cobrar: si rinde antes, lo
 * que se cobre después cae en un período nuevo y hay que hacerle una segunda
 * rendición —los números de la primera "dan mal"—. Pasó en un local real: la
 * mesa se había cerrado, se anularon sus cobros y quedó con saldo; el mozo
 * rindió, la cobraron en efectivo dos minutos después y hubo que rendir otra vez.
 *
 * Cuenta como sin cobrar:
 *  - mesa **abierta** con consumo y saldo (lo normal: todavía comen), y
 *  - cuenta **cerrada con saldo** (se anuló un cobro después de cerrarla).
 *
 * De quién es la mesa: del mozo asignado a la mesa, del mozo de la orden y de
 * cualquiera que tenga un cobro atribuido en ella (aunque esté anulado). Una
 * cerrada con saldo ya no tiene mozo de mesa, y el pago anulado es la única
 * huella de quién la estaba cobrando. Pecar de bloquear de más es barato: la
 * salida es cobrar la mesa, que hay que hacer igual.
 */
export type OrdenDeMesa = {
  id: string;
  table_label: string | null;
  lifecycle_status: "open" | "closed" | "cancelled";
  status: string;
  total_cents: number;
  total_paid_cents: number;
  mesa_mozo_id: string | null;
  orden_mozo_id: string | null;
  pagos_mozo_ids: string[];
};

export type MesaSinCobrar = {
  orderId: string;
  tableLabel: string | null;
  saldoCents: number;
};

export function mesaSinCobrar(o: OrdenDeMesa): boolean {
  if (o.status === "cancelled" || o.lifecycle_status === "cancelled") return false;
  return o.total_cents > 0 && saldoCents(o) > 0;
}

export function mesasSinCobrarPorMozo(
  ordenes: OrdenDeMesa[],
): Map<string, MesaSinCobrar[]> {
  const out = new Map<string, MesaSinCobrar[]>();
  for (const o of ordenes) {
    if (!mesaSinCobrar(o)) continue;
    const duenos = new Set(
      [o.mesa_mozo_id, o.orden_mozo_id, ...o.pagos_mozo_ids].filter(
        (x): x is string => !!x,
      ),
    );
    const mesa = { orderId: o.id, tableLabel: o.table_label, saldoCents: saldoCents(o) };
    for (const d of duenos) out.set(d, [...(out.get(d) ?? []), mesa]);
  }
  return out;
}

/** El texto del bloqueo, igual en la card y en el error de la action. */
export function motivoBloqueoRendicion(mesas: MesaSinCobrar[]): string {
  const etiquetas = mesas.map((m) => (m.tableLabel ? `mesa ${m.tableLabel}` : "una cuenta"));
  const cobrar = mesas.length === 1 ? "Cobrala" : "Cobralas";
  return `Tiene ${etiquetas.join(", ")} sin cobrar. ${cobrar} antes de rendir.`;
}
