/**
 * Alcance de un print-agent (spec 124): qué impresoras puede tocar.
 *
 * Un negocio puede tener más de un agente —golf tiene una PC por caja, en LANs
 * distintas— y cada uno sólo llega a las impresoras de su red. El alcance se
 * declara como lista de IPs o rangos CIDR y se filtra por el `printer_ip` que
 * cada trabajo ya trae resuelto, así que la misma regla cubre las cuatro
 * familias de papel (comanda, control, cuenta, factura) sin tener que declarar
 * sectores, salones y cajas por separado.
 *
 * Lógica pura, sin DB ni I/O: la comparte el endpoint del agente con la UI que
 * valida lo que se carga.
 *
 * Los defaults van todos en la misma dirección: **ante la duda, se sirve el
 * trabajo**. Un agente que recibe de más hace ruido (y ni siquiera imprime: no
 * puede abrir el socket); uno que recibe de menos deja al local sin papel en
 * medio del servicio, en silencio.
 */

export type PrinterScope = string[] | null | undefined;

/** `local:NOMBRE` — spec 181. Espejo de `isLocalPrinterTarget` en schemas.ts. */
function esDestinoLocal(entrada: string): boolean {
  return entrada.toLowerCase().startsWith("local:");
}

function esDestinoLocalValido(entrada: string): boolean {
  if (!esDestinoLocal(entrada)) return false;
  const nombre = entrada.slice("local:".length).trim();
  return nombre.length > 0 && !/[\\/\x00-\x1f]/.test(nombre);
}

/** Un rango parseado a enteros: `base` ya enmascarada + cantidad de bits. */
type Rango = { base: number; bits: number };

/**
 * IPv4 a entero sin signo. Estricto a propósito: cuatro octetos decimales de
 * 0-255, sin ceros a la izquierda que puedan leerse como octal ("010").
 */
function ipv4ANumero(raw: string): number | null {
  const partes = raw.split(".");
  if (partes.length !== 4) return null;
  let n = 0;
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    if (parte.length > 1 && parte.startsWith("0")) return null;
    const octeto = Number(parte);
    if (octeto > 255) return null;
    n = n * 256 + octeto;
  }
  return n;
}

/** `"192.168.100.0/24"` o `"10.0.0.7"` (= /32) → rango. `null` si no parsea. */
function parsearRango(entrada: string): Rango | null {
  const limpio = entrada.trim();
  if (!limpio) return null;

  const barra = limpio.indexOf("/");
  if (barra === -1) {
    const base = ipv4ANumero(limpio);
    return base === null ? null : { base, bits: 32 };
  }

  const base = ipv4ANumero(limpio.slice(0, barra));
  if (base === null) return null;

  const bitsRaw = limpio.slice(barra + 1);
  if (!/^\d{1,2}$/.test(bitsRaw)) return null;
  const bits = Number(bitsRaw);
  if (bits > 32) return null;

  // Se enmascara la base: `192.168.100.213/24` es, en los hechos,
  // `192.168.100.0/24`, y escribirlo así es lo que va a hacer cualquiera que
  // copie la IP de una comandera y le agregue el prefijo.
  // `>>> 0` en las dos puntas de la comparación: `&` devuelve int32 con signo y
  // cualquier IP de 192.x para arriba pasa 2^31.
  return { base: (base & mascara(bits)) >>> 0, bits };
}

/** Máscara de `bits` bits como entero sin signo (`>>> 0` evita el signo de JS). */
function mascara(bits: number): number {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
}

/**
 * ¿Este agente llega a esta impresora?
 *
 * - Sin scope (o vacío) → sí: es el negocio de un solo agente, como hasta hoy.
 * - Trabajo sin IP resoluble → sí, se le sirve a todos. Hoy esos trabajos se
 *   sirven igual y el agente los saltea; filtrarlos acá los haría desaparecer
 *   del pull sin que nadie los vea.
 * - Destino que no es IPv4 → también se le sirve a todos. `isValidPrinterHost`
 *   acepta hostnames (`comandera-cocina.local`) y ahí no hay forma de decidir a
 *   qué subred pertenece: sólo el agente, que resuelve el nombre en su LAN, lo
 *   sabe. Descartarlo dejaría esa comandera huérfana sin una sola traza.
 * - Una entrada inválida del scope no matchea, pero no rompe ni tumba a las
 *   demás: esto corre en el camino caliente del pull.
 */
export function alcanzaLaImpresora(
  scope: PrinterScope,
  printerIp: string | null | undefined,
): boolean {
  const ip = printerIp?.trim();

  // Spec 181 · D3 — un destino local es un nombre para el spooler de UNA
  // compu: lo alcanza sólo el agente que lo lista textual. Acá el default se
  // invierte a propósito: «sin alcance» significa «todas las IPs», no «todas
  // las USB del mundo» — servirlo a todos mandaría el control de la Terminal
  // 2 al agente de cocina, que reportaría `failed` sobre un papel que la
  // terminal sacó perfecto.
  if (ip && esDestinoLocal(ip)) {
    const objetivo = ip.toLowerCase();
    return (scope ?? []).some((e) => e.trim().toLowerCase() === objetivo);
  }

  if (!scope || scope.length === 0) return true;
  if (!ip) return true;

  const objetivo = ipv4ANumero(ip);
  if (objetivo === null) return true;

  return scope.some((entrada) => {
    const rango = parsearRango(entrada);
    if (!rango) return false;
    return (objetivo & mascara(rango.bits)) >>> 0 === rango.base;
  });
}

/**
 * Normaliza lo que se carga por UI: acepta un textarea (coma o salto de línea)
 * o una lista ya armada, limpia, deduplica y **valida**. Vacío → `null`, o sea
 * "sin restricción", nunca `[]`.
 *
 * Acá sí tira: es el borde de escritura, donde un error tiene que verse al
 * guardar y no seis horas después con el local sin comandas.
 */
export function normalizarScope(
  entrada: string | string[] | null | undefined,
): string[] | null {
  if (entrada == null) return null;

  const crudas = Array.isArray(entrada) ? entrada : entrada.split(/[,\n]/);
  const limpias = crudas.map((e) => e.trim()).filter(Boolean);
  if (limpias.length === 0) return null;

  const invalida = limpias.find(
    (e) => parsearRango(e) === null && !esDestinoLocalValido(e),
  );
  if (invalida) {
    throw new Error(
      `"${invalida}" no es una IP, un rango ni una impresora local válida (ej: 192.168.100.7, 192.168.100.0/24 o local:CONTROL-T1)`,
    );
  }

  return [...new Set(limpias)];
}
