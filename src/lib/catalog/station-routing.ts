import type { AdminCategory, AdminProduct } from "@/lib/admin/catalog-query";

/**
 * Ruteo de comandas por sector (spec 205 · D9): la tab Sectores y su editor
 * necesitan la misma cuenta —«N productos imprimen acá»— que hoy no vive en
 * ningún lado. Lógica pura, separada de los componentes para poder testearla
 * sin montar el catálogo entero.
 */

/**
 * El sector efectivo de un producto: el propio si lo tiene, si no el de su
 * categoría; `null` si no imprime (`sin_comanda`) o si ninguno de los dos
 * tiene sector asignado.
 */
export function effectiveStationId(
  product: Pick<AdminProduct, "station_id" | "category_id" | "sin_comanda">,
  categoryById: Map<string, Pick<AdminCategory, "station_id">>,
): string | null {
  if (product.sin_comanda) return null;
  return (
    product.station_id ??
    (product.category_id
      ? (categoryById.get(product.category_id)?.station_id ?? null)
      : null)
  );
}

/** Cuántos productos imprimen, efectivamente, en cada sector. */
export function countProductsByEffectiveStation(
  products: readonly Pick<
    AdminProduct,
    "station_id" | "category_id" | "sin_comanda"
  >[],
  categories: readonly Pick<AdminCategory, "id" | "station_id">[],
): Map<string, number> {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, number>();
  for (const p of products) {
    const s = effectiveStationId(p, categoryById);
    if (s) out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

/** Categorías cuyo sector *default* (no 2ª/3ª) es cada estación. */
export function categoriesByDefaultStation<
  T extends Pick<AdminCategory, "id" | "station_id">,
>(categories: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const c of categories) {
    if (!c.station_id) continue;
    out.set(c.station_id, [...(out.get(c.station_id) ?? []), c]);
  }
  return out;
}

/** Categorías que usan cada estación como 2ª/3ª comandera. */
export function categoriesByExtraStation<
  T extends Pick<AdminCategory, "id" | "extra_station_ids">,
>(categories: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const c of categories) {
    for (const sid of c.extra_station_ids ?? []) {
      out.set(sid, [...(out.get(sid) ?? []), c]);
    }
  }
  return out;
}

/** Productos que pisan el sector de su categoría con uno propio. */
export function productsWithOwnStation<
  T extends Pick<AdminProduct, "id" | "station_id" | "category_id" | "sin_comanda">,
>(
  products: readonly T[],
  categories: readonly Pick<AdminCategory, "id" | "station_id">[],
): Map<string, T[]> {
  // Sólo cuenta como «sector propio» el que es DISTINTO del de su categoría:
  // el catálogo importado de MaxiRest trae el sector cargado en cada producto,
  // y repetir el de la categoría no es pisarlo.
  const catStation = new Map(categories.map((c) => [c.id, c.station_id]));
  const out = new Map<string, T[]>();
  for (const p of products) {
    if (!p.station_id || p.sin_comanda) continue;
    if (p.category_id && catStation.get(p.category_id) === p.station_id) continue;
    out.set(p.station_id, [...(out.get(p.station_id) ?? []), p]);
  }
  return out;
}
