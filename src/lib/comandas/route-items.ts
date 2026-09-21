import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Dada una agrupación de `order_item.id`s por `station_id`, crea una
 * comanda por sector con `batch` autoincremental dentro de (order, station)
 * y linkea cada item via `comanda_items`.
 *
 * Usado tanto por:
 * - `enviarComanda` (dine-in: el mozo manda items a cocina).
 * - `confirmarPedido` (delivery/take-away/web: el encargado valida y
 *   recién ahí se rutea a sectores).
 *
 * **Items sin station_id NO entran acá** — el caller los excluye del
 * `itemsByStation` y se gestionan aparte (ej: bebidas que el mozo lleva
 * directo, sin comanda impresa).
 *
 * Devuelve los ids de las comandas creadas, en el orden del Map.
 *
 * Todo o nada (issue #126): corre en una sola transacción de Postgres
 * (`crear_comandas_tx`). Si falla un sector no queda creado ninguno.
 */
export async function createComandasForItems(
  service: GenericClient,
  orderId: string,
  itemsByStation: Map<string, string[]>,
  opts: {
    /**
     * Primera ruteada de la orden (issue #259).
     *
     * Con esto el batch NO se calcula leyendo el último: se fuerza a 1 y se
     * deja que el unique `(order_id, station_id, batch)` arbitre. Es la única
     * parte atómica de todo el camino.
     *
     * Por qué hace falta: `routeOrderToCocina` chequea idempotencia contando
     * comandas, y el batch se leía aparte con `max(batch)+1`. Dos pestañas
     * confirmando el mismo pedido entraban así: la segunda contaba cero
     * (la primera todavía no había insertado) pero para cuando leyó el batch ya
     * veía el 1 — y creaba un **batch 2 con los mismos ítems**. La cocina
     * recibía dos papeles bien formados, sin marca de reimpresión, y cocinaba
     * dos veces.
     *
     * Confirmar una orden online pasa una sola vez: su batch siempre es el 1.
     * Las tandas siguientes de una mesa son otro camino (`enviarComanda`), que
     * sí necesita incrementar y por eso no pasa este flag.
     */
    primeraRuteada?: boolean;
    /**
     * La observación de **este envío** (spec 128), ya normalizada por el
     * caller. Se escribe igual en todas las comandas que crea esta llamada:
     * una indicación de coordinación —«va todo junto»— que sólo le llega a un
     * sector no coordina nada.
     *
     * Copiada y no referenciada a propósito: la comanda es lo que se reimprime
     * (spec 035), así que el texto tiene que quedar congelado con ella.
     */
    notes?: string | null;
  } = {},
): Promise<{ ok: true; comanda_ids: string[] } | { ok: false; error: string }> {
  // Issue #126: todo el envío es una transacción (`crear_comandas_tx`, 0127).
  // Antes era un loop de inserts sueltos: si fallaba el sector N, los sectores
  // 1..N-1 ya estaban creados e impresos. Ahora o salen todos o ninguno, y el
  // print-agent no puede ver una comanda a medio crear.
  const grupos = Array.from(itemsByStation, ([station_id, order_item_ids]) => ({
    station_id,
    order_item_ids,
  })).filter((g) => g.order_item_ids.length > 0);

  if (grupos.length === 0) return { ok: true, comanda_ids: [] };

  const { data, error } = await service.rpc("crear_comandas_tx", {
    p_order_id: orderId,
    p_grupos: grupos,
    p_primera_ruteada: opts.primeraRuteada ?? false,
    p_notes: opts.notes ?? null,
  });
  if (error) {
    console.error("createComandasForItems · crear_comandas_tx", error);
    return { ok: false, error: "No pudimos crear la comanda." };
  }

  return { ok: true, comanda_ids: (data as string[] | null) ?? [] };
}
