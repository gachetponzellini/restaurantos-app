"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, RefreshCw, User } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
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
import { CajaAssignmentsPanel } from "@/components/admin/local/caja-assignments-tab";
import { registrarRendicionMozo } from "@/lib/caja/actions";
import { mozosQueDebenRendir } from "@/lib/caja/deben-rendir";
import type {
  Caja,
  CajaUserAssignment,
  MozoRendicion,
  RendicionMozoPendiente,
} from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { useOnActivate } from "@/lib/ui/use-tab-param";
import { getRendicionTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import type { RendicionData } from "@/app/[business_slug]/admin/(authed)/operacion/data";
import { cn } from "@/lib/utils";

type AssignmentWithNames = CajaUserAssignment & {
  user_name: string | null;
  caja_name: string;
};

type MemberOption = {
  user_id: string;
  full_name: string | null;
};

type Props = {
  slug: string;
  initialPendientes: RendicionMozoPendiente[];
  initialHistorial: (MozoRendicion & {
    mozo_name: string;
    registered_by_name: string | null;
  })[];
  cajas: Caja[];
  cajaAssignments: AssignmentWithNames[];
  members: MemberOption[];
  showAssignments: boolean;
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
  /** `true` si el panel montó lazy (spec 103): entonces revalida al montar. */
  refetchAlMontar?: boolean;
  /** Spec 103: cada snapshot nuevo del refetch, para el badge de la tab. */
  onServerData?: (d: RendicionData) => void;
};

export function RendicionMozosTab({
  slug,
  initialPendientes,
  initialHistorial,
  cajas,
  cajaAssignments: initialAssignments,
  members,
  showAssignments,
  active = true,
  refetchAlMontar = false,
  onServerData,
}: Props) {
  const [rendirMozo, setRendirMozo] = useState<RendicionMozoPendiente | null>(
    null,
  );

  // Snapshot del server de la tab, seedeado de los props y actualizado sólo por
  // el refetch (spec 103). Se reemplaza **entero**: es plata, y sumar en el
  // cliente es como se duplica una rendición.
  const [serverData, setServerData] = useState({
    pendientes: initialPendientes,
    historial: initialHistorial,
    assignments: initialAssignments,
  });
  const { pendientes, historial, assignments } = serverData;

  const refetchSeq = useRef(0);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  const refetchRendicion = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getRendicionTabData(slug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) {
        setServerData({
          pendientes: res.data.rendicionPendientes,
          historial: res.data.rendicionHistorial,
          assignments: res.data.cajaAssignments,
        });
        onServerDataRef.current?.(res.data);
      }
    } catch {
      // swallow: refresh de fondo, mantiene lo que hay (nunca vacía la tabla).
    }
  }, [slug]);

  // Volver a la tab revalida: es plata y el snapshot del page-load puede ser de
  // hace horas. Reemplaza al puente `router.refresh()` de la spec 101.
  useOnActivate(active, refetchRendicion, { onMount: refetchAlMontar });

  // issue #264 — la misma regla que el cierre, y no una copia con criterio
  // propio. Acá se filtraba sólo por `pagos_count > 0`, así que el que maneja
  // la caja aparecía como pendiente todas las noches **con los botones
  // «Rindió» y «No entregó» disponibles** — y tomarle una rendición a alguien
  // cuyo efectivo ya está en el cajón deja una diferencia negativa por todo lo
  // que cobró, más un aviso de faltante al dueño.
  //
  // `mozosQueDebenRendir` es la función que ya usan el modal de cierre y la
  // server action que bloquea; usarla acá es lo que hace que la pantalla diga
  // lo mismo que el sistema exige.
  const conPagos = mozosQueDebenRendir(pendientes, []);
  const sinPagos = pendientes.filter(
    (p) => !conPagos.some((c) => c.mozo_id === p.mozo_id),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          Rendición de mozos · pendientes del turno
        </p>
        <button
          type="button"
          onClick={() => void refetchRendicion()}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Refrescar"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {conPagos.length === 0 && sinPagos.length === 0 && (
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-zinc-100">
              <User className="size-7 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
                Sin mozos activos
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                No hay mozos/encargados con pagos pendientes de rendir.
              </p>
            </div>
          </div>
        </Surface>
      )}

      {conPagos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {conPagos.map((p) => (
            <MozoPendienteCard
              key={p.mozo_id}
              pendiente={p}
              onRendir={() => setRendirMozo(p)}
            />
          ))}
        </div>
      )}

      {sinPagos.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">
            Sin cobros en este turno
          </p>
          <div className="flex flex-wrap gap-2">
            {sinPagos.map((p) => (
              <span
                key={p.mozo_id}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm text-zinc-500 ring-1 ring-zinc-200/70"
              >
                <User className="size-3.5" />
                {p.mozo_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <div>
          <p className="mb-3 text-[0.6rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Últimas rendiciones
          </p>
          <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200/70">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60">
                  <th className="px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                    Mozo
                  </th>
                  <th className="px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                    Esperado
                  </th>
                  <th className="px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                    Entregado
                  </th>
                  <th className="px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                    Dif.
                  </th>
                  <th className="px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                    Registrado por
                  </th>
                  <th className="px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                    Hora
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {historial.map((r) => {
                  const diff = r.difference_cents;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-zinc-900">
                        {r.mozo_name}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-700 tabular-nums">
                        {formatCurrency(r.expected_cash_cents)}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-700 tabular-nums">
                        {formatCurrency(r.delivered_cash_cents)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-semibold tabular-nums",
                          diff === 0
                            ? "text-emerald-700"
                            : diff < 0
                              ? "text-rose-700"
                              : "text-amber-700",
                        )}
                      >
                        {diff === 0
                          ? "OK"
                          : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {r.registered_by_name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 tabular-nums">
                        {new Date(r.created_at).toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAssignments && (
        <CajaAssignmentsPanel
          slug={slug}
          cajas={cajas}
          assignments={assignments}
          onChanged={() => void refetchRendicion()}
          members={members}
        />
      )}

      {rendirMozo && (
        <RendirModal
          open
          onOpenChange={(o) => !o && setRendirMozo(null)}
          pendiente={rendirMozo}
          slug={slug}
          onSuccess={() => {
            setRendirMozo(null);
            void refetchRendicion();
          }}
        />
      )}
    </div>
  );
}

function MozoPendienteCard({
  pendiente,
  onRendir,
}: {
  pendiente: RendicionMozoPendiente;
  onRendir: () => void;
}) {
  const p = pendiente;

  return (
    <article className="flex flex-col rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <header className="flex items-start justify-between gap-3 border-b border-zinc-100 p-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-zinc-900">
            {p.mozo_name}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {p.pagos_count} cobro{p.pagos_count !== 1 ? "s" : ""} en el turno
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-800">
          Pendiente
        </span>
      </header>

      <div className="border-b border-zinc-100 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Efectivo a entregar
          </p>
          <p className="text-xl font-bold text-zinc-900 tabular-nums">
            {formatCurrency(p.efectivo_cents)}
          </p>
        </div>
        {/* Spec 177 · Parte B — la propina deja de ser un número informativo:
            se le paga en esta misma rendición, del cajón. */}
        {p.total_propinas_cents > 0 && (
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="text-xs text-zinc-500">Propina a pagarle</p>
            <p className="text-sm text-emerald-700 tabular-nums">
              {formatCurrency(p.total_propinas_cents)}
            </p>
          </div>
        )}
      </div>

      <div className="p-3">
        <Button className="w-full" onClick={onRendir}>
          <CheckCircle2 className="mr-2 size-4" />
          Registrar rendición
        </Button>
      </div>
    </article>
  );
}

function RendirModal({
  open,
  onOpenChange,
  pendiente,
  slug,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pendiente: RendicionMozoPendiente;
  slug: string;
  onSuccess: () => void;
}) {
  const [, startTransition] = useTransition();
  const [delivered, setDelivered] = useState("");
  const [notes, setNotes] = useState("");
  // Spec 139 · D1 — la otra salida: el mozo se fue y la plata queda como deuda
  // declarada, con motivo. No es una rendición en $0.
  const [noEntrego, setNoEntrego] = useState(false);

  useEffect(() => {
    if (!open) {
      setDelivered("");
      setNotes("");
      setNoEntrego(false);
    }
  }, [open]);

  const cents =
    delivered === "" ? null : Math.max(0, Math.round(Number(delivered) * 100));
  const diff = cents === null ? 0 : cents - pendiente.efectivo_cents;
  const requiresNotes = cents !== null && diff !== 0;

  /**
   * El mozo cobró, pero nada en efectivo: hizo todo con tarjeta, QR o
   * transferencia. Sigue apareciendo acá a propósito —la spec 139 · D4 pide que
   * cierre su período igual, o arrastra cobros viejos a la rendición de
   * mañana—, pero **no tiene nada que entregar**, así que las dos salidas
   * normales mienten: «Registrar rendición» le hace tipear un cero a mano, y
   * «No entregó» le deja una deuda declarada de $0 avisada al dueño.
   *
   * Reportado por la encargada de golf (2026-09-03): *"si un mozo vende todo en
   * tarjeta, ¿cómo saca eso? No me da opción de poner otra cosa que no es
   * efectivo"*. La spec 151 sacó los montos de tarjeta de esta pantalla pero
   * dejó este caso afuera a propósito; esto lo cierra.
   */
  const sinEfectivo = pendiente.efectivo_cents === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rendición de {pendiente.mozo_name}</DialogTitle>
        </DialogHeader>

        {sinEfectivo ? (
          <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
            <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
              No tiene efectivo para entregar
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Cobró todo con tarjeta, QR o transferencia — esa plata ya entró a
              la caja. Sólo queda cerrarle el período del turno.
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
            <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
              Efectivo que debería entregar
            </p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">
              {formatCurrency(pendiente.efectivo_cents)}
            </p>
          </div>
        )}

        {/* Spec 177 · Parte B — que salga plata del cajón no puede ser una
            sorpresa: el encargado lo lee antes de confirmar. */}
        {pendiente.total_propinas_cents > 0 && !noEntrego && (
          <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
            Se le paga{" "}
            <span className="font-semibold tabular-nums">
              {formatCurrency(pendiente.total_propinas_cents)}
            </span>{" "}
            de propina, y sale del cajón como movimiento de caja.
          </p>
        )}

        {noEntrego && (
          <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
            Queda como deuda de {pendiente.mozo_name} por{" "}
            <span className="font-semibold tabular-nums">
              {formatCurrency(pendiente.efectivo_cents)}
            </span>
            , a la vista en el cierre y avisada al dueño.
          </p>
        )}

        <div
          className={cn(
            "mt-4 grid gap-1.5",
            (noEntrego || sinEfectivo) && "hidden",
          )}
        >
          <Label className="text-sm font-medium">Efectivo que entrega</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base font-semibold text-zinc-400">
              $
            </span>
            <Input
              type="number"
              value={delivered}
              onChange={(e) => setDelivered(e.target.value)}
              placeholder="0"
              autoFocus
              inputMode="decimal"
              className="pl-7 text-base tabular-nums"
            />
          </div>
        </div>

        {!noEntrego && cents !== null && diff !== 0 && (
          <div
            className={cn(
              "mt-4 flex items-center justify-between rounded-lg p-3 ring-1",
              diff < 0
                ? "bg-rose-50 text-rose-900 ring-rose-200"
                : "bg-amber-50 text-amber-900 ring-amber-200",
            )}
          >
            <span className="text-sm font-semibold">
              {diff < 0 ? "Falta" : "Sobra"}
            </span>
            <span className="text-lg font-bold tabular-nums">
              {diff > 0 ? "+" : "−"}
              {formatCurrency(Math.abs(diff))}
            </span>
          </div>
        )}

        {!noEntrego && cents !== null && diff === 0 && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200">
            <span className="text-sm font-semibold">Cuadra perfecto</span>
            <CheckCircle2 className="size-4" />
          </div>
        )}

        {(requiresNotes || noEntrego) && (
          <div className="mt-3 grid gap-1.5">
            <Label className="text-sm font-medium">
              {noEntrego ? "¿Por qué no entregó?" : "¿Qué pasó?"}
              <span className="ml-1 text-rose-600">*</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ej: le di cambio de más, billete falso…"
            />
          </div>
        )}

        <DialogFooter>
          {/* Sin efectivo no hay nada que «no entregar»: la salida de deuda
              declarada (spec 139 · D1) no se ofrece, porque una deuda de $0
              avisada al dueño es ruido y asusta a quien la registra. */}
          {!sinEfectivo && (
            <Button
              variant="ghost"
              onClick={() => setNoEntrego((v) => !v)}
              className={cn(noEntrego && "text-zinc-900")}
            >
              {noEntrego ? "Volver a rendir" : "No entregó"}
            </Button>
          )}
          <Button
            variant={noEntrego ? "destructive" : "default"}
            disabled={
              sinEfectivo
                ? false
                : noEntrego
                  ? notes.trim() === ""
                  : cents === null || (requiresNotes && notes.trim() === "")
            }
            onClick={() =>
              startTransition(async () => {
                const r = await registrarRendicionMozo(
                  pendiente.mozo_id,
                  noEntrego ? 0 : (cents ?? 0),
                  notes.trim() || null,
                  slug,
                  noEntrego ? "no_entrego" : "rendida",
                );
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                const base = sinEfectivo
                  ? `Período de ${pendiente.mozo_name} cerrado`
                  : noEntrego
                    ? `${pendiente.mozo_name} quedó como «no entregó»`
                    : `Rendición de ${pendiente.mozo_name} registrada`;
                // Spec 177 — el pago sale del cajón: el toast lo confirma con
                // el monto, que es lo que el encargado acaba de sacar.
                toast.success(
                  r.data.propina_pagada_cents > 0
                    ? `${base} · propina pagada ${formatCurrency(r.data.propina_pagada_cents)}`
                    : base,
                );
                onSuccess();
              })
            }
          >
            <CheckCircle2 className="mr-2 size-4" />
            {sinEfectivo
              ? "Cerrar período"
              : noEntrego
                ? "Marcar como no entregó"
                : "Registrar rendición"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
