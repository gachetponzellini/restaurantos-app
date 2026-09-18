"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  Bike,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ListFilter,
  Search,
  ShoppingBag,
  Tag,
  UtensilsCrossed,
  X,
} from "lucide-react";

import { FilterPills } from "@/components/admin/filters/filter-pills";
import { OrderDetailSheet } from "@/components/admin/order-detail-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AdminOrder,
  OrderListDeliveryType,
  OrderListPaymentStatus,
  OrderListRange,
  OrderListResult,
} from "@/lib/admin/orders-query";
import { orderTitle } from "@/lib/admin/order-title";
import { formatCurrency } from "@/lib/currency";
import type { OrderStatus } from "@/lib/orders/status";
import { STATUS_META } from "@/lib/orders/status-meta";
import { updateOrderStatus } from "@/lib/orders/update-status";
import { cn } from "@/lib/utils";

type Filters = {
  range: OrderListRange;
  status: OrderStatus | "all";
  deliveryType: OrderListDeliveryType;
  paymentStatus: OrderListPaymentStatus;
  search: string;
};

const RANGE_OPTIONS: { value: OrderListRange; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "today", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

const STATUS_OPTIONS: { value: OrderStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos los estados" },
  { value: "pending", label: "Pendiente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "preparing", label: "En cocina" },
  { value: "ready", label: "Listo" },
  { value: "on_the_way", label: "En camino" },
  { value: "delivered", label: "Entregado" },
  { value: "cancelled", label: "Cancelado" },
];

const DELIVERY_OPTIONS: { value: OrderListDeliveryType; label: string }[] = [
  { value: "all", label: "Delivery + Retiro" },
  { value: "delivery", label: "Solo delivery" },
  { value: "pickup", label: "Solo retiro" },
];

const PAYMENT_OPTIONS: { value: OrderListPaymentStatus; label: string }[] = [
  { value: "all", label: "Pagos: todos" },
  { value: "paid", label: "Pagados" },
  { value: "pending", label: "Pendientes" },
  { value: "failed", label: "Fallidos" },
];

export function OrdersHistorialClient({
  slug,
  timezone,
  initialResult,
  initialFilters,
}: {
  slug: string;
  timezone: string;
  initialResult: OrderListResult;
  initialFilters: Filters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(initialFilters.search);
  useEffect(() => {
    setSearchInput(initialFilters.search);
  }, [initialFilters.search]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== initialFilters.search) {
        updateParam("q", searchInput || null, { resetPage: true });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateParam = (
    key: string,
    value: string | null,
    opts: { resetPage?: boolean } = {},
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "" || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    if (opts.resetPage) params.delete("page");
    startTransition(() => {
      const qs = params.toString();
      router.push(qs ? `?${qs}` : `?`);
    });
  };

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    startTransition(() => {
      const qs = params.toString();
      router.push(qs ? `?${qs}` : `?`);
    });
  };

  const resetAll = () => {
    setSearchInput("");
    startTransition(() => {
      router.push("?");
    });
  };

  const hasActiveFilters =
    initialFilters.range !== "all" ||
    initialFilters.status !== "all" ||
    initialFilters.deliveryType !== "all" ||
    initialFilters.paymentStatus !== "all" ||
    initialFilters.search.length > 0;

  const { orders: initialOrders, total, page, pageCount } = initialResult;

  // Local mirror so optimistic status updates from the sheet reflect instantly.
  const [orders, setOrders] = useState<AdminOrder[]>(initialOrders);
  useEffect(() => setOrders(initialOrders), [initialOrders]);

  const [activeOrder, setActiveOrder] = useState<AdminOrder | null>(null);

  const handleAdvance = async (order: AdminOrder, next: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)),
    );
    setActiveOrder((cur) =>
      cur && cur.id === order.id ? { ...cur, status: next } : cur,
    );
    const r = await updateOrderStatus({
      order_id: order.id,
      business_slug: slug,
      next_status: next,
    });
    if (!r.ok) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: order.status } : o,
        ),
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-full bg-white pl-4 pr-2 py-1.5",
          "ring-1 ring-zinc-200/70 shadow-sm transition",
          "focus-within:ring-2 focus-within:ring-zinc-900/15",
        )}
      >
        <Search className="size-4 shrink-0 text-zinc-400" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar nombre, teléfono o #N°…"
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Limpiar búsqueda"
          >
            <X className="size-3.5" />
          </button>
        )}

        <div className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block" aria-hidden />

        <CompactSelect
          icon={<ListFilter className="size-3.5 text-zinc-400" />}
          value={initialFilters.status}
          options={STATUS_OPTIONS}
          onChange={(v) => updateParam("status", v, { resetPage: true })}
        />
        <CompactSelect
          icon={<Tag className="size-3.5 text-zinc-400" />}
          value={initialFilters.deliveryType}
          options={DELIVERY_OPTIONS}
          onChange={(v) => updateParam("type", v, { resetPage: true })}
        />
        <CompactSelect
          icon={<CreditCard className="size-3.5 text-zinc-400" />}
          value={initialFilters.paymentStatus}
          options={PAYMENT_OPTIONS}
          onChange={(v) => updateParam("payment", v, { resetPage: true })}
        />

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAll}
            title="Limpiar filtros"
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="size-3" /> Limpiar
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterPills
          value={initialFilters.range}
          onChange={(v) => updateParam("range", v, { resetPage: true })}
          options={RANGE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            icon: <Calendar className="size-3.5" />,
          }))}
        />
        <p className="shrink-0 text-xs text-zinc-500 tabular-nums">
          {isPending
            ? "Cargando…"
            : total === 0
              ? "Sin resultados"
              : total === 1
                ? "1 pedido"
                : `${total.toLocaleString("es-AR")} pedidos`}
          {pageCount > 1 && ` · pág ${page}/${pageCount}`}
        </p>
      </div>

      {/* ── List ─────────────────────────────────────────────────── */}
      {orders.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} />
      ) : (
        <ul
          className={cn(
            "divide-border/60 overflow-hidden rounded-2xl bg-white divide-y ring-1 ring-zinc-200/70",
            isPending && "opacity-50 transition-opacity",
          )}
        >
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              timezone={timezone}
              onClick={() => setActiveOrder(o)}
            />
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || isPending}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" /> Anterior
          </button>
          <span className="text-xs text-zinc-500">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount || isPending}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Siguiente <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      {activeOrder && (
        <OrderDetailSheet
          open={!!activeOrder}
          onOpenChange={(o) => {
            if (!o) setActiveOrder(null);
          }}
          order={activeOrder}
          slug={slug}
          timezone={timezone}
          onAdvance={handleAdvance}
        />
      )}
    </div>
  );
}

function OrderRow({
  order,
  timezone,
  onClick,
}: {
  order: AdminOrder;
  timezone: string;
  onClick: () => void;
}) {
  const meta = STATUS_META[order.status];
  const ChannelIcon =
    order.delivery_type === "delivery"
      ? Bike
      : order.delivery_type === "dine_in"
        ? UtensilsCrossed
        : ShoppingBag;
  const channelLabel =
    order.delivery_type === "delivery"
      ? "Delivery"
      : order.delivery_type === "dine_in"
        ? "Salón"
        : "Retiro";
  const dateLabel = formatInTimeZone(order.created_at, timezone, "d MMM · HH:mm");
  const itemsCount = order.items.reduce((a, i) => a + i.quantity, 0);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="hover:bg-zinc-50/80 flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
      >
        <span className="text-zinc-900 w-16 shrink-0 text-base font-bold tabular-nums">
          #{order.order_number}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-zinc-900 truncate text-sm font-semibold">
            {orderTitle(order)}
          </p>
          <p className="text-zinc-500 truncate text-xs tabular-nums">
            {dateLabel} · {itemsCount} {itemsCount === 1 ? "ítem" : "ítems"}
          </p>
        </div>

        <ChannelIcon
          className="text-zinc-400 size-4 shrink-0"
          strokeWidth={1.75}
          aria-label={channelLabel}
        />

        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold sm:inline-flex",
            meta.tone,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>

        <span className="text-zinc-900 w-24 shrink-0 text-right text-sm font-bold tabular-nums">
          {formatCurrency(order.total_cents)}
        </span>

        <ChevronRight className="text-zinc-300 size-4 shrink-0" />
      </button>
    </li>
  );
}

function CompactSelect<T extends string>({
  value,
  onChange,
  options,
  icon,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  icon?: React.ReactNode;
}) {
  const active = value !== "all";
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger
        className={cn(
          "h-auto gap-1.5 rounded-full border-0 bg-transparent px-2.5 py-1.5 text-xs font-medium",
          "shadow-none ring-0 hover:bg-zinc-100 focus:ring-0 focus-visible:ring-0",
          active ? "text-zinc-900" : "text-zinc-600 hover:text-zinc-900",
        )}
      >
        {icon}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white p-12 text-center ring-1 ring-zinc-200/70">
      <ShoppingBag className="size-8 text-zinc-300" strokeWidth={1.5} />
      <p className="text-sm font-medium text-zinc-700">
        {hasFilters
          ? "No hay pedidos que coincidan con esos filtros"
          : "Todavía no hay pedidos"}
      </p>
      <p className="max-w-xs text-xs text-zinc-500">
        {hasFilters
          ? "Probá ampliando el rango de fechas o limpiando los filtros."
          : "Cuando entren pedidos los vas a ver acá."}
      </p>
    </div>
  );
}
