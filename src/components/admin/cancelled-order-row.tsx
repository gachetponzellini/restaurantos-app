"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { deleteOrder } from "@/lib/admin/order-delete-actions";
import { formatCurrency } from "@/lib/currency";

import type { AdminOrder } from "@/lib/admin/orders-query";

export function CancelledOrderRow({
  order,
  slug,
  timezone,
}: {
  order: AdminOrder;
  slug: string;
  timezone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const r = await deleteOrder({ order_id: order.id, business_slug: slug });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Pedido eliminado.");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <div className="bg-card flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 opacity-80">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground font-semibold">
              #{order.daily_number}
            </span>
            <span className="text-muted-foreground text-xs">
              {formatInTimeZone(order.created_at, timezone, "HH:mm")}
            </span>
            <span className="text-muted-foreground/70 text-xs">·</span>
            <span className="text-muted-foreground truncate text-xs">
              {order.customer_name}
            </span>
            <span className="text-muted-foreground/70 text-xs">·</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatCurrency(order.total_cents)}
            </span>
          </div>
          {order.cancelled_reason && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs italic">
              &quot;{order.cancelled_reason}&quot;
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <Link
            href={`/${slug}/admin/pedidos/${order.id}`}
            className="text-primary font-medium underline-offset-2 hover:underline"
          >
            Ver
          </Link>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setOpen(true)}
            aria-label="Eliminar pedido"
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="sm">
          <ModalHeader
            icon={<Trash2 />}
            tone="danger"
            title={`Eliminar pedido #${order.daily_number}`}
          />
          <ModalBody>
            <p className="text-muted-foreground text-sm">
              Se borra permanentemente — incluyendo ítems, línea de tiempo y
              cualquier dato asociado. No se puede deshacer.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="outline"
              size="xl"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Volver
            </Button>
            <Button
              variant="destructive-solid"
              size="xl"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? "Eliminando…" : "Eliminar"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
