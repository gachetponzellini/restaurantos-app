import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { OrderDetailActions } from "@/components/admin/order-detail-actions";
import {
  PageHeader,
  PageShell,
  Surface,
  SurfaceHeader,
} from "@/components/admin/shell/page-shell";
import { getOrderDetail } from "@/lib/admin/orders-query";
import { formatCurrency } from "@/lib/currency";
import { lugarDeEntrega } from "@/lib/orders/entrega-por-lote";
import type { OrderStatus } from "@/lib/orders/status";
import { getBusiness } from "@/lib/tenant";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "En cocina",
  ready: "Listo",
  on_the_way: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const STATUS_DOT: Record<OrderStatus, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-sky-500",
  preparing: "bg-indigo-500",
  ready: "bg-emerald-500",
  on_the_way: "bg-violet-500",
  delivered: "bg-zinc-400",
  cancelled: "bg-rose-500",
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const order = await getOrderDetail(id);
  if (!order) notFound();

  const tz = business.timezone;
  const status = order.status as OrderStatus;
  const history = (order.order_status_history ?? []).toSorted(
    (a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow={formatInTimeZone(order.created_at, tz, "dd MMM yyyy · HH:mm")}
        title={`Pedido #${order.daily_number}`}
        back={{ href: `/${business_slug}/admin/pedidos`, label: "Volver a pedidos" }}
        action={
          <span
            className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 ring-1 ring-zinc-200/70`}
          >
            <span
              className={`size-1.5 rounded-full ${STATUS_DOT[status]}`}
            />
            {STATUS_LABEL[status]}
          </span>
        }
      />

      <Surface padding="default">
        <SurfaceHeader
          eyebrow="Cliente"
          title={order.customer_name}
        />
        <a
          href={`tel:${order.customer_phone}`}
          className="mt-3 inline-block text-sm font-medium"
          style={{ color: "var(--brand)" }}
        >
          {order.customer_phone}
        </a>
      </Surface>

      {order.delivery_type === "delivery" && (
        <Surface padding="default">
          <SurfaceHeader eyebrow="Delivery" title="Entrega a domicilio" />
          <p className="mt-3 text-sm text-zinc-700">
            {lugarDeEntrega(business_slug, order.delivery_address ?? "")}
          </p>
          {order.delivery_notes && (
            <p className="mt-2 text-xs italic text-zinc-500">
              &quot;{order.delivery_notes}&quot;
            </p>
          )}
        </Surface>
      )}

      <Surface padding="default">
        {(() => {
          const allItems = order.order_items ?? [];
          const parentItems = allItems.filter((i: any) => !i.is_combo_component);
          return (
            <>
              <SurfaceHeader
                eyebrow={`${parentItems.length} ${parentItems.length === 1 ? "ítem" : "ítems"}`}
                title="Detalle del pedido"
              />
              <ul className="mt-5 space-y-4">
                {parentItems.map((item: any) => {
                  const menuSnap = item.daily_menu_snapshot as
                    | {
                        name?: string;
                        components?: {
                          label: string;
                          description: string | null;
                        }[];
                      }
                    | null;
                  const isMenu = !!item.daily_menu_id;
                  const children = allItems.filter(
                    (c: any) => c.parent_order_item_id === item.id,
                  );
                  return (
                    <li key={item.id} className="grid gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-zinc-900">
                          {item.quantity}× {item.product_name}
                          {isMenu && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-amber-900">
                              Menú del día
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-zinc-900">
                          {formatCurrency(item.subtotal_cents)}
                        </span>
                      </div>
                      {isMenu && menuSnap?.components && (
                        <ul className="ml-4 grid gap-0.5 text-xs text-zinc-500">
                          {menuSnap.components.map(
                            (c: { label: string }, idx: number) => (
                              <li key={idx}>· {c.label}</li>
                            ),
                          )}
                        </ul>
                      )}
                      {children.length > 0 && (
                        <ul className="ml-4 mt-1 grid gap-1 text-xs text-zinc-500">
                          {children.map((child: any) => (
                            <li key={child.id} className="flex items-baseline justify-between">
                              <span>
                                ↳ {child.quantity}× {child.product_name}
                              </span>
                              {(child.order_item_modifiers ?? []).length > 0 && (
                                <span className="ml-2 text-[11px]">
                                  {child.order_item_modifiers
                                    .map((m: any) => m.modifier_name)
                                    .join(" · ")}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.order_item_modifiers.length > 0 && (
                        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                          {item.order_item_modifiers
                            .map((m: any) => m.modifier_name)
                            .join(" · ")}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-xs italic text-zinc-500">
                          &quot;{item.notes}&quot;
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          );
        })()}
        <dl className="mt-6 space-y-2 border-t border-zinc-100 pt-5 text-sm tabular-nums">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Subtotal</dt>
            <dd className="text-zinc-900">
              {formatCurrency(order.subtotal_cents)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">
              {order.delivery_type === "delivery" ? "Envío" : "Retiro"}
            </dt>
            <dd className="text-zinc-900">
              {formatCurrency(order.delivery_fee_cents)}
            </dd>
          </div>
          <div className="mt-2 flex justify-between border-t border-zinc-100 pt-3 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatCurrency(order.total_cents)}</dd>
          </div>
        </dl>
      </Surface>

      <Surface padding="default">
        <SurfaceHeader eyebrow="Historial" title="Línea de tiempo" />
        <ol className="mt-5 space-y-3 text-sm">
          {history.map((h: any, idx: number) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-zinc-900" />
              <div className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-900">
                  {STATUS_LABEL[h.status as OrderStatus] ?? h.status}
                </span>
                <span className="text-xs tabular-nums text-zinc-500">
                  {formatInTimeZone(h.created_at, tz, "HH:mm")}
                </span>
                {h.notes && (
                  <p className="w-full text-xs text-zinc-500">{h.notes}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Surface>

      {order.cancelled_reason && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-semibold">Pedido cancelado</p>
          <p className="mt-0.5">{order.cancelled_reason}</p>
        </div>
      )}

      <OrderDetailActions
        orderId={order.id}
        slug={business_slug}
        status={status}
        deliveryType={order.delivery_type as "delivery" | "pickup"}
      />
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
