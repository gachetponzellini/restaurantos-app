export type Caja = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  /** Dónde caen los cobros sin cajero (pago online). Máx 1 por negocio. */
  is_default: boolean;
  /**
   * Cuánto efectivo queda en el cajón al cerrar, para tener cambio —y con qué
   * pagar propinas— al abrir (spec 177 · Parte C). 0 = se retira todo, que es
   * el comportamiento que fijó la spec 130.
   */
  fondo_fijo_cents: number;
  /**
   * Caja mayor (spec 160): **no se arquea y no cobra**. De acá salen los pagos a
   * proveedor, para que una orden de pago no descuadre el cajón del turno.
   * Máx 1 por negocio, y nunca puede ser la default.
   */
  is_administrative: boolean;
};

export type CajaCorte = {
  id: string;
  caja_id: string;
  business_id: string;
  encargado_id: string;
  expected_cash_cents: number;
  closing_cash_cents: number;
  difference_cents: number;
  closing_notes: string | null;
  denomination_count: Record<string, number> | null;
  created_at: string;
  /** Correlativo por negocio (spec 139 · D14). NULL en cortes anteriores. */
  numero?: number | null;
  /** Snapshot congelado del papel (spec 139 · D9). NULL en cortes anteriores. */
  resumen?: CierreResumenSnapshot | null;
};

/**
 * `propina` (spec 177 · Parte B): lo que sale del cajón para pagarle la propina
 * a un mozo. Es una salida como la sangría, pero con dueño — el reparto del
 * cierre y el libro necesitan poder separar «se lo llevó el dueño» de «se le
 * pagó al personal», y una sangría con `reason` libre no lo permite.
 */
export type CajaMovimientoKind = "sangria" | "ingreso" | "propina";

export type CajaMovimiento = {
  id: string;
  caja_id: string;
  business_id: string;
  kind: CajaMovimientoKind;
  amount_cents: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  /** Anulado (spec 070): sigue visible en el libro, no cuenta para el arqueo. */
  cancelled_at: string | null;
  cancelled_reason: string | null;
};

// ── Libro de movimientos (spec 070) ─────────────────────────────

export type LibroTipo = "cobro" | "sangria" | "ingreso" | "propina";

/**
 * Una línea de caja, sea un cobro o un movimiento. El libro las muestra
 * mezcladas y en orden cronológico, igual que el panel del período — pero con
 * rango, filtros, lo anulado a la vista y la línea accionable.
 */
export type LibroEntry = {
  tipo: LibroTipo;
  id: string;
  created_at: string;
  caja_id: string;
  caja_name: string;
  /** Cobro: lo cobrado (propina incluida). Movimiento: el monto movido. */
  amount_cents: number;
  tip_cents: number;
  method: PaymentMethod | null;
  attributed_mozo_id: string | null;
  attributed_mozo_name: string | null;
  /** Mesa 12 · Juan Pérez · #128, o el motivo de la sangría. */
  descripcion: string;
  order_id: string | null;
  order_number: number | null;
  anulado: boolean;
  anulado_reason: string | null;
  /** Tiene al menos un renglón en `caja_audit_log`. */
  corregido: boolean;
  /** Por qué NO se puede corregir, en castellano. `null` = se puede. */
  bloqueo: string | null;
  /** Corregible, pero con límites (mozo que ya rindió). */
  advertencias: string[];
  /**
   * Comprobante autorizado de la cuenta, si hay. NO limita la corrección del
   * cobro (la factura se emite sobre la cuenta, no sobre el pago): está para
   * poder saltar a él cuando lo que hay que arreglar es el comprobante.
   */
  factura: {
    id: string;
    tipo_comprobante: string;
    punto_venta: number;
    numero: number | null;
  } | null;
};

export type LibroTotales = {
  cobrado_cents: number;
  propinas_cents: number;
  cobros_count: number;
  ingresos_cents: number;
  sangrias_cents: number;
  /** Lo que salió del cajón para pagarle la propina a los mozos (spec 177). */
  propinas_pagadas_cents: number;
  por_metodo: Record<PaymentMethod, number>;
};

export type LibroFiltros = {
  from: string;
  to: string;
  cajaId?: string | null;
  tipo?: LibroTipo | null;
  method?: PaymentMethod | null;
  mozoId?: string | null;
  search?: string | null;
};

export type CorreccionLog = {
  id: string;
  field: string;
  from_value: string | null;
  to_value: string | null;
  reason: string;
  created_at: string;
  by_name: string | null;
};

export type PaymentMethod =
  | "cash"
  | "card_manual"
  | "mp_link"
  | "mp_qr"
  | "transfer"
  | "other"
  /**
   * Fiado (spec 141). Cierra el ticket como cualquier otro método —la mesa se
   * libera, la factura sale— pero **no es plata cobrada**: queda como saldo del
   * cliente (`payments.credit_customer_id`, obligatorio por check).
   *
   * Ojo al sumarlo: entra en la venta, NO en «Cobrado» ni en el arqueo. El
   * arqueo ya está a salvo solo (`expected-cash.ts` filtra `cash`), pero
   * `getCajaLiveStats` suma todos los métodos — ahí hay que excluirlo, o el
   * encargado lee «Cobrado $180.000» con $150.000 en el cajón (D3).
   */
  | "cuenta_corriente";

/**
 * De dónde vino la plata, derivado de `orders.delivery_type`.
 * Ojo: la venta de mostrador se guarda como `dine_in`, así que hoy cae en
 * `salon` — no está separada.
 */
export type VentaOrigen = "salon" | "delivery" | "takeaway" | "otro";

export type CajaLiveStats = {
  caja_id: string;
  total_ventas_cents: number;
  /**
   * Fiado del período (spec 141 · D3). Va SEPARADO de `total_ventas_cents`
   * porque el panel muestra ése como «Cobrado», y el fiado es venta pero no es
   * plata: sumarlo haría cerrar el turno con una diferencia inexplicable.
   */
  total_fiado_cents: number;
  total_propinas_cents: number;
  ventas_por_metodo: Record<PaymentMethod, number>;
  ventas_por_origen: Record<VentaOrigen, number>;
  /**
   * Origen × método: cuánto de cada origen entró por cada medio.
   *
   * Es lo que permite entender el arqueo: un delivery cobrado con tarjeta no
   * pone un peso en el cajón, uno en efectivo sí. Los dos desgloses sueltos no
   * lo decían.
   */
  ventas_por_origen_y_metodo: Record<
    VentaOrigen,
    Record<PaymentMethod, number>
  >;
  cobros_count: number;
  /** Cuántos cobros por método — el papel del cierre lleva columna «Cant». */
  cobros_por_metodo: Record<PaymentMethod, number>;
  /** Idem por origen. */
  cobros_por_origen: Record<VentaOrigen, number>;
  expected_cash_cents: number;
  periodo_desde: string;
  /**
   * Los cuatro sumandos de `expected_cash_cents`, para poder mostrar de dónde
   * sale (issue #188): el arqueo decía "cobros + propinas" cuando la cuenta es
   * apertura + efectivo **sin** propina + ingresos − sangrías, y los números no
   * cerraban justo en la pantalla donde se decide si falta plata.
   */
  desglose_esperado: {
    /**
     * Lo que quedó en el cajón del turno anterior **después** del retiro del
     * cierre (spec 130): cuando se retiró todo —el caso normal— es $0 y el
     * turno arranca limpio.
     */
    apertura_cents: number;
    /** Lo que se llevó el cierre anterior, ya descontado de `apertura_cents`. */
    retiro_cierre_cents: number;
    /** Efectivo cobrado, **con** la propina adentro (spec 177 · D5). */
    efectivo_cents: number;
    ingresos_cents: number;
    sangrias_cents: number;
    /** Lo que salió del cajón para pagarle la propina a los mozos (spec 177). */
    propinas_pagadas_cents: number;
  };
};

export type CajaConEstado = Caja & {
  ultimo_corte: CajaCorte | null;
  periodo_desde: string;
};

/**
 * Lo que se congela en `caja_cortes.resumen` al cerrar (spec 139 · D9).
 *
 * Es el contrato del **papel**: el ticket se arma de acá y no de la base viva,
 * así que una corrección posterior (spec 070) no puede mover un cierre que
 * alguien ya firmó. `version` existe para poder cambiar la forma sin romper los
 * cierres viejos que ya están impresos y archivados.
 */
export type CierreResumenSnapshot = {
  version: 1;
  caja_name: string;
  encargado_name: string | null;
  periodo_desde: string;
  total_ventas_cents: number;
  total_propinas_cents: number;
  cobros_count: number;
  expected_cash_cents: number;
  closing_cash_cents: number;
  difference_cents: number;
  /**
   * El fondo que quedó en el cajón, congelado (spec 177 · Parte C). Ausente en
   * los cortes anteriores a la spec.
   */
  fondo_fijo_cents?: number;
  desglose_esperado: CajaLiveStats["desglose_esperado"];
  /** Línea por línea, con su motivo — así lo imprime MaxiRest. */
  movimientos: {
    ingresos: { detalle: string; total_cents: number }[];
    egresos: { detalle: string; total_cents: number }[];
  };
  ventas_por_origen_lineas: {
    detalle: string;
    total_cents: number;
    cant: number;
  }[];
  ventas_por_metodo_lineas: {
    detalle: string;
    total_cents: number;
    cant: number;
  }[];
};

// ── El cierre archivado (spec 149) ──────────────────────────────

/** Una fila del historial de cierres. */
export type CorteDelHistorial = CajaCorte & {
  caja_name: string;
  encargado_name: string | null;
  /**
   * Arranque del turno que este corte cerró: el `created_at` del corte
   * anterior de la misma caja, o el alta de la caja si es el primero.
   */
  periodo_desde: string;
  /**
   * No hay corte anterior: `periodo_desde` es el alta de la caja.
   *
   * Importa para lo que se dice, no para la plata. Una caja creada hace dos
   * meses y cortada por primera vez anoche tiene una ventana de 74 días —
   * correcta para sumar cobros, absurda como «turno de 74 d».
   */
  es_primer_corte: boolean;
};

export type RendicionDelCorte = MozoRendicion & { mozo_name: string };

/**
 * El resumen de un cierre ya hecho.
 *
 * ⚠️ No es una foto congelada: sólo los cuatro campos del arqueo
 * (`expected_cash_cents`, `closing_cash_cents`, `difference_cents`,
 * `denomination_count`) están guardados en la fila. Todo lo demás se
 * reconstruye de la ventana del turno, así que una corrección posterior
 * (spec 070) cambia el resumen de un cierre viejo. Es lo correcto para
 * auditar — la corrección tiene su propio rastro — pero conviene saberlo.
 */
export type ResumenDeCorte = {
  corte: CajaCorte;
  caja_name: string;
  encargado_name: string | null;
  /** `is_default`: la que barre el salón y gobierna las rendiciones (D5). */
  barre_salon: boolean;
  periodo_desde: string;
  /** No hay corte anterior: `periodo_desde` es el alta de la caja. */
  es_primer_corte: boolean;
  stats: CajaLiveStats;
  /** Los del turno. El retiro del corte anterior ya está neteado, no viene acá. */
  movimientos: CajaMovimiento[];
  /**
   * Lo que este cierre sacó del cajón, por `caja_movimientos.corte_id`.
   *
   * `null` no es $0: es «no se sabe». El rótulo lo escribe un `UPDATE`
   * best-effort después de la transacción (`cerrarCaja`), así que un corte
   * cuyo update falló tiene el retiro hecho pero sin atar. Mostrar $0 ahí
   * sería afirmar que no se retiró nada.
   */
  retiro_cents: number | null;
  /** Vacío en una caja que no barre el salón (D5). */
  rendiciones: RendicionDelCorte[];
};

export type PaymentMethodConfig = {
  id: string;
  business_id: string;
  method: PaymentMethod;
  adjustment_percent: number;
  label: string | null;
  is_active: boolean;
  sort_order: number;
};

/**
 * Cómo se resolvió la rendición de un mozo (spec 139 · D1).
 *
 * `no_entrego` no es una rendición en $0: es una **deuda declarada**. La
 * distinción importa porque un mozo que cobró todo con tarjeta también entrega
 * $0, y el papel del cierre, el mail del dueño y cualquier consulta futura
 * tienen que poder diferenciarlos.
 */
export type RendicionEstado = "rendida" | "no_entrego";

export type MozoRendicion = {
  id: string;
  business_id: string;
  mozo_id: string;
  registered_by: string;
  expected_cash_cents: number;
  delivered_cash_cents: number;
  difference_cents: number;
  notes: string | null;
  por_metodo: Record<PaymentMethod, number>;
  estado: RendicionEstado;
  created_at: string;
};

export type RendicionMozoPendiente = {
  mozo_id: string;
  mozo_name: string;
  /** Rol en el negocio. Decide si tiene que rendir (issue #264). */
  mozo_role?: string;
  /** Lo que entrega: efectivo neto de propina (spec 151). */
  efectivo_cents: number;
  /** Lo que tiene encima: el mismo efectivo con la propina adentro (spec 177). */
  efectivo_bruto_cents: number;
  tickets_cents: number;
  por_metodo: Record<PaymentMethod, number>;
  total_propinas_cents: number;
  pagos_count: number;
};

export type CajaUserAssignment = {
  id: string;
  business_id: string;
  caja_id: string;
  user_id: string;
  created_at: string;
};
