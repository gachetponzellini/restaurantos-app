"use client";

import { Ban } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cancelarComanda } from "@/lib/comandas/actions";

/**
 * Anular una comanda entera (spec 049), compartido entre el kanban de Comandas
 * y el panel de la mesa (spec 078).
 *
 * Es el mismo proceso en las dos pantallas —mismo copy, mismo motivo
 * obligatorio, misma server action— justamente porque el panel de mesa es un
 * atajo, no un flujo alternativo. Por eso el componente se parametriza con
 * primitivas: cada caller arma el `origen` con los datos que tiene a mano.
 */
export function AnularComandaModal({
  slug,
  comandaId,
  stationName,
  batch,
  origen,
  onClose,
  onDone,
}: {
  slug: string;
  comandaId: string;
  stationName: string;
  batch: number;
  /** De dónde salió la comanda: "Mesa 5", el nombre del cliente, etc. */
  origen?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const m = motivo.trim();
    if (!m) {
      toast.error("Indicá un motivo.");
      return;
    }
    startTransition(async () => {
      const res = await cancelarComanda(slug, comandaId, m);
      if (res.ok) {
        toast.success("Comanda anulada · se reimprime ANULADA en cocina.");
        onDone();
      } else {
        toast.error(res.error ?? "No pudimos anular la comanda.");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular comanda</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Se cancelan todos los ítems de{" "}
          <span className="text-foreground font-semibold">
            {stationName} · tanda {batch}
          </span>
          {origen ? ` (${origen})` : ""}. Sale un ticket{" "}
          <span className="font-semibold">ANULADA</span> en la comandera del
          sector y se avisa al mozo.
        </p>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Motivo (ej: mesa se levantó, error de carga)"
          className="border-input bg-background focus-visible:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={pending}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive-solid"
            size="lg"
            onClick={submit}
            disabled={pending}
          >
            <Ban className="size-4" strokeWidth={2.5} />
            {pending ? "Anulando…" : "Anular comanda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
