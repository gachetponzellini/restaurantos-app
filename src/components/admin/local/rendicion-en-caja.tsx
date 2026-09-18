"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { AmountCard } from "@/components/ui/amount-card";
import { SectionLabel } from "@/components/ui/section-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CajaAssignmentsPanel } from "@/components/admin/local/caja-assignments-tab";
import { registrarRendicionMozo } from "@/lib/caja/actions";
import { mozosQueDebenRendir } from "@/lib/caja/deben-rendir";
import {
  agruparCobrosPorMozo,
  type CobrosDeMozo,
} from "@/lib/caja/liquidacion-mozo";
import { motivoBloqueoRendicion } from "@/lib/caja/mesas-sin-cobrar";
import type { CajaPayment } from "@/lib/caja/queries";
import { ImprimirRendicionBoton } from "./imprimir-rendicion-boton";
import type {
  Caja,
  CajaUserAssignment,
  MozoRendicion,
  PaymentMethod,
  RendicionMozoPendiente,
} from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { METHOD_COLOR, METHOD_LABEL } from "./caja-metricas";
import {
  CANALES,
  CANAL_LABEL,
  type CanalRendicion,
} from "@/lib/caja/canal-rendicion";

/**
 * Rendición de mozos dentro de la vista Caja (#351).
 *
 * Antes era una tab aparte, con sus propias cards, y la caja tenía abajo otras
 * cards —«Cobrado por empleado»— con un «a rendir» calculado distinto (período
 * de la caja, sin filtro por rol). Dos números para el mismo mozo en la misma
 * pantalla. Ahora hay una sola card por empleado: arriba lo que cobró en esta
 * caja (informativo), abajo lo que tiene que rendir —la MISMA cuenta que se
 * guarda— y el botón para rendir.
 *
 * El botón se traba si el mozo tiene una mesa suya sin cobrar: rendir antes
 * obliga a una segunda rendición cuando esa mesa se cobre.
 */

export type HistorialRendicion = MozoRendicion & {
  mozo_name: string;
  registered_by_name: string | null;
};

type AssignmentWithNames = CajaUserAssignment & {
  user_name: string | null;
  caja_name: string;
};

type Props = {
  slug: string;
  /** Los cobros de la caja que se está mirando, en su período. */
  payments: CajaPayment[];
  /** Lo que cada uno debe rendir: de todo el negocio, desde su última rendición. */
  pendientes: RendicionMozoPendiente[];
  historial: HistorialRendicion[];
  cajas: Caja[];
  assignments: AssignmentWithNames[];
  members: { user_id: string; full_name: string | null }[];
  showAssignments: boolean;
  onChanged: () => void;
};

export function RendicionEnCaja({
  slug,
  payments,
  pendientes,
  historial,
  cajas,
  assignments,
  members,
  showAssignments,
  onChanged,
}: Props) {
  const [rendirMozo, setRendirMozo] = useState<RendicionMozoPendiente | null>(
    null,
  );

  // Misma regla que el cierre y la server action (issue #264).
  const debenRendir = mozosQueDebenRendir(pendientes, []);
  const pendientePorId = new Map(debenRendir.map((p) => [p.mozo_id, p]));

  const cobrados = agruparCobrosPorMozo(payments);
  // Los que deben rendir pero no cobraron en ESTA caja (cobraron en otra, o en
  // un período anterior): igual tienen que poder rendir desde acá.
  const conCard = new Set(cobrados.map((m) => m.mozo_id).filter(Boolean));
  const soloPendientes = debenRendir.filter((p) => !conCard.has(p.mozo_id));

  return (
    <section className="bg-card ring-border/70 space-y-4 rounded-2xl p-5 ring-1">
      <p className="text-muted-foreground text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
        Cobrado por empleado · rendición
      </p>

      {cobrados.length === 0 && soloPendientes.length === 0 ? (
        <p className="text-muted-foreground text-sm">Todavía no hubo cobros.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {cobrados.map((m) => (
            <EmpleadoCard
              key={m.mozo_id ?? m.mozo_name}
              cobrado={m}
              pendiente={
                m.mozo_id ? (pendientePorId.get(m.mozo_id) ?? null) : null
              }
              onRendir={setRendirMozo}
            />
          ))}
          {soloPendientes.map((p) => (
            <EmpleadoCard
              key={p.mozo_id}
              cobrado={null}
              nombre={p.mozo_name}
              pendiente={p}
              onRendir={setRendirMozo}
            />
          ))}
        </ul>
      )}

      {(historial.length > 0 || showAssignments) && (
        <details className="group ring-border/70 rounded-xl ring-1">
          <summary className="text-foreground/80 flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium">
            Últimas rendiciones{showAssignments ? " y asignación de cajas" : ""}
            <ChevronDown className="size-4 transition group-open:rotate-180" />
          </summary>
          <div className="border-border/60 space-y-5 border-t p-4">
            {historial.length > 0 && (
              <HistorialRendiciones slug={slug} historial={historial} />
            )}
            {showAssignments && (
              <CajaAssignmentsPanel
                slug={slug}
                cajas={cajas}
                assignments={assignments}
                onChanged={onChanged}
                members={members}
              />
            )}
          </div>
        </details>
      )}

      {rendirMozo && (
        <RendirModal
          open
          onOpenChange={(o) => !o && setRendirMozo(null)}
          pendiente={rendirMozo}
          slug={slug}
          onSuccess={() => {
            setRendirMozo(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

/** Iniciales para el avatar. «Sin mozo» no lleva. */
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function EmpleadoCard({
  cobrado,
  nombre,
  pendiente,
  onRendir,
}: {
  cobrado: CobrosDeMozo | null;
  nombre?: string;
  pendiente: RendicionMozoPendiente | null;
  onRendir: (p: RendicionMozoPendiente) => void;
}) {
  const name = cobrado?.mozo_name ?? nombre ?? "Sin nombre";
  const sinMozo = cobrado !== null && cobrado.mozo_id === null;
  const mesas = pendiente?.mesas_sin_cobrar ?? [];
  const bloqueado = mesas.length > 0;

  return (
    <li className="bg-muted/50 ring-border/70 flex flex-col rounded-xl p-4 ring-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold",
              sinMozo
                ? "bg-card text-muted-foreground/70 ring-border ring-1"
                : "bg-border text-foreground/80",
            )}
          >
            {sinMozo ? "—" : iniciales(name)}
          </span>
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-semibold">
              {name}
            </p>
            {cobrado && (
              <p className="text-muted-foreground text-xs tabular-nums">
                {cobrado.cobros_count} cobro
                {cobrado.cobros_count === 1 ? "" : "s"} en esta caja
              </p>
            )}
          </div>
        </div>
        {cobrado && (
          <p className="text-foreground shrink-0 text-base font-bold tracking-tight tabular-nums">
            {formatCurrency(cobrado.total_cents)}
          </p>
        )}
      </div>

      {cobrado && (
        <ul className="mt-3 space-y-1.5">
          {cobrado.por_metodo.map((f) => (
            <li
              key={f.method}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="text-foreground/70 inline-flex items-baseline gap-1.5">
                <span
                  className="inline-block size-2 shrink-0 translate-y-px rounded-full"
                  style={{ background: METHOD_COLOR[f.method] }}
                />
                {METHOD_LABEL[f.method]}
                <span className="text-muted-foreground/70 tabular-nums">
                  ×{f.count}
                </span>
              </span>
              <span className="text-foreground/90 font-semibold tabular-nums">
                {formatCurrency(f.total_cents)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Sin mozo no hay a quién pedírselo: esa plata la cobró la caja. */}
      {!sinMozo && (
        <div className="mt-auto pt-3">
          <div className="border-border/70 border-t pt-3">
            {pendiente ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-foreground/70 text-xs font-medium">
                    Efectivo a rendir
                  </span>
                  <span className="text-foreground text-lg font-bold tabular-nums">
                    {formatCurrency(pendiente.efectivo_cents)}
                  </span>
                </div>
                <EfectivoPorCanal pendiente={pendiente} />
                <PropinaDetalle
                  pendiente={pendiente}
                  className="mt-1.5 text-xs"
                />
                {bloqueado ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
                    <Lock className="mt-px size-3.5 shrink-0" />
                    {motivoBloqueoRendicion(mesas)}
                  </p>
                ) : null}
                <Button
                  className="mt-3 w-full"
                  disabled={bloqueado}
                  onClick={() => onRendir(pendiente)}
                >
                  <CheckCircle2 className="mr-2 size-4" />
                  Rendir
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                Rendido
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * La propina, partida en lo que ya tiene y lo que hay que darle (#351).
 *
 * La del efectivo se la quedó al cobrar —entrega el neto—; si la pantalla
 * decía «se le paga $X del cajón» por el total, el encargado se la daba otra
 * vez y el cajón quedaba corto. La contabilidad no cambia (el movimiento de
 * propina sigue siendo por el total, spec 177 · D5): cambia qué se le dice.
 */
function PropinaDetalle({
  pendiente,
  className,
}: {
  pendiente: RendicionMozoPendiente;
  className?: string;
}) {
  const enEfectivo = pendiente.propina_efectivo_cents ?? 0;
  const aDarle =
    pendiente.propina_a_entregar_cents ??
    pendiente.total_propinas_cents - enEfectivo;
  if (enEfectivo === 0 && aDarle === 0) return null;
  return (
    <div className={cn("space-y-0.5", className)}>
      {aDarle > 0 && (
        <p className="flex items-baseline justify-between gap-2">
          <span>Propina a darle del cajón</span>
          <span className="font-semibold text-emerald-700 tabular-nums">
            {formatCurrency(aDarle)}
          </span>
        </p>
      )}
      {enEfectivo > 0 && (
        <p className="text-muted-foreground flex items-baseline justify-between gap-2">
          <span>Propina en efectivo · ya la tiene</span>
          <span className="tabular-nums">{formatCurrency(enEfectivo)}</span>
        </p>
      )}
    </div>
  );
}

function HistorialRendiciones({
  slug,
  historial,
}: {
  slug: string;
  historial: HistorialRendicion[];
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-3 text-[0.6rem] font-semibold tracking-[0.14em] uppercase">
        Últimas rendiciones
      </p>
      <div className="ring-border/70 overflow-x-auto rounded-lg ring-1">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border/60 bg-muted/30 border-b">
              <th className="text-muted-foreground px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Mozo
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Esperado
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Entregado
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Dif.
              </th>
              <th className="text-muted-foreground px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Registrado por
              </th>
              <th className="text-muted-foreground px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Hora
              </th>
              {/* Spec 178 — el papel del mozo, a pedido. Sin rótulo: el
                      botón se explica solo y la columna queda angosta. */}
              <th className="px-3 py-2" aria-label="Imprimir" />
            </tr>
          </thead>
          <tbody className="divide-border/60 divide-y">
            {historial.map((r) => {
              const diff = r.difference_cents;
              return (
                <tr key={r.id}>
                  <td className="text-foreground px-3 py-2 font-medium">
                    {r.mozo_name}
                  </td>
                  <td className="text-foreground/80 px-3 py-2 text-right tabular-nums">
                    {formatCurrency(r.expected_cash_cents)}
                  </td>
                  <td className="text-foreground/80 px-3 py-2 text-right tabular-nums">
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
                  <td className="text-foreground/70 px-3 py-2">
                    {r.registered_by_name ?? "—"}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 tabular-nums">
                    {new Date(r.created_at).toLocaleTimeString("es-AR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ImprimirRendicionBoton
                      slug={slug}
                      rendicionId={r.id}
                      mozoName={r.mozo_name}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Los canales con efectivo a entregar (spec 203). Con más de uno —o con uno que
 * no sea el salón— se rinde y se muestra por separado.
 */
function canalesConEfectivo(p: RendicionMozoPendiente): CanalRendicion[] {
  return CANALES.filter((c) => (p.por_canal?.[c]?.efectivo_cents ?? 0) > 0);
}

function mostrarPorCanal(p: RendicionMozoPendiente): boolean {
  const canales = CANALES.filter((c) => p.por_canal?.[c]);
  return canales.length > 1 || (canales.length === 1 && canales[0] !== "salon");
}

function EfectivoPorCanal({
  pendiente,
}: {
  pendiente: RendicionMozoPendiente;
}) {
  if (!mostrarPorCanal(pendiente)) return null;
  return (
    <ul className="mt-2 space-y-1">
      {CANALES.filter((c) => pendiente.por_canal?.[c]).map((c) => (
        <li
          key={c}
          className="flex items-baseline justify-between gap-2 text-xs"
        >
          <span className="text-foreground/70">{CANAL_LABEL[c]}</span>
          <span className="text-foreground/90 font-semibold tabular-nums">
            {formatCurrency(pendiente.por_canal[c]!.efectivo_cents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Lo que cobró con otros métodos (tarjeta, QR, transferencia…), **sólo para
 * informar** (#330). La spec 151 sacó estos montos de la rendición porque no
 * se rinden —esa plata ya entró a la caja—; el encargado igual quiere verlos
 * al rendir, así que vuelven con la leyenda escrita para que nadie los cuente
 * como plata a entregar.
 */
function OtrosCobrosInformativo({
  porMetodo,
  className,
}: {
  porMetodo: Record<PaymentMethod, number>;
  className?: string;
}) {
  const filas = (Object.entries(porMetodo) as Array<[PaymentMethod, number]>)
    .filter(([method, cents]) => method !== "cash" && cents > 0)
    .sort((a, b) => b[1] - a[1]);
  if (filas.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-muted-foreground text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
        Otros cobros · informativo
      </p>
      <ul className="mt-1.5 space-y-1">
        {filas.map(([method, cents]) => (
          <li
            key={method}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="text-foreground/70 inline-flex items-baseline gap-1.5">
              <span
                className="inline-block size-2 shrink-0 translate-y-px rounded-full"
                style={{ background: METHOD_COLOR[method] }}
              />
              {METHOD_LABEL[method]}
            </span>
            <span className="text-foreground/80 tabular-nums">
              {formatCurrency(cents)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-1.5 text-[0.7rem]">
        No se rinde: ya entró a la caja. Sólo se rinde el efectivo.
      </p>
    </div>
  );
}

export function RendirModal({
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
  // Spec 203 · D4 — con más de un canal con efectivo, un monto por canal.
  const [deliveredPorCanal, setDeliveredPorCanal] = useState<
    Partial<Record<CanalRendicion, string>>
  >({});

  useEffect(() => {
    if (!open) {
      setDeliveredPorCanal({});
      setDelivered("");
      setNotes("");
      setNoEntrego(false);
    }
  }, [open]);

  const aCents = (v: string | undefined) =>
    v === undefined || v === ""
      ? null
      : Math.max(0, Math.round(Number(v) * 100));
  const canales = canalesConEfectivo(pendiente);
  const porCanal = canales.length > 1;
  const centsPorCanal = Object.fromEntries(
    canales.map((c) => [c, aCents(deliveredPorCanal[c])]),
  ) as Partial<Record<CanalRendicion, number | null>>;
  const cents = porCanal
    ? canales.some((c) => centsPorCanal[c] === null)
      ? null
      : canales.reduce((acc, c) => acc + (centsPorCanal[c] ?? 0), 0)
    : aCents(delivered);
  const diff = cents === null ? 0 : cents - pendiente.efectivo_cents;
  const hayDiferenciaEnCanal =
    porCanal &&
    canales.some(
      (c) =>
        centsPorCanal[c] !== null &&
        centsPorCanal[c] !== pendiente.por_canal[c]!.efectivo_cents,
    );
  const requiresNotes = cents !== null && (diff !== 0 || hayDiferenciaEnCanal);

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
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader
          title={`Rendición de ${pendiente.mozo_name}`}
          icon={<CheckCircle2 />}
        />
        <ModalBody>
          {sinEfectivo ? (
            <div className="bg-muted/50 ring-border/70 rounded-xl p-4 ring-1">
              <SectionLabel>No tiene efectivo para entregar</SectionLabel>
              <p className="text-foreground/70 mt-1 text-sm">
                Cobró todo con tarjeta, QR o transferencia — esa plata ya entró
                a la caja. Sólo queda cerrarle el período del turno.
              </p>
            </div>
          ) : (
            <AmountCard
              label="Efectivo que debería entregar"
              value={formatCurrency(pendiente.efectivo_cents)}
            >
              <EfectivoPorCanal pendiente={pendiente} />
            </AmountCard>
          )}

          <OtrosCobrosInformativo
            porMetodo={pendiente.por_metodo}
            className="ring-border/70 mt-4 rounded-xl p-4 ring-1"
          />

          {/* Spec 177 · Parte B — que salga plata del cajón no puede ser una
            sorpresa: el encargado lo lee antes de confirmar. */}
          {pendiente.total_propinas_cents > 0 && !noEntrego && (
            <PropinaDetalle
              pendiente={pendiente}
              className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200"
            />
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

          {porCanal && !noEntrego && (
            <div className="mt-4 grid gap-3">
              {canales.map((c) => {
                const esperado = pendiente.por_canal[c]!.efectivo_cents;
                const entregado = centsPorCanal[c];
                const d =
                  entregado === null || entregado === undefined
                    ? null
                    : entregado - esperado;
                return (
                  <div key={c} className="grid gap-1.5">
                    <Label className="flex items-baseline justify-between text-sm font-medium">
                      <span>{CANAL_LABEL[c]} · efectivo que entrega</span>
                      <span className="text-muted-foreground text-xs font-normal tabular-nums">
                        debería {formatCurrency(esperado)}
                        {d !== null && d !== 0 && (
                          <span
                            className={cn(
                              "ml-1 font-semibold",
                              d < 0 ? "text-rose-700" : "text-amber-700",
                            )}
                          >
                            ({d > 0 ? "+" : "−"}
                            {formatCurrency(Math.abs(d))})
                          </span>
                        )}
                      </span>
                    </Label>
                    <div className="relative">
                      <span className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base font-semibold">
                        $
                      </span>
                      <Input
                        type="number"
                        aria-label={`${CANAL_LABEL[c]} · efectivo que entrega`}
                        value={deliveredPorCanal[c] ?? ""}
                        onChange={(e) =>
                          setDeliveredPorCanal((prev) => ({
                            ...prev,
                            [c]: e.target.value,
                          }))
                        }
                        placeholder="0"
                        inputMode="decimal"
                        className="pl-7 text-base tabular-nums"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div
            className={cn(
              "mt-4 grid gap-1.5",
              (noEntrego || sinEfectivo || porCanal) && "hidden",
            )}
          >
            <Label className="text-sm font-medium">Efectivo que entrega</Label>
            <div className="relative">
              <span className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base font-semibold">
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

          {!noEntrego &&
            cents !== null &&
            diff === 0 &&
            !hayDiferenciaEnCanal && (
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
        </ModalBody>

        <ModalFooter>
          {/* Sin efectivo no hay nada que «no entregar»: la salida de deuda
              declarada (spec 139 · D1) no se ofrece, porque una deuda de $0
              avisada al dueño es ruido y asusta a quien la registra. */}
          {!sinEfectivo && (
            <Button
              variant="outline"
              size="xl"
              onClick={() => setNoEntrego((v) => !v)}
              className={cn(noEntrego && "text-foreground")}
            >
              {noEntrego ? "Volver a rendir" : "No entregó"}
            </Button>
          )}
          <Button
            size="xl"
            variant={noEntrego ? "destructive-solid" : "default"}
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
                  undefined,
                  porCanal && !noEntrego
                    ? (centsPorCanal as Partial<Record<CanalRendicion, number>>)
                    : undefined,
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
                // #351 — el toast dice lo que hay que darle en mano: la propina
                // en efectivo ya la tiene y no sale del cajón físicamente.
                const aDarle = pendiente.propina_a_entregar_cents ?? 0;
                toast.success(
                  r.data.propina_pagada_cents > 0 && aDarle > 0
                    ? `${base} · dale ${formatCurrency(aDarle)} de propina`
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
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
