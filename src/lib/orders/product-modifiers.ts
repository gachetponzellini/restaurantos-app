/**
 * Validación server-side de los `modifier_ids` de una línea de producto
 * (QA #382 · H-01).
 *
 * `persistOrder` escribe con el service client y el precio se re-deriva de la DB,
 * pero hasta acá sólo se miraba que el adicional existiera, fuera del negocio y
 * estuviera disponible. Mandando el payload a mano entraban pedidos imposibles:
 * sin la salsa obligatoria, con la salsa de OTRO plato (y su precio), con el
 * mismo adicional repetido o con más opciones que el máximo del grupo.
 *
 * Es la contraparte server de lo que ya validan el `ProductSheet` público y el
 * `ProductModal` del mozo (`min_selection` / `max_selection`). Puro y sin
 * dependencias, para testearlo sin DB. No toca precios: sólo acepta o rechaza.
 */

export type ProductModifierGroup = {
  id: string;
  name: string;
  is_required: boolean;
  min_selection: number;
  max_selection: number;
  /** Opciones del grupo; sólo importa su id y si están disponibles. */
  modifiers: { id: string; is_available: boolean }[];
};

export type ProductModifiersResult = { ok: true } | { ok: false; error: string };

function opciones(n: number): string {
  return n === 1 ? "1 opción" : `${n} opciones`;
}

/**
 * Valida la selección de UNA línea contra los grupos de SU producto.
 *
 * Reglas, en este orden:
 * 1. sin ids repetidos (un payload roto no es «dos porciones»);
 * 2. cada id pertenece a un grupo de este producto;
 * 3. por grupo: al menos `min_selection` (y 1 si `is_required`) y a lo sumo
 *    `max_selection`.
 *
 * Los grupos sin ninguna opción disponible no se exigen: serían un paso sin
 * salida (mismo criterio que `askableModifierGroups`).
 *
 * Los mensajes arrancan con el nombre del producto, que es lo que el cliente
 * reconoce en el carrito: «Tallarines: elegí una opción de Salsa para pasta».
 */
export function validateProductModifiers(
  productName: string,
  groups: ProductModifierGroup[],
  modifierIds: string[],
): ProductModifiersResult {
  const fail = (msg: string): ProductModifiersResult => ({
    ok: false,
    error: `${productName}: ${msg}`,
  });

  if (new Set(modifierIds).size !== modifierIds.length) {
    return fail("hay opciones repetidas. Revisá lo que elegiste.");
  }

  const groupByModifier = new Map<string, ProductModifierGroup>();
  for (const g of groups) {
    for (const m of g.modifiers) groupByModifier.set(m.id, g);
  }

  const countByGroup = new Map<string, number>();
  for (const id of modifierIds) {
    const group = groupByModifier.get(id);
    if (!group) {
      return fail("una de las opciones elegidas no corresponde a este producto.");
    }
    countByGroup.set(group.id, (countByGroup.get(group.id) ?? 0) + 1);
  }

  for (const g of groups) {
    if (!g.modifiers.some((m) => m.is_available)) continue;
    const count = countByGroup.get(g.id) ?? 0;
    const min = Math.max(g.min_selection, g.is_required ? 1 : 0);
    if (count < min) {
      return fail(
        min === 1
          ? `elegí una opción de ${g.name}`
          : `elegí al menos ${opciones(min)} de ${g.name}`,
      );
    }
    if (count > g.max_selection) {
      return fail(
        `podés elegir hasta ${opciones(g.max_selection)} de ${g.name}`,
      );
    }
  }

  return { ok: true };
}
