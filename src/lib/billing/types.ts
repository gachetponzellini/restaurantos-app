// ============================================
// Tipos del dominio Billing (CU-03 cuenta + CU-04 cobro).
//
// Re-exporta PaymentMethod desde lib/caja para no duplicar el tipo: caja es
// donde vive el modelo del payment y donde nació primero.
// ============================================

import type { PaymentMethod } from "@/lib/caja/types";
export type { PaymentMethod };

export type SplitMode =
  | "por_personas"
  | "por_items"
  | "por_comensal"
  | "por_monto";
export type SplitStatus = "pending" | "paid" | "cancelled";

export type OrderSplit = {
  id: string;
  order_id: string;
  business_id: string;
  split_mode: SplitMode;
  split_index: number;
  expected_amount_cents: number;
  /** Cuánto de `expected_amount_cents` es propina (spec 177 · Parte 0). */
  tip_cents: number;
  paid_amount_cents: number;
  status: SplitStatus;
  label: string | null;
};

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type Payment = {
  id: string;
  order_id: string;
  business_id: string;
  split_id: string | null;
  caja_id: string;
  operated_by: string | null;
  attributed_mozo_id: string | null;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  last_four: string | null;
  card_brand: "visa" | "mastercard" | "amex" | "otro" | null;
  mp_payment_id: string | null;
  mp_preference_id: string | null;
  payment_status: PaymentStatus;
  notes: string | null;
  refunded_at: string | null;
  refunded_reason: string | null;
  created_at: string;
};

export type CuentaItem = {
  id: string;
  product_name: string;
  quantity: number;
  subtotal_cents: number;
  notes: string | null;
  station_id: string | null;
  cancelled_at: string | null;
  loaded_by: string | null;
  seat_number: number | null;
  /**
   * Spec 069 — precio pisado por el encargado. `price_original_cents` null =
   * la línea se cobra al precio de la carta. Quien cobra necesita ver por qué
   * el número no coincide con la carta.
   */
  unit_price_cents: number;
  price_original_cents: number | null;
  price_override_reason: string | null;
};

export type CuentaTotals = {
  subtotal_cents: number;
  tip_cents: number;
  discount_cents: number;
  total_cents: number;
};

export type CuentaState = {
  order: {
    id: string;
    business_id: string;
    order_number: number;
    table_id: string | null;
    tip_cents: number;
    discount_cents: number;
    discount_reason: string | null;
    lifecycle_status: "open" | "closed" | "cancelled";
    /** spec 092 — el eje de producción; el cobro también lo mira. */
    status: string;
    total_cents: number;
    closed_at: string | null;
    total_paid_cents: number;
  };
  items: CuentaItem[];
  splits: OrderSplit[];
  totals: CuentaTotals;
  // last_mozo_id derivado: max(id) sobre order_items.loaded_by no null.
  // Sirve para atribuir propina al cobrar (R10 de CU-03).
  last_mozo_id: string | null;
};
