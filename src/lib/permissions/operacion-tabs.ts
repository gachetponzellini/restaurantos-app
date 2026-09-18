import type { BusinessRole } from "@/lib/admin/context";

/**
 * Las tabs de `/admin/operacion` y quién ve cada una (spec 140 · D2, spec 182).
 *
 * Vive acá y no adentro de `local-shell.tsx` porque **el server también
 * necesita la respuesta**: la página arma una promesa por tab, y la de una tab
 * que el rol no ve no se tiene que crear (spec 182 · D3). Mientras la lista
 * estuvo del lado del cliente, el shell escondía el pane pero la promesa
 * viajaba igual en el payload RSC — la caja, la rendición y los teléfonos de
 * las reservas llegaban al navegador de la terminal, que es una PC compartida
 * por todo el salón.
 */
export const OPERACION_TABS = [
  "salon",
  "reservas",
  "comandas",
  "pedidos",
  "caja",
  // spec 141 — «Cuentas corrientes», no «Cuentas»: en la casa «la cuenta» es la
  // factura de la mesa, y confundirlas en la barra de operación sería caro. Va
  // después de Caja porque es la familia de la plata.
  "cuentas",
  "fichaje",
] as const;

export type OperacionTab = (typeof OPERACION_TABS)[number];

/**
 * Qué tabs ve cada rol. Sin entrada acá = las ve todas.
 *
 * `terminal` es el puesto compartido del salón: opera mesas, mira las comandas
 * y deja que el personal fiche con su PIN. No ve la plata de supervisión
 * —caja, rendición, cuentas corrientes— ni la cola de pedidos de mostrador.
 *
 * **Reservas se le sacó en la spec 182.** La matriz de secciones ya decía
 * `reservas: terminal: "none"` (la 167 cerró `/admin/reservas`); la tab de
 * adentro de Operación vivía en esta otra lista y quedó abierta por olvido. Lo
 * que la terminal necesita del turno —las reservas de hoy, con «Sentar» y
 * asignar mesa— está en el aside del plano, que no se toca. Lo que se va es el
 * libro del día y la bandeja «A confirmar», que además no puede resolver.
 *
 * Rendición además no tendría qué mostrar: con una cuenta compartida por todo
 * el salón, "lo mío" no existe. La plata se atribuye al mozo de cada mesa y la
 * rendición la mira el encargado desde su propia pantalla.
 */
const TABS_POR_ROL: Partial<Record<BusinessRole, readonly OperacionTab[]>> = {
  terminal: ["salon", "comandas", "fichaje"],
};

export function tabsVisiblesEnOperacion(
  role: BusinessRole,
): readonly OperacionTab[] {
  return TABS_POR_ROL[role] ?? OPERACION_TABS;
}

export function veTabDeOperacion(
  role: BusinessRole,
  tab: OperacionTab,
): boolean {
  return tabsVisiblesEnOperacion(role).includes(tab);
}
