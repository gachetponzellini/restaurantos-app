/**
 * Navegación del editor del catálogo (spec 205 · D4/D6). Lógica pura: el
 * componente sólo pinta lo que dice este estado.
 *
 * - **‹ ›** recorre la lista *filtrada* que el usuario tiene en pantalla: editar
 *   el precio de 20 bebidas es abrir la primera y apretar → 19 veces.
 * - **Editores enlazados**: dentro de un editor, el nombre de otra entidad
 *   (la categoría de un producto, el insumo de una receta) abre ese otro editor
 *   y apila el actual. «Volver» desapila.
 *
 * ‹ › sólo existe en el editor raíz: un editor abierto por un enlace no vino de
 * ninguna lista, así que no tiene anterior ni siguiente.
 */

export type EditorRef = {
  /** Qué entidad: "product", "category", "ingredient"… */
  kind: string;
  id: string;
  /** Sección a la que abre (ej. Costeo abre el producto en "precio"). */
  section?: string;
};

export type EditorState = {
  current: EditorRef | null;
  stack: EditorRef[];
};

export const CLOSED: EditorState = { current: null, stack: [] };

export function neighbors(
  ids: readonly string[],
  id: string,
): { index: number; total: number; prev: string | null; next: string | null } {
  const index = ids.indexOf(id);
  if (index < 0) return { index, total: ids.length, prev: null, next: null };
  return {
    index,
    total: ids.length,
    prev: index > 0 ? ids[index - 1] : null,
    next: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

const same = (a: EditorRef, b: EditorRef) => a.kind === b.kind && a.id === b.id;

/** Abrir desde la lista: sin pila. */
export function openRoot(ref: EditorRef): EditorState {
  return { current: ref, stack: [] };
}

/** Abrir un enlace desde dentro de un editor: apila el actual. */
export function openLinked(state: EditorState, ref: EditorRef): EditorState {
  if (!state.current) return openRoot(ref);
  if (same(state.current, ref)) return state;
  return { current: ref, stack: [...state.stack, state.current] };
}

/** «Volver»: desapila. Sin pila, cierra. */
export function goBack(state: EditorState): EditorState {
  if (state.stack.length === 0) return CLOSED;
  return {
    current: state.stack[state.stack.length - 1],
    stack: state.stack.slice(0, -1),
  };
}

/** ‹ ›: pasa al vecino de la lista conservando la sección. Sólo en la raíz. */
export function stepTo(state: EditorState, id: string): EditorState {
  if (!state.current || state.stack.length > 0) return state;
  return { current: { ...state.current, id }, stack: [] };
}

export function closeEditor(): EditorState {
  return CLOSED;
}
