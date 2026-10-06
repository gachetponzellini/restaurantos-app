import type { CajaMovimientoKind, PaymentMethod } from "./types";

/**
 * Spec 211 · R4 — qué le hace cada línea del período al cajón, y cómo queda.
 *
 * `efectoEnCajon` es la misma regla que `efectivo_esperado_caja` (0134): el
 * efectivo que cobró la caja directo entra; el que cobró un mozo no (lo tiene
 * él hasta que lo entrega); tarjeta/QR no tocan el cajón; ingreso y rendición
 * suman; sangría y propina pagada restan; lo anulado no cuenta.
 *
 * El saldo corrido se arma **hacia atrás desde «Debería haber»**: la línea más
 * nueva deja el cajón exactamente en lo que espera la base, sin depender de
 * cómo se cuenta el retiro del corte anterior.
 */
export type LineaDeCaja =
  | {
      tipo: "cobro";
      id: string;
      createdAt: string;
      method: PaymentMethod;
      amount_cents: number;
      /** `null`: lo cobró la caja. `undefined` (dato viejo): igual que `null`. */
      rinde_mozo_id?: string | null;
    }
  | {
      tipo: "movimiento";
      id: string;
      createdAt: string;
      kind: CajaMovimientoKind;
      amount_cents: number;
      cancelled: boolean;
    };

export function efectoEnCajon(l: LineaDeCaja): number {
  if (l.tipo === "cobro") {
    return l.method === "cash" && !l.rinde_mozo_id ? l.amount_cents : 0;
  }
  if (l.cancelled) return 0;
  return l.kind === "ingreso" || l.kind === "rendicion" ? l.amount_cents : -l.amount_cents;
}

/** `lineas` de la más nueva a la más vieja (como se muestran). */
export function conSaldoCorrido<T extends LineaDeCaja>(
  lineas: T[],
  deberiaHaberCents: number,
): { linea: T; efecto: number; saldoDespues: number }[] {
  let saldo = deberiaHaberCents;
  return lineas.map((linea) => {
    const efecto = efectoEnCajon(linea);
    const fila = { linea, efecto, saldoDespues: saldo };
    saldo -= efecto;
    return fila;
  });
}

export type FiltroCaja = "todo" | "cajon" | "cobros" | "caja" | "mozos";

export const FILTROS_CAJA: { id: FiltroCaja; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "cajon", label: "Mueven el cajón" },
  { id: "cobros", label: "Cobros" },
  { id: "caja", label: "Sangrías e ingresos" },
  { id: "mozos", label: "Rendiciones" },
];

export function pasaFiltro(l: LineaDeCaja, f: FiltroCaja): boolean {
  switch (f) {
    case "todo":
      return true;
    case "cajon":
      return efectoEnCajon(l) !== 0;
    case "cobros":
      return l.tipo === "cobro";
    case "caja":
      return l.tipo === "movimiento" && (l.kind === "sangria" || l.kind === "ingreso");
    case "mozos":
      return l.tipo === "movimiento" && (l.kind === "rendicion" || l.kind === "propina");
  }
}
