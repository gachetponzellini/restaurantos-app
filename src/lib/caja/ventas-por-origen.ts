import type { PaymentMethod, VentaOrigen } from "./types";

const EMPTY_BY_METHOD: Record<PaymentMethod, number> = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  mp_manual: 0,
  other: 0,
  cuenta_corriente: 0,
};

export const EMPTY_BY_ORIGEN: Record<VentaOrigen, number> = {
  salon: 0,
  delivery: 0,
  takeaway: 0,
  otro: 0,
};

/**
 * `orders.delivery_type` es texto libre en la DB y solo existen tres valores:
 * `dine_in`, `delivery` y `pickup` (el retiro en el local, o sea take away).
 * `take_away` se acepta por defensa —  fue un valor fantasma que nunca se
 * llegó a persistir— pero es el mismo balde que `pickup`.
 *
 * Cualquier valor desconocido cae en `otro` en vez de descartarse: la suma de
 * los orígenes tiene que cerrar con `total_ventas_cents` siempre.
 */
export function origenDeDeliveryType(deliveryType: string): VentaOrigen {
  switch (deliveryType) {
    case "dine_in":
      return "salon";
    case "delivery":
      return "delivery";
    case "pickup":
    case "take_away":
      return "takeaway";
    default:
      return "otro";
  }
}

/**
 * La venta es `amount_cents − tip_cents`, igual que `total_ventas_cents`
 * (spec 098): la propina viaja **adentro** de `amount_cents` —es la plata que
 * efectivamente entró— pero no es venta del negocio.
 *
 * Esto sumaba `amount_cents` pelado, así que la misma pantalla mostraba
 * «Cobrado en el período $45.800» y «Salón $50.000» para el mismo único cobro,
 * sin nada que dijera cuál era cuál (issue #189). El contrato de arriba —los
 * orígenes cierran con `total_ventas_cents`— quedaba roto en cuanto había una
 * propina.
 */
export function agruparVentasPorOrigen(
  payments: Array<{
    delivery_type: string;
    amount_cents: number;
    tip_cents?: number;
  }>,
): Record<VentaOrigen, number> {
  const acc: Record<VentaOrigen, number> = { ...EMPTY_BY_ORIGEN };
  for (const p of payments) {
    const origen = origenDeDeliveryType(p.delivery_type);
    acc[origen] += p.amount_cents - (p.tip_cents ?? 0);
  }
  return acc;
}


/** Origen × método: cuánto entró por cada medio, dentro de cada origen. */
export type VentasPorOrigenYMetodo = Record<
  VentaOrigen,
  Record<PaymentMethod, number>
>;

export const EMPTY_ORIGEN_METODO = (): VentasPorOrigenYMetodo => ({
  salon: { ...EMPTY_BY_METHOD },
  delivery: { ...EMPTY_BY_METHOD },
  takeaway: { ...EMPTY_BY_METHOD },
  otro: { ...EMPTY_BY_METHOD },
});

/**
 * El cruce origen × método (pedido de Juan, 2026-09-03).
 *
 * Los dos desgloses que había —por origen y por método— no se podían leer
 * juntos: la pantalla decía «Salón $206.500» y «Efectivo $228.500» sin ninguna
 * forma de saber **cuánto del salón fue en efectivo**, que es justo lo que hay
 * que saber para entender el arqueo. Un delivery cobrado con tarjeta no pone un
 * peso en el cajón; uno cobrado en efectivo sí.
 *
 * Misma regla de plata que el resto: la venta es `amount − tip` (spec 098), así
 * que cada celda cierra contra `agruparVentasPorOrigen` y contra
 * `ventas_por_metodo` sumando por la otra dimensión.
 */
export function cruzarOrigenYMetodo(
  payments: Array<{
    delivery_type: string;
    method: PaymentMethod;
    amount_cents: number;
    tip_cents?: number;
  }>,
): VentasPorOrigenYMetodo {
  const acc = EMPTY_ORIGEN_METODO();
  for (const p of payments) {
    const origen = origenDeDeliveryType(p.delivery_type);
    acc[origen][p.method] += p.amount_cents - (p.tip_cents ?? 0);
  }
  return acc;
}
