import { formatInTimeZone } from "date-fns-tz";

import type { FloorTable, Reservation } from "@/lib/reservations/types";

/**
 * El plano del día completo (spec 137, rehecho en la 192) — reglas puras.
 *
 * El plano que ya existe (`salon-desktop`) es la foto del **ahora**: las
 * reservas entran recién cuando faltan 3 h (`VENTANA_RESERVA_EN_PLANO_MS`),
 * porque a quien atiende el mediodía una reserva de las 21 no le dice nada.
 *
 * Acá la pregunta es la opuesta: **qué tiene reservado el salón hoy**. La
 * primera versión la contestaba con un slider de hora; la 192 lo sacó — el día
 * entra entero en el dibujo, y los turnos quedan como filtro, no como recorrido
 * obligatorio.
 */

export type EstadoDeMesa = "libre" | "reservada" | "pendiente";

export type MesaEnElPlano = {
  mesa: FloorTable;
  estado: EstadoDeMesa;
  /** Todas las reservas del día en esa mesa, ordenadas por hora (spec 192). */
  reservas: ReservaEnPlano[];
};

export type ReservaEnPlano = Pick<
  Reservation,
  "id" | "table_id" | "starts_at" | "ends_at" | "status" | "party_size" | "customer_name"
> & {
  service?: string | null;
  floor_plan_id?: string | null;
  /**
   * Spec 189 — el resto de la ficha. El plano es la vista de entrada, así que
   * tocar una mesa tiene que contestar lo mismo que contestaba la fila de la
   * lista: quién, a qué teléfono, con qué nota. Son opcionales porque nada de
   * la geometría depende de ellos: las reglas puras siguen andando sin la
   * ficha.
   */
  customer_phone?: string | null;
  notes?: string | null;
  source?: Reservation["source"];
  created_at?: string;
};

/** Los turnos del día. La reserva cae en uno por su hora de inicio. */
export const TURNOS = [
  { id: "mediodia", label: "Mediodía", desde: 0, hasta: 17 },
  { id: "tarde", label: "Tarde", desde: 17, hasta: 20 },
  { id: "noche", label: "Noche", desde: 20, hasta: 24 },
] as const;

export type TurnoId = (typeof TURNOS)[number]["id"];

/** El turno al que pertenece una reserva, por su hora local de inicio. */
export function turnoDe(reserva: ReservaEnPlano, timezone: string): TurnoId {
  const h = Number(formatInTimeZone(new Date(reserva.starts_at), timezone, "H"));
  return (TURNOS.find((t) => h >= t.desde && h < t.hasta)?.id ?? "noche") as TurnoId;
}

/** Vive = ocupa lugar. Lo cancelado, vencido y terminado no pinta el salón. */
function viva(r: ReservaEnPlano): boolean {
  return r.status === "pending" || r.status === "confirmed" || r.status === "seated";
}

function porHora(a: ReservaEnPlano, b: ReservaEnPlano): number {
  return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
}

/**
 * Todas las reservas del día, mesa por mesa (spec 192).
 *
 * Reemplaza al estado «a una hora» del slider. Un servicio normal tiene una
 * reserva por mesa y por turno: pedirle al encargado que barra una línea de
 * tiempo para encontrarlas era hacerle buscar lo que se puede mostrar de una.
 * Cuando una mesa tiene varias, se listan todas ordenadas por hora — el plano
 * dice «acá hay más», no esconde la segunda.
 *
 * `pendiente` gana sobre `reservada`: lo que el encargado necesita ver es qué
 * mesa se comería una solicitud sin responder.
 */
export function reservasDelDia(
  reservas: ReservaEnPlano[],
  mesas: FloorTable[],
  opciones?: { turno?: TurnoId | null; timezone?: string },
): MesaEnElPlano[] {
  const turno = opciones?.turno ?? null;
  const tz = opciones?.timezone ?? "America/Argentina/Buenos_Aires";
  const activas = reservas.filter(
    (r) => viva(r) && (!turno || turnoDe(r, tz) === turno),
  );

  return mesas.map((mesa) => {
    const encima = activas.filter((r) => r.table_id === mesa.id).sort(porHora);
    if (encima.length === 0) {
      return { mesa, estado: "libre" as const, reservas: encima };
    }
    return {
      mesa,
      estado: encima.some((r) => r.status === "pending")
        ? ("pendiente" as const)
        : ("reservada" as const),
      reservas: encima,
    };
  });
}

/** Cuántas reservas vivas tiene cada turno del día (para los chips). */
export function conteoPorTurno(
  reservas: ReservaEnPlano[],
  timezone: string,
): Record<TurnoId, number> {
  const out = { mediodia: 0, tarde: 0, noche: 0 } as Record<TurnoId, number>;
  for (const r of reservas) if (viva(r)) out[turnoDe(r, timezone)] += 1;
  return out;
}

/**
 * Las reservas del día sin mesa. En flexible son mayoría (la mesa se define al
 * llegar, spec 059): no se pueden dibujar, pero esconderlas haría leer un salón
 * más vacío de lo que está.
 *
 * Spec 192 — devuelve las filas, no sólo el número: un contador que no se puede
 * abrir esconde media noche.
 */
export function sinMesa(
  reservas: ReservaEnPlano[],
  opciones?: { turno?: TurnoId | null; timezone?: string },
): { cantidad: number; cubiertos: number; reservas: ReservaEnPlano[] } {
  const turno = opciones?.turno ?? null;
  const tz = opciones?.timezone ?? "America/Argentina/Buenos_Aires";
  const vivas = reservas
    .filter(
      (r) =>
        r.table_id === null && viva(r) && (!turno || turnoDe(r, tz) === turno),
    )
    .sort(porHora);
  return {
    cantidad: vivas.length,
    cubiertos: vivas.reduce((sum, r) => sum + (r.party_size ?? 0), 0),
    reservas: vivas,
  };
}

/**
 * El `viewBox` que encuadra un conjunto de mesas, con aire alrededor
 * (spec 144). Lo comparten el plano del día y el picker del formulario de
 * reserva: dos planos del mismo salón que encuadraran distinto se leerían como
 * dos salones.
 */
export function encuadreDeMesas(
  mesas: Pick<FloorTable, "x" | "y" | "width" | "height">[],
  pad = 40,
): string {
  if (mesas.length === 0) return "0 0 100 100";
  const minX = Math.min(...mesas.map((t) => t.x)) - pad;
  const minY = Math.min(...mesas.map((t) => t.y)) - pad;
  const maxX = Math.max(...mesas.map((t) => t.x + t.width)) + pad;
  const maxY = Math.max(...mesas.map((t) => t.y + t.height)) + pad;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

/** Cuántos caracteres entran a 9px dentro de una mesa de `width` unidades. */
function cabenChars(width: number): number {
  return Math.max(3, Math.floor((width - 6) / 4.95));
}

/** El nombre como entra en la mesa: el de pila, cortado si hace falta. */
export function nombreEnMesa(nombre: string, width: number): string {
  const limite = cabenChars(width);
  const pila = nombre.trim().split(/\s+/)[0] ?? "";
  if (pila.length <= limite) return pila;
  return `${pila.slice(0, Math.max(1, limite - 1))}…`;
}

/**
 * Los renglones que la mesa muestra sin que la toquen (spec 189/190).
 *
 * La mesa más chica del parque mide 35 unidades: no hay lugar para todo, así
 * que se cae con orden — primero se van los cubiertos, después el nombre. Lo
 * que nunca se va es **la hora**: es lo que se va a buscar al plano, y sin ella
 * una mesa pintada no dice si el problema es a la una o a las nueve.
 *
 * Con más de una reserva en el día, el segundo renglón deja de ser el nombre y
 * pasa a ser «+N más»: el plano avisa que hay otra, en vez de mostrar una sola
 * y hacer creer que la mesa está libre el resto del día.
 */
export function renglonesDeMesa(
  mesa: Pick<FloorTable, "width" | "height">,
  reservas: ReservaEnPlano[],
  timezone: string,
): string[] {
  const [primera, ...resto] = reservas;
  if (!primera) return [];
  const hora = formatInTimeZone(new Date(primera.starts_at), timezone, "HH:mm");
  const cupo = `${primera.party_size}p`;
  const cabenLosDos = cabenChars(mesa.width) >= `${hora} · ${cupo}`.length;
  const linea1 = cabenLosDos ? `${hora} · ${cupo}` : hora;
  // Dos renglones de 10 + la etiqueta de 13 no entran en una mesa baja.
  if (mesa.height < 48) return [linea1];
  const linea2 = resto.length
    ? `+${resto.length} más`
    : nombreEnMesa(primera.customer_name, mesa.width);
  return linea2 ? [linea1, linea2] : [linea1];
}
