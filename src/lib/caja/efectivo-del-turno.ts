/**
 * Dónde está el efectivo del turno (spec 217 · R1).
 *
 * Es la cuenta que hacía `EfectivoDeLaCaja` para una caja, ahora sobre todos
 * los mozos del turno: cada mozo reparte lo que tuvo en la mano (lo de antes +
 * lo que cobró en efectivo) en lo que entregó, lo que todavía tiene (a rendir,
 * o deuda reconocida) y su propina de tarjeta/QR, que se queda de ese
 * efectivo. Si la caja le pagó parte de la propina, esa parte no salió de su
 * efectivo; si la caja todavía le debe, lo que se quedó es todo lo que tenía.
 * Así las partes suman exacto.
 *
 * Los números de cada mozo salen de `saldos_mozos` (base): acá sólo se suman.
 */
export type SaldoParaEfectivo = {
  mozo_name: string;
  anterior_cents: number;
  efectivo_cents: number;
  entregado_cents: number;
  saldo_cents: number;
  deuda: boolean;
};

export type EfectivoDelTurno = {
  /** Lo cobró la caja directo: ya está en el cajón. */
  directoCents: number;
  /** Lo entregaron los mozos: ya está en el cajón. */
  rendidoCents: number;
  /** Lo tienen los mozos y tienen que entregarlo. */
  aRendirCents: number;
  /** Sus propinas de tarjeta/QR: se las quedan del efectivo. */
  propinasCents: number;
  /** «No entregó» reconocido: pasa al turno siguiente. */
  deudaCents: number;
  /** Lo que los mozos traían de antes de la ventana. */
  anteriorCents: number;
  totalCents: number;
  /** Nombre de pila de los que tienen plata para entregar. */
  enManosDe: string[];
};

export function efectivoDelTurno(saldos: SaldoParaEfectivo[], directoCents: number): EfectivoDelTurno {
  const suma = (f: (m: SaldoParaEfectivo) => number) => saldos.reduce((a, m) => a + f(m), 0);
  const rendidoCents = suma((m) => m.entregado_cents);
  const aRendirCents = suma((m) => (m.deuda ? 0 : Math.max(0, m.saldo_cents)));
  const deudaCents = suma((m) => (m.deuda ? Math.max(0, m.saldo_cents) : 0));
  const propinasCents = suma((m) =>
    Math.max(0, m.anterior_cents + m.efectivo_cents - m.entregado_cents - Math.max(0, m.saldo_cents)),
  );
  return {
    directoCents,
    rendidoCents,
    aRendirCents,
    propinasCents,
    deudaCents,
    anteriorCents: suma((m) => m.anterior_cents),
    totalCents: directoCents + rendidoCents + aRendirCents + propinasCents + deudaCents,
    // Un mozo con plata en dos cajas tiene dos filas, pero es una persona.
    enManosDe: [...new Set(saldos.filter((m) => !m.deuda && m.saldo_cents > 0).map((m) => m.mozo_name.split(" ")[0]))],
  };
}
