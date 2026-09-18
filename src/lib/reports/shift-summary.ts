import { formatInTimeZone } from "date-fns-tz";

import { formatCurrency } from "@/lib/currency";
import type { PaymentMethod } from "@/lib/caja/types";

// ════════════════════════════════════════════════════════════════════════
// Resumen de cierre de turno (spec 34) — COMPOSICIÓN PURA.
//
// `buildShiftSummary` toma los datos ya agregados por las fuentes existentes
// (caja, AFIP, reportes, rendiciones) y los mapea a las secciones del mail,
// formateando montos en ARS y horas en timezone AR. NO recalcula totales: los
// montos salen de las mismas fuentes que ve el dueño en caja/AFIP, así no
// divergen. Es pura y testeable con fixtures — el loader (impuro, service
// client) vive aparte en `shift-summary-loader.ts`.
// ════════════════════════════════════════════════════════════════════════

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card_manual: "Tarjeta",
  mp_link: "Mercado Pago (link)",
  mp_qr: "Mercado Pago (QR)",
  transfer: "Transferencia",
  mp_manual: "Mercado Pago",
  other: "Otro",
  cuenta_corriente: "Cuenta corriente",
};

const METHOD_ORDER: PaymentMethod[] = [
  "cash",
  "card_manual",
  "mp_qr",
  "mp_link",
  "transfer",
  "mp_manual",
  "other",
];

// ── Datos de entrada (agregados crudos) ─────────────────────────────────

export type CancellationKind = "mesa" | "item" | "factura";

export type CancellationRow = {
  kind: CancellationKind;
  /** Qué se anuló: "Mesa 5", "Milanesa napolitana", "Factura B 0001-00000123". */
  label: string;
  reason: string | null;
  /** Nombre resuelto del responsable, o null si no se pudo (→ "—"). */
  responsable: string | null;
  at: string; // ISO
};

/**
 * Una corrección de caja del turno (spec 070). El mail las lista al lado de
 * las anulaciones: son la otra forma de que un número del día cambie después
 * de registrado, y el dueño tiene que poder verlas sin entrar al panel.
 */
export type CorrectionRow = {
  entity: "payment" | "movimiento";
  /** Columna corregida: 'method', 'amount_cents', 'cancelled'… */
  field: string;
  from_value: string | null;
  to_value: string | null;
  /** Nombre legible cuando el valor es un id (mozo, caja); lo resuelve el loader. */
  from_label: string | null;
  to_label: string | null;
  reason: string;
  responsable: string | null;
  at: string; // ISO
};

export type ShiftCorte = {
  caja_name: string;
  encargado_name: string | null;
  difference_cents: number;
  closing_cash_cents: number;
  expected_cash_cents: number;
  at: string; // ISO
};

export type ShiftMozo = {
  mozo_name: string;
  ventas_cents: number;
  propinas_cents: number;
  cobros_count: number;
};

export type ShiftSummaryData = {
  businessName: string;
  timezone: string;
  /** Etiqueta del rango ya formateada por el loader (ej. "sábado 28/06/2026"). */
  rangeLabel: string;
  recaudacion: {
    /** Lo que entró al cajón. El fiado NO suma acá (spec 141 · D3). */
    total_cents: number;
    /**
     * Fiado del día (`cuenta_corriente`): venta sí, plata cobrada no.
     * Opcional: un resumen calculado antes de la issue #272 no lo trae.
     */
    fiado_cents?: number;
    propinas_cents: number;
    por_metodo: Record<PaymentMethod, number>;
    cobros_count: number;
  };
  afip: {
    totalCents: number;
    count: number;
    countA: number;
    countB: number;
    countFailed: number;
    countPending: number;
  };
  operacion: {
    orderCount: number;
    revenueCents: number;
    averageTicketCents: number;
    deliveryCount: number;
    pickupCount: number;
    dineInCount: number;
    cancelledCount: number;
  };
  cortes: ShiftCorte[];
  porMozo: ShiftMozo[];
  anulaciones: CancellationRow[];
  /** Opcional: un resumen calculado antes de la spec 070 no tiene ninguna. */
  correcciones?: CorrectionRow[];
};

// ── Modelo de vista (formateado, listo para el template) ────────────────

export type MetodoLine = { label: string; value: string };

export type ShiftSummary = {
  businessName: string;
  rangeLabel: string;
  recaudacion: {
    total: string;
    propinas: string;
    /** Fiado del día, formateado. "$0" cuando nadie firmó. */
    fiado: string;
    /** False cuando el fiado es cero: el mail no muestra el renglón. */
    tieneFiado: boolean;
    cobros: number;
    porMetodo: MetodoLine[];
  };
  facturacion: {
    total: string;
    comprobantes: number;
    desglose: string;
    pendientes: number;
    fallidos: number;
  };
  operacion: {
    pedidos: number;
    ticketPromedio: string;
    delivery: number;
    pickup: number;
    /** Mesas atendidas (dine-in). MVP: aproxima "cubiertos" — el nº de
     *  comensales no se captura hoy por orden. Ver design D5. */
    mesas: number;
    cancelados: number;
  };
  caja: {
    cortes: {
      caja: string;
      encargado: string;
      diferencia: string;
      hora: string;
    }[];
    diferenciaTotal: string;
  };
  porMozo: { mozo: string; ventas: string; propinas: string }[];
  anulaciones: {
    detalle: string;
    motivo: string;
    responsable: string;
    hora: string;
  }[];
  correcciones: {
    detalle: string;
    cambio: string;
    motivo: string;
    responsable: string;
    hora: string;
  }[];
  /** False si el día no tuvo movimiento (recaudación, pedidos ni cortes). */
  hasData: boolean;
};

const CAMPO_CORREGIDO: Record<string, string> = {
  method: "método",
  amount_cents: "monto",
  tip_cents: "propina",
  attributed_mozo_id: "mozo",
  caja_id: "caja",
  last_four: "últimos 4",
  card_brand: "tarjeta",
  notes: "nota",
  cancelled: "estado",
};

/** Los centavos y los ids del log no se leen: se traducen. */
export function valorCorregido(
  field: string,
  raw: string | null,
  label: string | null,
): string {
  if (raw === null) return "—";
  if (field === "amount_cents" || field === "tip_cents") {
    return formatCurrency(Number(raw));
  }
  if (field === "method") {
    return PAYMENT_METHOD_LABELS[raw as PaymentMethod] ?? raw;
  }
  if (field === "attributed_mozo_id" || field === "caja_id")
    return label ?? raw;
  return raw;
}

function fmtHora(iso: string, timezone: string): string {
  try {
    return formatInTimeZone(new Date(iso), timezone, "HH:mm");
  } catch {
    return "—";
  }
}

/**
 * Compone el `ShiftSummary` (vista formateada) a partir de los datos agregados.
 * Pura: mismo input → mismo output; no toca la red ni `new Date()` para el
 * rango (eso lo hace el loader).
 */
export function buildShiftSummary(data: ShiftSummaryData): ShiftSummary {
  const { recaudacion, afip, operacion, cortes, porMozo, anulaciones } = data;
  const correcciones = data.correcciones ?? [];

  // `METHOD_ORDER` no lista `cuenta_corriente` a propósito: son los métodos de
  // COBRO, y el fiado no es uno — sale en su propio KPI, al lado de la
  // recaudación, para que la tabla vuelva a sumar al total de arriba.
  const fiadoCents = recaudacion.fiado_cents ?? 0;

  const porMetodo: MetodoLine[] = METHOD_ORDER.filter(
    (m) => (recaudacion.por_metodo[m] ?? 0) > 0,
  ).map((m) => ({
    label: PAYMENT_METHOD_LABELS[m],
    value: formatCurrency(recaudacion.por_metodo[m] ?? 0),
  }));

  const diferenciaTotalCents = cortes.reduce(
    (acc, c) => acc + c.difference_cents,
    0,
  );

  const hasData =
    recaudacion.total_cents > 0 ||
    fiadoCents > 0 ||
    operacion.orderCount > 0 ||
    cortes.length > 0 ||
    afip.count > 0;

  return {
    businessName: data.businessName,
    rangeLabel: data.rangeLabel,
    recaudacion: {
      total: formatCurrency(recaudacion.total_cents),
      propinas: formatCurrency(recaudacion.propinas_cents),
      fiado: formatCurrency(fiadoCents),
      tieneFiado: fiadoCents > 0,
      cobros: recaudacion.cobros_count,
      porMetodo,
    },
    facturacion: {
      total: formatCurrency(afip.totalCents),
      comprobantes: afip.count,
      desglose: `A: ${afip.countA} · B: ${afip.countB}`,
      pendientes: afip.countPending,
      fallidos: afip.countFailed,
    },
    operacion: {
      pedidos: operacion.orderCount,
      ticketPromedio: formatCurrency(operacion.averageTicketCents),
      delivery: operacion.deliveryCount,
      pickup: operacion.pickupCount,
      mesas: operacion.dineInCount,
      cancelados: operacion.cancelledCount,
    },
    caja: {
      cortes: cortes.map((c) => ({
        caja: c.caja_name,
        encargado: c.encargado_name ?? "—",
        diferencia: formatCurrency(c.difference_cents),
        hora: fmtHora(c.at, data.timezone),
      })),
      diferenciaTotal: formatCurrency(diferenciaTotalCents),
    },
    porMozo: porMozo.map((m) => ({
      mozo: m.mozo_name,
      ventas: formatCurrency(m.ventas_cents),
      propinas: formatCurrency(m.propinas_cents),
    })),
    anulaciones: anulaciones.map((a) => ({
      detalle: a.label,
      motivo: a.reason?.trim() ? a.reason.trim() : "—",
      responsable: a.responsable?.trim() ? a.responsable.trim() : "—",
      hora: fmtHora(a.at, data.timezone),
    })),
    correcciones: correcciones.map((c) => ({
      detalle: `${c.entity === "payment" ? "Cobro" : "Movimiento"} · ${CAMPO_CORREGIDO[c.field] ?? c.field}`,
      cambio: `${valorCorregido(c.field, c.from_value, c.from_label)} → ${valorCorregido(c.field, c.to_value, c.to_label)}`,
      motivo: c.reason.trim() || "—",
      responsable: c.responsable?.trim() ? c.responsable.trim() : "—",
      hora: fmtHora(c.at, data.timezone),
    })),
    hasData,
  };
}
