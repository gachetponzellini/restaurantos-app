import type { OrderStatus } from "./status";

/**
 * Centralized visual metadata for each order status — used by the kanban,
 * dashboard, recent-orders list, and historial grid. Single source of truth
 * for label, dot color, and badge tone (Tailwind classes).
 */
export const STATUS_META: Record<
  OrderStatus,
  { label: string; dot: string; tone: string }
> = {
  pending: {
    label: "Pendiente",
    dot: "bg-amber-500",
    tone: "text-amber-800 bg-amber-50",
  },
  confirmed: {
    label: "Confirmado",
    dot: "bg-sky-500",
    tone: "text-sky-800 bg-sky-50",
  },
  preparing: {
    label: "En cocina",
    dot: "bg-indigo-500",
    tone: "text-indigo-800 bg-indigo-50",
  },
  ready: {
    label: "En cocina",
    dot: "bg-emerald-500",
    tone: "text-emerald-800 bg-emerald-50",
  },
  on_the_way: {
    label: "En cocina",
    dot: "bg-violet-500",
    tone: "text-violet-800 bg-violet-50",
  },
  delivered: {
    label: "Entregado",
    dot: "bg-zinc-400",
    tone: "text-zinc-700 bg-zinc-100",
  },
  cancelled: {
    label: "Cancelado",
    dot: "bg-rose-500",
    tone: "text-rose-800 bg-rose-50",
  },
};

export const ORDER_STATUSES_IN_ORDER: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "on_the_way",
  "delivered",
  "cancelled",
];
