/**
 * Spec 202 — qué muestra el plano del operativo: un salón o todos juntos.
 *
 * `activeId` es lo que eligió la encargada (un id de salón o `VISTA_TODOS`).
 * «Todos» sólo existe si hay más de un salón para mostrar; con uno solo, o si
 * el id ya no está entre los mostrados, cae al primero.
 */
export const VISTA_TODOS = "all";

export type VistaSalon =
  | { modo: "todos"; planIds: string[] }
  | { modo: "uno"; planId: string | null };

export function resolverVistaSalon(
  shownPlanIds: string[],
  activeId: string,
): VistaSalon {
  if (activeId === VISTA_TODOS && shownPlanIds.length > 1) {
    return { modo: "todos", planIds: shownPlanIds };
  }
  return {
    modo: "uno",
    planId: shownPlanIds.includes(activeId)
      ? activeId
      : (shownPlanIds[0] ?? null),
  };
}
