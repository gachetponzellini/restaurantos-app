"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Plus } from "lucide-react";
import { toast } from "sonner";

import { getPedidosTabOrders } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { Button } from "@/components/ui/button";
import type { AdminOrder } from "@/lib/admin/orders-query";
import {
  aceptarPedidoProgramado,
  confirmarPedido,
} from "@/lib/orders/confirm-order";
import { rechazarPedido } from "@/lib/orders/rechazar-pedido";
import {
  isScheduledForLater,
  marchAtForOrder,
} from "@/lib/orders/scheduled";
import type { OrderStatus } from "@/lib/orders/status";
import { updateOrderStatus } from "@/lib/orders/update-status";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useOnActivate } from "@/lib/ui/use-tab-param";

import { CancelledOrderRow } from "./cancelled-order-row";
import { CargarPedidoSheet } from "./cargar-pedido-sheet";
import { OrderCard } from "./order-card";

type Column = {
  key: string;
  label: string;
  statuses: OrderStatus[];
  accent: string;
  ring: string;
  countBg: string;
  countText: string;
  emptyHint: string;
};

const COLUMNS: Column[] = [
  {
    key: "new",
    label: "Pendientes",
    statuses: ["pending", "confirmed"],
    accent: "bg-blue-500",
    ring: "ring-blue-500/30",
    countBg: "bg-blue-50",
    countText: "text-blue-700",
    emptyHint: "Sin pedidos pendientes",
  },
  {
    key: "preparing",
    label: "En cocina",
    // Los estados intermedios (`ready`, `on_the_way`) no se usan más: el
    // board avanza directo de `preparing` a `delivered`. Se siguen mapeando
    // acá para que los pedidos legacy en esos estados no desaparezcan del
    // tablero y se puedan entregar con el mismo botón.
    statuses: ["preparing", "ready", "on_the_way"],
    accent: "bg-amber-500",
    ring: "ring-amber-500/30",
    countBg: "bg-amber-50",
    countText: "text-amber-800",
    emptyHint: "Cocina libre",
  },
  {
    key: "delivered",
    label: "Entregados",
    statuses: ["delivered"],
    accent: "bg-zinc-300",
    ring: "ring-zinc-300/40",
    countBg: "bg-zinc-100",
    countText: "text-zinc-700",
    emptyHint: "Todavía no se entregó nada",
  },
];

function playBeep(): void {
  try {
    type AudioContextConstructor = new () => AudioContext;
    const Ctx: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // fail silently — sound is not critical
  }
}

export function OrdersRealtimeBoard({
  businessId,
  slug,
  timezone,
  initialOrders,
  marchLeadKitchenMin,
  deliveryFeeCents = 0,
  active,
}: {
  businessId: string;
  slug: string;
  timezone: string;
  initialOrders: AdminOrder[];
  /** Horarios que el negocio ofrece hoy para programar (spec 085). */
  marchLeadKitchenMin: number;
  /** Envío del negocio, para que la hoja de carga lo muestre (issue #260). */
  deliveryFeeCents?: number;
  /** Si la tab «Pedidos online» está a la vista. El panel no se desmonta al
   *  cambiar de tab, así que es la señal para revalidar al volver. */
  active: boolean;
}) {
  const [orders, setOrders] = useState<AdminOrder[]>(initialOrders);
  const [newlyArrived, setNewlyArrived] = useState<Set<string>>(new Set());
  // Spec 139 — rechazar pide motivo: es lo que el cliente va a leer.
  const [rechazando, setRechazando] = useState<AdminOrder | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [rechazoEnCurso, setRechazoEnCurso] = useState(false);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  // Spec 054 — sheet para cargar a mano un pedido para llevar/delivery.
  const [cargarOpen, setCargarOpen] = useState(false);

  // Keep a ref for realtime handler (avoids stale closure).
  const soundUnlockedRef = useRef(soundUnlocked);
  soundUnlockedRef.current = soundUnlocked;

  /**
   * Traer la verdad del server y pisar el estado local.
   *
   * Esta pantalla vivía **sólo** del stream de realtime: se seedeaba con el SSR
   * del page-load y ya. Un evento perdido —el canal que se cae, el token que
   * vence en una pantalla abierta hace horas, la máquina que se suspende— la
   * dejaba congelada sin forma de recuperarse: los pedidos seguían avanzando en
   * la base y las tarjetas quedaban en la columna vieja, con el botón de un
   * estado que ya pasó. Al tocarlo, el server contestaba «No se puede pasar de
   * "delivered" a "ready"» y la tarjeta volvía a su estado viejo, así que el
   * error era eterno.
   *
   * `seq` descarta respuestas fuera de orden: mismo patrón que el kanban de
   * comandas, un solo escritor gana.
   */
  const refetchSeq = useRef(0);
  const refetchOrders = useCallback(async () => {
    const seq = ++refetchSeq.current;
    const r = await getPedidosTabOrders(slug);
    if (!r.ok || seq !== refetchSeq.current) return;
    setOrders(r.data);
  }, [slug]);

  // Volver a la tab (el panel no se desmonta, así que no hay refetch de montaje
  // que lo cubra) — igual que Comandas, Caja, Rendición y Salón.
  useOnActivate(active, () => void refetchOrders());

  // Volver a la pestaña / despertar la máquina. Es el caso real de la pantalla
  // de operación, que queda abierta todo el servicio: mientras estuvo oculta el
  // websocket pudo haberse dormido y perdido eventos.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetchOrders();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetchOrders]);

  const fetchOrder = useCallback(
    async (orderId: string): Promise<AdminOrder | null> => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("orders")
        .select(
          "id, order_number, daily_number, created_at, customer_name, customer_phone, delivery_type, total_cents, status, payment_method, payment_status, cancelled_reason, scheduled_at, kitchen_at, kitchen_notes, order_items(product_name, quantity)",
        )
        .eq("id", orderId)
        .maybeSingle();
      if (!data) return null;
      // Las orders dine_in viven en el flow de salón, no en el board de
      // pedidos online. Si el realtime nos trae una, la ignoramos.
      if (data.delivery_type === "dine_in") return null;
      return {
        id: data.id,
        order_number: data.order_number,
        daily_number: data.daily_number,
        created_at: data.created_at,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        delivery_type: data.delivery_type as AdminOrder["delivery_type"],
        total_cents: Number(data.total_cents),
        status: data.status as OrderStatus,
        payment_method: data.payment_method,
        payment_status: data.payment_status,
        cancelled_reason: data.cancelled_reason,
        scheduled_at: data.scheduled_at,
        kitchen_at: data.kitchen_at,
        kitchen_notes: data.kitchen_notes,
        items: (data.order_items ?? []).map((i) => ({
          product_name: i.product_name,
          quantity: i.quantity,
        })),
      };
    },
    [],
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const topic = `orders:${businessId}:${Math.random().toString(36).slice(2, 10)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `business_id=eq.${businessId}`,
          },
          async (payload) => {
            if (payload.eventType === "INSERT") {
              const id = (payload.new as { id: string }).id;
              const full = await fetchOrder(id);
              if (!full) return;
              setOrders((prev) => [full, ...prev.filter((o) => o.id !== id)]);
              setNewlyArrived((prev) => new Set(prev).add(id));
              setTimeout(() => {
                setNewlyArrived((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
              }, 4000);
              if (soundUnlockedRef.current) playBeep();
            } else if (payload.eventType === "UPDATE") {
              const id = (payload.new as { id: string }).id;
              const full = await fetchOrder(id);
              if (!full) return;
              setOrders((prev) => prev.map((o) => (o.id === id ? full : o)));
            } else if (payload.eventType === "DELETE") {
              const id = (payload.old as { id: string }).id;
              setOrders((prev) => prev.filter((o) => o.id !== id));
            }
          },
        )
        .subscribe((status) => {
          // Cada vez que el canal queda arriba —la primera y las que siguen a
          // una reconexión— se revalida contra el server. Es el único momento en
          // que sabemos que hubo un hueco en el stream, y lo que hace que la
          // pantalla se arregle sola sin que nadie toque nada.
          if (status === "SUBSCRIBED") void refetchOrders();
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [businessId, fetchOrder, refetchOrders]);

  const handleAdvance = useCallback(
    async (order: AdminOrder, next: OrderStatus) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)),
      );
      const result = await updateOrderStatus({
        order_id: order.id,
        business_slug: slug,
        next_status: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        // No se revierte a lo que teníamos: lo que teníamos es justo lo que está
        // mal. Un rechazo de transición («No se puede pasar de "delivered" a
        // "ready"») significa que el server ya está en otro estado, así que se
        // pide la fila real. Devolver la tarjeta a su columna vieja dejaba el
        // botón equivocado puesto y el error se repetía para siempre.
        const fresh = await fetchOrder(order.id);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? (fresh ?? { ...o, status: order.status }) : o,
          ),
        );
      }
    },
    [slug, fetchOrder],
  );

  /**
   * Spec 139 — el local no toma el pedido. Pide motivo (le llega al cliente) y,
   * si estaba pagado, dispara el reembolso por Mercado Pago.
   */
  const handleReject = useCallback(
    async (order: AdminOrder, motivo: string) => {
      const result = await rechazarPedido({
        order_id: order.id,
        business_slug: slug,
        motivo,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const devuelto =
        result.data.refund === "refunded"
          ? " · plata devuelta"
          : result.data.refund === "manual"
            ? " · ⚠️ la devolución quedó pendiente, hacela por Mercado Pago"
            : "";
      toast.success(`Pedido #${order.daily_number} rechazado${devuelto}`);
      const fresh = await fetchOrder(order.id);
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? (fresh ?? o) : o)),
      );
    },
    [slug, fetchOrder],
  );

  const handleConfirm = useCallback(
    async (order: AdminOrder, kitchenNotes?: string) => {
      // Optimistic: pasamos a "preparing" en local mientras la action corre.
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: "preparing" } : o,
        ),
      );
      const result = await confirmarPedido(order.id, slug, kitchenNotes);
      if (!result.ok) {
        toast.error(result.error);
        const fresh = await fetchOrder(order.id);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? (fresh ?? { ...o, status: order.status }) : o,
          ),
        );
        return;
      }
      const { comanda_ids, items_without_station } = result.data;
      const cocinaPart =
        comanda_ids.length === 0
          ? "sin items para cocina"
          : `${comanda_ids.length} comanda${comanda_ids.length === 1 ? "" : "s"} a sectores`;
      const directPart =
        items_without_station > 0
          ? ` · ${items_without_station} ítem${items_without_station === 1 ? "" : "s"} va${items_without_station === 1 ? "" : "n"} directo (sin imprimir)`
          : "";
      toast.success(
        `Pedido #${order.daily_number} confirmado · ${cocinaPart}${directPart}`,
      );
    },
    [slug, fetchOrder],
  );

  // Aceptar un programado (spec 061): lo avala sin marcharlo. Queda en
  // Próximos y la comanda sale sola cuando entra en ventana.
  const handleAceptarProgramado = useCallback(
    async (order: AdminOrder) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: "confirmed" } : o,
        ),
      );
      const result = await aceptarPedidoProgramado(order.id, slug);
      if (!result.ok) {
        toast.error(result.error);
        const fresh = await fetchOrder(order.id);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? (fresh ?? { ...o, status: order.status }) : o,
          ),
        );
        return;
      }
      toast.success(
        `Pedido #${order.daily_number} aceptado · la comanda sale sola antes de la hora`,
      );
    },
    [slug, fetchOrder],
  );

  const unlockSound = () => {
    playBeep();
    setSoundUnlocked(true);
  };

  // Agendados (spec 31 + 061): pedidos diferidos que todavía no marcharon.
  // Spec 127 — el agendado **vive en «Nuevos»**, con su chip «Programado», en
  // vez de en una sección aparte. Sus estados (`pending` / `confirmed`) son los
  // de esa columna, así que no hace falta moverlo a ningún lado: alcanza con no
  // sacarlo. Dos formas de estar agendado:
  //  · `pending`   → pago (MP aprobado, listo) o impago (espera que el
  //                  encargado lo acepte; sin eso el cron no lo toma — 047).
  //  · `confirmed` → ya aceptado, esperando su ventana.
  // Spec 127 — la cuenta de la marcha, igual que la del server.
  const lead = useMemo(
    () => ({ scheduled_march_lead_kitchen_min: marchLeadKitchenMin }),
    [marchLeadKitchenMin],
  );
  const byColumn = useMemo(() => {
    const now = new Date();
    const isAgendado = (o: AdminOrder) =>
      !!o.scheduled_at &&
      (o.status === "pending" || o.status === "confirmed") &&
      isScheduledForLater(o.scheduled_at, now);

    const groups: Record<string, AdminOrder[]> = {};
    for (const col of COLUMNS) groups[col.key] = [];
    for (const order of orders) {
      const col = COLUMNS.find((c) => c.statuses.includes(order.status));
      if (col) groups[col.key].push(order);
    }
    // FIFO en las columnas activas: el pedido más viejo arriba (la query trae
    // created_at desc y el realtime hace prepend). "Entregados" queda como
    // historial —el más reciente arriba— igual que en el KDS de comandas.
    //
    // Spec 127 — los agendados van **al final** de «Nuevos», ordenados por su
    // hora de marcha. Por FIFO puro un encargue para mañana cargado a las 10 le
    // ganaría a un pedido que entró recién, y arriba tiene que estar lo que hay
    // que atender ahora.
    for (const col of COLUMNS) {
      const asc = col.key !== "delivered";
      groups[col.key].sort((a, b) => {
        const aAg = isAgendado(a);
        const bAg = isAgendado(b);
        if (aAg !== bAg) return aAg ? 1 : -1;
        if (aAg && bAg) {
          const ma = marchAtForOrder(a, lead)?.getTime() ?? 0;
          const mb = marchAtForOrder(b, lead)?.getTime() ?? 0;
          return ma - mb;
        }
        return asc
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at);
      });
    }
    groups["delivered"] = groups["delivered"].slice(0, 20);
    return groups;
  }, [orders, lead]);

  const cancelledOrders = useMemo(
    () => orders.filter((o) => o.status === "cancelled"),
    [orders],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar: sólo el toggle de sonido, y sólo mientras haga falta. Cargar
          un pedido a mano (spec 054) se fue a la cabecera de «Nuevos» (spec
          121): ahí es donde el pedido va a aparecer. */}
      {!soundUnlocked && (
        <div className="flex items-center justify-end gap-3">
          <Button size="sm" variant="outline" onClick={unlockSound}>
            <Bell className="size-4" />
            Activar sonido
          </Button>
        </div>
      )}

      <CargarPedidoSheet
        slug={slug}
        open={cargarOpen}
        onClose={() => setCargarOpen(false)}
        timezone={timezone}
        marchLeadKitchenMin={marchLeadKitchenMin}
        deliveryFeeCents={deliveryFeeCents}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = byColumn[col.key];
          return (
            <section
              key={col.key}
              className="bg-muted/30 ring-border/60 flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-3 ring-1"
            >
              <div className="flex flex-col gap-2">
                <div className={`h-1 w-10 rounded-full ${col.accent}`} />
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-foreground text-base font-bold tracking-tight">
                    {col.label}
                  </h2>
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums ${col.countBg} ${col.countText}`}
                  >
                    {items.length}
                  </span>
                </div>
              </div>

              {/* Cargar a mano vive en «Nuevos» (spec 121), arriba de todo y
                  del ancho de la columna: es la acción más frecuente del
                  board y estaba perdida en una barra chica arriba de todo. El
                  pedido que cargás aparece justo abajo, así que el botón está
                  donde va a salir el resultado. */}
              {col.key === "new" && (
                <button
                  type="button"
                  onClick={() => setCargarOpen(true)}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-base font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99]"
                >
                  <Plus className="size-5 shrink-0" strokeWidth={2.75} />
                  Cargar pedido
                </button>
              )}

              <div className="flex flex-col gap-3">
                {items.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    slug={slug}
                    timezone={timezone}
                    onAdvance={handleAdvance}
                    onConfirm={handleConfirm}
                    onReject={(o) => {
                      setMotivoRechazo("");
                      setRechazando(o);
                    }}
                    onAccept={handleAceptarProgramado}
                    marchLeadKitchenMin={marchLeadKitchenMin}
                    onChanged={() => void refetchOrders()}
                    isNew={newlyArrived.has(order.id)}
                    columnRing={col.ring}
                  />
                ))}
                {items.length === 0 && (
                  <div className="border-border/60 text-muted-foreground/70 rounded-xl border border-dashed px-3 py-6 text-center text-xs">
                    {col.emptyHint}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {cancelledOrders.length > 0 && (
        <details className="group mt-2">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 text-xs font-semibold tracking-wider uppercase transition-colors">
            <span>Cancelados</span>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-50 px-1.5 text-[0.65rem] font-bold text-rose-700 tabular-nums">
              {cancelledOrders.length}
            </span>
            <span className="text-muted-foreground/60 tracking-normal normal-case">
              · tocá para ver
            </span>
          </summary>
          <div className="mt-3 grid gap-2">
            {cancelledOrders.map((order) => (
              <CancelledOrderRow
                key={order.id}
                order={order}
                slug={slug}
                timezone={timezone}
              />
            ))}
          </div>
        </details>
      )}

      {/* Spec 139 — el motivo del rechazo es lo que el cliente va a leer, así
          que se pide siempre. */}
      {rechazando && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => !rechazoEnCurso && setRechazando(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-zinc-900">
              ¿Rechazar el pedido #{rechazando.daily_number}?
            </h3>
            <p className="mt-1.5 text-sm text-zinc-600">
              Le avisamos a{" "}
              <span className="font-semibold">{rechazando.customer_name}</span>{" "}
              que no pudimos tomarlo.
              {rechazando.payment_status === "paid" && (
                <>
                  {" "}
                  Como ya pagó, se le devuelve la plata por Mercado Pago.
                </>
              )}
            </p>
            <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Motivo
            </label>
            <input
              type="text"
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder="Ej: ya estamos cerrando la cocina"
              className="mt-1.5 h-10 w-full rounded-xl border-0 bg-zinc-100 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRechazando(null)}
                disabled={rechazoEnCurso}
                className="flex-1 rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-60"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!motivoRechazo.trim()) {
                    toast.error("Decile al cliente por qué.");
                    return;
                  }
                  setRechazoEnCurso(true);
                  await handleReject(rechazando, motivoRechazo);
                  setRechazoEnCurso(false);
                  setRechazando(null);
                }}
                disabled={rechazoEnCurso}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


