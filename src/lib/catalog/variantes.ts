/**
 * Spec 207 — la pizza tiene gustos.
 *
 * Un grupo de adicionales marcado `is_variant` no suma «+$X»: cada opción es una
 * versión del producto con precio final = `price_cents + price_delta_cents`.
 * Todo lo que no está marcado sigue siendo un adicional común.
 */

type Opcion = {
  id?: string;
  name: string;
  price_delta_cents: number;
  is_available?: boolean;
};

type Grupo<O extends Opcion = Opcion> = {
  is_variant?: boolean;
  modifiers: O[];
};

export function grupoVariante<G extends Grupo>(product: {
  modifier_groups: G[];
}): G | null {
  return product.modifier_groups.find((g) => g.is_variant === true) ?? null;
}

function gustosDisponibles<O extends Opcion>(g: Grupo<O>): O[] {
  return g.modifiers.filter((m) => m.is_available !== false);
}

export function rangoDePrecio(product: {
  price_cents: number;
  modifier_groups: Grupo[];
}): { min: number; max: number } {
  const g = grupoVariante(product);
  const precios = g
    ? gustosDisponibles(g).map((m) => product.price_cents + m.price_delta_cents)
    : [];
  if (precios.length === 0) {
    return { min: product.price_cents, max: product.price_cents };
  }
  return { min: Math.min(...precios), max: Math.max(...precios) };
}

export function etiquetaDePrecio(
  product: { price_cents: number; modifier_groups: Grupo[] },
  fmt: (cents: number) => string,
): string {
  const { min, max } = rangoDePrecio(product);
  return min === max ? fmt(min) : `desde ${fmt(min)}`;
}

export type FilaDeCarta = { key: string; name: string; price_cents: number };

/** La carta del QR: una fila por gusto disponible, o el producto solo. */
export function filasDeCarta(product: {
  id?: string;
  name: string;
  price_cents: number;
  modifier_groups: Grupo[];
}): FilaDeCarta[] {
  const g = grupoVariante(product);
  const gustos = g ? gustosDisponibles(g) : [];
  if (gustos.length === 0) {
    return [
      {
        key: product.id ?? product.name,
        name: product.name,
        price_cents: product.price_cents,
      },
    ];
  }
  return gustos.map((m) => ({
    key: m.id ?? m.name,
    name: `${product.name} ${m.name}`,
    price_cents: product.price_cents + m.price_delta_cents,
  }));
}

/**
 * Agotado = el producto está apagado, o es un producto con variantes y no le
 * queda ningún gusto prendido (se apagaron de a uno). Sin variante, los
 * adicionales apagados no agotan el producto.
 */
export function estaAgotado(product: {
  is_available: boolean;
  modifier_groups: Grupo[];
}): boolean {
  if (!product.is_available) return true;
  const g = grupoVariante(product);
  return g !== null && gustosDisponibles(g).length === 0;
}
