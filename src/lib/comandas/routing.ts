/**
 * A qué sectores se rutea un ítem al insertarlo en una comanda.
 *
 * Spec 180 — un producto puede salir por **varias comanderas** (MaxiRest deja
 * hasta tres). La primera de la lista es el **sector principal**: el que
 * cocina, el que va en `order_items.station_id` y el único que mueve el estado
 * del ítem (D2). Las demás reciben su propia comanda, con su estado, su acuse
 * y su reimpresión — es lo que hace que «cocina sale con todo» sea configuración
 * y no un flag.
 *
 * Precedencia, igual que siempre: override del producto > default de la
 * categoría > fallback global. Para las extras, `null` en el producto hereda
 * de la categoría y `[]` es «ninguna extra».
 *
 * `sin_comanda` gana a todo: es «este producto no imprime», aunque la
 * categoría tenga sector — la Heineken, y los postres que la categoría mandaba
 * a cocina sin querer.
 *
 * Funciones puras — sin DB, fáciles de testear.
 */
export type ProductoRuteable = {
  station_id: string | null;
  extra_station_ids?: string[] | null;
  sin_comanda?: boolean | null;
  category: {
    station_id: string | null;
    extra_station_ids?: string[] | null;
  } | null;
};

export function resolveStations(
  product: ProductoRuteable,
  fallbackStationId: string | null = null,
): string[] {
  if (product.sin_comanda) return [];

  const principal =
    product.station_id ?? product.category?.station_id ?? fallbackStationId;
  const extras =
    product.extra_station_ids ?? product.category?.extra_station_ids ?? [];

  const out: string[] = [];
  for (const s of [principal, ...extras]) {
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** El sector principal — el primero de la lista. Compat con los que sólo necesitan uno. */
export function resolveStation(
  product: ProductoRuteable,
  fallbackStationId: string | null = null,
): string | null {
  return resolveStations(product, fallbackStationId)[0] ?? null;
}
