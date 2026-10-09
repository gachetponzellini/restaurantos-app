"use client";

import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { anularCuentaCerrada } from "@/lib/caja/anular-cuenta-actions";

/**
 * «Anular» en una fila cerrada de Por cobrar (spec 215). Es destructiva: el
 * motivo va en un `<textarea>` y el disparo es un click explícito (AGENTS §3,
 * spec 043), nunca Enter.
 */
export function AnularCuentaCerrada({
  slug,
  orderId,
  nombre,
  onAnulada,
}: {
  slug: string;
  orderId: string;
  nombre: string;
  onAnulada: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, startTransition] = useTransition();

  if (!abierto) {
    return (
      <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setAbierto(true)} aria-label={`Anular ${nombre}`}>
        <Ban className="size-4" /> Anular
      </Button>
    );
  }

  const anular = () =>
    startTransition(async () => {
      const r = await anularCuentaCerrada({ orderId, motivo, slug });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${nombre} anulada.`);
      setAbierto(false);
      setMotivo("");
      onAnulada();
    });

  return (
    <div className="w-full rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200 sm:w-80">
      <p className="text-sm text-rose-900">
        Se da de baja la venta de <strong>{nombre}</strong>: deja de figurar por cobrar y no suma en las ventas.
        Si tiene un cobro vivo, primero hay que anular el cobro.
      </p>
      <label className="mt-2 grid gap-1 text-xs font-medium text-rose-900">
        Motivo
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Facturada por fuera, error de carga…"
          className="rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-sm text-foreground"
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="bg-rose-600 hover:bg-rose-700"
          disabled={pending || motivo.trim() === ""}
          onClick={anular}
        >
          {pending ? "Anulando…" : "Anular"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
