import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calculateExpectedCash, separarRetiroDelCierre } from "./expected-cash";
import { calcularRendicionMozo } from "./liquidacion-mozo";
import { mozosQueDebenRendir } from "./deben-rendir";
import {
  repartirEfectivoEsperado,
  type RepartoEfectivo,
} from "./reparto-efectivo";
import {
  agruparVentasPorOrigen,
  cruzarOrigenYMetodo,
  origenDeDeliveryType,
} from "./ventas-por-origen";
import { encadenarPeriodos, ventanaDelCorte } from "./historial-cortes";
import type {
  Caja,
  CajaConEstado,
  CajaCorte,
  CajaLiveStats,
  CajaMovimiento,
  CajaMovimientoKind,
  CajaUserAssignment,
  CorreccionLog,
  LibroEntry,
  LibroFiltros,
  LibroTotales,
  CorteDelHistorial,
  MozoRendicion,
  PaymentMethod,
  PaymentMethodConfig,
  RendicionDelCorte,
  RendicionMozoPendiente,
  ResumenDeCorte,
  VentaOrigen,
} from "./types";

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0044 applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

const EMPTY_BY_METHOD: Record<PaymentMethod, number> = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  cuenta_corriente: 0,
};

/**
 * Las cajas donde se **cobra**. Es la puerta de todos los pickers: mesa, pedido,
 * venta rápida y cobranza de cuenta corriente cuelgan de acá.
 *
 * spec 160 · deja afuera la caja administrativa. El filtro va en el server y no en
 * cada `<select>` porque hay cuatro caminos que reciben un `caja_id` del cliente;
 * esconderla en la pantalla no cierra ninguno.
 */
export async function getCajasForBusiness(businessId: string): Promise<Caja[]> {
  const service = db();
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, sort_order, is_default, is_administrative")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .eq("is_administrative", false)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Caja[];
}

/**
 * Todas las cajas activas del negocio, administrativa incluida — sólo para el
 * libro de movimientos y su filtro (spec 160). No usar para cobrar.
 */
export async function getCajasParaLibro(businessId: string): Promise<Caja[]> {
  const service = db();
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, sort_order, is_default, is_administrative")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Caja[];
}

export type SaldoCajaAdministrativa = {
  cajaId: string;
  cajaName: string;
  saldo_cents: number;
  movimientos: number;
  ultimo_movimiento: string | null;
};

/**
 * El saldo de la caja mayor — spec 168.
 *
 * Va por RPC y no por `select` a propósito: esta caja **no corta nunca**, así que
 * sus movimientos se leen desde su `created_at` hasta hoy sin ninguna frontera, y
 * PostgREST trunca en `PAGE_SIZE` **en silencio**. A 7,6 movimientos por día hábil
 * el saldo empezaría a mentir hacia arriba a los 4-6 meses, sin un solo error.
 * `saldo_caja_administrativa` agrega en Postgres y devuelve un número.
 *
 * `null` si el negocio todavía no tiene caja administrativa.
 */
export async function getSaldoCajaAdministrativa(
  businessId: string,
): Promise<SaldoCajaAdministrativa | null> {
  const service = db();
  const { data, error } = await service.rpc("saldo_caja_administrativa", {
    p_business_id: businessId,
  });

  // spec 161 · no se traga el error: ver que se rompió es mejor que ver $0 — y un
  // $0 acá es indistinguible de una caja recién creada.
  if (error) {
    throw new Error(`Falló el saldo de la caja mayor: ${error.message}`);
  }

  const fila = (data as unknown as Array<{
    caja_id: string;
    caja_name: string;
    saldo_cents: number | string;
    movimientos: number;
    ultimo_movimiento: string | null;
  }> | null)?.[0];
  if (!fila) return null;

  return {
    cajaId: fila.caja_id,
    cajaName: fila.caja_name,
    // `bigint` vuelve como string cuando no entra en un number seguro.
    saldo_cents: Number(fila.saldo_cents),
    movimientos: fila.movimientos,
    ultimo_movimiento: fila.ultimo_movimiento,
  };
}

/**
 * La caja administrativa del negocio (spec 160), o `null` si todavía no existe.
 * Es de donde sale el pago a proveedor — y el único lugar que la resuelve.
 */
export async function getCajaAdministrativa(
  businessId: string,
): Promise<Caja | null> {
  const service = db();
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, sort_order, is_default, is_administrative")
    .eq("business_id", businessId)
    .eq("is_administrative", true)
    .maybeSingle();
  return (data as Caja) ?? null;
}

/**
 * Todas las cajas de turno, incluidas las pausadas — alimenta el filtro del
 * historial de cierres. spec 160: la administrativa no corta nunca, así que
 * filtrarla por ahí daría siempre vacío.
 */
export async function getAllCajasForBusiness(
  businessId: string,
): Promise<Caja[]> {
  const service = db();
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, sort_order, is_default, is_administrative")
    .eq("business_id", businessId)
    .eq("is_administrative", false)
    .order("is_active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Caja[];
}

/**
 * Caja donde se asienta un cobro que no tuvo cajero: hoy, el pago online de un
 * delivery / take-away que acredita el webhook de MP.
 *
 * Si el negocio no marcó ninguna, cae en la primera caja activa por
 * `sort_order`. El fallback importa: `payments.caja_id` es NOT NULL, así que
 * sin él un negocio que nunca entró a la config perdería el pago.
 */
export async function getDefaultCaja(businessId: string): Promise<Caja | null> {
  const cajas = await getCajasForBusiness(businessId);
  if (cajas.length === 0) return null;
  return cajas.find((c) => c.is_default) ?? cajas[0];
}

async function getUltimoCorte(
  cajaId: string,
  businessId: string,
): Promise<CajaCorte | null> {
  const service = db();
  const { data } = await service
    .from("caja_cortes")
    .select("*")
    .eq("caja_id", cajaId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as CajaCorte | null;
}

/**
 * Las cajas con su período y su último corte.
 *
 * spec 160 · por defecto **sin la administrativa**: alimenta el board de operación
 * y `/admin/caja`, que son pantallas de arqueo, y esa caja no se arquea.
 *
 * El **libro de movimientos** pasa `incluirAdministrativa` porque es al revés: si
 * la caja se cae del mapa, la orden de pago sale con `caja_name: "—"` y
 * `arqueado: false` —o sea corregible y anulable para siempre— y el desplegable de
 * filtro tampoco la lista, así que no hay forma de aislarla. El libro es el único
 * lugar donde una OP se audita.
 */
export async function getCajasConEstado(
  businessId: string,
  incluirAdministrativa = false,
): Promise<CajaConEstado[]> {
  const cajas = incluirAdministrativa
    ? await getCajasParaLibro(businessId)
    : await getCajasForBusiness(businessId);
  if (cajas.length === 0) return [];
  const service = db();

  // Un solo round-trip lógico en vez de 2N encadenados (spec 103): esto corre
  // en la carga inicial de `/admin/operacion`, así que lo pagaba **toda** la
  // operación — con 3 cajas eran 6 queries en cascada antes de pintar nada.
  //
  // Cada corte se sigue pidiendo **acotado por caja** (`getUltimoCorte`, con su
  // `limit(1)`) en vez de traer el historial del negocio y agrupar en JS: una
  // lectura sin `.limit()` sobre una tabla que crece por transacción la trunca
  // PostgREST en `max_rows` (1000, ver `supabase/config.toml`) **en silencio**,
  // y una caja que quedara fuera de esa ventana se leería como "nunca cortada"
  // — con "$0 inicio" y el período arrancando el día que se creó, en la misma
  // tarjeta donde el efectivo esperado sí sale del corte real.
  const ids = cajas.map((c) => c.id);
  const [cortes, cajasRes] = await Promise.all([
    Promise.all(cajas.map((c) => getUltimoCorte(c.id, businessId))),
    service.from("cajas").select("id, created_at").in("id", ids),
  ]);

  const creadaPorCaja = new Map(
    ((cajasRes.data ?? []) as Array<{ id: string; created_at: string }>).map(
      (c) => [c.id, c.created_at],
    ),
  );

  return cajas.map((caja, i) => {
    const ultimoCorte = cortes[i];
    return {
      ...caja,
      ultimo_corte: ultimoCorte,
      // Sin corte previo, el período arranca cuando se creó la caja.
      periodo_desde:
        ultimoCorte?.created_at ??
        creadaPorCaja.get(caja.id) ??
        new Date().toISOString(),
    };
  });
}

export async function getMovimientosPeriodoActual(
  cajaId: string,
  businessId: string,
): Promise<CajaMovimiento[]> {
  const ultimoCorte = await getUltimoCorte(cajaId, businessId);
  const service = db();

  let query = service
    .from("caja_movimientos")
    .select(
      "id, caja_id, business_id, kind, amount_cents, reason, created_by, created_at, cancelled_at, cancelled_reason",
    )
    .eq("caja_id", cajaId)
    .eq("business_id", businessId)
    // Spec 130 · El retiro del cierre cae en este período por un milisegundo
    // (0052) pero es la última línea del corte anterior, no el primer
    // movimiento del turno: la app lo netea contra la apertura, así que
    // listarlo acá sería contar la misma plata dos veces en pantalla. Sigue
    // visible —y anulable— en el libro (spec 070).
    .is("corte_id", null)
    .order("created_at", { ascending: true });

  if (ultimoCorte) {
    query = query.gt("created_at", ultimoCorte.created_at);
  }

  const { data } = await query;
  return (data ?? []) as CajaMovimiento[];
}

export type CajaPayment = {
  id: string;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  created_at: string;
  order_id: string;
  order_number: number;
  delivery_type: string;
  table_label: string | null;
  customer_name: string | null;
  attributed_mozo_name: string | null;
  /**
   * El comprobante de esta orden quedó rechazado y no hay otro vivo (spec 147).
   *
   * Con la emisión automática el fallo no tiene pantalla: nadie apretó nada, y
   * la mesa ya se liberó. La campana avisa en el momento; esto es lo que queda
   * después, en la única lista de Operación donde el cobro sigue existiendo.
   * Un reintento que sale con CAE lo apaga solo (hay comprobante vivo).
   */
  comprobante_fallido: boolean;
};

export async function getPaymentsPeriodoActual(
  cajaId: string,
  businessId: string,
): Promise<CajaPayment[]> {
  const ultimoCorte = await getUltimoCorte(cajaId, businessId);
  const service = db();

  let query = service
    .from("payments")
    .select(
      "id, method, amount_cents, tip_cents, created_at, attributed_mozo_id, order_id, orders!inner(order_number, delivery_type, customer_name, table_id, tables!orders_table_id_fkey(label))",
    )
    .eq("caja_id", cajaId)
    .eq("payment_status", "paid")
    .order("created_at", { ascending: true });

  if (ultimoCorte) {
    query = query.gt("created_at", ultimoCorte.created_at);
  }

  type Row = {
    id: string;
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    created_at: string;
    attributed_mozo_id: string | null;
    order_id: string;
    orders:
      | {
          order_number: number;
          delivery_type: string;
          customer_name: string | null;
          table_id: string | null;
          tables: { label: string } | { label: string }[] | null;
        }
      | {
          order_number: number;
          delivery_type: string;
          customer_name: string | null;
          table_id: string | null;
          tables: { label: string } | { label: string }[] | null;
        }[]
      | null;
  };

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const mozoIds = Array.from(
    new Set(
      rows.map((r) => r.attributed_mozo_id).filter((x): x is string => !!x),
    ),
  );
  const mozoNameById = new Map<string, string>();
  if (mozoIds.length > 0) {
    const { data: bu } = await service
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .in("user_id", mozoIds);
    for (const m of (bu ?? []) as {
      user_id: string;
      full_name: string | null;
    }[]) {
      if (m.full_name) mozoNameById.set(m.user_id, m.full_name);
    }
  }

  // spec 147 — comprobantes de las órdenes del período, en una sola query.
  // "Fallido" es la orden que tiene una factura `failed` y **ninguna viva**:
  // si el reintento salió con CAE, el cobro ya no tiene nada raro que mostrar.
  const orderIds = Array.from(
    new Set(rows.map((r) => r.order_id).filter(Boolean)),
  );
  const conFallo = new Set<string>();
  if (orderIds.length > 0) {
    const { data: invRows } = await service
      .from("invoices")
      .select("order_id, status")
      .in("order_id", orderIds)
      .in("tipo_comprobante", ["factura_a", "factura_b"]);
    const vivas = new Set<string>();
    for (const inv of (invRows ?? []) as {
      order_id: string | null;
      status: string;
    }[]) {
      if (!inv.order_id) continue;
      if (inv.status === "failed") conFallo.add(inv.order_id);
      else if (inv.status === "pending" || inv.status === "authorized") {
        vivas.add(inv.order_id);
      }
    }
    for (const id of vivas) conFallo.delete(id);
  }

  return rows.map((r) => {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    const tbl = ord?.tables
      ? Array.isArray(ord.tables)
        ? ord.tables[0]
        : ord.tables
      : null;
    return {
      id: r.id,
      method: r.method,
      amount_cents: Number(r.amount_cents),
      tip_cents: Number(r.tip_cents),
      created_at: r.created_at,
      order_id: r.order_id,
      order_number: ord?.order_number ?? 0,
      delivery_type: ord?.delivery_type ?? "",
      table_label: tbl?.label ?? null,
      customer_name: ord?.customer_name ?? null,
      attributed_mozo_name: r.attributed_mozo_id
        ? (mozoNameById.get(r.attributed_mozo_id) ?? null)
        : null,
      comprobante_fallido: conFallo.has(r.order_id),
    };
  });
}

export async function getCajaLiveStats(
  cajaId: string,
  businessId: string,
): Promise<CajaLiveStats | null> {
  const service = db();

  const { data: cajaRow } = await service
    .from("cajas")
    .select("id, business_id, is_active, created_at")
    .eq("id", cajaId)
    .maybeSingle();
  if (!cajaRow) return null;
  if ((cajaRow as { business_id: string }).business_id !== businessId)
    return null;

  const ultimoCorte = await getUltimoCorte(cajaId, businessId);
  const periodoDesdeFecha =
    ultimoCorte?.created_at ?? (cajaRow as { created_at: string }).created_at;

  return getCajaStatsEnVentana(cajaId, {
    desde: periodoDesdeFecha,
    hasta: null,
    arrastreBrutoCents: ultimoCorte?.closing_cash_cents ?? 0,
  });
}

/**
 * Los mismos stats, sobre una ventana arbitraria (spec 149 · D3).
 *
 * El período vivo es el caso `hasta: null`; el resumen de un cierre pasa el
 * `created_at` del corte como techo y la ventana queda `(corte anterior, este
 * corte]` — el mismo criterio estricto por abajo con el que se calcula el
 * período activo.
 *
 * Vive acá y no duplicada del lado del historial **a propósito**: esto calcula
 * el efectivo esperado, o sea plata. Dos implementaciones del mismo número
 * derivan, y el día que deriven la pantalla del cierre y su propio resumen van
 * a decir cosas distintas del mismo turno sin que nadie sepa cuál creer.
 *
 * `arrastreBrutoCents` es lo contado por el corte **anterior**: entra como
 * arrastre bruto porque `separarRetiroDelCierre` le netea el retiro que ese
 * corte dejó adentro de esta ventana (el del `+1 ms` de la 0052).
 */
async function getCajaStatsEnVentana(
  cajaId: string,
  ventana: {
    /** Exclusivo: `created_at > desde`, como el período vivo. */
    desde: string;
    /** Inclusivo. `null` = abierta hasta ahora. */
    hasta: string | null;
    arrastreBrutoCents: number;
  },
): Promise<CajaLiveStats> {
  const service = db();
  const { desde, hasta, arrastreBrutoCents } = ventana;

  // `orders!inner` es seguro: `payments.order_id` es NOT NULL, así que el join
  // no puede descartar cobros y desbalancear los totales.
  let paymentsQuery = service
    .from("payments")
    .select("method, amount_cents, tip_cents, orders!inner(delivery_type)")
    .eq("caja_id", cajaId)
    .eq("payment_status", "paid");
  paymentsQuery = paymentsQuery.gt("created_at", desde);
  if (hasta) paymentsQuery = paymentsQuery.lte("created_at", hasta);

  // `cancelled_at` viaja para que el efectivo esperado ignore los movimientos
  // anulados (spec 070): siguen en el libro, pero no mueven la caja.
  let movQuery = service
    .from("caja_movimientos")
    .select("kind, amount_cents, cancelled_at, corte_id")
    .eq("caja_id", cajaId);
  movQuery = movQuery.gt("created_at", desde);
  if (hasta) movQuery = movQuery.lte("created_at", hasta);

  const [paymentsRes, movimientosRes] = await Promise.all([
    paymentsQuery,
    movQuery,
  ]);

  const paymentRows = (paymentsRes.data ?? []) as unknown as Array<{
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    orders: { delivery_type: string } | { delivery_type: string }[] | null;
  }>;
  const payments = paymentRows.map((r) => {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    return {
      method: r.method,
      amount_cents: Number(r.amount_cents),
      tip_cents: Number(r.tip_cents),
      delivery_type: ord?.delivery_type ?? "",
    };
  });
  const movimientosDelPeriodo = (movimientosRes.data ?? []) as Array<{
    kind: CajaMovimientoKind;
    amount_cents: number;
    cancelled_at: string | null;
    corte_id: string | null;
  }>;

  // Spec 130 · El retiro del cierre se netea contra la apertura en vez de
  // contarse como movimiento del turno nuevo: `expected_cash_cents` da
  // exactamente lo mismo (es el mismo sumando del otro lado de la cuenta) pero
  // el turno arranca en $0 en vez de mostrar «$262.000 del corte anterior» y,
  // abajo, la sangría que lo vacía — que es lo que se leyó como «el sistema me
  // pide un saldo anterior» (Golf, 2/9).
  const {
    apertura_cents,
    retiro_cierre_cents,
    del_turno: movimientos,
  } = separarRetiroDelCierre(arrastreBrutoCents, movimientosDelPeriodo);

  const ventas_por_metodo: Record<PaymentMethod, number> = {
    ...EMPTY_BY_METHOD,
  };
  const cobros_por_metodo: Record<PaymentMethod, number> = {
    ...EMPTY_BY_METHOD,
  };
  const cobros_por_origen: Record<VentaOrigen, number> = {
    salon: 0,
    delivery: 0,
    takeaway: 0,
    otro: 0,
  };
  let total_ventas_cents = 0;
  /** spec 141 · D3 — fiado del período: es venta, no es plata cobrada. */
  let total_fiado_cents = 0;
  let total_propinas_cents = 0;
  for (const p of payments) {
    cobros_por_metodo[p.method] = (cobros_por_metodo[p.method] ?? 0) + 1;
    const origen = origenDeDeliveryType(p.delivery_type);
    cobros_por_origen[origen] = (cobros_por_origen[origen] ?? 0) + 1;
    // spec 098 — la venta es lo que le queda al negocio: `amount − tip`. La
    // propina viaja dentro de `amount_cents` (es la plata que efectivamente
    // entró) pero **no es venta**, y sumarla acá la contaba dos veces: una en
    // «Ventas» y otra en «Propinas», como si fueran conceptos independientes.
    const venta = p.amount_cents - p.tip_cents;
    ventas_por_metodo[p.method] = (ventas_por_metodo[p.method] ?? 0) + venta;
    // spec 141 · D3 — el fiado es VENTA pero NO es plata cobrada, y este total se
    // muestra en el panel del arqueo como «Cobrado». Si entrara acá, el encargado
    // leería «Cobrado $180.000» con $150.000 en el cajón y cerraría el turno con
    // una diferencia que nadie puede explicar: el mismo bug que la propina tuvo
    // hasta la spec 098, dos renglones más arriba. Va aparte, en `total_fiado`.
    //
    // El arqueo (`calculateExpectedCash`) no necesita esta guarda: ya suma sólo
    // `cash`. El que sumaba todo era este.
    if (p.method === "cuenta_corriente") {
      total_fiado_cents += venta;
    } else {
      total_ventas_cents += venta;
    }
    total_propinas_cents += p.tip_cents;
  }

  const expected_cash_cents = calculateExpectedCash({
    last_closing_cash_cents: apertura_cents,
    payments,
    movimientos,
  });

  // El mismo desglose que usa `calculateExpectedCash`, expuesto para poder
  // mostrarlo (issue #188). Spec 177 · D5 — el efectivo va **con** la propina
  // adentro (está en el cajón hasta que se paga) y la propina pagada sale como
  // su propio renglón. Tiene que espejar la fórmula renglón por renglón o la
  // pantalla donde se decide si falta plata no cierra.
  const vivos = movimientos.filter((m) => !m.cancelled_at);
  const desglose_esperado = {
    apertura_cents,
    retiro_cierre_cents,
    efectivo_cents: payments
      .filter((p) => p.method === "cash")
      .reduce((acc, p) => acc + p.amount_cents, 0),
    ingresos_cents: vivos
      .filter((m) => m.kind === "ingreso")
      .reduce((acc, m) => acc + m.amount_cents, 0),
    sangrias_cents: vivos
      .filter((m) => m.kind === "sangria")
      .reduce((acc, m) => acc + m.amount_cents, 0),
    propinas_pagadas_cents: vivos
      .filter((m) => m.kind === "propina")
      .reduce((acc, m) => acc + m.amount_cents, 0),
  };

  return {
    caja_id: cajaId,
    total_ventas_cents,
    total_fiado_cents,
    total_propinas_cents,
    ventas_por_metodo,
    ventas_por_origen: agruparVentasPorOrigen(payments),
    ventas_por_origen_y_metodo: cruzarOrigenYMetodo(payments),
    cobros_count: payments.length,
    cobros_por_metodo,
    cobros_por_origen,
    expected_cash_cents,
    periodo_desde: desde,
    desglose_esperado,
  };
}

export async function getPaymentMethodConfigs(
  businessId: string,
): Promise<PaymentMethodConfig[]> {
  const service = db();
  const { data } = await service
    .from("payment_method_configs")
    .select(
      "id, business_id, method, adjustment_percent, label, is_active, sort_order",
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as unknown as PaymentMethodConfig[]).map((r) => ({
    ...r,
    adjustment_percent: Number(r.adjustment_percent),
  }));
}

export async function getAllPaymentMethodConfigs(
  businessId: string,
): Promise<PaymentMethodConfig[]> {
  const service = db();
  const { data } = await service
    .from("payment_method_configs")
    .select(
      "id, business_id, method, adjustment_percent, label, is_active, sort_order",
    )
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as unknown as PaymentMethodConfig[]).map((r) => ({
    ...r,
    adjustment_percent: Number(r.adjustment_percent),
  }));
}

// ── El cierre archivado (spec 149) ──────────────────────────────

/** Nombres de `users` por id, para no repetir el join a mano. */
async function nombresDeUsuarios(
  ids: string[],
): Promise<Map<string, string | null>> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return new Map();
  const service = db();
  const { data } = await service
    .from("users")
    .select("id, full_name")
    .in("id", unicos);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map((u) => [
      u.id,
      u.full_name,
    ]),
  );
}

/**
 * El corte inmediatamente anterior de la misma caja. Marca el piso de la
 * ventana del turno y aporta el arrastre de efectivo.
 */
async function getCorteAnterior(
  cajaId: string,
  antesDe: string,
): Promise<CajaCorte | null> {
  const service = db();
  const { data } = await service
    .from("caja_cortes")
    .select("*")
    .eq("caja_id", cajaId)
    .lt("created_at", antesDe)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as CajaCorte | null;
}

/**
 * Los cierres de un rango, el más reciente primero.
 *
 * `periodo_desde` (cuándo arrancó el turno que cada corte cerró) se resuelve
 * **encadenando** la lista: dentro del rango, el turno de un corte arranca en
 * el corte anterior de su misma caja, que ya está acá. Sólo el más viejo de
 * cada caja necesita ir a la base — una consulta por caja, no por corte.
 */
export async function getCortesDelRango(
  businessId: string,
  filtros: { from: string; to: string; cajaId?: string | null },
): Promise<CorteDelHistorial[]> {
  const service = db();

  let query = service
    .from("caja_cortes")
    .select("*, cajas!inner(name, created_at)")
    .eq("business_id", businessId)
    .gte("created_at", filtros.from)
    .lte("created_at", filtros.to)
    .order("created_at", { ascending: false });
  if (filtros.cajaId) query = query.eq("caja_id", filtros.cajaId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Array<
    CajaCorte & {
      cajas:
        | { name: string; created_at: string }
        | { name: string; created_at: string }[];
    }
  >;
  if (rows.length === 0) return [];

  const caja = (r: (typeof rows)[number]) =>
    Array.isArray(r.cajas) ? r.cajas[0] : r.cajas;

  const { desdePorCorte, sinPredecesor } = encadenarPeriodos(rows);

  // Los que quedaron sin predecesor son el más viejo de cada caja del rango:
  // su piso está antes de lo pedido. Una consulta por caja, no por corte.
  const primeros = new Set<string>();
  const pisos = await Promise.all(
    sinPredecesor.map(async (r) => {
      const anterior = await getCorteAnterior(r.caja_id, r.created_at);
      if (!anterior) primeros.add(r.id);
      return [r.id, anterior?.created_at ?? caja(r).created_at] as const;
    }),
  );
  for (const [id, desde] of pisos) desdePorCorte.set(id, desde);

  const nombres = await nombresDeUsuarios(rows.map((r) => r.encargado_id));

  return rows.map((r) => ({
    ...r,
    caja_name: caja(r).name,
    encargado_name: nombres.get(r.encargado_id) ?? null,
    periodo_desde: desdePorCorte.get(r.id) ?? caja(r).created_at,
    es_primer_corte: primeros.has(r.id),
  }));
}

/**
 * El resumen archivado de un cierre: los números del turno que cerró.
 *
 * Devuelve `null` si el corte no existe **o es de otro negocio** — el scope
 * multi-tenant se chequea acá y no sólo en la ruta.
 */
export async function getResumenDeCorte(
  corteId: string,
  businessId: string,
): Promise<ResumenDeCorte | null> {
  const service = db();

  const { data: corteRow } = await service
    .from("caja_cortes")
    .select("*, cajas!inner(name, is_default, created_at)")
    .eq("id", corteId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!corteRow) return null;

  const row = corteRow as unknown as CajaCorte & {
    cajas:
      | { name: string; is_default: boolean; created_at: string }
      | { name: string; is_default: boolean; created_at: string }[];
  };
  const caja = Array.isArray(row.cajas) ? row.cajas[0] : row.cajas;
  // El join viaja pegado a la fila; el corte que se devuelve es sólo la fila.
  const corte: CajaCorte = {
    id: row.id,
    caja_id: row.caja_id,
    business_id: row.business_id,
    encargado_id: row.encargado_id,
    expected_cash_cents: row.expected_cash_cents,
    closing_cash_cents: row.closing_cash_cents,
    difference_cents: row.difference_cents,
    closing_notes: row.closing_notes,
    denomination_count: row.denomination_count,
    created_at: row.created_at,
    numero: row.numero ?? null,
    resumen: row.resumen ?? null,
  };

  const anterior = await getCorteAnterior(corte.caja_id, corte.created_at);
  const ventana = ventanaDelCorte(corte, anterior, caja.created_at);
  const periodoDesde = ventana.desde;

  const [stats, movimientosRes, retiroRes] = await Promise.all([
    getCajaStatsEnVentana(corte.caja_id, ventana),
    // `corte_id is null`: el retiro del corte **anterior** cae en esta ventana
    // por el `+1 ms` (0052) pero es la última línea de aquel cierre, no un
    // movimiento de este turno. Los stats ya lo netearon contra la apertura;
    // listarlo acá sería contar la misma plata dos veces (igual que hace
    // `getMovimientosPeriodoActual`).
    service
      .from("caja_movimientos")
      .select(
        "id, caja_id, business_id, kind, amount_cents, reason, created_by, created_at, cancelled_at, cancelled_reason",
      )
      .eq("caja_id", corte.caja_id)
      .eq("business_id", businessId)
      .is("corte_id", null)
      .gt("created_at", periodoDesde)
      .lte("created_at", corte.created_at)
      .order("created_at", { ascending: true }),
    // El retiro de **este** cierre vive fuera de su propia ventana (nace un
    // milisegundo después del corte), así que se lo busca por el rótulo.
    service
      .from("caja_movimientos")
      .select("amount_cents, cancelled_at")
      .eq("corte_id", corte.id)
      .eq("business_id", businessId),
  ]);

  const retiroRows = (retiroRes.data ?? []) as {
    amount_cents: number;
    cancelled_at: string | null;
  }[];
  const retiro_cents =
    retiroRows.length === 0
      ? null
      : retiroRows
          .filter((m) => !m.cancelled_at)
          .reduce((acc, m) => acc + Number(m.amount_cents), 0);

  const rendiciones = caja.is_default
    ? await getRendicionesDeVentana(businessId, periodoDesde, corte.created_at)
    : [];

  const nombres = await nombresDeUsuarios([corte.encargado_id]);

  return {
    corte,
    caja_name: caja.name,
    encargado_name: nombres.get(corte.encargado_id) ?? null,
    barre_salon: caja.is_default,
    periodo_desde: periodoDesde,
    es_primer_corte: anterior === null,
    stats,
    movimientos: (movimientosRes.data ?? []) as CajaMovimiento[],
    retiro_cents,
    rendiciones,
  };
}

/**
 * Las rendiciones registradas dentro de la ventana del turno.
 *
 * `mozo_rendiciones` es **por negocio**, no por caja: sólo tiene sentido
 * colgarlas del cierre de la caja que barre el salón (D5). El nombre se
 * resuelve contra `business_users`, que es donde vive el del mozo en ESTE
 * negocio.
 */
async function getRendicionesDeVentana(
  businessId: string,
  desde: string,
  hasta: string,
): Promise<RendicionDelCorte[]> {
  const service = db();
  const { data } = await service
    .from("mozo_rendiciones")
    .select("*")
    .eq("business_id", businessId)
    .gt("created_at", desde)
    .lte("created_at", hasta)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as MozoRendicion[];
  if (rows.length === 0) return [];

  const { data: bu } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", Array.from(new Set(rows.map((r) => r.mozo_id))));
  const nombre = new Map(
    ((bu ?? []) as { user_id: string; full_name: string | null }[]).map((u) => [
      u.user_id,
      u.full_name,
    ]),
  );

  return rows.map((r) => ({
    ...r,
    mozo_name: nombre.get(r.mozo_id) ?? "Sin nombre",
  }));
}

// ── Rendición de mozos ──────────────────────────────────────────

async function getUltimaRendicionMozo(
  mozoId: string,
  businessId: string,
): Promise<MozoRendicion | null> {
  const service = db();
  const { data } = await service
    .from("mozo_rendiciones")
    .select("*")
    .eq("business_id", businessId)
    .eq("mozo_id", mozoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as MozoRendicion | null;
}

export async function getRendicionPendienteMozo(
  mozoId: string,
  businessId: string,
  mozoName: string,
  /**
   * Scope opcional por caja, para el **reparto del arqueo** (issue #264).
   *
   * Lo que el mozo DEBE rendir es de todo el negocio: la plata la tiene encima
   * una sola vez y la entrega una sola vez. Pero el reparto de una caja explica
   * el efectivo esperado **de ese cajón**, y ese esperado se calcula por caja
   * (`getCajaStatsEnVentana` filtra `caja_id`). Sin este scope, al cajón de la
   * Principal se le restaba lo que el mozo había cobrado en el Bar —plata que
   * nunca estuvo en el esperado de la Principal— y el modal mostraba menos de
   * lo que había que contar.
   *
   * Sin `cajaId` el comportamiento es el de siempre: todo el negocio.
   */
  cajaId?: string,
  /**
   * Techo del período, inclusive (issue #264).
   *
   * El período de un mozo tenía piso —su última rendición— pero no techo, y la
   * rendición se insertaba con `now()` de otra transacción. Un cobro que entrara
   * entre la lectura y el insert quedaba **huérfano para siempre**: no lo cubría
   * esta rendición (se leyó antes) ni la siguiente (su `created_at` es anterior
   * al de la fila que define el nuevo piso).
   *
   * Con un techo explícito, el que rinde y el que guarda usan exactamente el
   * mismo corte, y lo que caiga después queda para la próxima.
   */
  hastaIso?: string,
  /** Rol del usuario, para decidir si tiene que rendir (issue #264). */
  mozoRole?: string,
): Promise<RendicionMozoPendiente> {
  const ultima = await getUltimaRendicionMozo(mozoId, businessId);
  const service = db();

  let query = service
    .from("payments")
    .select("method, amount_cents, tip_cents")
    .eq("attributed_mozo_id", mozoId)
    // Scope por negocio (spec 36 · R-C2): sin esto, un mozo activo en dos
    // locales (House/Golf) veía en su rendición los pagos del OTRO negocio.
    .eq("business_id", businessId)
    .eq("payment_status", "paid");

  if (ultima) {
    query = query.gt("created_at", ultima.created_at);
  }
  if (cajaId) {
    query = query.eq("caja_id", cajaId);
  }
  if (hastaIso) {
    query = query.lte("created_at", hastaIso);
  }

  const { data } = await query;
  const payments = (data ?? []) as Array<{
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
  }>;

  const rendicion = calcularRendicionMozo(payments);

  return {
    mozo_id: mozoId,
    mozo_name: mozoName,
    mozo_role: mozoRole,
    efectivo_cents: rendicion.efectivo_cents,
    efectivo_bruto_cents: rendicion.efectivo_bruto_cents,
    tickets_cents: rendicion.tickets_cents,
    por_metodo: rendicion.por_metodo,
    total_propinas_cents: rendicion.total_propinas_cents,
    pagos_count: payments.length,
  };
}

export async function getRendicionesPendientesTodosLosMozos(
  businessId: string,
  /** Scope por caja — sólo para el reparto del arqueo. Ver `getRendicionPendienteMozo`. */
  cajaId?: string,
): Promise<RendicionMozoPendiente[]> {
  const service = db();

  const { data: mozos } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("role", ["mozo", "encargado"]);

  if (!mozos || mozos.length === 0) return [];

  // En paralelo, no en cascada (spec 103): esto corre en la carga inicial de
  // `/admin/operacion` y con 8 mozos eran 8 round-trips encadenados —cada uno
  // con su propia consulta de pagos— antes de que la página pudiera cerrar.
  return Promise.all(
    (
      mozos as Array<{
        user_id: string;
        full_name: string | null;
        role: string;
      }>
    ).map((m) =>
      getRendicionPendienteMozo(
        m.user_id,
        businessId,
        m.full_name ?? "Sin nombre",
        cajaId,
        undefined,
        m.role,
      ),
    ),
  );
}

export async function getRendicionesHistorial(
  businessId: string,
  limit = 20,
): Promise<
  (MozoRendicion & { mozo_name: string; registered_by_name: string | null })[]
> {
  const service = db();
  const { data } = await service
    .from("mozo_rendiciones")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) return [];

  const rows = data as MozoRendicion[];
  const userIds = Array.from(
    new Set([
      ...rows.map((r) => r.mozo_id),
      ...rows.map((r) => r.registered_by),
    ]),
  );
  const { data: users } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", userIds);
  const nameById = new Map(
    (users ?? []).map((u) => [
      (u as { user_id: string }).user_id,
      (u as { full_name: string | null }).full_name,
    ]),
  );

  return rows.map((r) => ({
    ...r,
    mozo_name: nameById.get(r.mozo_id) ?? "Sin nombre",
    registered_by_name: nameById.get(r.registered_by) ?? null,
  }));
}

// ── Asignación caja↔usuario ─────────────────────────────────────

export async function getCajaUserAssignments(
  businessId: string,
): Promise<
  (CajaUserAssignment & { user_name: string | null; caja_name: string })[]
> {
  const service = db();
  const { data } = await service
    .from("caja_user_assignments")
    .select("*, cajas!inner(name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) return [];

  const rows = data as unknown as (CajaUserAssignment & {
    cajas: { name: string } | { name: string }[];
  })[];

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: users } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", userIds);
  const nameById = new Map(
    (users ?? []).map((u) => [
      (u as { user_id: string }).user_id,
      (u as { full_name: string | null }).full_name,
    ]),
  );

  return rows.map((r) => {
    const cajaName = Array.isArray(r.cajas) ? r.cajas[0].name : r.cajas.name;
    return {
      id: r.id,
      business_id: r.business_id,
      caja_id: r.caja_id,
      user_id: r.user_id,
      created_at: r.created_at,
      user_name: nameById.get(r.user_id) ?? null,
      caja_name: cajaName,
    };
  });
}

// ── Libro de movimientos (spec 070) ─────────────────────────────

/**
 * Techo de filas por consulta. El libro es una herramienta de auditoría del
 * turno / del día, no un export contable: si un rango se pasa de esto, se
 * avisa (`truncado`) en vez de mentir con una lista cortada en silencio.
 */
const LIBRO_MAX_FILAS = 500;

function descripcionDeOrden(o: {
  delivery_type: string;
  customer_name: string | null;
  order_number: number;
  table_label: string | null;
}): string {
  if (o.delivery_type === "dine_in" && o.table_label)
    return `Mesa ${o.table_label}`;
  const nombre = o.customer_name?.trim();
  if (nombre) return nombre;
  return o.order_number > 0 ? `#${o.order_number}` : "Orden";
}

/**
 * Todas las líneas de caja de un rango: cobros (incluidos los **anulados**, que
 * hoy no se ven en ninguna pantalla) y movimientos, mezclados y ordenados del
 * más nuevo al más viejo.
 *
 * Cada línea llega sabiendo si se puede corregir y, si no, por qué — que es lo
 * que el encargado necesita leer para saber qué hacer en su lugar.
 */
export async function getLibroDeMovimientos(
  businessId: string,
  filtros: LibroFiltros,
): Promise<{
  entries: LibroEntry[];
  totales: LibroTotales;
  truncado: boolean;
}> {
  const service = db();
  // spec 160 · con `true`: si la administrativa se cae del Map, la orden de pago
  // sale con `caja_name: "—"` y `arqueado: false`, y queda corregible para siempre.
  const cajas = await getCajasConEstado(businessId, true);
  const cajaById = new Map(cajas.map((c) => [c.id, c]));

  const quiereCobros = !filtros.tipo || filtros.tipo === "cobro";
  const quiereMovs = !filtros.tipo || filtros.tipo !== "cobro";

  let pagosQuery = service
    .from("payments")
    .select(
      "id, caja_id, method, amount_cents, tip_cents, created_at, attributed_mozo_id, order_id, payment_status, refunded_reason, mp_payment_id, orders!inner(order_number, delivery_type, customer_name, table_id, tables!orders_table_id_fkey(label))",
    )
    .eq("business_id", businessId)
    .in("payment_status", ["paid", "refunded"])
    .gte("created_at", filtros.from)
    .lte("created_at", filtros.to)
    .order("created_at", { ascending: false })
    .limit(LIBRO_MAX_FILAS);
  if (filtros.cajaId) pagosQuery = pagosQuery.eq("caja_id", filtros.cajaId);
  if (filtros.method) pagosQuery = pagosQuery.eq("method", filtros.method);
  if (filtros.mozoId)
    pagosQuery = pagosQuery.eq("attributed_mozo_id", filtros.mozoId);

  let movsQuery = service
    .from("caja_movimientos")
    .select(
      "id, caja_id, kind, amount_cents, reason, created_at, cancelled_at, cancelled_reason",
    )
    .eq("business_id", businessId)
    .gte("created_at", filtros.from)
    .lte("created_at", filtros.to)
    .order("created_at", { ascending: false })
    .limit(LIBRO_MAX_FILAS);
  if (filtros.cajaId) movsQuery = movsQuery.eq("caja_id", filtros.cajaId);
  if (
    filtros.tipo === "sangria" ||
    filtros.tipo === "ingreso" ||
    filtros.tipo === "propina"
  ) {
    movsQuery = movsQuery.eq("kind", filtros.tipo);
  }

  const [pagosRes, movsRes] = await Promise.all([
    quiereCobros ? pagosQuery : Promise.resolve({ data: [] }),
    // Un filtro por método o por mozo es de cobros: una sangría no tiene
    // ninguno de los dos, así que mostrarlas igual sería ruido.
    quiereMovs && !filtros.method && !filtros.mozoId
      ? movsQuery
      : Promise.resolve({ data: [] }),
  ]);

  type PagoRow = {
    id: string;
    caja_id: string;
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    created_at: string;
    attributed_mozo_id: string | null;
    order_id: string;
    payment_status: string;
    refunded_reason: string | null;
    mp_payment_id: string | null;
    orders:
      | {
          order_number: number;
          delivery_type: string;
          customer_name: string | null;
          table_id: string | null;
          tables: { label: string } | { label: string }[] | null;
        }
      | Array<{
          order_number: number;
          delivery_type: string;
          customer_name: string | null;
          table_id: string | null;
          tables: { label: string } | { label: string }[] | null;
        }>
      | null;
  };
  type MovRow = {
    id: string;
    caja_id: string;
    kind: CajaMovimientoKind;
    amount_cents: number;
    reason: string | null;
    created_at: string;
    cancelled_at: string | null;
    cancelled_reason: string | null;
  };

  const pagos = (pagosRes.data ?? []) as unknown as PagoRow[];
  const movs = (movsRes.data ?? []) as unknown as MovRow[];

  // Datos de apoyo: nombres, correcciones previas, facturas y rendiciones.
  const mozoIds = Array.from(
    new Set(
      pagos.map((p) => p.attributed_mozo_id).filter((x): x is string => !!x),
    ),
  );
  const orderIds = Array.from(new Set(pagos.map((p) => p.order_id)));
  const entityIds = [...pagos.map((p) => p.id), ...movs.map((m) => m.id)];

  const [nombresRes, auditRes, facturasRes, rendicionesRes] = await Promise.all(
    [
      mozoIds.length > 0
        ? service
            .from("business_users")
            .select("user_id, full_name")
            .eq("business_id", businessId)
            .in("user_id", mozoIds)
        : Promise.resolve({ data: [] }),
      entityIds.length > 0
        ? service
            .from("caja_audit_log")
            .select("entity_id")
            .eq("business_id", businessId)
            .in("entity_id", entityIds)
        : Promise.resolve({ data: [] }),
      orderIds.length > 0
        ? service
            .from("invoices")
            .select("id, order_id, tipo_comprobante, punto_venta, numero")
            .eq("business_id", businessId)
            .eq("status", "authorized")
            .in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
      service
        .from("mozo_rendiciones")
        .select("mozo_id, created_at")
        .eq("business_id", businessId)
        .gte("created_at", filtros.from),
    ],
  );

  const nombreById = new Map(
    (
      (nombresRes.data ?? []) as Array<{
        user_id: string;
        full_name: string | null;
      }>
    ).map((u) => [u.user_id, u.full_name]),
  );
  const corregidos = new Set(
    ((auditRes.data ?? []) as Array<{ entity_id: string }>).map(
      (r) => r.entity_id,
    ),
  );
  // El comprobante NO limita la corrección del cobro (se emite sobre la cuenta,
  // no sobre el pago): viaja para poder saltar a él desde la línea cuando lo
  // que hay que rehacer es la factura.
  const facturaPorOrden = new Map(
    (
      (facturasRes.data ?? []) as Array<{
        id: string;
        order_id: string;
        tipo_comprobante: string;
        punto_venta: number;
        numero: number | null;
      }>
    ).map((r) => [
      r.order_id,
      {
        id: r.id,
        tipo_comprobante: r.tipo_comprobante,
        punto_venta: r.punto_venta,
        numero: r.numero,
      },
    ]),
  );
  const rendiciones = (rendicionesRes.data ?? []) as Array<{
    mozo_id: string;
    created_at: string;
  }>;

  const entries: LibroEntry[] = [];

  for (const p of pagos) {
    const ord = Array.isArray(p.orders) ? p.orders[0] : p.orders;
    const tbl = ord?.tables
      ? Array.isArray(ord.tables)
        ? ord.tables[0]
        : ord.tables
      : null;
    const caja = cajaById.get(p.caja_id);
    const anulado = p.payment_status === "refunded";
    const esMp =
      p.mp_payment_id !== null ||
      p.method === "mp_link" ||
      p.method === "mp_qr";
    const arqueado = caja
      ? new Date(p.created_at).getTime() <=
        new Date(caja.periodo_desde).getTime()
      : false;

    let bloqueo: string | null = null;
    if (anulado) bloqueo = "El cobro está anulado.";
    else if (esMp)
      bloqueo = "Es un cobro de Mercado Pago: la acreditación la confirmó MP.";
    else if (arqueado) bloqueo = "Ya entró en un arqueo cerrado.";

    const advertencias: string[] = [];
    if (!bloqueo) {
      const yaRindio = rendiciones.some(
        (r) =>
          r.mozo_id === p.attributed_mozo_id &&
          new Date(r.created_at).getTime() > new Date(p.created_at).getTime(),
      );
      if (yaRindio) {
        const nombre = p.attributed_mozo_id
          ? (nombreById.get(p.attributed_mozo_id) ?? "ese mozo")
          : "ese mozo";
        advertencias.push(
          `${nombre} ya rindió este cobro: no se puede cambiar el mozo.`,
        );
      }
    }

    entries.push({
      tipo: "cobro",
      id: p.id,
      created_at: p.created_at,
      caja_id: p.caja_id,
      caja_name: caja?.name ?? "—",
      amount_cents: Number(p.amount_cents),
      tip_cents: Number(p.tip_cents),
      method: p.method,
      attributed_mozo_id: p.attributed_mozo_id,
      attributed_mozo_name: p.attributed_mozo_id
        ? (nombreById.get(p.attributed_mozo_id) ?? null)
        : null,
      descripcion: ord
        ? descripcionDeOrden({
            delivery_type: ord.delivery_type,
            customer_name: ord.customer_name,
            order_number: ord.order_number,
            table_label: tbl?.label ?? null,
          })
        : "Orden",
      order_id: p.order_id,
      order_number: ord?.order_number ?? null,
      anulado,
      anulado_reason: p.refunded_reason,
      corregido: corregidos.has(p.id),
      bloqueo,
      advertencias,
      factura: facturaPorOrden.get(p.order_id) ?? null,
    });
  }

  for (const m of movs) {
    const caja = cajaById.get(m.caja_id);
    const arqueado = caja
      ? new Date(m.created_at).getTime() <=
        new Date(caja.periodo_desde).getTime()
      : false;
    let bloqueo: string | null = null;
    if (m.cancelled_at) bloqueo = "El movimiento está anulado.";
    else if (arqueado) bloqueo = "Ya entró en un arqueo cerrado.";

    entries.push({
      tipo: m.kind,
      id: m.id,
      created_at: m.created_at,
      caja_id: m.caja_id,
      caja_name: caja?.name ?? "—",
      amount_cents: Number(m.amount_cents),
      tip_cents: 0,
      method: null,
      attributed_mozo_id: null,
      attributed_mozo_name: null,
      descripcion:
        m.reason?.trim() || (m.kind === "sangria" ? "Sangría" : "Ingreso"),
      order_id: null,
      order_number: null,
      anulado: m.cancelled_at !== null,
      anulado_reason: m.cancelled_reason,
      corregido: corregidos.has(m.id),
      bloqueo,
      advertencias: [],
      factura: null,
    });
  }

  const term = filtros.search?.trim().toLowerCase() ?? "";
  const filtradas = term
    ? entries.filter(
        (e) =>
          e.descripcion.toLowerCase().includes(term) ||
          (e.order_number !== null && String(e.order_number).includes(term)) ||
          (e.attributed_mozo_name ?? "").toLowerCase().includes(term),
      )
    : entries;

  filtradas.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const totales: LibroTotales = {
    cobrado_cents: 0,
    propinas_cents: 0,
    cobros_count: 0,
    ingresos_cents: 0,
    sangrias_cents: 0,
    propinas_pagadas_cents: 0,
    por_metodo: { ...EMPTY_BY_METHOD },
  };
  for (const e of filtradas) {
    // Lo anulado se muestra, pero no suma: si sumara, el libro contradiría al
    // arqueo, que ya lo ignora.
    if (e.anulado) continue;
    if (e.tipo === "cobro") {
      totales.cobrado_cents += e.amount_cents;
      totales.propinas_cents += e.tip_cents;
      totales.cobros_count += 1;
      if (e.method) {
        totales.por_metodo[e.method] =
          (totales.por_metodo[e.method] ?? 0) + e.amount_cents;
      }
    } else if (e.tipo === "ingreso") {
      totales.ingresos_cents += e.amount_cents;
    } else if (e.tipo === "propina") {
      // Spec 177 — aparte de las sangrías: las dos sacan plata del cajón, pero
      // una se la lleva el dueño y la otra se le paga al personal.
      totales.propinas_pagadas_cents += e.amount_cents;
    } else {
      totales.sangrias_cents += e.amount_cents;
    }
  }

  return {
    entries: filtradas,
    totales,
    truncado: pagos.length >= LIBRO_MAX_FILAS || movs.length >= LIBRO_MAX_FILAS,
  };
}

/** El historial de correcciones de una línea, para el detalle. */
export async function getCorreccionesDeLinea(
  businessId: string,
  entityType: "payment" | "movimiento",
  entityId: string,
): Promise<CorreccionLog[]> {
  const service = db();
  const { data } = await service
    .from("caja_audit_log")
    .select("id, field, from_value, to_value, reason, created_at, by_user_id")
    .eq("business_id", businessId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as Array<{
    id: string;
    field: string;
    from_value: string | null;
    to_value: string | null;
    reason: string;
    created_at: string;
    by_user_id: string | null;
  }>;
  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(rows.map((r) => r.by_user_id).filter((x): x is string => !!x)),
  );
  const { data: users } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", userIds);
  const nombreById = new Map(
    ((users ?? []) as Array<{ user_id: string; full_name: string | null }>).map(
      (u) => [u.user_id, u.full_name],
    ),
  );

  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    from_value: r.from_value,
    to_value: r.to_value,
    reason: r.reason,
    created_at: r.created_at,
    by_name: r.by_user_id ? (nombreById.get(r.by_user_id) ?? null) : null,
  }));
}

/**
 * Traduce los ids que guarda la auditoría a algo legible. El log guarda ids
 * (es el dato exacto); el encargado necesita nombres.
 */
export async function resolverNombresDeCorreccion(
  businessId: string,
  logs: CorreccionLog[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const l of logs) {
    if (l.field === "attributed_mozo_id" || l.field === "caja_id") {
      if (l.from_value) ids.add(l.from_value);
      if (l.to_value) ids.add(l.to_value);
    }
  }
  const out = new Map<string, string>();
  if (ids.size === 0) return out;

  const service = db();
  const lista = Array.from(ids);
  const [usersRes, cajasRes] = await Promise.all([
    service
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .in("user_id", lista),
    service
      .from("cajas")
      .select("id, name")
      .eq("business_id", businessId)
      .in("id", lista),
  ]);
  for (const u of (usersRes.data ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>) {
    if (u.full_name) out.set(u.user_id, u.full_name);
  }
  for (const c of (cajasRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    out.set(c.id, c.name);
  }
  return out;
}

// ── Cierre de caja (spec 130) ────────────────────────────────────

/**
 * Una mesa con la cuenta abierta. Bloquea el cierre de la caja principal:
 * cerrar el día así es cerrar con plata sin cobrar (D7).
 */
export type CuentaAbierta = {
  order_id: string;
  order_number: number | null;
  table_id: string;
  table_label: string;
  mozo_name: string | null;
  total_cents: number;
  /** Lo que falta cobrar: el total menos lo ya pagado (cuentas divididas). */
  pendiente_cents: number;
};

/** Un pedido sin mesa (delivery / take away) todavía abierto. Avisa, no bloquea. */
export type PedidoAbierto = {
  order_id: string;
  order_number: number | null;
  origen: "delivery" | "takeaway" | "otro";
  customer_name: string | null;
  total_cents: number;
};

export async function getCuentasAbiertas(
  businessId: string,
): Promise<CuentaAbierta[]> {
  const service = db();
  const { data } = await service
    .from("orders")
    .select(
      "id, order_number, total_cents, total_paid_cents, table_id, tables!orders_table_id_fkey(label, mozo_id)",
    )
    .eq("business_id", businessId)
    .eq("lifecycle_status", "open")
    .not("table_id", "is", null)
    .order("order_number", { ascending: true });

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    order_number: number | null;
    total_cents: number;
    total_paid_cents: number | null;
    table_id: string;
    tables:
      | { label: string; mozo_id: string | null }
      | { label: string; mozo_id: string | null }[]
      | null;
  }>;
  if (rows.length === 0) return [];

  // El nombre del mozo sale de la asignación de la mesa, en un solo viaje: la
  // lista se muestra para ir a cobrar, y «Mesa 12» sin dueño no le dice a nadie
  // a quién buscar.
  const mozoIds = [
    ...new Set(
      rows
        .map((r) => (Array.isArray(r.tables) ? r.tables[0] : r.tables)?.mozo_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const nombres = new Map<string, string>();
  if (mozoIds.length > 0) {
    const { data: users } = await service
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .in("user_id", mozoIds);
    for (const u of (users ?? []) as Array<{
      user_id: string;
      full_name: string | null;
    }>) {
      if (u.full_name) nombres.set(u.user_id, u.full_name);
    }
  }

  return rows.map((r) => {
    const mesa = Array.isArray(r.tables) ? r.tables[0] : r.tables;
    const total = Number(r.total_cents ?? 0);
    const pagado = Number(r.total_paid_cents ?? 0);
    return {
      order_id: r.id,
      order_number: r.order_number,
      table_id: r.table_id,
      table_label: mesa?.label ?? "?",
      mozo_name: mesa?.mozo_id ? (nombres.get(mesa.mozo_id) ?? null) : null,
      total_cents: total,
      pendiente_cents: Math.max(0, total - pagado),
    };
  });
}

export async function getPedidosAbiertosSinMesa(
  businessId: string,
): Promise<PedidoAbierto[]> {
  const service = db();
  const { data } = await service
    .from("orders")
    .select("id, order_number, total_cents, customer_name, delivery_type")
    .eq("business_id", businessId)
    .eq("lifecycle_status", "open")
    .is("table_id", null)
    .order("order_number", { ascending: true });

  return (
    (data ?? []) as Array<{
      id: string;
      order_number: number | null;
      total_cents: number;
      customer_name: string | null;
      delivery_type: string;
    }>
  ).map((r) => {
    const origen = origenDeDeliveryType(r.delivery_type);
    return {
      order_id: r.id,
      order_number: r.order_number,
      // `salon` acá sería una venta de mostrador sin mesa: entra como "otro"
      // para no prometer un origen que la lista no puede distinguir (D11).
      origen: origen === "delivery" || origen === "takeaway" ? origen : "otro",
      customer_name: r.customer_name,
      total_cents: Number(r.total_cents ?? 0),
    };
  });
}

/** Todo lo que el modal de cierre necesita, resuelto en un solo viaje. */
export type CierreCajaData = {
  stats: CajaLiveStats;
  /** El esperado partido por dueño (D5). Sólo la principal reparte (D9). */
  reparto: RepartoEfectivo;
  /** Bloquean el cierre. Vacío en una caja que no barre el salón. */
  cuentas_abiertas: CuentaAbierta[];
  /** Avisan, no bloquean. */
  pedidos_abiertos: PedidoAbierto[];
  /** Cuántas mesas se van a liberar y cuántas asignaciones se van a limpiar. */
  salon: { mesas_a_liberar: number; mozos_asignados: number };
  /** `is_default`: la caja principal es la que cierra el día (D9). */
  barre_salon: boolean;
  /**
   * Spec 139 · quiénes tienen que rendir antes de cerrar. **Bloquean.** Es
   * superconjunto de `reparto.mozos`: acá entra también el que cobró todo con
   * tarjeta (efectivo $0 pero período abierto, D4).
   */
  deben_rendir: RendicionMozoPendiente[];
  /**
   * La caja no tiene ningún operador asignado (`caja_user_assignments`). Sin
   * eso, D3 no puede excluir a nadie y el que atiende la caja termina
   * rindiéndose a sí mismo. Se avisa en el modal.
   */
  sin_operadores: boolean;
};

/**
 * Los números del cierre. Vive aparte de `getCajaLiveStats` a propósito: el
 * reparto por dueño necesita la rendición pendiente de **cada** mozo (una
 * consulta de pagos por cabeza) y los stats los pide un poll de 30 s, por caja,
 * desde cada tablet del local. Colgarlo del poll era pagar 40 queries cada
 * medio minuto para un número que sólo se mira cuando se cierra el día.
 */
export async function getCierreCajaData(
  cajaId: string,
  businessId: string,
): Promise<CierreCajaData | null> {
  const service = db();
  const { data: cajaRow } = await service
    .from("cajas")
    .select("id, business_id, is_default, is_administrative")
    .eq("id", cajaId)
    .maybeSingle();
  if (!cajaRow) return null;
  const caja = cajaRow as {
    business_id: string;
    is_default: boolean;
    is_administrative: boolean;
  };
  if (caja.business_id !== businessId) return null;
  // spec 160 · sin esto la pantalla arma un arqueo para una caja que no se
  // arquea, y recién falla al confirmar contra `cerrar_caja_tx`.
  if (caja.is_administrative) return null;

  const stats = await getCajaLiveStats(cajaId, businessId);
  if (!stats) return null;

  // El cierre del bar puede pasar en plena cena: no libera mesas, no pide
  // rendiciones y no le importa la 12 que sigue comiendo (D9).
  if (!caja.is_default) {
    return {
      stats,
      reparto: repartirEfectivoEsperado({
        expected_cash_cents: stats.expected_cash_cents,
        mozos_sin_rendir: [],
      }),
      cuentas_abiertas: [],
      pedidos_abiertos: [],
      salon: { mesas_a_liberar: 0, mozos_asignados: 0 },
      barre_salon: false,
      deben_rendir: [],
      sin_operadores: false,
    };
  }

  // Dos lecturas del mismo concepto, y la diferencia importa (issue #264):
  //
  //  · `pendientes` es de TODO el negocio — es lo que cada mozo debe entregar,
  //    y se entrega una sola vez, sin importar en qué caja cobró. Alimenta
  //    `deben_rendir` y el bloqueo del cierre.
  //  · `pendientesDeEstaCaja` está scopeado a ESTA caja — es lo único que puede
  //    restarse de SU cajón, porque `stats.expected_cash_cents` también se
  //    calcula por caja. Antes se usaba el business-wide para las dos cosas, y
  //    al cajón de la Principal se le descontaba el efectivo que el mozo había
  //    cobrado en el Bar: plata que jamás estuvo en el esperado de la Principal.
  const [pendientes, pendientesDeEstaCaja, operadores, cuentas, pedidos, salon] =
    await Promise.all([
      getRendicionesPendientesTodosLosMozos(businessId),
      getRendicionesPendientesTodosLosMozos(businessId, cajaId),
      getOperadoresDeCaja(cajaId, businessId),
      getCuentasAbiertas(businessId),
      getPedidosAbiertosSinMesa(businessId),
      contarSalonPorLiberar(businessId),
    ]);

  // Spec 139 · D3 — el operador de la caja no rinde, y tampoco se le resta al
  // cajón: lo que cobró ya está adentro. Antes el reparto le restaba su
  // efectivo al cajón y el modal mostraba menos plata de la que hay.
  const debenRendir = mozosQueDebenRendir(pendientes, operadores);
  const restanDeEsteCajon = mozosQueDebenRendir(pendientesDeEstaCaja, operadores);

  return {
    stats,
    reparto: repartirEfectivoEsperado({
      expected_cash_cents: stats.expected_cash_cents,
      mozos_sin_rendir: restanDeEsteCajon.map((p) => ({
        mozo_id: p.mozo_id,
        mozo_name: p.mozo_name,
        // Bruto: es lo que el mozo tiene en la mano, y es lo que hay que
        // restarle al cajón (spec 177 · D5).
        efectivo_cents: p.efectivo_bruto_cents,
      })),
    }),
    cuentas_abiertas: cuentas,
    pedidos_abiertos: pedidos,
    salon,
    barre_salon: true,
    deben_rendir: debenRendir,
    sin_operadores: operadores.length === 0,
  };
}

/**
 * Los usuarios asignados a una caja (`caja_user_assignments`, spec 07): los que
 * cobran parados en ella y por eso **no rinden** (spec 139 · D3).
 */
export async function getOperadoresDeCaja(
  cajaId: string,
  businessId: string,
): Promise<string[]> {
  const service = db();
  const { data } = await service
    .from("caja_user_assignments")
    .select("user_id")
    .eq("caja_id", cajaId)
    .eq("business_id", businessId);
  return ((data as { user_id: string }[] | null) ?? []).map((a) => a.user_id);
}

/**
 * Lo que el cierre va a barrer, para poder anunciarlo **antes** de apretar
 * (D8): hoy el encargado se entera por un toast, cuando ya pasó.
 */
async function contarSalonPorLiberar(
  businessId: string,
): Promise<{ mesas_a_liberar: number; mozos_asignados: number }> {
  const service = db();
  const { data: plans } = await service
    .from("floor_plans")
    .select("id")
    .eq("business_id", businessId);
  const planIds = ((plans as { id: string }[] | null) ?? []).map((p) => p.id);
  if (planIds.length === 0) return { mesas_a_liberar: 0, mozos_asignados: 0 };

  const { data } = await service
    .from("tables")
    .select("operational_status, mozo_id")
    .in("floor_plan_id", planIds);

  const rows = (data ?? []) as Array<{
    operational_status: string;
    mozo_id: string | null;
  }>;
  return {
    mesas_a_liberar: rows.filter((t) => t.operational_status !== "libre")
      .length,
    mozos_asignados: rows.filter((t) => t.mozo_id !== null).length,
  };
}
