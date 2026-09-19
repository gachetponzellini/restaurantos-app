import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";

// ════════════════════════════════════════════════════════════════════════
// El rango del filtro de fechas (spec 153 · D4/D5) — lógica pura, sin DB.
//
// Dos ideas y las dos importan:
//
//   · La granularidad se elige primero (día / mes / año) y después se navega de
//     a uno. El 90 % de las veces se quiere «ayer» o «el mes pasado», y con dos
//     campos de fecha eso son cuatro toques en dos calendarios.
//
//   · **El día va de 6 AM a 6 AM.** Un restaurante cierra a la 1 de la mañana:
//     con el día de calendario el cierre de anoche cae en «Hoy», separado de los
//     cobros que lo produjeron. Con el día operativo el turno entero —los cobros
//     y el corte que los cierra— cae en un solo día.
//
// ⚠️ Esto define QUÉ ENTRA EN CADA FILTRO. No toca ningún cálculo de plata: la
// ventana de un corte sigue siendo `(corte anterior, este corte]` (spec 149 D2),
// que no tiene nada que ver con esto.
// ════════════════════════════════════════════════════════════════════════

export type Granularidad = "dia" | "semana" | "mes" | "anio";

/** Hora local a la que arranca el día operativo. */
export const INICIO_DIA_OPERATIVO_H = 6;

/**
 * El ancla del filtro, en la TZ del negocio: `yyyy-MM-dd` para día, `yyyy-MM`
 * para mes, `yyyy` para año. Viaja en la URL, así que es texto y no `Date`.
 */
export type Ancla = string;

export type RangoFechas = { from: string; to: string };

const H = String(INICIO_DIA_OPERATIVO_H).padStart(2, "0");

/** `yyyy-MM-dd` + 6 AM en la TZ del negocio → el instante UTC. */
function arranque(dia: string, tz: string): Date {
  return fromZonedTime(`${dia}T${H}:00:00`, tz);
}

/** Suma días a un `yyyy-MM-dd` sin pasar por husos: aritmética de calendario. */
function sumarDias(dia: string, delta: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

function sumarMeses(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return t.toISOString().slice(0, 7);
}

/** El lunes de la semana de un `yyyy-MM-dd`: la semana va de lunes a domingo. */
function lunesDe(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return sumarDias(dia, -((dow + 6) % 7));
}

/**
 * En qué día operativo cae un instante. Antes de las 6 AM todavía es el día
 * anterior — es la regla entera de D5, en dos líneas.
 */
export function diaOperativoDe(instante: Date, tz: string): string {
  const hora = Number(formatInTimeZone(instante, tz, "H"));
  const fecha = formatInTimeZone(instante, tz, "yyyy-MM-dd");
  return hora < INICIO_DIA_OPERATIVO_H ? sumarDias(fecha, -1) : fecha;
}

/** El ancla que corresponde a «ahora» para cada granularidad. */
export function anclaDeHoy(
  gran: Granularidad,
  tz: string,
  ahora: Date = new Date(),
): Ancla {
  const dia = diaOperativoDe(ahora, tz);
  if (gran === "dia") return dia;
  if (gran === "semana") return lunesDe(dia);
  if (gran === "mes") return dia.slice(0, 7);
  return dia.slice(0, 4);
}

/**
 * Los bordes del rango, en UTC. `from` inclusivo, `to` exclusivo — el borde
 * derecho es el arranque del período siguiente, así dos períodos consecutivos
 * no comparten ni pierden un instante.
 */
export function rangoDe(
  gran: Granularidad,
  ancla: Ancla,
  tz: string,
): RangoFechas {
  if (gran === "dia") {
    return {
      from: arranque(ancla, tz).toISOString(),
      to: arranque(sumarDias(ancla, 1), tz).toISOString(),
    };
  }
  if (gran === "semana") {
    return {
      from: arranque(ancla, tz).toISOString(),
      to: arranque(sumarDias(ancla, 7), tz).toISOString(),
    };
  }
  if (gran === "mes") {
    return {
      from: arranque(`${ancla}-01`, tz).toISOString(),
      to: arranque(`${sumarMeses(ancla, 1)}-01`, tz).toISOString(),
    };
  }
  const y = Number(ancla);
  return {
    from: arranque(`${y}-01-01`, tz).toISOString(),
    to: arranque(`${y + 1}-01-01`, tz).toISOString(),
  };
}

/** Mover el ancla de a uno. */
export function desplazar(
  gran: Granularidad,
  ancla: Ancla,
  delta: number,
): Ancla {
  if (gran === "dia") return sumarDias(ancla, delta);
  if (gran === "semana") return sumarDias(ancla, 7 * delta);
  if (gran === "mes") return sumarMeses(ancla, delta);
  return String(Number(ancla) + delta);
}

/** El ancla ya es el período corriente: no hay hacia dónde avanzar. */
export function esPresente(
  gran: Granularidad,
  ancla: Ancla,
  tz: string,
  ahora: Date = new Date(),
): boolean {
  return ancla >= anclaDeHoy(gran, tz, ahora);
}

const MAYUS = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Cómo se llama el período. Se nombra solo: «Hoy» y «Ayer» por nombre, el resto
 * por fecha; y el año sólo aparece cuando no es el corriente, para no repetir
 * «2026» en cada paso.
 */
export function etiquetaDe(
  gran: Granularidad,
  ancla: Ancla,
  tz: string,
  ahora: Date = new Date(),
): string {
  const hoy = anclaDeHoy(gran, tz, ahora);

  if (gran === "dia") {
    if (ancla === hoy) return "Hoy";
    if (ancla === sumarDias(hoy, -1)) return "Ayer";
    // Mediodía para que el formateo no se caiga del día por el huso.
    const d = fromZonedTime(`${ancla}T12:00:00`, tz);
    const anioActual = hoy.slice(0, 4);
    const patron = ancla.slice(0, 4) === anioActual ? "EEE d/M" : "EEE d/M/yy";
    return formatInTimeZone(d, tz, patron, { locale: es });
  }

  if (gran === "semana") {
    if (ancla === hoy) return "Esta semana";
    if (ancla === sumarDias(hoy, -7)) return "Semana pasada";
    const d = (dia: string) => fromZonedTime(`${dia}T12:00:00`, tz);
    const patron = ancla.slice(0, 4) === hoy.slice(0, 4) ? "d/M" : "d/M/yy";
    return `${formatInTimeZone(d(ancla), tz, patron)} – ${formatInTimeZone(d(sumarDias(ancla, 6)), tz, patron)}`;
  }

  if (gran === "mes") {
    if (ancla === hoy) return "Este mes";
    const d = fromZonedTime(`${ancla}-01T12:00:00`, tz);
    const mismoAnio = ancla.slice(0, 4) === hoy.slice(0, 4);
    return MAYUS(
      formatInTimeZone(d, tz, mismoAnio ? "LLLL" : "LLLL yyyy", { locale: es }),
    );
  }

  return ancla;
}

/** Las tres opciones del segmentado, en orden. */
export const GRANULARIDADES: { id: Granularidad; label: string }[] = [
  { id: "dia", label: "Día" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "anio", label: "Año" },
];

/** `?gran=` de la URL → una granularidad válida. Default: día (o el que pida la vista). */
export function parseGranularidad(
  raw: string | undefined,
  porDefecto: Granularidad = "dia",
): Granularidad {
  return raw === "dia" || raw === "semana" || raw === "mes" || raw === "anio"
    ? raw
    : porDefecto;
}

/**
 * `?fecha=` de la URL → un ancla válida para esa granularidad. Una basura
 * cae en el período corriente en vez de romper la página.
 */
export function parseAncla(
  gran: Granularidad,
  raw: string | undefined,
  tz: string,
  ahora: Date = new Date(),
): Ancla {
  // La semana se ancla en su lunes: cualquier día válido se normaliza.
  if (gran === "semana") {
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? lunesDe(raw) : anclaDeHoy(gran, tz, ahora);
  }
  const patron =
    gran === "dia" ? /^\d{4}-\d{2}-\d{2}$/ : gran === "mes" ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
  return raw && patron.test(raw) ? raw : anclaDeHoy(gran, tz, ahora);
}
