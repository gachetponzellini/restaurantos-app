import { isPlaceholderName } from "@/lib/mozo/table-display-name";

/**
 * Cómo se nombra un pedido en el listado y en su detalle (issue #339).
 *
 * Las órdenes de mesa nacen con `customer_name = "Mesa"` (un relleno del
 * sistema), así que el listado mostraba una columna de «Mesa» idénticas: para
 * encontrar la mesa 4 había que abrir una por una. La mesa es lo que el
 * encargado busca; el nombre del cliente, si hay uno de verdad, va al lado.
 */
export function orderTitle(order: {
  customer_name: string | null;
  delivery_type: string;
  table_label?: string | null;
}): string {
  const nombre = isPlaceholderName(order.customer_name)
    ? null
    : order.customer_name!.trim();
  if (order.table_label) {
    return nombre
      ? `Mesa ${order.table_label} · ${nombre}`
      : `Mesa ${order.table_label}`;
  }
  if (order.delivery_type === "dine_in") return nombre ?? "Mostrador";
  return nombre ?? "Sin nombre";
}
