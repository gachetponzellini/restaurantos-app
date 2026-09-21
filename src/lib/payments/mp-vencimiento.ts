/**
 * Vencimiento de una preferencia de Mercado Pago (#148 · H-20).
 *
 * Sin vencimiento, un link de pago abandonado servía para siempre: el barrido
 * cancela el pedido impago a las 2 h, y el cliente podía pagarlo igual después.
 * Con esto el link vence a los 90 min, y los cupones offline (Rapipago, Pago
 * Fácil: `date_of_expiration`) también — quedan 30 min de margen.
 *
 * Formato de la documentación de MP: ISO con milisegundos y offset explícito.
 * Argentina es UTC-3 fijo (sin horario de verano).
 */
export const MP_PREFERENCIA_VENCE_MIN = 90;

const OFFSET_AR_MIN = -180;

function isoAR(d: Date): string {
  const local = new Date(d.getTime() + OFFSET_AR_MIN * 60_000);
  return local.toISOString().replace("Z", "-03:00");
}

export function vencimientoPreferencia(
  now: Date = new Date(),
  /** Vencimiento explícito (el reintento de pago lo acota al barrido, #368). */
  hastaExplicito?: Date,
) {
  const hasta =
    hastaExplicito ??
    new Date(now.getTime() + MP_PREFERENCIA_VENCE_MIN * 60_000);
  return {
    expires: true as const,
    expiration_date_from: isoAR(now),
    expiration_date_to: isoAR(hasta),
    date_of_expiration: isoAR(hasta),
  };
}
