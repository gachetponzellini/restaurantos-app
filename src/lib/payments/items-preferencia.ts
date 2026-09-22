/**
 * Los ítems de la preferencia de Mercado Pago de un pedido online (#372).
 *
 * La regla que manda: **MP cobra exactamente `orders.total_cents`**, que es lo
 * que la caja asienta cuando el pago se acredita (`aplicarPagoMpAprobado`).
 *
 * Antes cada línea se redondeaba a pesos por separado y se multiplicaba por la
 * cantidad: 3 × $1.234,50 viajaba como 3 × $1.235 y el cliente pagaba distinto
 * de lo que la caja esperaba. MP acepta decimales (el cobro de mesa ya manda
 * `amount_cents / 100`, ver `importeDePreferenciaMp`), así que no se redondea.
 *
 * El descuento viajaba como una línea con precio negativo. La documentación de
 * MP no dice que lo acepte y nunca se probó en producción (ningún pedido con
 * cupón se pagó por MP): si lo rechaza, el cliente con cupón no puede pagar.
 * Con descuento —o si por cualquier motivo las líneas no suman el total— se
 * manda UNA línea por el total. Se pierde el detalle en la pantalla de MP, pero
 * se cobra lo correcto y siempre con un precio positivo.
 */
export type ItemPreferencia = {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
};

export function itemsDePreferenciaPedido(params: {
  lineas: { id: string; titulo: string; cantidad: number; unitarioCents: number }[];
  envioCents: number;
  descuentoCents: number;
  totalCents: number;
  numeroPedido: number | string;
}): ItemPreferencia[] {
  const { lineas, envioCents, descuentoCents, totalCents, numeroPedido } = params;
  const unaLinea: ItemPreferencia[] = [
    {
      id: "pedido",
      title: `Pedido #${numeroPedido}`,
      quantity: 1,
      unit_price: totalCents / 100,
    },
  ];
  if (descuentoCents > 0) return unaLinea;

  const detalle: ItemPreferencia[] = [
    ...lineas
      // Un plato de regalo ($0) no es un ítem que MP acepte cobrar.
      .filter((l) => l.unitarioCents > 0 && l.cantidad > 0)
      .map((l) => ({
        id: l.id,
        title: l.titulo,
        quantity: l.cantidad,
        unit_price: l.unitarioCents / 100,
      })),
    ...(envioCents > 0
      ? [{ id: "envio", title: "Envío", quantity: 1, unit_price: envioCents / 100 }]
      : []),
  ];
  const sumaCents = Math.round(
    detalle.reduce((a, i) => a + i.quantity * i.unit_price * 100, 0),
  );
  return detalle.length > 0 && sumaCents === totalCents ? detalle : unaLinea;
}

/**
 * ¿MP cobró lo que dice la orden? `transaction_amount` viene en pesos (con
 * decimales). Sin monto informado no hay con qué comparar: no se alarma.
 */
export function montoCobradoCoincide(
  cobradoPesos: number | null | undefined,
  totalCents: number,
): boolean {
  if (cobradoPesos == null) return true;
  return Math.round(cobradoPesos * 100) === totalCents;
}
