// ════════════════════════════════════════════════════════════════════════
// Las reglas de una fichada (spec 179). Puras, sin I/O: las comparten las
// tres actions y se prueban sin base.
// ════════════════════════════════════════════════════════════════════════

export type Fichada = { clock_in: string; clock_out: string | null };
export type FichadaConId = Fichada & { id: string };

export type Validacion = { ok: true } | { ok: false; error: string };

/** 24 h. Un turno de cena que termina a las 3 entra; 25 horas es un error de tipeo. */
const MAX_JORNADA_MS = 24 * 60 * 60 * 1000;

function ms(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Lo que una fichada tiene que cumplir por sí sola, antes de mirar las demás.
 */
export function validarFichada(f: Fichada, ahora: number = Date.now()): Validacion {
  const entrada = ms(f.clock_in);
  if (Number.isNaN(entrada)) return { ok: false, error: "La entrada no es una fecha válida." };
  if (entrada > ahora) return { ok: false, error: "La entrada no puede estar en el futuro." };

  if (f.clock_out === null) return { ok: true };

  const salida = ms(f.clock_out);
  if (Number.isNaN(salida)) return { ok: false, error: "La salida no es una fecha válida." };
  if (salida <= entrada) {
    return { ok: false, error: "La salida tiene que ser después de la entrada." };
  }
  if (salida > ahora) return { ok: false, error: "La salida no puede estar en el futuro." };
  if (salida - entrada > MAX_JORNADA_MS) {
    return {
      ok: false,
      error: "Una jornada no puede durar más de 24 horas. ¿Está bien el día?",
    };
  }
  return { ok: true };
}

/**
 * Con cuál de las otras fichadas del mismo empleado se pisa ésta, o `null`.
 *
 * Una fichada **abierta** ocupa desde su entrada en adelante, sin fin: no se
 * puede cargar nada después de ella hasta que se cierre. Tocarse en el borde
 * (salió a las 13:00, volvió a entrar a las 13:00) no es pisarse.
 *
 * `excluirId` es para corregir: la fichada que se está editando no se pisa
 * consigo misma.
 */
export function fichadaSePisa(
  f: Fichada,
  otras: FichadaConId[],
  excluirId?: string,
): FichadaConId | null {
  const ini = ms(f.clock_in);
  const fin = f.clock_out === null ? Number.POSITIVE_INFINITY : ms(f.clock_out);

  for (const o of otras) {
    if (o.id === excluirId) continue;
    const oIni = ms(o.clock_in);
    const oFin = o.clock_out === null ? Number.POSITIVE_INFINITY : ms(o.clock_out);
    // Dos intervalos semiabiertos [ini, fin) se pisan sii cada uno arranca
    // antes de que el otro termine.
    if (ini < oFin && oIni < fin) return o;
  }
  return null;
}
