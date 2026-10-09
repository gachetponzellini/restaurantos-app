import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatCurrency } from "@/lib/currency";

type GenericClient = SupabaseClient;

/**
 * ¿Hay plata o comprobantes que impidan anular estas órdenes? (spec 092)
 *
 * Devuelve el mensaje de error para el encargado, o `null` si se puede anular.
 *
 * ## Por qué esto no existía y por qué duele
 *
 * `anularMesa` no leía `payments` ni `invoices` — grep de las dos tablas en el
 * archivo daba vacío. Los dos agujeros que abre eso:
 *
 * **Un pago parcial se queda sin camino de vuelta.** Uno de la mesa paga
 * $20.000 y el grupo se va; el encargado anula. Después «Anular cobro»
 * desaparece: esa pantalla carga la cuenta con `getCuentaForTable`, que exige
 * `lifecycle='open'`, y la orden ya está cancelada. Queda un único camino, nada
 * obvio: `anularLineaDeCobro` desde el libro de caja. Mientras tanto el resumen
 * de cierre muestra los $20.000 en recaudación pero esa venta no está en el
 * bloque de operación — **los dos números del mismo PDF no cierran**.
 *
 * **La factura sobrevive a la anulación.** Se emite una factura B, el cliente
 * discute y se va, el encargado anula: el comprobante ya tiene CAE, o sea que
 * se declaró IVA por una venta que no ocurrió. Y si la factura estaba todavía
 * `pending` en el gateway, el cron la autoriza igual **y le manda el mail al
 * cliente** — la ventana es de ~28 min de promedio y hasta 85 en el peor caso.
 *
 * En los dos casos la salida correcta es la misma: **primero deshacer la plata,
 * después anular**. Por eso esto bloquea en vez de intentar arreglarlo solo:
 * anular un cobro o emitir una nota de crédito son decisiones con consecuencia
 * fiscal, y las toma una persona.
 */
export async function bloqueoPorPlata(
  service: GenericClient,
  orderIds: string[],
  /**
   * Cómo nombrar lo que se anula. La guarda nació para el salón y decía «esta
   * mesa» siempre; desde la issue #259 también la usa el board de pedidos
   * online, donde no hay ninguna mesa.
   */
  sujeto: "mesa" | "pedido" = "mesa",
): Promise<string | null> {
  const Sujeto = sujeto === "mesa" ? "Esta mesa" : "Este pedido";
  if (orderIds.length === 0) return null;

  const { data: pagos } = await service
    .from("payments")
    .select("amount_cents")
    .in("order_id", orderIds)
    .eq("payment_status", "paid");

  const cobrado = ((pagos ?? []) as { amount_cents: number }[]).reduce(
    (a, p) => a + Number(p.amount_cents || 0),
    0,
  );
  if (cobrado > 0) {
    return `${Sujeto} tiene ${formatCurrency(cobrado)} ya cobrados. Anulá el cobro primero y después ${sujeto === "mesa" ? "la mesa" : "el pedido"}.`;
  }

  const { data: facturas } = await service
    .from("invoices")
    .select("status, provider")
    .in("order_id", orderIds)
    .in("status", ["pending", "authorized"]);

  // spec 215 · D4 — una factura de sandbox no es fiscal: no hay nada que
  // compensar con una nota de crédito. Si frenara, en un negocio sin ARCA
  // activo no se podría anular ninguna mesa cobrada.
  const rows = ((facturas ?? []) as { status: string; provider?: string | null }[]).filter(
    (f) => f.provider !== "sandbox",
  );
  if (rows.length > 0) {
    const autorizada = rows.some((f) => f.status === "authorized");
    return autorizada
      ? `${Sujeto} ya tiene una factura autorizada con CAE. Emití la nota de crédito antes de anular.`
      : `${Sujeto} tiene una factura en curso. Esperá a que termine de emitirse y resolvela antes de anular.`;
  }

  return null;
}
