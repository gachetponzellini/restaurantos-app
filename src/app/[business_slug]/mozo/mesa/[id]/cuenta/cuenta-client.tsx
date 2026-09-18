"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Lock,
  Printer,
  Receipt,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { BusinessRole } from "@/lib/admin/context";
import {
  aplicarPropinaYDescuento,
  cancelarItemEnCuenta,
  limpiarDivision,
} from "@/lib/billing/cuenta-actions";
import { sumActiveItems } from "@/lib/billing/totals";
import { useArrowFocus } from "@/lib/ui/use-arrow-focus";
import type { CuentaState } from "@/lib/billing/types";
import { formatCurrency } from "@/lib/currency";
import { canApplyDiscount, canCancelItem } from "@/lib/permissions/can";
import { useOptimisticAction } from "@/lib/ui/use-optimistic-action";
import { cn } from "@/lib/utils";

import { PageShell } from "@/components/admin/shell/page-shell";
import { Button } from "@/components/ui/button";
import { imprimirCuenta } from "@/lib/print/cuenta-print-actions";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DividirModal, SplitsBanner } from "@/components/billing/dividir-modal";

const TIP_PRESETS = [0, 5, 10, 15];
const DISCOUNT_REASONS = [
  { value: "cumpleanos", label: "Cumpleaños" },
  { value: "fidelidad", label: "Fidelidad" },
  { value: "cortesia", label: "Cortesía de la casa" },
  { value: "staff", label: "Staff" },
  { value: "otro", label: "Otro" },
];

type Props = {
  slug: string;
  tableId: string;
  tableLabel: string;
  role: BusinessRole;
  cuenta: CuentaState;
  /** Destinos para usar la vista desde el panel admin sin saltar a /mozo.
   *  Default: la app del mozo. */
  homeHref?: string;
  cobrarHref?: string;
  /** Modo embebido: se renderiza dentro del panel del salón (no como página).
   *  Sin chrome full-screen; header de panel con cerrar; CTA no-fija. En vez de
   *  navegar usa los callbacks. */
  embedded?: boolean;
  /** Cerrar el panel (volver al detalle de mesa). Solo embebido. */
  onClose?: () => void;
  /** "Pasar a cobro": el parent abre el cobro embebido de la misma mesa. */
  onCobrar?: () => void;
  /** Re-fetch tras dividir / limpiar / cancelar item, sin cerrar el panel. */
  onReload?: () => void;
};

export function CuentaClient({
  slug,
  tableId,
  tableLabel,
  role,
  cuenta,
  homeHref,
  cobrarHref,
  embedded = false,
  onClose,
  onCobrar,
  onReload,
}: Props) {
  const router = useRouter();
  const backHref = homeHref ?? `/${slug}/mozo`;
  const cobrarTarget = cobrarHref ?? `/${slug}/mozo/mesa/${tableId}/cobrar`;
  const [isPending, startTransition] = useTransition();
  // Refrescar datos: embebido re-fetchea via parent; página re-renderiza.
  const reloadData = () => {
    if (embedded) onReload?.();
    else router.refresh();
  };

  // Cancelar ítem es optimista: marcamos el ítem cancelado al instante y el
  // subtotal (y total/propina/descuento derivados) se recalcula con la misma
  // `sumActiveItems` del server — sin total transitorio incorrecto. El overlay
  // se sostiene hasta que el `router.refresh()` (dentro de la transición del
  // helper) trae el dato real; si falla, revierte solo.
  const { state: items, run: runCancelItem } = useOptimisticAction(
    cuenta.items,
    (list, payload: { id: string; cancelledAt: string }) =>
      list.map((it) =>
        it.id === payload.id
          ? { ...it, cancelled_at: payload.cancelledAt }
          : it,
      ),
  );
  const subtotal = sumActiveItems(items);

  const [tipPercent, setTipPercent] = useState<number | "custom">(
    cuenta.order.tip_cents === 0 ? 0 : "custom",
  );
  const [tipCustomCents, setTipCustomCents] = useState(cuenta.order.tip_cents);
  const tipCents =
    tipPercent === "custom"
      ? tipCustomCents
      : Math.round((subtotal * tipPercent) / 100);

  const [discountPercent, setDiscountPercent] = useState(
    subtotal === 0
      ? 0
      : Math.round((cuenta.order.discount_cents / subtotal) * 100),
  );
  const initialReason = cuenta.order.discount_reason ?? "";
  const initialReasonKnown = DISCOUNT_REASONS.some(
    (r) => r.value === initialReason,
  );
  const [discountReasonValue, setDiscountReasonValue] = useState<string>(
    initialReasonKnown ? initialReason : initialReason ? "otro" : "",
  );
  const [discountReasonOther, setDiscountReasonOther] = useState(
    initialReasonKnown ? "" : initialReason,
  );
  const discountReasonText =
    discountReasonValue === "otro"
      ? discountReasonOther
      : (DISCOUNT_REASONS.find((r) => r.value === discountReasonValue)?.label ??
        "");

  const discountCents =
    subtotal === 0 ? 0 : Math.round((subtotal * discountPercent) / 100);
  const total = Math.max(0, subtotal + tipCents - discountCents);

  const [dividirOpen, setDividirOpen] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);

  // Imprimir la cuenta (spec 080). El action resuelve la comandera del salón
  // ANTES de encolar, así que un local sin comandera configurada se entera acá
  // y no se queda esperando un papel que nunca sale.
  const handleImprimir = async () => {
    setImprimiendo(true);
    const r = await imprimirCuenta(tableId, slug);
    setImprimiendo(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(
      r.data.reprint ? "Cuenta reimpresa." : "Cuenta enviada a la impresora.",
    );
  };
  const [cancelarItemId, setCancelarItemId] = useState<string | null>(null);

  const dirty =
    tipCents !== cuenta.order.tip_cents ||
    discountCents !== cuenta.order.discount_cents ||
    (discountReasonText || null) !== (cuenta.order.discount_reason || null);

  const cantApplyDiscount =
    discountPercent > 0 && !canApplyDiscount(role, discountPercent);

  // El motivo del descuento es obligatorio (lo valida `handleConfirmar` y de
  // nuevo el server), pero el botón se veía habilitado y el requisito recién
  // aparecía como toast al apretarlo: el encargado tocaba «Cobrar» y no pasaba
  // nada visible (issue #189). Ahora el gate está a la vista, en el mismo lugar
  // donde se elige.
  const faltaMotivo = discountCents > 0 && discountReasonText.trim() === "";

  // Las sub-cuentas canceladas siguen en la fila para auditoría, pero la mesa
  // no está dividida por ellas: contándolas, después de limpiar la división el
  // banner seguía anunciando una sub-cuenta y el botón ofrecía «Volver a
  // dividir (1)» sobre una cuenta entera (issue #189).
  const splitsVivos = cuenta.splits.filter((s) => s.status !== "cancelled");

  const handleConfirmar = () => {
    if (cantApplyDiscount) {
      toast.error("Tu rol no permite ese descuento.");
      return;
    }
    if (discountCents > 0 && discountReasonText.trim() === "") {
      toast.error("El descuento requiere un motivo.");
      return;
    }
    startTransition(async () => {
      if (dirty) {
        const r = await aplicarPropinaYDescuento(
          cuenta.order.id,
          {
            tip_cents: tipCents,
            discount_cents: discountCents,
            discount_reason: discountCents > 0 ? discountReasonText : null,
          },
          slug,
        );
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
      }
      if (embedded) onCobrar?.();
      else router.push(cobrarTarget);
    });
  };

  // La terminal tiene el tope del mozo (`canApplyDiscount`, spec 140): el
  // cartel le decía «sin límite» y el server le rechazaba el 15 % (#294).
  const topeDeMozo = role === "mozo" || role === "terminal";
  const tramoDescuento = topeDeMozo
    ? "10%"
    : role === "encargado"
      ? "25%"
      : "sin límite";

  // A quién hay que ir a buscar cuando el descuento se pasa del tramo. Estaba
  // escrito «pedile al encargado» para todos, así que la encargada leía que se
  // pidiera permiso a sí misma (issue #188). Arriba del encargado está el dueño.
  const quienAutoriza = topeDeMozo ? "l encargado" : "l dueño";

  // ↑/↓ recorren los controles de la cuenta —líneas, dividir, propina,
  // descuento, Cobrar— sin cambiar a Tab (spec 075, FR-017). Sólo en el panel
  // del salón: la versión full-screen del mozo es táctil.
  const panelRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown: handleArrows } = useArrowFocus(panelRef);

  return (
    <div
      ref={panelRef}
      onKeyDown={embedded ? handleArrows : undefined}
      className={cn(
        embedded
          ? "flex h-full min-h-0 flex-col"
          : "min-h-dvh bg-muted/60 pb-32",
      )}
    >
      {embedded ? (
        <header className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground text-2xl leading-none font-extrabold tracking-tight">
              {tableLabel}
            </h3>
            <p className="text-muted-foreground mt-1 text-[11px] font-semibold tracking-wider uppercase">
              Cuenta
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="flex-shrink-0"
            aria-label="Cerrar cuenta"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
      ) : (
        <header className="sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-screen-md items-center gap-3 px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => router.push(backHref)}
              aria-label="Volver al salón"
            >
              <ArrowRight className="size-4 rotate-180" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {tableLabel}
              </p>
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Cuenta
              </h1>
            </div>
            <div className="text-right">
              <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Total
              </p>
              <p className="text-lg font-bold tracking-tight text-foreground tabular-nums">
                {formatCurrency(total)}
              </p>
            </div>
          </div>
        </header>
      )}

      <div
        className={cn(embedded ? "min-h-0 flex-1 overflow-y-auto" : "contents")}
      >
        <PageShell width="narrow" className="!py-4 sm:!py-6">
          {/* Banner: división activa */}
          {splitsVivos.length > 0 && (
            <SplitsBanner
              splits={cuenta.splits}
              onLimpiar={() =>
                startTransition(async () => {
                  const r = await limpiarDivision(cuenta.order.id, slug);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("División eliminada");
                    reloadData();
                  }
                })
              }
            />
          )}

          {/* Items */}
          <section className="rounded-2xl bg-card ring-1 ring-border/70">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  Detalle
                </p>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {items.filter((it) => it.cancelled_at === null).length} items
                </h2>
              </div>
              <p className="text-sm font-semibold text-foreground tabular-nums">
                {formatCurrency(subtotal)}
              </p>
            </div>
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {items.map((it) => {
                const cancelled = it.cancelled_at !== null;
                return (
                  <li
                    key={it.id}
                    className={cn(
                      "flex items-start justify-between gap-3 px-4 py-3",
                      cancelled && "opacity-50",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 inline-flex size-7 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground/80 tabular-nums">
                        {it.quantity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-medium text-foreground",
                            cancelled && "line-through",
                          )}
                        >
                          {it.product_name}
                        </p>
                        {(it as { seat_number?: number | null }).seat_number !=
                          null && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[0.6rem] font-semibold text-violet-700">
                            Comensal{" "}
                            {(it as { seat_number: number }).seat_number}
                          </span>
                        )}
                        {it.notes && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {it.notes}
                          </p>
                        )}
                        {cancelled && (
                          <p className="mt-0.5 text-[0.65rem] font-semibold tracking-[0.14em] text-rose-600 uppercase">
                            Cancelado
                          </p>
                        )}
                        {!cancelled && it.price_original_cents != null && (
                          <p className="mt-0.5 text-xs font-medium text-amber-700">
                            <span className="tabular-nums line-through opacity-60">
                              {formatCurrency(it.price_original_cents)}
                            </span>{" "}
                            <span className="tabular-nums">
                              {formatCurrency(it.unit_price_cents)}
                            </span>
                            {it.price_override_reason
                              ? ` · ${it.price_override_reason}`
                              : ""}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={cn(
                          "text-sm font-medium text-foreground tabular-nums",
                          cancelled && "line-through",
                        )}
                      >
                        {formatCurrency(it.subtotal_cents)}
                      </span>
                      {!cancelled && canCancelItem(role) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setCancelarItemId(it.id)}
                          aria-label="Cancelar item"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Propina y descuento, lado a lado con el panel ancho (spec 111): son
            dos secciones bajas y angostas por contenido, y apiladas obligaban a
            scrollear el panel para llegar a «Pasar a cobro». */}
          <div className="grid items-start gap-3 @2xl:grid-cols-2">
            {/* Propina */}
            <section className="rounded-2xl bg-card p-4 ring-1 ring-border/70">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Propina
                  </p>
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    Sugerencia para el mozo
                  </h2>
                </div>
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {tipCents > 0 ? `+ ${formatCurrency(tipCents)}` : "—"}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {TIP_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTipPercent(p)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition",
                      tipPercent === p
                        ? "bg-primary text-white ring-primary"
                        : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
                    )}
                  >
                    {p === 0 ? "Sin propina" : `${p}%`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setTipPercent("custom")}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition",
                    tipPercent === "custom"
                      ? "bg-primary text-white ring-primary"
                      : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
                  )}
                >
                  Custom
                </button>
              </div>
              {tipPercent === "custom" && (
                <Input
                  type="number"
                  className="mt-3 w-40"
                  value={tipCustomCents / 100}
                  onChange={(e) =>
                    setTipCustomCents(
                      Math.max(0, Math.round(Number(e.target.value) * 100)),
                    )
                  }
                  placeholder="0.00"
                  inputMode="decimal"
                />
              )}
            </section>

            {/* Descuento */}
            <section className="rounded-2xl bg-card p-4 ring-1 ring-border/70">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Descuento
                  </p>
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    Tu rol permite hasta {tramoDescuento}
                  </h2>
                </div>
                <p className="text-sm font-semibold text-rose-600 tabular-nums">
                  {discountCents > 0
                    ? `− ${formatCurrency(discountCents)}`
                    : "—"}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Input
                  type="number"
                  // Vacío en vez de un `0` precargado: tipear «30» sobre el cero
                  // dejaba «030» en pantalla (issue #189), y encima obligaba a
                  // borrarlo antes de escribir. El placeholder dice lo mismo sin
                  // estorbar.
                  value={discountPercent === 0 ? "" : discountPercent}
                  onChange={(e) =>
                    setDiscountPercent(
                      Math.max(0, Math.min(100, Number(e.target.value))),
                    )
                  }
                  placeholder="0"
                  className="w-24"
                  inputMode="decimal"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              {cantApplyDiscount && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[0.65rem] font-semibold text-rose-700">
                  <Lock className="size-3" />
                  Excede tu autorización · pedile a{quienAutoriza}
                </div>
              )}
              {discountCents > 0 && (
                <div className="mt-3 grid gap-2">
                  <p className="text-xs font-medium text-foreground/80">
                    Motivo
                    <span className="ml-1 text-rose-600">*</span>
                    {faltaMotivo && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        elegí uno para poder cobrar
                      </span>
                    )}
                  </p>
                  {/* `@md` = ancho del panel; con `sm:` (viewport) esto estaba
                  congelado en 3 columnas y el `grid-cols-2` era código muerto. */}
                  <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
                    {DISCOUNT_REASONS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setDiscountReasonValue(r.value)}
                        className={cn(
                          "rounded-lg px-2.5 py-2 text-xs font-medium ring-1 transition",
                          discountReasonValue === r.value
                            ? "bg-primary text-white ring-primary"
                            : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {discountReasonValue === "otro" && (
                    <Input
                      value={discountReasonOther}
                      onChange={(e) => setDiscountReasonOther(e.target.value)}
                      placeholder="Especificá el motivo"
                    />
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Resumen + dividir */}
          <section className="rounded-2xl bg-card p-4 ring-1 ring-border/70">
            <ResumenRow label="Subtotal" value={formatCurrency(subtotal)} />
            {tipCents > 0 && (
              <ResumenRow
                label="Propina"
                value={`+ ${formatCurrency(tipCents)}`}
              />
            )}
            {discountCents > 0 && (
              <ResumenRow
                label="Descuento"
                value={`− ${formatCurrency(discountCents)}`}
                tone="discount"
              />
            )}
            <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                {formatCurrency(total)}
              </span>
            </div>
            <div className="mt-4 grid gap-2 @lg:grid-cols-2">
              {/* Spec 080: el papel que se le da a la mesa. Se puede tocar las
                veces que haga falta — agregan un café y la vuelven a pedir. */}
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handleImprimir}
                disabled={total === 0 || imprimiendo}
                className="w-full"
              >
                <Printer className="size-4" />
                {imprimiendo ? "Imprimiendo…" : "Imprimir cuenta"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setDividirOpen(true)}
                disabled={total === 0}
                className="w-full"
              >
                <Scissors className="size-4" />
                {splitsVivos.length > 0
                  ? `Volver a dividir (${splitsVivos.length})`
                  : "Dividir cuenta"}
              </Button>
            </div>
          </section>
        </PageShell>
      </div>

      {/* CTA — fija en página, al pie del panel en embebido */}
      <div
        className={cn(
          embedded
            ? "border-border/60 border-t p-3"
            : "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 backdrop-blur",
        )}
      >
        <div className={cn(!embedded && "mx-auto max-w-screen-md p-4")}>
          <Button
            type="button"
            size="xl"
            onClick={handleConfirmar}
            disabled={
              cantApplyDiscount || faltaMotivo || total === 0 || isPending
            }
            className="w-full"
            style={{
              background: "var(--brand, #18181B)",
              color: "var(--brand-foreground, white)",
            }}
          >
            <Receipt className="size-5" />
            {dirty ? "Guardar y pasar a cobro" : "Pasar a cobro"}
            <span className="ml-1 tabular-nums">{formatCurrency(total)}</span>
          </Button>
        </div>
      </div>

      {/* Modales */}
      <DividirModal
        open={dividirOpen}
        onOpenChange={setDividirOpen}
        items={items.filter((i) => i.cancelled_at === null)}
        orderId={cuenta.order.id}
        slug={slug}
        totalCents={total}
        parentStartTransition={startTransition}
        isPending={isPending}
        onDone={() => {
          setDividirOpen(false);
          // El refresh va DENTRO de la transición: `isPending` se mantiene
          // hasta que llegan los splits recién creados, así "Pasar a cobro"
          // queda bloqueado. Si no, se rehabilita con la vista vieja (sin
          // splits) y el cobro arma un pago único. (bug 2026-06-19)
          if (embedded) onReload?.();
          else startTransition(() => router.refresh());
        }}
      />

      <Modal
        open={cancelarItemId !== null}
        onOpenChange={(o) => !o && setCancelarItemId(null)}
      >
        <ModalContent size="sm">
          <ModalHeader title="Cancelar item" />
          <CancelarItemForm
            onSubmit={(motivo) => {
              if (!cancelarItemId) return;
              const id = cancelarItemId;
              // Optimista: cerramos el diálogo y tachamos el ítem al instante.
              setCancelarItemId(null);
              runCancelItem(
                { id, cancelledAt: new Date().toISOString() },
                async () => {
                  const r = await cancelarItemEnCuenta(id, motivo, slug);
                  if (r.ok) {
                    toast.success("Item cancelado");
                    reloadData();
                  }
                  return r;
                },
              );
            }}
            onCancel={() => setCancelarItemId(null)}
          />
        </ModalContent>
      </Modal>
    </div>
  );
}

function ResumenRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "discount";
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-sm">
      <span className="text-foreground/70">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          tone === "discount" ? "text-rose-600" : "text-foreground/80",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function CancelarItemForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (motivo: string) => void;
  onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <>
      <ModalBody>
        <div className="grid gap-1.5">
          <Label>Motivo</Label>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ej: cliente cambió de opinión, plato salió mal…"
            autoFocus
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" size="xl" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          size="xl"
          disabled={motivo.trim() === ""}
          onClick={() => onSubmit(motivo)}
        >
          Confirmar
        </Button>
      </ModalFooter>
    </>
  );
}
