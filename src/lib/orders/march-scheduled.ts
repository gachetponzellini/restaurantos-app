import "server-only";

import { notifyMarchaFallida } from "@/lib/notifications/events";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { routeOrderToCocina } from "./route-to-cocina";
import { MAX_MARCH_LEAD_MIN, marchAtForOrder } from "./scheduled";

export type MarchDueResult = {
  considered: number;
  marched: number;
  failed: number;
  /**
   * Marchados sin una sola comanda porque ningún ítem resolvió sector (spec 093
   * · H-22). El cron descartaba `items_without_station` del resultado, así que
   * un pedido que "marchaba" sin que saliera un papel en cocina era
   * indistinguible de uno sano. El aviso al encargado lo emite
   * `routeOrderToCocina`; esto es el contador para el log del cron.
   */
  withoutComanda: number;
  /** Marchados a los que no se les pudo emitir el control de pedido. */
  controlFailed: number;
  /**
   * Encargues de hoy a los que sólo hubo que avanzarles el estado (spec 127):
   * su comanda ya se había impreso al cargarlos, así que por `routeOrderToCocina`
   * pasaron como no-op. No son un problema — son el camino normal del encargue
   * telefónico— pero conviene verlos separados en el log del cron.
   */
  advancedOnly: number;
  /**
   * #148 · H-42 — en ventana pero sin tocar: ya fallaron `MARCH_ATTEMPTS_MAX`
   * veces seguidas. Se avisó al encargado (una vez) y esperan que alguien los
   * marche a mano.
   */
  gaveUp: number;
};

/**
 * #148 · H-42 — cuántas veces seguidas se reintenta un pedido que falla al
 * marchar antes de avisar y dejarlo.
 *
 * El cron corre cada 5 min y no tenía techo: un pedido que fallaba siempre se
 * reintentaba 288 veces por día, en silencio, y el primer aviso era el cliente
 * parado en el mostrador. Tres intentos son ~15 min: alcanza para un corte de
 * red corto y no deja pasar una falla de verdad.
 *
 * El techo es sólo del cron. Marcharlo a mano («Marchar ahora» →
 * `confirmarPedido`) llama a `routeOrderToCocina` directo y no lo mira.
 */
export const MARCH_ATTEMPTS_MAX = 3;

type DueRow = {
  id: string;
  business_id: string;
  delivery_type: string;
  scheduled_at: string | null;
  /** Spec 127: la hora de cocina, cuando el encargado la escribió. */
  kitchen_at: string | null;
  /** #148 · H-42 (0132). */
  march_attempts: number | null;
  march_alerted_at: string | null;
  business: {
    scheduled_march_lead_pickup_min: number | null;
    scheduled_march_lead_delivery_min: number | null;
    scheduled_march_lead_kitchen_min: number | null;
  } | null;
};

/**
 * Marcha los pedidos diferidos que ya entran en ventana. La ventana es **por
 * negocio y por tipo** (spec 061): `scheduled_at - lead <= now`, con el lead de
 * `businesses.scheduled_march_lead_{pickup,delivery}_min`.
 *
 * Qué entra (spec 047 intacto — "imprime solo lo que el local ya avaló"):
 * - `status = 'pending'` **y** `payment_status = 'paid'` → pagado por
 *   adelantado (MP aprobado), no necesita gesto humano.
 * - `status = 'confirmed'` → el encargado lo aceptó desde «Próximos»
 *   (`aceptarPedidoProgramado`). Es el camino del programado en efectivo.
 *
 * Un `pending` impago **no** se marcha nunca: se queda esperando que alguien lo
 * acepte. Sin eso, abrir el delivery programado al efectivo produciría pedidos
 * que jamás llegan a cocina.
 *
 * Multi-tenant en una pasada (service client, todos los negocios) — el patrón
 * "una función, todos los tenants" del auto-`no_show` (spec 22). A diferencia
 * de aquél (UPDATE puro en SQL), marchar crea comandas con routing por sector
 * (lógica TS), así que la dispara el cron vía un endpoint, no SQL puro
 * (`march-scheduled` route + `pg_cron`/`pg_net`). Reusa `routeOrderToCocina`,
 * que es **idempotente**: si un pedido ya tiene comandas (lo marchó "marchar
 * ahora"), es no-op.
 */
/**
 * ¿Cocina ya terminó todo lo de este pedido? (spec 127)
 *
 * Hace falta porque el papel puede salir horas antes de que el pedido entre al
 * kanban: si cocina lo despachó en el medio, el avance a `preparing` llegaría
 * tarde y mentiría. Una comanda cancelada no cuenta — no hay nada que esperar
 * de ella.
 */
async function comandasTerminadas(
  service: ReturnType<typeof createSupabaseServiceClient>,
  orderId: string,
): Promise<boolean> {
  const { data } = await service
    .from("comandas")
    .select("status, cancelled_at")
    .eq("order_id", orderId);
  const vivas = ((data ?? []) as { status: string; cancelled_at: string | null }[])
    .filter((c) => !c.cancelled_at);
  return vivas.length > 0 && vivas.every((c) => c.status === "entregado");
}

export async function marchDueScheduledOrders(
  now: Date = new Date(),
): Promise<MarchDueResult> {
  const service = createSupabaseServiceClient();

  // El filtro SQL acota con el techo del lead configurable: nada más allá de
  // `now + 240min` puede estar en ventana para ningún negocio. El corte exacto
  // se hace después, en TS, con el lead de cada pedido. El índice parcial
  // (business_id, scheduled_at) where scheduled_at is not null sirve el `lte`.
  const cutoff = new Date(
    now.getTime() + MAX_MARCH_LEAD_MIN * 60_000,
  ).toISOString();

  const { data: due } = await service
    .from("orders")
    .select(
      "id, business_id, delivery_type, scheduled_at, kitchen_at, march_attempts, march_alerted_at, business:businesses(scheduled_march_lead_pickup_min, scheduled_march_lead_delivery_min, scheduled_march_lead_kitchen_min)",
    )
    .in("delivery_type", ["pickup", "delivery"])
    .or("and(status.eq.pending,payment_status.eq.paid),status.eq.confirmed")
    // Spec 127 — la ventana la manda la hora de COCINA cuando está; si no, la
    // del pedido, que es el canal web. Escrito como `or` en vez de un
    // `coalesce` porque así cada rama usa su índice parcial.
    .or(
      `kitchen_at.lte.${cutoff},and(kitchen_at.is.null,scheduled_at.lte.${cutoff})`,
    );

  const rows = (due ?? []) as unknown as DueRow[];
  // `considered` = los que efectivamente entraron en ventana, no los que trajo
  // la query: el `cutoff` es deliberadamente ancho.
  const inWindow = rows.filter((o) => {
    const at = marchAtForOrder(o, o.business);
    return at !== null && at.getTime() <= now.getTime();
  });

  let marched = 0;
  let failed = 0;
  let withoutComanda = 0;
  let controlFailed = 0;
  let advancedOnly = 0;
  let gaveUp = 0;

  // #148 · H-42 — un intento fallido queda en la orden. Se escribe el número
  // leído + 1: cada orden se procesa una vez por tick.
  const contarFallo = async (o: DueRow) => {
    const { error } = await service
      .from("orders")
      .update({ march_attempts: (o.march_attempts ?? 0) + 1 })
      .eq("id", o.id);
    if (error) console.error("marchDueScheduledOrders · march_attempts", o.id, error);
  };

  for (const o of inWindow) {
    // #148 · H-42 — llegó al techo: no se reintenta. Se avisa una sola vez; la
    // guarda `march_alerted_at is null` hace que, si dos ticks se pisan, avise
    // sólo el que gana el UPDATE.
    if ((o.march_attempts ?? 0) >= MARCH_ATTEMPTS_MAX) {
      gaveUp += 1;
      if (!o.march_alerted_at) {
        const { data: sellado, error } = await service
          .from("orders")
          .update({ march_alerted_at: now.toISOString() })
          .eq("id", o.id)
          .is("march_alerted_at", null)
          .select("id");
        if (error) {
          console.error("marchDueScheduledOrders · march_alerted_at", o.id, error);
        } else if ((sellado ?? []).length > 0) {
          await notifyMarchaFallida({
            businessId: o.business_id,
            orderId: o.id,
            attempts: o.march_attempts ?? MARCH_ATTEMPTS_MAX,
          }).catch((e) =>
            console.error("marchDueScheduledOrders · aviso de marcha fallida", o.id, e),
          );
        }
      }
      continue;
    }

    try {
      const res = await routeOrderToCocina(o.id, o.business_id);
      if (!res.ok) {
        failed += 1;
        await contarFallo(o);
        continue;
      }
      marched += 1;
      if (
        res.data.comanda_ids.length === 0 &&
        res.data.items_without_station > 0
      ) {
        withoutComanda += 1;
      }
      if (res.data.control_failed) controlFailed += 1;

      // Spec 127 — el encargue de HOY ya imprimió su comanda al cargarse, así
      // que la llamada de arriba fue no-op por idempotencia y **no le movió el
      // estado**. Lo que le falta es justamente eso: entrar al kanban. Misma
      // guarda optimista que usa `routeOrderToCocina`, para que un pedido
      // cancelado entre el SELECT y esto no reviva.
      if (res.data.already_had_comandas) {
        // …salvo que cocina ya lo haya terminado. `orders.status` y
        // `comandas.status` son ejes independientes (spec 091) y ninguna acción
        // de cocina mueve el primero, así que un encargue impreso a las 18:00 y
        // cocinado a las 19:00 sigue en `confirmed` a las 20:35. Bajarlo ahí a
        // `preparing` diría que se empieza a preparar algo que ya está hecho.
        if (await comandasTerminadas(service, o.id)) continue;

        const { data: advanced, error } = await service
          .from("orders")
          .update({ status: "preparing" })
          .eq("id", o.id)
          .in("status", ["pending", "confirmed"])
          .select("id");
        if (error) {
          console.error("marchDueScheduledOrders · avanzar estado", o.id, error);
          failed += 1;
          marched -= 1;
        } else if ((advanced ?? []).length > 0) {
          advancedOnly += 1;
        }
      }
    } catch (e) {
      console.error("marchDueScheduledOrders · routeOrderToCocina", o.id, e);
      failed += 1;
      await contarFallo(o);
    }
  }

  return {
    considered: inWindow.length,
    marched,
    failed,
    withoutComanda,
    controlFailed,
    advancedOnly,
    gaveUp,
  };
}
