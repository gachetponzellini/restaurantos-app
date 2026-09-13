"use client";

import { useEffect, useState, useTransition } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  agregarFichada,
  anularFichada,
  corregirFichada,
} from "@/lib/rrhh/asistencia-actions";
import type { ClockEntry } from "@/lib/rrhh/clock-queries";

/**
 * Corregir o agregar una fichada (spec 179 · D1).
 *
 * Un solo modal para las dos: la diferencia es si hay una fila detrás
 * (`entry`) o hay que elegir a quién (`empleados`). Las dos piden motivo — es
 * sueldo, y el motivo es lo que hace que el rastro sirva.
 *
 * Las horas se tipean en la zona del LOCAL y viajan como instante: un
 * `datetime-local` no lleva offset, y en un server UTC «09:00» sería otra
 * hora. Misma convención que el resto del fichaje (`fromZonedTime`).
 */
export function FichadaModal({
  open,
  onOpenChange,
  slug,
  timezone,
  entry,
  empleados,
  defaultDay,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  timezone: string;
  /** Con fila = corregir. Sin fila = agregar. */
  entry?: ClockEntry | null;
  empleados: { userId: string; name: string }[];
  /** `YYYY-MM-DD` del día abierto, para precargar la entrada al agregar. */
  defaultDay?: string | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [entrada, setEntrada] = useState("");
  const [salida, setSalida] = useState("");
  const [motivo, setMotivo] = useState("");

  const aLocal = (iso: string) => formatInTimeZone(iso, timezone, "yyyy-MM-dd'T'HH:mm");
  const aInstante = (local: string) => fromZonedTime(local, timezone).toISOString();

  useEffect(() => {
    if (!open) return;
    setMotivo("");
    if (entry) {
      setUserId(entry.userId);
      setEntrada(aLocal(entry.clockIn));
      setSalida(entry.clockOut ? aLocal(entry.clockOut) : "");
    } else {
      setUserId(empleados[0]?.userId ?? "");
      setEntrada(defaultDay ? `${defaultDay}T09:00` : "");
      setSalida("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const corrige = Boolean(entry);
  const listo = entrada !== "" && motivo.trim() !== "" && (corrige || userId !== "");

  const submit = () => {
    startTransition(async () => {
      const payload = {
        clock_in: aInstante(entrada),
        clock_out: salida ? aInstante(salida) : null,
        reason: motivo,
        slug,
      };
      const r = corrige
        ? await corregirFichada({ entryId: entry!.id, ...payload })
        : await agregarFichada({ userId, ...payload });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(corrige ? "Fichada corregida." : "Fichada agregada.");
      onDone();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {corrige ? `Corregir fichada de ${entry!.name}` : "Agregar fichada"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!corrige && (
            <div className="space-y-1.5">
              <Label htmlFor="fichada-empleado">Empleado</Label>
              <select
                id="fichada-empleado"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm"
              >
                {empleados.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fichada-entrada">Entrada</Label>
              <Input
                id="fichada-entrada"
                type="datetime-local"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fichada-salida">Salida</Label>
              <Input
                id="fichada-salida"
                type="datetime-local"
                value={salida}
                onChange={(e) => setSalida(e.target.value)}
              />
              <p className="text-xs text-zinc-500">
                Vacía = la fichada queda abierta.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fichada-motivo">Motivo</Label>
            <Textarea
              id="fichada-motivo"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Se olvidó de marcar la salida, llegó a las 10 y fichó a las 9…"
            />
            <p className="text-xs text-zinc-500">
              Queda en el rastro con tu nombre y la hora anterior.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!listo || pending} onClick={submit}>
            {pending ? "Guardando…" : corrige ? "Guardar corrección" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Anular una fichada, con motivo. Nunca se borra: queda tachada (D1). */
export function AnularFichadaModal({
  open,
  onOpenChange,
  slug,
  entry,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  entry: ClockEntry | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (open) setMotivo("");
  }, [open]);

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular fichada de {entry.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-600">
          Deja de sumar horas y queda tachada en el día, con el motivo. No se
          borra.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="anular-motivo">Motivo</Label>
          <Textarea
            id="anular-motivo"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Fichó dos veces, fichó por otro…"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={motivo.trim() === "" || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await anularFichada({ entryId: entry.id, reason: motivo, slug });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Fichada anulada.");
                onDone();
                onOpenChange(false);
              })
            }
          >
            {pending ? "Anulando…" : "Anular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
