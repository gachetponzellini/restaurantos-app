/**
 * Lo que el cliente había elegido antes de ir a loguearse (auditoría de
 * reservas · media). El flujo arma `next=/reservar?date=&party=&slot=` (o
 * `service=` en flexible), pero nadie lo leía y el cliente volvía a «hoy, 2
 * personas». Sólo se toma lo que tiene formato válido; lo demás se ignora.
 */
export type ReservaInicial = {
  date?: string;
  party?: number;
  slot?: string;
  service?: string;
  salon?: string;
};

type Param = string | string[] | undefined;
const primero = (v: Param) => (Array.isArray(v) ? v[0] : v);

export function parseReservaInicial(
  sp: Record<string, Param>,
  opts: { maxParty: number },
): ReservaInicial {
  const out: ReservaInicial = {};
  const date = primero(sp.date);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  const party = Number(primero(sp.party));
  if (Number.isInteger(party) && party >= 1 && party <= opts.maxParty) out.party = party;
  const slot = primero(sp.slot);
  if (slot && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) out.slot = slot;
  const service = primero(sp.service);
  if (service && service.length <= 60) out.service = service;
  const salon = primero(sp.salon);
  if (salon && /^[0-9a-f-]{36}$/i.test(salon)) out.salon = salon;
  return out;
}
