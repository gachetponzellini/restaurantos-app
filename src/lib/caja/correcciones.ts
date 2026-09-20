// ============================================
// Spec 070 · Lógica pura de la corrección de una línea de caja.
//
// Todo lo que decide si una corrección es válida y qué le pasa a la orden vive
// acá, sin I/O: es la parte que toca plata y se prueba con casos límite antes
// de que exista una fila en la base. La server action (correccion-actions.ts)
// se queda con las guardas de contexto (arqueo cerrado, factura, rendición) y
// la RPC `corregir_pago_tx` con la atomicidad.
// ============================================

import type { PaymentMethod } from "./types";

/** Los únicos métodos que se corrigen: la plata de MP la confirmó Mercado Pago. */
export const METODOS_MANUALES = [
  "cash",
  "card_manual",
  "transfer",
  "mp_manual",
  "other",
] as const satisfies readonly PaymentMethod[];

export type MetodoManual = (typeof METODOS_MANUALES)[number];

export function esMetodoManual(method: string): method is MetodoManual {
  return (METODOS_MANUALES as readonly string[]).includes(method);
}

/** El estado del pago tal como está hoy en la base. */
export type PagoActual = {
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  attributed_mozo_id: string | null;
  caja_id: string;
  last_four: string | null;
  card_brand: string | null;
  notes: string | null;
};

/**
 * Los campos a corregir. Clave ausente = no tocar; clave presente con `null` =
 * ponerlo en null (desatribuir el mozo, sacar los últimos 4). La distinción es
 * la razón por la que el patch viaja como objeto y no como parámetros sueltos.
 */
export type CorreccionPatch = {
  method?: PaymentMethod;
  amount_cents?: number;
  tip_cents?: number;
  attributed_mozo_id?: string | null;
  caja_id?: string;
  last_four?: string | null;
  card_brand?: string | null;
  notes?: string | null;
};

const CAMPOS: (keyof CorreccionPatch)[] = [
  "method",
  "amount_cents",
  "tip_cents",
  "attributed_mozo_id",
  "caja_id",
  "last_four",
  "card_brand",
  "notes",
];

/**
 * Deja sólo los campos que **realmente** cambian. Sin esto, "corregir" un pago
 * mandando los mismos valores dejaría renglones de auditoría vacíos y le
 * cobraría al encargado un motivo por nada.
 */
export function diffPatch(
  actual: PagoActual,
  patch: CorreccionPatch,
): CorreccionPatch {
  const out: CorreccionPatch = {};
  for (const campo of CAMPOS) {
    if (!(campo in patch)) continue;
    const nuevo = patch[campo] ?? null;
    const viejo = actual[campo] ?? null;
    if (nuevo !== viejo) {
      // El índice dinámico sobre un objeto con claves heterogéneas necesita el
      // cast; el valor ya viene tipado por `CorreccionPatch`.
      (out as Record<string, unknown>)[campo] = patch[campo];
    }
  }
  return out;
}

export type ValidacionResultado = { ok: true } | { ok: false; error: string };

/**
 * Invariantes duras de la corrección. Las mismas están en la RPC — acá para
 * darle al encargado el error antes de ir a la base, allá para que no dependan
 * de que el caller sea el nuestro.
 */
export function validarCorreccion(
  actual: PagoActual,
  patch: CorreccionPatch,
  motivo: string,
): ValidacionResultado {
  if (!motivo || motivo.trim() === "") {
    return { ok: false, error: "La corrección requiere un motivo." };
  }

  const cambios = diffPatch(actual, patch);
  if (Object.keys(cambios).length === 0) {
    return { ok: false, error: "No hay nada que corregir." };
  }

  const method = cambios.method ?? actual.method;
  const amount = cambios.amount_cents ?? actual.amount_cents;
  const tip = cambios.tip_cents ?? actual.tip_cents;

  if (!esMetodoManual(actual.method)) {
    return {
      ok: false,
      error:
        "Los cobros de Mercado Pago no se corrigen: la acreditación la confirmó MP.",
    };
  }
  if (!esMetodoManual(method)) {
    return {
      ok: false,
      error:
        "No se puede convertir un cobro manual en uno de Mercado Pago. Anulalo y volvé a cobrar.",
    };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      ok: false,
      error:
        "El monto tiene que ser mayor a cero. Si el cobro no existió, usá «Anular cobro».",
    };
  }
  if (!Number.isInteger(tip) || tip < 0) {
    return { ok: false, error: "La propina no puede ser negativa." };
  }
  // La propina viaja DENTRO del monto (la rendición hace neto = monto − propina).
  if (tip > amount) {
    return {
      ok: false,
      error: "La propina no puede ser mayor que el monto cobrado.",
    };
  }

  const lastFour = cambios.last_four ?? actual.last_four;
  if (lastFour !== null && !/^\d{4}$/.test(lastFour)) {
    return { ok: false, error: "Los últimos 4 dígitos deben ser 4 números." };
  }

  // Misma regla que el cobro (spec 126): sólo «otro» exige nota. La corrección
  // ya pide `motivo` obligatorio aparte, así que el rastro de auditoría no
  // dependía de este campo.
  const notes = (cambios.notes ?? actual.notes)?.trim() ?? "";
  if (method === "other" && notes === "") {
    return { ok: false, error: 'Para método "otro", se requiere una nota.' };
  }

  return { ok: true };
}

export type SplitActivo = {
  expected_amount_cents: number;
  paid_amount_cents: number;
};

export type VeredictoMonto =
  /** La orden no cambia de estado. */
  | "sin_cambio_de_estado"
  /** Estaba abierta y la corrección la salda: hay que cerrarla (y liberar mesa). */
  | "cierra_la_orden"
  /** Estaba cerrada y la corrección la dejaría impaga: se rechaza (FR-012). */
  | "dejaria_descubierta";

/**
 * Qué le pasa a la orden después de corregir el monto.
 *
 * El caso `dejaria_descubierta` no se acepta: la mesa de esa orden ya se
 * liberó y puede estar ocupada por otra cuenta, así que reabrir la vieja
 * dejaría dos órdenes abiertas sobre la misma mesa. Ese caso —el cliente pagó
 * menos de lo que debía— no es un error de tipeo: es otro cobro.
 */
export function veredictoDeMonto(input: {
  lifecycle: string;
  cubiertaDespues: boolean;
}): VeredictoMonto {
  if (input.lifecycle === "closed") {
    return input.cubiertaDespues ? "sin_cambio_de_estado" : "dejaria_descubierta";
  }
  if (input.lifecycle === "open" && input.cubiertaDespues) {
    return "cierra_la_orden";
  }
  return "sin_cambio_de_estado";
}

/**
 * Los hechos que la action va a buscar a la base para poder decidir. Se pasan
 * ya resueltos para que la decisión sea pura: son las guardas que más caro
 * salen si fallan (arqueo firmado, factura emitida, rendición cerrada) y las
 * que hay que poder probar sin una base delante.
 */
export type ContextoCorreccion = {
  pago: {
    business_id: string;
    payment_status: string;
    mp_payment_id: string | null;
    created_at: string;
    caja_id: string;
    attributed_mozo_id: string | null;
  };
  businessId: string;
  /** Último corte de la caja del pago (ISO), o null si nunca se arqueó. */
  ultimoCorteOrigen: string | null;
  /** Último corte de la caja destino, sólo si el patch la cambia. */
  ultimoCorteDestino?: string | null;
  /**
   * Mozos (origen y/o destino) que ya rindieron después de este cobro. El
   * nombre entra en el mensaje: "ya entró en la rendición de X" explica, "no
   * se puede" no.
   */
  rendicionesPosteriores: Array<{ mozoId: string; nombre: string }>;
};

function esPosterior(fecha: string, corte: string | null): boolean {
  if (!corte) return true;
  return new Date(fecha).getTime() > new Date(corte).getTime();
}

/**
 * Guardas de contexto (FR-004 a FR-007, FR-016). Corren antes de tocar la base:
 * la RPC repite las invariantes duras, pero estos mensajes son los que el
 * encargado necesita leer para saber qué hacer en su lugar.
 *
 * Ojo con lo que NO está acá: tener **factura emitida** no bloquea corregir el
 * monto. El comprobante se emite sobre la CUENTA (`order.total_cents` sin
 * propina), no sobre el pago — corregir cuánta plata entró a la caja no cambia
 * un peso de lo declarado a ARCA. Si lo que está mal es el importe facturado,
 * eso se arregla en Facturación: anular (emite la nota de crédito) y
 * re-facturar.
 */
export function evaluarGuardas(
  ctx: ContextoCorreccion,
  patch: CorreccionPatch,
): ValidacionResultado {
  if (ctx.pago.business_id !== ctx.businessId) {
    return { ok: false, error: "Ese cobro no es de este negocio." };
  }
  if (ctx.pago.payment_status !== "paid") {
    return {
      ok: false,
      error: "Sólo se corrigen cobros registrados: uno anulado o en curso, no.",
    };
  }
  if (ctx.pago.mp_payment_id !== null) {
    return {
      ok: false,
      error:
        "Los cobros de Mercado Pago no se corrigen: la acreditación la confirmó MP.",
    };
  }
  if (!esPosterior(ctx.pago.created_at, ctx.ultimoCorteOrigen)) {
    return {
      ok: false,
      // spec 098 · H-35 — el mensaje decía «Anulá el cobro y volvé a
      // registrarlo», que era exactamente la salida equivocada: `anularCobro`
      // no tenía guarda de período, así que este error empujaba al encargado
      // por la única puerta que sí podía reescribir un arqueo firmado. Ahora
      // esa puerta está cerrada, y el consejo apunta a donde corresponde.
      error:
        "Ese cobro ya entró en un arqueo cerrado. Registrá la diferencia como un movimiento del período actual.",
    };
  }

  const cambiaCaja =
    patch.caja_id !== undefined && patch.caja_id !== ctx.pago.caja_id;
  if (cambiaCaja && !esPosterior(ctx.pago.created_at, ctx.ultimoCorteDestino ?? null)) {
    return {
      ok: false,
      error:
        "La caja destino ya cerró un arqueo posterior a ese cobro. Registralo en el período vigente.",
    };
  }

  const cambiaMozo =
    patch.attributed_mozo_id !== undefined &&
    patch.attributed_mozo_id !== ctx.pago.attributed_mozo_id;
  if (cambiaMozo && ctx.rendicionesPosteriores.length > 0) {
    return {
      ok: false,
      error: `Ese cobro ya entró en la rendición de ${ctx.rendicionesPosteriores[0].nombre}.`,
    };
  }

  // #356 — el mozo rindió contra ESTE método y ESTE monto (y cobró esa
  // propina). Corregir la plata después movía el esperado del cajón y no la
  // rendición: el arqueo cerraba con una diferencia sin dueño.
  if (cambiaPlata(patch) && ctx.rendicionesPosteriores.length > 0) {
    return {
      ok: false,
      error: `Ese cobro ya entró en la rendición de ${ctx.rendicionesPosteriores[0].nombre}: su plata no se corrige.`,
    };
  }

  return { ok: true };
}

/** #356 — ¿la corrección toca la plata del cobro (y no sólo sus datos)? */
export function cambiaPlata(patch: CorreccionPatch): boolean {
  return (
    patch.method !== undefined ||
    patch.amount_cents !== undefined ||
    patch.tip_cents !== undefined
  );
}

/**
 * Guardas de la **anulación** de una línea de cobro. Casi las mismas que
 * corregir, con una diferencia: acá la rendición del mozo se mira siempre (no
 * sólo si se cambia la atribución), porque sacar el cobro le baja la
 * liquidación a alguien que ya rindió.
 */
export function evaluarGuardasDeAnulacion(
  ctx: ContextoCorreccion,
): ValidacionResultado {
  const base = evaluarGuardas(ctx, {});
  if (!base.ok) return base;
  if (ctx.rendicionesPosteriores.length > 0) {
    return {
      ok: false,
      error: `Ese cobro ya entró en la rendición de ${ctx.rendicionesPosteriores[0].nombre}: anularlo le cambiaría una liquidación cerrada.`,
    };
  }
  return { ok: true };
}

const ERRORES_RPC: Record<string, string> = {
  REASON_REQUIRED: "La corrección requiere un motivo.",
  PAYMENT_NOT_FOUND: "No se encontró el cobro.",
  PAYMENT_OTHER_BUSINESS: "Ese cobro no es de este negocio.",
  PAYMENT_NOT_PAID:
    "Sólo se corrigen cobros registrados: uno anulado o en curso, no.",
  PAYMENT_IS_MP:
    "Los cobros de Mercado Pago no se corrigen: la acreditación la confirmó MP.",
  ORDER_NOT_FOUND: "No se encontró la cuenta del cobro.",
  METHOD_NOT_MANUAL:
    "No se puede convertir un cobro manual en uno de Mercado Pago. Anulalo y volvé a cobrar.",
  AMOUNT_MUST_BE_POSITIVE:
    "El monto tiene que ser mayor a cero. Si el cobro no existió, usá «Anular cobro».",
  TIP_GT_AMOUNT: "La propina no puede ser mayor que el monto cobrado.",
  CAJA_INVALID: "La caja destino no existe o está inactiva.",
  MOZO_INVALID: "Ese empleado no puede recibir la atribución del cobro.",
  ORDER_WOULD_BE_UNCOVERED:
    "Con esa corrección la cuenta quedaría sin cubrir. Si el cliente pagó menos, anulá el cobro y volvé a cobrar; si lo que cambió es la propina, corregí también el monto.",
  // #357 — p. ej. bajar sólo la propina de un cobro con excedente: el total
  // de la cuenta bajaría y lo cobrado no.
  TOTAL_BELOW_PAID:
    "Con esa corrección la cuenta quedaría por debajo de lo cobrado. Si la propina fue menor, corregí también el monto.",
  NOTHING_TO_CHANGE: "No hay nada que corregir.",
  MOVIMIENTO_NOT_FOUND: "No se encontró el movimiento.",
  MOVIMIENTO_OTHER_BUSINESS: "Ese movimiento no es de este negocio.",
  MOVIMIENTO_ALREADY_CANCELLED: "Ese movimiento ya está anulado.",
};

/** Traduce el error crudo de la RPC al castellano del encargado. */
export function mapCorreccionError(raw: string): string {
  for (const [code, mensaje] of Object.entries(ERRORES_RPC)) {
    if (raw.includes(code)) return mensaje;
  }
  return `No se pudo corregir: ${raw}`;
}
