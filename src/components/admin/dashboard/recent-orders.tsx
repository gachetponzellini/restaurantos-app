import Link from "next/link";
import { ArrowUpRight, Bike, Package2 } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import type { AdminOrder } from "@/lib/admin/orders-query";
import { STATUS_META } from "@/lib/orders/status-meta";
import { cn } from "@/lib/utils";
import { TZ_AR } from "@/lib/timezone";

function shortTime(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function RecentOrders({
  orders,
  slug,
}: {
  orders: AdminOrder[];
  slug: string;
}) {
  const recent = orders.slice(0, 6);

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Pedidos de hoy
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            Actividad reciente
          </h2>
        </div>
        <Link
          href={`/${slug}/admin/pedidos`}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
        >
          Ver todos
          <ArrowUpRight className="size-3" />
        </Link>
      </header>

      {recent.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-8 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-white ring-1 ring-zinc-200">
            <Package2 className="size-4 text-zinc-500" />
          </div>
          <p className="mt-3 text-sm text-zinc-600">
            Todavía no entraron pedidos hoy.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Cuando llegue uno lo vas a ver acá en vivo.
          </p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-zinc-100">
          {recent.map((o) => {
            const meta = STATUS_META[o.status];
            return (
              <li key={o.id}>
                <Link
                  href={`/${slug}/admin/pedidos/${o.id}`}
                  className="group flex items-center gap-3 py-3 transition"
                >
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl ring-1 ring-zinc-200",
                      o.delivery_type === "delivery"
                        ? "bg-zinc-50 text-zinc-700"
                        : "bg-zinc-50 text-zinc-700",
                    )}
                    aria-hidden
                  >
                    {o.delivery_type === "delivery" ? (
                      <Bike className="size-4" />
                    ) : (
                      <Package2 className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-zinc-900">
                        #{o.order_number}
                      </span>
                      <span className="truncate text-sm text-zinc-600">
                        {o.customer_name}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {o.items
                        .slice(0, 2)
                        .map((i) => `${i.quantity}× ${i.product_name}`)
                        .join(" · ")}
                      {o.items.length > 2 ? ` · +${o.items.length - 2}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(o.total_cents)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                        meta.tone,
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", meta.dot)} />
                      {meta.label}
                      <span className="text-zinc-500">·</span>
                      <span className="tabular-nums text-zinc-500">
                        {shortTime(o.created_at)}
                      </span>
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
