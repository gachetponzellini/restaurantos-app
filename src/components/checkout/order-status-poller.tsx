"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);

/**
 * Refreshes the tracking route on an interval while the order is still in a
 * non-terminal state, so the customer eventually sees admin-driven status
 * changes (preparing → delivered) and cancellations
 * without a manual reload. Deliberately not realtime — a periodic refresh is
 * enough here. Stops once the order reaches a terminal status.
 *
 * Renders nothing — pure side effect.
 */
export function OrderStatusPoller({
  status,
  intervalMs = 60_000,
}: {
  status: string;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;

    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(id);
  }, [status, intervalMs, router]);

  return null;
}
