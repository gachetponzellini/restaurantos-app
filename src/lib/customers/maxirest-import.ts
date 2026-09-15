import { normalizePhone } from "@/lib/phone";

// ============================================================================
// De `mxcli` (MaxiRest) a `customers` + `customer_addresses` — el mapeo puro
// (spec 195, #320).
//
// Vive acá y no en `scripts/` porque decide dos cosas que se ven en la calle:
// **qué teléfono** queda como identidad del cliente y **qué lote** va a leer el
// repartidor. Acá se testea; el script sólo lee el dump, llama a esto, escribe
// el CSV de control y —recién con `--apply`— la base.
// ============================================================================

/** Las columnas de `mxcli` que este import mira. Todas llegan como texto: son
 *  `char(n)` en MaxiRest, incluido el `codigo`. */
export type MxcliClienteRow = {
  codigo: string;
  nombre: string;
  apellido: string;
  razon: string;
  calle: string;
  altura: string;
  telefono: string;
  celular: string;
  e_mail: string;
};

/** Un cliente listo para `customers` + su lote para `customer_addresses`. */
export type ClienteImportado = {
  /** `mxcli.codigo` — sólo para rastrear la fila de origen en el CSV. */
  codigo: string;
  /** Digits-only, como lo guarda `customers.phone` (identidad del cliente). */
  phone: string;
  name: string | null;
  /** El número de lote, ya resuelto. `null` = no se pudo deducir. */
  lote: string | null;
  /** Cómo se dedujo — va al CSV para que el local pueda auditarlo. */
  loteOrigen: "altura" | "calle-lote" | "calle-numero" | "codigo" | null;
  /** La calle del barrio, referencia del repartidor. No es la dirección. */
  calle: string | null;
  /** Algo que un humano tiene que mirar antes de confiar en la fila. */
  aviso: string | null;
};

export type PlanImportClientes = {
  clientes: ClienteImportado[];
  /** Filas que no entran, con el motivo. La mayoría: sin teléfono. */
  descartados: { codigo: string; nombre: string; motivo: string }[];
};

/** Los códigos de cliente por debajo de este número se cargaron en orden de
 *  lote: el código ES el lote. Arriba son altas nuevas y clientes de
 *  facturación, donde el código ya no significa nada. */
const CODIGO_ES_LOTE_HASTA = 700;

/** Un teléfono argentino sin 0 ni 15 tiene 10 dígitos. Menos que eso es un
 *  interno del barrio («4938031») o un fijo viejo sin característica: no sirve
 *  para llamar de afuera ni para WhatsApp. */
const DIGITOS_MINIMOS = 10;

const BASURA = /^x+$/i;

/** Limpia el relleno que dejó la carga en MaxiRest: «xxxx», «XXX». */
function limpiar(valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  return BASURA.test(v) ? "" : v;
}

/**
 * El teléfono del cliente. Prefiere el celular —es el que contesta y el que
 * sirve para WhatsApp— y cae al fijo sólo si tiene largo de número real.
 */
export function telefonoDeCliente(row: MxcliClienteRow): string {
  const celular = normalizePhone(row.celular);
  if (celular.length >= DIGITOS_MINIMOS) return celular;
  const fijo = normalizePhone(row.telefono);
  if (fijo.length >= DIGITOS_MINIMOS) return fijo;
  return "";
}

/**
 * El número de lote, que MaxiRest guarda de tres formas distintas porque
 * nunca tuvo un campo para él:
 *
 * 1. **`altura`** — el caso normal. Los primeros 700 clientes se cargaron en
 *    orden de lote, así que suele coincidir con el `codigo`.
 * 2. **`calle` = «LOTE 354»** — las altas nuevas lo escribieron a mano ahí.
 * 3. **`calle` numérica** — algún alta puso el número solo.
 *
 * Si nada de eso está pero el código cae en el rango viejo, el código es el
 * lote. `LOS RHUS 420` (código 707) es la prueba de que manda la altura y no
 * el código: ese cliente se dio de alta último y vive en el lote 420.
 */
export function loteDeCliente(
  row: MxcliClienteRow,
): { lote: string; origen: NonNullable<ClienteImportado["loteOrigen"]> } | null {
  const altura = limpiar(row.altura);
  if (/^\d+$/.test(altura)) {
    return { lote: String(parseInt(altura, 10)), origen: "altura" };
  }

  const calle = limpiar(row.calle);
  const escrito = calle.match(/LOTE\s*(\d+)/i);
  if (escrito) return { lote: String(parseInt(escrito[1], 10)), origen: "calle-lote" };
  if (/^\d+$/.test(calle)) {
    return { lote: String(parseInt(calle, 10)), origen: "calle-numero" };
  }

  const codigo = parseInt(row.codigo, 10);
  if (Number.isFinite(codigo) && codigo < CODIGO_ES_LOTE_HASTA) {
    return { lote: String(codigo), origen: "codigo" };
  }
  return null;
}

/**
 * El nombre, como lo va a ver el que atiende el teléfono.
 *
 * MaxiRest tiene los dos campos mezclados: a veces el apellido está en
 * `nombre`, a veces el mismo apellido está repetido en los dos («FARIAS
 * FARIAS»), y a veces uno de los dos es relleno.
 */
export function nombreDeCliente(row: MxcliClienteRow): string | null {
  const nombre = limpiar(row.nombre);
  const apellido = limpiar(row.apellido);
  if (nombre && apellido && nombre.toUpperCase() === apellido.toUpperCase()) {
    return apellido;
  }
  const completo = [nombre, apellido].filter(Boolean).join(" ").trim();
  return completo || limpiar(row.razon) || null;
}

/**
 * Qué se importa y qué queda afuera.
 *
 * **Sin teléfono no hay cliente**: `customers` se identifica por
 * `(business_id, phone)`, así que una fila sin número no tiene dónde vivir —y
 * un placeholder ensuciaría la base para siempre. De las 782 filas de KCC
 * entran 153.
 *
 * Cuando dos filas comparten teléfono gana la que tiene lote y nombre; la otra
 * se reporta como descartada, no se pierde en silencio.
 */
export function planificarImportClientes(
  rows: MxcliClienteRow[],
): PlanImportClientes {
  const clientes: ClienteImportado[] = [];
  const descartados: PlanImportClientes["descartados"] = [];
  const porTelefono = new Map<string, ClienteImportado>();

  for (const row of rows) {
    const nombre = nombreDeCliente(row) ?? "";
    const phone = telefonoDeCliente(row);
    if (!phone) {
      descartados.push({
        codigo: row.codigo,
        nombre,
        motivo: normalizePhone(row.celular) || normalizePhone(row.telefono)
          ? "teléfono demasiado corto (interno o fijo sin característica)"
          : "sin teléfono",
      });
      continue;
    }

    const lote = loteDeCliente(row);
    const calle = limpiar(row.calle);
    const cliente: ClienteImportado = {
      codigo: row.codigo,
      phone,
      name: nombre || null,
      lote: lote?.lote ?? null,
      loteOrigen: lote?.origen ?? null,
      // Cuando la calle ES el lote («LOTE 354»), como referencia no aporta.
      calle: calle && !/^LOTE\s*\d+$/i.test(calle) ? calle : null,
      aviso:
        phone.length > DIGITOS_MINIMOS
          ? `teléfono de ${phone.length} dígitos — revisar`
          : lote
            ? null
            : "sin lote — el repartidor no sabe dónde ir",
    };

    const previo = porTelefono.get(phone);
    if (previo) {
      const mejor = puntaje(cliente) > puntaje(previo) ? cliente : previo;
      const peor = mejor === cliente ? previo : cliente;
      porTelefono.set(phone, mejor);
      clientes.splice(clientes.indexOf(previo), 1, mejor);
      descartados.push({
        codigo: peor.codigo,
        nombre: peor.name ?? "",
        motivo: `teléfono repetido con el cliente ${mejor.codigo}`,
      });
      continue;
    }
    porTelefono.set(phone, cliente);
    clientes.push(cliente);
  }

  return { clientes, descartados };
}

/** Entre dos filas con el mismo teléfono, gana la más completa. */
function puntaje(c: ClienteImportado): number {
  return (c.lote ? 2 : 0) + (c.name ? 1 : 0);
}
