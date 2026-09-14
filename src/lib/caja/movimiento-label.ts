import type { CajaMovimientoKind } from "./types";

/**
 * Cómo se nombra y hacia dónde va cada movimiento de caja (issue #299).
 *
 * Vive acá, y no en cada componente, porque la spec 177 · Parte B agregó
 * `propina` como tercer `kind` y **cuatro renderers se habían quedado con una
 * condición binaria** (`kind === "sangria" ? … : …`). El peor caso era la lista
 * del período en `caja-admin-board`: una propina caía en la rama del `else` y
 * se dibujaba como «Ingreso», en verde y con signo `+`. El arqueo daba bien
 * —`calculateExpectedCash` sí la resta— pero la línea decía que entró plata que
 * había salido, y ésa es justo la línea que se lee para entender el número que
 * hay que contar.
 *
 * Los dos mapas son `Record<CajaMovimientoKind, …>` **a propósito**: un cuarto
 * `kind` rompe el build acá en vez de renderizarse mal y en silencio, que es
 * exactamente lo que pasó esta vez.
 */
export const MOVIMIENTO_LABEL: Record<CajaMovimientoKind, string> = {
  sangria: "Sangría",
  ingreso: "Ingreso",
  // «pagada» y no «Propina» a secas: la distingue de la propina *cobrada*, que
  // en la misma pantalla viaja adentro del cobro. Es el rótulo que el drawer
  // del libro ya usaba.
  propina: "Propina pagada",
};

/**
 * Si el movimiento **saca** plata del cajón.
 *
 * El signo, el color y la flecha salen de acá. `ingreso` es el único que mete
 * plata; la sangría se la lleva el dueño y la propina se le paga al mozo, pero
 * las dos salen del mismo cajón (spec 177 · D6).
 */
const DIRECCION: Record<CajaMovimientoKind, "entra" | "sale"> = {
  sangria: "sale",
  ingreso: "entra",
  propina: "sale",
};

export function saleDelCajon(kind: CajaMovimientoKind): boolean {
  return DIRECCION[kind] === "sale";
}
