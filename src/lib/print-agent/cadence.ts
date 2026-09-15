/**
 * La cadencia del print-agent: cada cuánto pregunta, cuánto lo retiene el
 * server y a partir de cuándo el panel lo canta desconectado (spec 183).
 *
 * Todo junto y puro a propósito. Son números que se leen de a tres —el sleep
 * del agente, la retención del server y el umbral del panel— y separarlos es
 * lo que dejó el bug que la D5 arregla: `OFFLINE_THRESHOLD_MS = 60_000` vivía
 * suelto en un componente, así que subir la cadencia a 30 s hacía que el panel
 * dijera «sin conexión» sin que nada estuviera mal.
 *
 * La fórmula que gobierna todo esto, medida en golf el 2026-09-15 con 30 ms de
 * error:
 *
 *     período = sleep + (requests × RTT)
 *
 * `pollMs` NO es el período: es el sleep entre vueltas. El RTT del local a
 * `iad1` es de 0,4–0,7 s por request y se mueve con la hora del día.
 */

/**
 * El piso de red por request, redondeado para arriba (spec 183 · «El piso de
 * red»). Medimos 0,76 s por tick de día y 1,4 s de noche con dos requests;
 * queda 1 s como estimación conservadora para *un* request, que es lo que
 * manda un agente con la D1 aplicada.
 *
 * Se usa sólo para dimensionar umbrales — nunca para esperar.
 */
export const RTT_PISO_MS = 1_000;

/**
 * Cuánto retiene el GET la respuesta cuando no hay nada para imprimir
 * (spec 183 · D5).
 *
 * Es el corazón de la decisión: en vez de contestar «no hay nada» al toque y
 * dejar que el agente vuelva a preguntar, el server **espera mirando la cola**
 * y contesta apenas aparece algo. El agente ocioso pregunta cada ~30 s —barato—
 * y cuando hay trabajo la respuesta sale más rápido que antes, no más lento.
 *
 * Funciona con el `.exe` ya instalado: su loop es `tick(); sleep(pollMs)` y
 * `tick()` espera la respuesta HTTP. Retener alarga el período sin que el local
 * se entere, y por eso esta decisión no necesita una visita al local.
 *
 * 25 s + el sleep de un agente ocioso (5 s) + el RTT dan los ~30 s que se
 * buscaban. El techo real es `functionDefaultTimeout: 300`, así que hay lugar
 * de sobra; lo que acota el valor es cuánto tarda en notarse un agente muerto
 * (ver `OFFLINE_THRESHOLD_MS`), no el timeout.
 */
export const HOLD_MS = 25_000;

/**
 * Cada cuánto mira la cola el server mientras retiene.
 *
 * Es la latencia real de una comanda cuando el agente está retenido: 2 s, que
 * es mejor que el período que golf tiene hoy (10,99 s medidos). Bajarlo a 1 s
 * duplicaría las queries de la sonda sin que nadie note la diferencia en la
 * cocina; subirlo a 5 s empieza a notarse en la prueba de impresora, que tiene
 * una persona parada al lado.
 */
export const PROBE_MS = 2_000;

/** Sleep cuando este pull trajo trabajo, o hubo movimiento hace poco. */
export const POLL_RAPIDO_MS = 1_000;
/** Sleep del negocio abierto pero sin movimiento. */
export const POLL_OCIOSO_MS = 5_000;
/** Sleep del negocio cerrado. El techo: nunca se manda más que esto. */
export const POLL_CERRADO_MS = 20_000;

/**
 * Ventana de «hubo movimiento hace poco» (spec 183 · D2). Deliberadamente
 * generosa: una mesa que pide entrada y después plato entra entera, y
 * equivocarse para el lado rápido no cuesta nada.
 */
export const ACTIVIDAD_RECIENTE_MS = 3 * 60_000;

/**
 * El período más lento que puede tener un agente que no tiene nada que
 * imprimir: retención + el sleep más largo que el server manda + el RTT.
 *
 * Es el número contra el que se dimensiona el umbral de «sin conexión».
 */
export function cadenciaOciosaMaxMs(): number {
  return HOLD_MS + POLL_CERRADO_MS + RTT_PISO_MS;
}

/** Cuántos períodos de gracia antes de cantar «sin conexión». */
export const PERIODOS_DE_GRACIA = 3;

/**
 * A partir de cuándo el panel dice que la comandera está sin conexión
 * (spec 183 · D5, arreglo 1).
 *
 * Estaba clavado en 60_000 en dos componentes distintos, dimensionado para la
 * cadencia de 1 s de la spec 28. Con la retención, el período ocioso llega a
 * ~46 s: con 60 s de umbral entraba **un solo latido** antes de la alarma, así
 * que un tick lento hacía que el panel dijera «sin conexión» con el agente
 * perfectamente vivo. Falsa alarma recurrente, que es la peor clase de alarma:
 * enseña a ignorarlas.
 *
 * Se deriva, no se elige: tres períodos del peor caso ocioso. Dos latidos
 * perdidos seguidos todavía no alarman; el precio es que un agente realmente
 * muerto tarda ~2,3 min en cantarse en vez de 1. Si eso es mucho, lo que hay
 * que bajar es `HOLD_MS`, no este número — bajarlo acá trae de vuelta la falsa
 * alarma.
 */
export const OFFLINE_THRESHOLD_MS = PERIODOS_DE_GRACIA * cadenciaOciosaMaxMs();

/**
 * Cuánto retener esta request. `wait_ms` en la query lo acota — es lo que usa
 * el `--once` del agente de referencia para no colgarse 25 s, y la salida de
 * emergencia si la retención resultara mala idea en producción.
 *
 * Un valor inválido (texto, negativo) cae al default: el parámetro es una
 * optimización del llamador, no algo que pueda romper el contrato.
 */
export function retencionMs(waitMsPedido?: string | number | null): number {
  if (waitMsPedido == null || waitMsPedido === "") return HOLD_MS;
  const n =
    typeof waitMsPedido === "number" ? waitMsPedido : Number(waitMsPedido);
  if (!Number.isFinite(n) || n < 0) return HOLD_MS;
  return Math.min(Math.trunc(n), HOLD_MS);
}

/** Lo que el server necesita saber del negocio para elegir la cadencia. */
export type SituacionDelNegocio = {
  /** Este pull trajo trabajo. */
  hayTrabajo: boolean;
  /** Hubo alguna comanda en los últimos `ACTIVIDAD_RECIENTE_MS`. */
  hayActividadReciente: boolean;
  /** El negocio está dentro de su horario cargado. */
  abierto: boolean;
};

/**
 * Cuánto tiene que dormir el agente después de esta respuesta (spec 183 · D2).
 * Viaja como `next_poll_ms` en el GET; un agente viejo lo ignora y usa su
 * `cfg.pollMs`.
 *
 * Es un **sleep, no un período**: el período es esto más el RTT del request
 * (~0,7 s), y más la retención si la respuesta vino vacía. Quien toque estos
 * números tiene que acordarse de sumarle el piso antes de comparar contra una
 * medición.
 *
 * Lo importante de la decisión no es la tabla, es quién la decide: tunear la
 * cadencia deja de requerir una visita al local. Cambiar el 1000 por 3000 en
 * golf costó tres intentos, PowerShell elevado y una caída de 3 minutos (D3).
 *
 * El orden de las reglas importa y es el mitigante del riesgo: **el movimiento
 * gana sobre el horario**. Un negocio con los `business_hours` mal cargados se
 * iría a 20 s en pleno servicio; si hay comandas, es rápido, diga lo que diga
 * la config. Y el peor caso —la primera comanda después de un rato muerto—
 * pasa de 1 s a 5 s de espera, que con la retención de la D5 ya no se paga casi
 * nunca: si el agente está retenido, la comanda sale en ~2 s.
 */
export function proximoPollMs({
  hayTrabajo,
  hayActividadReciente,
  abierto,
}: SituacionDelNegocio): number {
  if (hayTrabajo || hayActividadReciente) return POLL_RAPIDO_MS;
  return abierto ? POLL_OCIOSO_MS : POLL_CERRADO_MS;
}
