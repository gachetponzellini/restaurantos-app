import { rindeSoloSinMesa } from "./canal-rendicion";

/**
 * Quién tiene que rendir antes de que se cierre la caja (spec 139 · D3, D4).
 *
 * Lógica pura, sin DB: la comparte la pantalla del cierre con la server action,
 * así que lo que el modal lista es exactamente lo que el bloqueo exige.
 *
 * Dos reglas, y las dos importan por lo que dejan afuera:
 *
 *  - **Rinde el que cobró, no el que tiene efectivo** (D4). El reparto del
 *    cierre filtra por `efectivo_cents > 0` porque pinta el cajón; la
 *    obligación mira `pagos_count`, así que el mozo que hizo toda la noche con
 *    tarjeta también cierra su período y entrega sus tickets. Si no, su período
 *    queda abierto arrastrando cobros viejos a la rendición de mañana.
 *
 *  - **El operador de la caja no rinde** (D3). El que está parado en la caja
 *    cobra directo al cajón: esa plata ya está adentro. Pedirle que se rinda a
 *    sí mismo es un trámite diario que además descuadra el reparto, que hoy le
 *    resta al cajón lo que ese usuario cobró.
 *
 *  - **El encargado rinde sólo takeaway y delivery** (spec 203, revierte en
 *    parte el #264). Lo que cobra en el salón entra derecho al cajón, así que
 *    la query de la pendiente (`calcularRendicionPorCanal`) ya se lo saca:
 *    acá, si le queda algún cobro, es de mostrador o delivery y lo rinde —
 *    **aunque esté asignado como operador de la caja**, porque D3 cubre la
 *    plata del salón, no la de la compu del mostrador.
 */
export type MozoConCobros = {
  mozo_id: string;
  mozo_name: string;
  efectivo_cents: number;
  pagos_count: number;
  /** Rol en el negocio. `admin` y `encargado` rinden sólo lo sin mesa (spec 203). */
  mozo_role?: string;
};


export function mozosQueDebenRendir<T extends MozoConCobros>(
  pendientes: T[],
  operadoresDeCaja: string[],
): T[] {
  const operadores = new Set(operadoresDeCaja);

  return pendientes
    .filter(
      (m) =>
        m.pagos_count > 0 &&
        (rindeSoloSinMesa(m.mozo_role) || !operadores.has(m.mozo_id)),
    )
    .sort(
      (a, b) =>
        b.efectivo_cents - a.efectivo_cents ||
        a.mozo_name.localeCompare(b.mozo_name, "es"),
    );
}
