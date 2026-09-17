"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isOnlinePendingAdvance, type OrderStatus } from "@/lib/orders/status";
import { updateOrderStatus } from "@/lib/orders/update-status";

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "Confirmar",
  confirmed: "A cocina",
  // Flujo simplificado: de cocina se entrega directo.
  preparing: "Entregar",
  ready: "Entregar",
  on_the_way: "Entregar",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "delivered",
  ready: "delivered",
  on_the_way: "delivered",
};

export function OrderDetailActions({
  orderId,
  slug,
  status,
  deliveryType,
}: {
  orderId: string;
  slug: string;
  status: OrderStatus;
  deliveryType: "delivery" | "pickup";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const isTerminal = status === "delivered" || status === "cancelled";
  const next = NEXT_STATUS[status];
  const advanceLabel = NEXT_LABEL[status];

  const handleAdvance = () => {
    if (!next) return;
    startTransition(async () => {
      const result = await updateOrderStatus({
        order_id: orderId,
        business_slug: slug,
        next_status: next,
      });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  };

  const handleCancel = () => {
    if (!reason.trim()) {
      toast.error("Ingresá un motivo.");
      return;
    }
    startTransition(async () => {
      const result = await updateOrderStatus({
        order_id: orderId,
        business_slug: slug,
        next_status: "cancelled",
        cancelled_reason: reason.trim(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCancelOpen(false);
      router.refresh();
    });
  };

  // spec 096 · H-51 — callejón sin salida. Este componente no recibe
  // `onConfirm`, así que el botón caía a `updateOrderStatus` y el server
  // respondía «Usá "Confirmar" para mandar el pedido a cocina» — mientras el
  // botón que se acababa de apretar decía, literalmente, «Confirmar». Nunca
  // funcionó desde acá.
  //
  // Se usa **el mismo predicado que el server** para decidir si el avance es
  // alcanzable: así la UI y la guarda no pueden desincronizarse. Si no lo es,
  // el botón no se dibuja y se explica dónde está el gesto que sí funciona.
  const avanceBloqueado = Boolean(
    next && isOnlinePendingAdvance(status, deliveryType, next),
  );

  if (isTerminal) return null;

  return (
    <div className="flex gap-2">
      {avanceBloqueado && (
        <p className="text-muted-foreground self-center text-xs">
          Mandalo a cocina desde Operación.
        </p>
      )}
      {!avanceBloqueado && advanceLabel && next && (
        <Button disabled={pending} onClick={handleAdvance} className="flex-1">
          {advanceLabel}
        </Button>
      )}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" disabled={pending}>
              Cancelar
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pedido</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Motivo</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Sin stock, zona fuera de cobertura, etc."
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={pending}
            >
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={pending}
            >
              Cancelar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
