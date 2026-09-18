/**
 * Cuentas corrientes — el saldo y su lectura (spec 141).
 *
 * Lógica pura, sin DB: la comparten la tab de Operación, la ficha del cliente y
 * el buscador del cobro, así que el número que se ve antes de fiar es el mismo
 * que el que se cobra después.
 *
 * **El saldo se DERIVA** (D4):
 *
 *     saldo = Σ cargos (payments cuenta_corriente vivos)
 *           − Σ cobranzas (customer_credit_settlements vivas)
 *
 * No hay libro de asientos. El cargo **ya es** una fila de `payments`, y esa fila
 * hereda gratis la idempotencia de `registrar_pago_tx`, la corrección de monto de
 * la spec 070 y su `caja_audit_log`. Un libro aparte obligaría a mantener dos
 * filas en sync en cada anulación y en cada corrección — y la única forma de que
 * un saldo mienta es que tenga dos fuentes.
 */

/** Un consumo fiado. Sale de `payments` con `method = 'cuenta_corriente'`. */
export type CargoCuentaCorriente = {
  id: string;
  amount_cents: number;
  created_at: string;
  /** Anulado en el libro de caja (spec 070): no cuenta para el saldo. */
  cancelled_at?: string | null;
  order_number?: number | null;
};

/** Un pago del cliente contra su saldo. */
export type CobranzaCuentaCorriente = {
  id: string;
  amount_cents: number;
  created_at: string;
  method: string;
  cancelled_at?: string | null;
};

export type MovimientoCuenta = {
  tipo: "cargo" | "cobranza";
  id: string;
  amount_cents: number;
  created_at: string;
  anulado: boolean;
  /** `#128` para un consumo; el método para una cobranza. */
  detalle: string;
};

const vivo = (x: { cancelled_at?: string | null }) => !x.cancelled_at;

/**
 * El saldo del cliente, en centavos. Positivo = debe.
 *
 * Puede dar **negativo** y eso no es un bug: es un cliente que pagó de más (o al
 * que se le anuló un consumo después de cobrarle). Se muestra como saldo a favor;
 * clamparlo a cero escondería plata que el local le debe a alguien.
 */
export function calcularSaldo(
  cargos: CargoCuentaCorriente[],
  cobranzas: CobranzaCuentaCorriente[],
): number {
  const debe = cargos.filter(vivo).reduce((n, c) => n + c.amount_cents, 0);
  const pago = cobranzas.filter(vivo).reduce((n, c) => n + c.amount_cents, 0);
  return debe - pago;
}

/**
 * El libro del cliente: consumos y cobranzas mezclados, del más nuevo al más
 * viejo. Lo anulado **se muestra** —tachado, como en el libro de caja— porque un
 * movimiento que desaparece es un movimiento que nadie puede auditar.
 */
export function armarLibro(
  cargos: CargoCuentaCorriente[],
  cobranzas: CobranzaCuentaCorriente[],
): MovimientoCuenta[] {
  const items: MovimientoCuenta[] = [
    ...cargos.map((c) => ({
      tipo: "cargo" as const,
      id: c.id,
      amount_cents: c.amount_cents,
      created_at: c.created_at,
      anulado: !vivo(c),
      detalle:
        c.order_number != null ? `Consumo #${c.order_number}` : "Consumo",
    })),
    ...cobranzas.map((c) => ({
      tipo: "cobranza" as const,
      id: c.id,
      amount_cents: c.amount_cents,
      created_at: c.created_at,
      anulado: !vivo(c),
      detalle: `Pago · ${METODO_LABEL[c.method] ?? c.method}`,
    })),
  ];
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const METODO_LABEL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  mp_manual: "Mercado Pago",
  card_manual: "Tarjeta",
  other: "Otro",
};

/**
 * Hace cuántos días que el cliente no paga nada.
 *
 * Se mide desde la última **cobranza**, y si nunca pagó, desde el primer consumo
 * vivo — que es cuando empezó a deber. `null` si no debe nada.
 *
 * `ahora` entra por parámetro para que la función sea pura y testeable: acá no se
 * llama a `Date.now()`.
 */
export function diasSinPagar(
  cargos: CargoCuentaCorriente[],
  cobranzas: CobranzaCuentaCorriente[],
  ahora: Date,
): number | null {
  const cargosVivos = cargos.filter(vivo);
  if (cargosVivos.length === 0) return null;

  const ultimaCobranza = cobranzas
    .filter(vivo)
    .map((c) => c.created_at)
    .sort()
    .at(-1);
  const primerCargo = cargosVivos.map((c) => c.created_at).sort()[0];
  const desde = new Date(ultimaCobranza ?? primerCargo);
  if (Number.isNaN(desde.getTime())) return null;

  const ms = ahora.getTime() - desde.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export type TramoAntiguedad = "al_dia" | "mas_30" | "mas_60";

/**
 * El corte por antigüedad del panel: es la única lectura que dispara una llamada
 * al cliente. Los umbrales son 30 y 60 días, que es lo que se usa en la casa.
 */
export function tramoDeAntiguedad(dias: number | null): TramoAntiguedad {
  if (dias == null || dias < 30) return "al_dia";
  return dias < 60 ? "mas_30" : "mas_60";
}
