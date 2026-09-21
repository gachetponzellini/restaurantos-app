import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createNotification } from "@/lib/notifications/create";
import { cancelarOrden } from "@/lib/orders/cancel-order";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Los pedidos online que nadie resuelve se vencen (#148 · H-20 + H-45).
 *
 * Sin esto quedaban `pending` + `open` para siempre: con el stock descontado,
 * sumando a la facturación y ensuciando reportes. Plazos decididos por Juan
 * (2026-09-21):
 *
 * - **MP sin pagar** → se cancela a las 2 h de creado, «Pago no completado».
 *   Es seguro porque la preferencia de MP vence a los 90 min (y sus cupones
 *   offline también, ver `createPreference`): a las 2 h ya no se puede pagar.
 * - **Programado en efectivo que nadie aceptó** → 30 min después de su horario
 *   se le avisa al encargado; a la hora, se cancela «No confirmado».
 * - Un pedido con **algún pago acreditado** no se toca nunca, diga lo que diga
 *   su estado.
 *
 * Corre dentro del cron de marcha (cada 5 min): no suma invocaciones.
 */

const MP_IMPAGO_MIN = 120;
const PROGRAMADO_AVISO_MIN = 30;
const PROGRAMADO_CANCELA_MIN = 60;

export const MOTIVO_IMPAGO = "Pago no completado";
export const MOTIVO_NO_CONFIRMADO = "No confirmado";
export const TIPO_AVISO_POR_VENCER = "pedido.programado_por_vencer";

export type CandidatoVencimiento = {
  payment_method: string | null;
  status: string;
  payment_status: string | null;
  created_at: string;
  scheduled_at: string | null;
  tienePagoAcreditado: boolean;
};

export type DecisionVencimiento =
  | "cancelar_impago"
  | "cancelar_no_confirmado"
  | "avisar"
  | null;

const minutosDesde = (iso: string, now: Date) =>
  (now.getTime() - new Date(iso).getTime()) / 60_000;

export function decidirVencimiento(
  o: CandidatoVencimiento,
  now: Date,
): DecisionVencimiento {
  if (o.tienePagoAcreditado || o.payment_status === "paid") return null;
  // Aceptado = ya es de alguien: lo marcha el cron o lo resuelve el local.
  if (o.status !== "pending") return null;

  if (o.payment_method === "mp") {
    return minutosDesde(o.created_at, now) >= MP_IMPAGO_MIN
      ? "cancelar_impago"
      : null;
  }

  if (o.payment_method === "cash" && o.scheduled_at) {
    const atraso = minutosDesde(o.scheduled_at, now);
    if (atraso >= PROGRAMADO_CANCELA_MIN) return "cancelar_no_confirmado";
    if (atraso >= PROGRAMADO_AVISO_MIN) return "avisar";
  }

  return null;
}

type Fila = CandidatoVencimiento & {
  id: string;
  business_id: string;
  order_number: number | null;
  customer_name: string | null;
};

export type VencimientoResult = {
  considerados: number;
  cancelados: number;
  avisados: number;
};

export async function vencerPedidosSinResolver(
  now: Date = new Date(),
  service: SupabaseClient = createSupabaseServiceClient() as unknown as SupabaseClient,
): Promise<VencimientoResult> {
  const result: VencimientoResult = {
    considerados: 0,
    cancelados: 0,
    avisados: 0,
  };

  const corteMp = new Date(
    now.getTime() - MP_IMPAGO_MIN * 60_000,
  ).toISOString();
  const corteProgramado = new Date(
    now.getTime() - PROGRAMADO_AVISO_MIN * 60_000,
  ).toISOString();

  const { data, error } = await service
    .from("orders")
    .select(
      "id, business_id, order_number, customer_name, payment_method, status, payment_status, created_at, scheduled_at",
    )
    .eq("lifecycle_status", "open")
    .eq("status", "pending")
    .in("delivery_type", ["pickup", "delivery"])
    .or(
      `and(payment_method.eq.mp,created_at.lt.${corteMp}),and(payment_method.eq.cash,scheduled_at.lt.${corteProgramado})`,
    )
    .limit(200);
  if (error) {
    console.error("vencerPedidosSinResolver · select", error);
    return result;
  }

  const filas = (data ?? []) as Omit<Fila, "tienePagoAcreditado">[];
  if (filas.length === 0) return result;
  result.considerados = filas.length;

  // Un pago acreditado manda sobre el estado de la orden: se lee aparte y no se
  // toca nada que tenga plata adentro.
  const { data: pagos } = await service
    .from("payments")
    .select("order_id")
    .in(
      "order_id",
      filas.map((f) => f.id),
    )
    .eq("payment_status", "paid");
  const conPago = new Set(
    ((pagos ?? []) as { order_id: string }[]).map((p) => p.order_id),
  );

  const nowIso = now.toISOString();
  for (const f of filas) {
    const decision = decidirVencimiento(
      { ...f, tienePagoAcreditado: conPago.has(f.id) },
      now,
    );
    if (
      decision === "cancelar_impago" ||
      decision === "cancelar_no_confirmado"
    ) {
      const r = await cancelarOrden(service, {
        orderId: f.id,
        businessId: f.business_id,
        motivo:
          decision === "cancelar_impago" ? MOTIVO_IMPAGO : MOTIVO_NO_CONFIRMADO,
        actorUserId: null,
        nowIso,
      });
      if (r.cancelled) result.cancelados += 1;
    } else if (decision === "avisar") {
      // Un solo aviso por pedido: el cron pasa cada 5 min.
      const { count } = await service
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("business_id", f.business_id)
        .eq("type", TIPO_AVISO_POR_VENCER)
        .eq("payload->>orderId", f.id);
      if ((count ?? 0) > 0) continue;
      await createNotification({
        businessId: f.business_id,
        targetRole: "encargado",
        type: TIPO_AVISO_POR_VENCER,
        payload: {
          orderId: f.id,
          orderNumber: f.order_number ?? undefined,
          customerName: f.customer_name ?? undefined,
          scheduledAt: f.scheduled_at,
        },
      });
      result.avisados += 1;
    }
  }

  return result;
}
