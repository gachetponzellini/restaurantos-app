import { calcularRendicionMozo, type RendicionResult } from "./liquidacion-mozo";
import type { PaymentMethod } from "./types";

/**
 * Por dónde entró un cobro, para rendirlo por separado (spec 203 · D2).
 *
 * Lógica pura: la comparten la query de la rendición pendiente, la server
 * action que la registra y el modal, así lo que se pide y lo que se guarda
 * salen de la misma cuenta.
 */
export type CanalRendicion = "salon" | "takeaway" | "delivery";

/** Orden de pantalla y de papel. */
export const CANALES: CanalRendicion[] = ["salon", "takeaway", "delivery"];

export const CANAL_LABEL: Record<CanalRendicion, string> = {
  salon: "Salón",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

export function canalDelCobro(order: {
  table_id: string | null;
  delivery_type: string | null;
}): CanalRendicion {
  if (order.table_id) return "salon";
  return order.delivery_type === "delivery" ? "delivery" : "takeaway";
}

/**
 * Los roles que manejan la caja rinden sólo lo que no tiene mesa (D3): lo que
 * cobraron en el salón entra derecho al cajón (#264), pero takeaway y delivery
 * se rinden aparte.
 */
const SOLO_SIN_MESA = new Set(["admin", "encargado"]);

export function rindeSoloSinMesa(role: string | undefined): boolean {
  return SOLO_SIN_MESA.has(role ?? "");
}

export type CobroConCanal = {
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  canal: CanalRendicion;
};

export type PendienteDeCanal = {
  efectivo_cents: number;
  pagos_count: number;
  por_metodo: Record<PaymentMethod, number>;
};

export type RendicionPorCanal = RendicionResult & {
  pagos_count: number;
  /** Sólo los canales con al menos un cobro. */
  por_canal: Partial<Record<CanalRendicion, PendienteDeCanal>>;
};

/** Filtra por rol y parte la rendición por canal. El total es la suma. */
export function calcularRendicionPorCanal(
  cobros: CobroConCanal[],
  role: string | undefined,
): RendicionPorCanal {
  const rinde = rindeSoloSinMesa(role)
    ? cobros.filter((c) => c.canal !== "salon")
    : cobros;

  const por_canal: RendicionPorCanal["por_canal"] = {};
  for (const canal of CANALES) {
    const delCanal = rinde.filter((c) => c.canal === canal);
    if (delCanal.length === 0) continue;
    const r = calcularRendicionMozo(delCanal);
    por_canal[canal] = {
      efectivo_cents: r.efectivo_cents,
      pagos_count: delCanal.length,
      por_metodo: r.por_metodo,
    };
  }

  return {
    ...calcularRendicionMozo(rinde),
    pagos_count: rinde.length,
    por_canal,
  };
}

export type LiquidacionDeCanal = {
  esperado_cents: number;
  entregado_cents: number;
  diferencia_cents: number;
};

export type LiquidacionPorCanal = {
  por_canal: Partial<Record<CanalRendicion, LiquidacionDeCanal>>;
  expected_cash_cents: number;
  delivered_cash_cents: number;
  difference_cents: number;
};

/**
 * Cruza lo esperado de cada canal con lo entregado (D4).
 *
 * Un canal sin monto entregado cuenta como $0 entregado: una diferencia en rojo
 * se ve, un canal olvidado que se da por bien no. Con `no_entrego` todo va a $0.
 */
export function liquidarPorCanal(
  pendiente: Partial<Record<CanalRendicion, { efectivo_cents: number }>>,
  entregado: Partial<Record<CanalRendicion, number>>,
  noEntrego = false,
): LiquidacionPorCanal {
  const por_canal: LiquidacionPorCanal["por_canal"] = {};
  let expected = 0;
  let delivered = 0;
  for (const canal of CANALES) {
    const p = pendiente[canal];
    if (!p) continue;
    const e = noEntrego ? 0 : Math.max(0, entregado[canal] ?? 0);
    por_canal[canal] = {
      esperado_cents: p.efectivo_cents,
      entregado_cents: e,
      diferencia_cents: e - p.efectivo_cents,
    };
    expected += p.efectivo_cents;
    delivered += e;
  }
  return {
    por_canal,
    expected_cash_cents: expected,
    delivered_cash_cents: delivered,
    difference_cents: delivered - expected,
  };
}
