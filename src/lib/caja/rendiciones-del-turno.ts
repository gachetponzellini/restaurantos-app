/**
 * La rendición de un mozo en este turno, en esta caja (spec 217): la que
 * reimprime su fila en «Ya rindieron». La última que no se anuló; las viejas
 * sin caja (antes de la caja v2) no cuentan porque no se sabe de qué caja son.
 */
export type RendicionParaFila = {
  id: string;
  mozo_id: string;
  caja_id?: string | null;
  created_at: string;
  anulada_at?: string | null;
};

export function rendicionDelTurno<R extends RendicionParaFila>(
  rendiciones: R[],
  mozoId: string,
  cajaId: string,
  desde: string | null,
): R | null {
  const desdeMs = desde ? new Date(desde).getTime() : -Infinity;
  let ultima: R | null = null;
  for (const r of rendiciones) {
    if (r.mozo_id !== mozoId || r.caja_id !== cajaId || r.anulada_at) continue;
    if (new Date(r.created_at).getTime() < desdeMs) continue;
    if (!ultima || r.created_at > ultima.created_at) ultima = r;
  }
  return ultima;
}
