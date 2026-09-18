"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Fingerprint, LogOut, UserX, X } from "lucide-react";

import {
  clockPunch,
  getCurrentPresent,
  type PresentEmployee,
} from "@/lib/rrhh/clock-actions";
import type { TodaySummary } from "@/lib/rrhh/clock-queries";
import { formatDuration } from "@/lib/rrhh/format-utils";
import { PresentEmployeeCard } from "@/components/shared/present-employee-card";
import { RoleBadge } from "@/components/shared/role-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ClockFeedback,
  type FeedbackState,
} from "@/components/fichar/clock-feedback";
import { Numpad } from "@/components/fichar/numpad";
import { PinDisplay } from "@/components/fichar/pin-display";

export function FichajeTab({
  slug,
  initialPresent,
  todaySummary,
  active = true,
}: {
  slug: string;
  initialPresent: PresentEmployee[];
  todaySummary?: TodaySummary;
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
}) {
  const [present, setPresent] = useState(initialPresent);
  // `finished` / `absent` (el resumen del día) se leen **derecho de los props**:
  // no tienen ni setter, y en `useState` quedaban congelados al montar — con el
  // keep-alive de la spec 101 el panel monta una sola vez, así que "Ya salieron"
  // y "Sin fichar" se clavaban en el snapshot del page-load por todo el turno,
  // aunque el server mandara datos nuevos.
  const finished = todaySummary?.finished ?? [];
  const absent = todaySummary?.absent ?? [];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pin, setPin] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ status: "idle" });

  // Los presentes vuelven a seedearse cuando el server manda datos nuevos (el
  // puente del shell revalida la ruta al entrar a la tab). Sin esto el panel se
  // quedaba con lo del page-load: con keep-alive ya no hay re-montaje que lo
  // re-seedee, y el badge de la tab —que lee la promesa— terminaba diciendo un
  // número distinto al de las tarjetas.
  useEffect(() => {
    setPresent(initialPresent);
  }, [initialPresent]);

  // El poll se detiene con la tab oculta (spec 101): con el keep-alive el panel
  // queda montado al cambiar de tab y si no, seguiría preguntando quién está
  // presente cada 60 s para siempre sin que nadie lo mire.
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(async () => {
      const updated = await getCurrentPresent(slug);
      setPresent(updated);
    }, 60_000);
    return () => clearInterval(interval);
  }, [slug, active]);

  const handleDigit = useCallback(
    (d: string) => {
      if (feedback.status === "loading") return;
      if (feedback.status !== "idle") setFeedback({ status: "idle" });
      setPin((prev) => (prev.length < 4 ? prev + d : prev));
    },
    [feedback.status],
  );

  const handleDelete = useCallback(() => {
    if (feedback.status === "loading") return;
    if (feedback.status !== "idle") setFeedback({ status: "idle" });
    setPin((prev) => prev.slice(0, -1));
  }, [feedback.status]);

  // El PIN se tipea, igual que en el kiosco de `/fichar`: abrís el diálogo y
  // escribís. El foco vive en el popup —no en un input— así que no se abre el
  // teclado en pantalla de la tablet, que ya tiene el numpad abajo, y las
  // teclas siguen llegando acá aunque el foco ande por otro lado del diálogo.
  // `e.key` es el dígito tanto en la fila de arriba como en el pad numérico.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      }
    },
    [handleDigit, handleDelete],
  );

  useEffect(() => {
    if (pin.length < 4) return;

    setFeedback({ status: "loading" });

    clockPunch(slug, pin).then((r) => {
      if (!r.ok) {
        setFeedback({ status: "error", message: r.error });
      } else {
        setFeedback({ status: "success", result: r.data });
        if (r.data.type === "in") {
          setPresent((prev) => [
            ...prev,
            {
              userId: "",
              name: r.data.employeeName,
              role: "",
              clockIn: r.data.time,
            },
          ]);
        } else {
          setPresent((prev) =>
            prev.filter(
              (p) =>
                p.name.toLowerCase() !== r.data.employeeName.toLowerCase(),
            ),
          );
        }
      }
      setPin("");
      setTimeout(() => {
        setFeedback({ status: "idle" });
        if (r.ok) setDialogOpen(false);
      }, 2000);
    });
  }, [pin, slug]);

  return (
    <div className="flex h-full flex-col gap-6 lg:flex-row">
      {/* Left: Presentes + action */}
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Asistencia del día
            </h2>
            <p className="text-sm text-muted-foreground">
              {present.length}{" "}
              {present.length === 1 ? "persona" : "personas"} trabajando
              ahora
            </p>
          </div>
          <Button size="lg" onClick={() => setDialogOpen(true)}>
            <Fingerprint className="size-4" />
            Marcar asistencia
          </Button>
        </div>

        {present.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/70">
            <Clock className="size-10 opacity-40" />
            <p className="text-sm">No hay nadie fichado todavía.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {present.map((e) => (
              <PresentEmployeeCard
                key={e.userId + e.clockIn}
                name={e.name}
                role={e.role}
                clockIn={e.clockIn}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar: finished + absent (apilado debajo en <lg) */}
      {(finished.length > 0 || absent.length > 0) && (
        <aside className="w-full shrink-0 space-y-5 overflow-y-auto rounded-2xl bg-card p-5 ring-1 ring-border/70 lg:w-72">
          {finished.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <LogOut className="size-3.5" />
                Ya salieron ({finished.length})
              </div>
              <ul className="space-y-1.5">
                {finished.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <span className="truncate font-medium text-foreground/80">
                      {e.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDuration(e.durationMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {absent.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <UserX className="size-3.5" />
                Sin fichar ({absent.length})
              </div>
              <ul className="space-y-1.5">
                {absent.map((a) => (
                  <li
                    key={a.userId}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm"
                  >
                    <span className="truncate text-muted-foreground">{a.name}</span>
                    <RoleBadge role={a.role} size="xs" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      )}

      {/* Numpad dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setPin("");
            setFeedback({ status: "idle" });
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          ref={popupRef}
          // Sin esto el foco arranca en la ✕ —el primer focuseable del
          // diálogo— y el teclado no escribe nada.
          initialFocus={popupRef}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="max-w-sm rounded-3xl bg-zinc-950 p-8 text-white shadow-2xl ring-0 outline-none"
        >
          <DialogTitle className="sr-only">Marcar asistencia</DialogTitle>
          <button
            type="button"
            onClick={() => setDialogOpen(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 rounded-lg p-1 text-zinc-400 transition hover:text-white"
          >
            <X className="size-5" />
          </button>

          <div className="flex flex-col items-center gap-6">
            <div className="flex items-center gap-2 text-zinc-400">
              <Fingerprint className="size-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Ingresá tu PIN
              </span>
            </div>

            <PinDisplay
              length={pin.length}
              size="md"
              active={feedback.status !== "loading"}
            />

            <div className="h-16 w-full">
              <ClockFeedback feedback={feedback} size="md" />
            </div>

            <Numpad
              onDigit={handleDigit}
              onDelete={handleDelete}
              disabled={feedback.status === "loading"}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
