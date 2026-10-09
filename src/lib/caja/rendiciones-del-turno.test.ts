import { describe, expect, it } from "vitest";

import { rendicionDelTurno } from "./rendiciones-del-turno";

/**
 * Spec 217 — el «Reimprimir» de cada mozo que ya rindió imprime SU rendición
 * de ESTE turno, en ESA caja: la última que no se anuló.
 */
const r = (o: { id: string; mozo?: string; caja?: string | null; at: string; anulada?: boolean }) => ({
  id: o.id,
  mozo_id: o.mozo ?? "ana",
  caja_id: o.caja === undefined ? "c1" : o.caja,
  created_at: o.at,
  anulada_at: o.anulada ? "2026-10-08T23:00:00Z" : null,
});

describe("rendicionDelTurno", () => {
  const desde = "2026-10-08T12:00:00Z";

  it("la última del mozo en esa caja, dentro del turno", () => {
    const lista = [
      r({ id: "vieja", at: "2026-10-07T22:00:00Z" }),
      r({ id: "primera", at: "2026-10-08T18:00:00Z" }),
      r({ id: "ultima", at: "2026-10-08T22:00:00Z" }),
    ];
    expect(rendicionDelTurno(lista, "ana", "c1", desde)?.id).toBe("ultima");
  });

  it("no mezcla cajas ni mozos", () => {
    const lista = [r({ id: "bar", caja: "c2", at: "2026-10-08T22:00:00Z" }), r({ id: "leo", mozo: "leo", at: "2026-10-08T22:00:00Z" })];
    expect(rendicionDelTurno(lista, "ana", "c1", desde)).toBeNull();
  });

  it("una anulada no se reimprime", () => {
    expect(rendicionDelTurno([r({ id: "x", at: "2026-10-08T22:00:00Z", anulada: true })], "ana", "c1", desde)).toBeNull();
  });

  it("sin turno abierto, vale la última de esa caja", () => {
    expect(rendicionDelTurno([r({ id: "x", at: "2026-10-07T22:00:00Z" })], "ana", "c1", null)?.id).toBe("x");
  });

  it("una rendición vieja sin caja (antes de la caja v2) no cuenta", () => {
    expect(rendicionDelTurno([r({ id: "x", caja: null, at: "2026-10-08T22:00:00Z" })], "ana", "c1", desde)).toBeNull();
  });
});
