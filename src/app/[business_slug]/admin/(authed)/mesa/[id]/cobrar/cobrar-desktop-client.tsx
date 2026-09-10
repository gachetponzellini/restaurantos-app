"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  PageHeader,
  PageShell,
  Surface,
} from "@/components/admin/shell/page-shell";
import { AyudaChip } from "@/components/admin/ayuda-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessRole } from "@/lib/admin/context";
import { formatInvoiceNumber, tipoLabel } from "@/lib/afip/format";
import type { Invoice } from "@/lib/afip/types";
import {
  anularCobro,
  iniciarPagoMp,
  registrarPago,
  type IniciarCobroResult,
} from "@/lib/billing/cobro-actions";
import type { CuentaState, OrderSplit } from "@/lib/billing/types";
import { CobroForm } from "@/components/billing/cobro-form";
import { actionError } from "@/lib/actions";
import { FacturacionSection } from "@/components/billing/facturacion-section";
import {
  ComprobanteFields,
  comprobanteEsValido,
  comprobanteInicial,
  comprobanteToInvoiceInput,
  type ComprobanteState,
} from "@/components/billing/comprobante-fields";
import type { PaymentMethodConfig } from "@/lib/caja/types";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  tableId: string;
  tableLabel: string;
  role: BusinessRole;
  cuenta: CuentaState;
  init: IniciarCobroResult;
  /** Modo embebido: se renderiza dentro del panel del salón (no como página).
   *  Sin PageShell/PageHeader; header de panel con cerrar; layout en una
   *  columna; en vez de navegar a `/admin/operacion` usa los callbacks. */
  embedded?: boolean;
  /** Cerrar el panel manualmente (solo embebido). */
  onClose?: () => void;
  /** El cobro terminó (orden cerrada / anulada): el parent cierra y refresca. */
  onClosed?: () => void;
  /** Recargar los datos del cobro sin cerrar el panel (solo embebido). El
   *  parent re-corre `loadCobroForTable`. Necesario tras dividir/limpiar o un
   *  pago parcial, porque embebido el `init` viene de estado del cliente y
   *  `router.refresh()` no lo actualiza. */
  onReload?: () => void;
  /** Comprobante ya emitido para esta orden, si lo hay: con uno cargado la
   *  sección lo muestra en vez del formulario. No alcanza con el guard del
   *  server, que es por TIPO — sin este dato se podría emitir una Factura A
   *  sobre una orden que ya tiene una B. */
  existingInvoice?: Invoice | null;
  /** El negocio tiene AFIP configurado (CUIT + punto de venta). Con esto en
   *  true la pantalla ofrece emitir el comprobante al terminar de cobrar y NO
   *  se cierra sola: era el único de los cuatro puntos de cobro que no
   *  facturaba, y el encargado no llega a la sección Facturación (#137). */
  afipConfigured?: boolean;
  /** spec 141 — con quién se puede fiar. Vacío ⇒ el método no se ofrece. */
  clientesParaFiar?: {
    id: string;
    name: string | null;
    phone: string;
    saldo_cents: number;
  }[];
};

/** Lo que devuelve un cobro OK — incluye el desenlace del comprobante (spec 156). */
type CobroData = Extract<
  Awaited<ReturnType<typeof registrarPago>>,
  { ok: true }
>["data"];

export function CobrarDesktopClient({
  slug,
  tableId: _tableId,
  tableLabel,
  role,
  cuenta,
  init,
  embedded = false,
  onClose,
  onClosed,
  onReload,
  existingInvoice = null,
  afipConfigured = false,
  clientesParaFiar = [],
}: Props) {
  void _tableId;
  const router = useRouter();
  // Volver al salón: embebido cierra el panel via callback; página navega.
  const goHome = () => {
    if (embedded) onClosed?.();
    else router.push(`/${slug}/admin/operacion`);
  };
  // Refrescar los datos del cobro: embebido re-fetchea via parent; página
  // re-renderiza el server component.
  const reloadData = () => {
    if (embedded) onReload?.();
    else router.refresh();
  };
  const splits = init.hasImplicitSplit
    ? [
        implicitSplit(
          cuenta.order.id,
          cuenta.order.business_id,
          cuenta.totals.total_cents,
          cuenta.order.tip_cents,
        ),
      ]
    : init.splits;

  const [activeSplitId, setActiveSplitId] = useState<string | null>(
    splits.find((s) => s.status !== "paid" && s.status !== "cancelled")?.id ??
      null,
  );
  const [cajaId, setCajaId] = useCajaPreferida(slug, init.cajas);
  // spec 156 · D1 — qué comprobante sale, elegido antes de cobrar. Es de la
  // orden entera: si la cuenta se divide, la elección no se reinicia por split.
  const [comprobante, setComprobante] =
    useState<ComprobanteState>(comprobanteInicial());
  const activeSplit = splits.find((s) => s.id === activeSplitId) ?? null;

  const total = cuenta.totals.total_cents;
  // El server avisó que cerró la orden y nos quedamos en la pantalla para
  // facturar (#137). Sin esto habría que recargar para ver "Mesa cobrada", y
  // recargar es justamente lo que no podemos hacer: `getCuentaForTable` exige
  // la orden `open`, así que el refetch devolvería "no hay cuenta" y se
  // llevaría puesta la sección de facturación.
  const [closedLocal, setClosedLocal] = useState(false);

  // Cerrada = señal del SERVER (lifecycle o el `orderClosed` que acaba de
  // devolver el pago), nunca una suma del cliente. Un total 0 con la orden
  // abierta —mesa sin ítems, todo anulado, descuento del 100%— da
  // `totalPending === 0` sin que nadie haya pagado, y esa orden no se cierra
  // sola nunca (`closeOrderIfFullyPaid` exige `total_cents > 0`). Facturar ahí
  // sería emitir un comprobante fiscal de una mesa impaga.
  const orderClosed = cuenta.order.lifecycle_status !== "open" || closedLocal;

  const splitsActivos = splits.filter((s) => s.status !== "cancelled");
  // Con la orden ya cerrada los splits de `init` quedaron viejos (no se
  // refetchea, ver arriba): el cobro fue completo, así que el total pagado es
  // el total. Sin esto la barra queda en 0% y "Anular cobro" desaparece justo
  // cuando más se necesita.
  const totalPaid = orderClosed
    ? total
    : splitsActivos.reduce((acc, s) => acc + s.paid_amount_cents, 0);
  const totalPending = Math.max(0, total - totalPaid);
  const progressPct =
    total === 0 ? 0 : Math.min(100, (totalPaid / total) * 100);
  // Para el cartel y la barra alcanza con que no quede saldo (comportamiento
  // previo). Para FACTURAR se exige `orderClosed`.
  const allPaid = totalPending === 0 || orderClosed;

  const body = (
    <div
      className={cn(
        embedded
          ? // Embebido era una sola columna porque el panel medía 480px. Desde
            // la spec 111 puede llegar a 900: a partir de 800 de **panel**
            // (container query, no viewport) toma la misma grilla que la página.
            "space-y-4 @min-[800px]:grid @min-[800px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)] @min-[800px]:items-start @min-[800px]:gap-4 @min-[800px]:space-y-0"
          : "grid gap-4 lg:grid-cols-[1fr_minmax(0,420px)]",
      )}
    >
      {/* ── Columna izquierda: KPI + caja + splits + anular ── */}
      <div className="space-y-4">
        {/* KPI principal */}
        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--brand-soft, #F4F4F5)" }}
        >
          <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-600 uppercase">
            {allPaid ? "Cobrado" : "Falta cobrar"}
          </p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {formatCurrency(allPaid ? total : totalPending)}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            de {formatCurrency(total)} total
            {totalPaid > 0 && !allPaid && (
              <> · ya cobrado {formatCurrency(totalPaid)}</>
            )}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                background: allPaid
                  ? "rgb(16 185 129)"
                  : "var(--brand, #18181B)",
              }}
            />
          </div>
        </section>

        {/* Selector de caja si hay >1 */}
        {init.cajas.length > 1 && (
          <Surface padding="compact">
            <Label className="text-[0.6rem] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
              Caja para registrar el cobro
            </Label>
            <Select value={cajaId} onValueChange={(v) => v && setCajaId(v)}>
              <SelectTrigger className="mt-1.5 @xl:max-w-xs">
                <SelectValue placeholder="Seleccionar caja">
                  {init.cajas.find((c) => c.id === cajaId)?.name ?? "Caja"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {init.cajas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || `Caja #${c.sort_order + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Surface>
        )}

        {/* Splits. Con la orden cerrada no se listan: los de `init` quedaron
              viejos (sin refetch) y mostrarían "Cobrar" habilitado sobre una
              mesa ya cobrada — el server rechazaría el pago, pero la pantalla
              estaría invitando a un callejón. */}
        {!orderClosed && (
          <section className="space-y-2.5">
            <p className="px-1 text-[0.6rem] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
              {splitsActivos.length === 1
                ? "Pago único"
                : `${splitsActivos.length} sub-cuentas`}
            </p>
            {/* Las canceladas no se listan: no se pueden cobrar y ocupaban el
                  lugar de la fila que sí (issue #189). Siguen en la DB. */}
            <ul className="space-y-2.5">
              {splitsActivos.map((s) => (
                <li key={s.id}>
                  <SplitRow
                    split={s}
                    isActive={activeSplitId === s.id}
                    onSelect={() => setActiveSplitId(s.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Anular cobro (admin / encargado) */}
        {(role === "admin" || role === "encargado") && totalPaid > 0 && (
          <AnularCobroSection
            orderId={cuenta.order.id}
            slug={slug}
            onDone={goHome}
            existingInvoice={existingInvoice}
          />
        )}

        {allPaid && (
          <section className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500 text-white">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-900">
                Mesa cobrada
              </p>
              <p className="text-xs text-emerald-700">
                {afipConfigured
                  ? "Emití el comprobante o volvé al salón."
                  : "La mesa se va a marcar para limpiar."}
              </p>
            </div>
            <button
              type="button"
              onClick={goHome}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              Volver al salón
              <ArrowRight className="size-3.5" />
            </button>
          </section>
        )}

        {/* Emitir el comprobante sin salir del cobro (#137). Mismo componente
              que usa el mozo: el encargado pide los mismos datos de la misma
              forma. Sin AFIP configurado no se muestra nada. Se exige
              `orderClosed` (server), no `allPaid`: ver arriba. */}
        {orderClosed && afipConfigured && (
          <FacturacionSection
            orderId={cuenta.order.id}
            totalCents={total}
            slug={slug}
            existingInvoice={existingInvoice}
          />
        )}
      </div>

      {/* ── Columna derecha (página) / debajo (embebido): form de cobro ── */}
      <aside className={cn(!embedded && "lg:sticky lg:top-4 lg:self-start")}>
        {activeSplit && !orderClosed ? (
          <CobrarSplitPanel
            key={activeSplit.id}
            split={activeSplit}
            orderId={cuenta.order.id}
            cajaId={cajaId}
            slug={slug}
            isImplicit={init.hasImplicitSplit}
            methodConfigs={init.methodConfigs}
            clientesParaFiar={clientesParaFiar}
            // El comprobante es de la ORDEN, no del split: vive en el padre
            // para que dividir la cuenta no lo reinicie.
            comprobante={comprobante}
            onComprobanteChange={setComprobante}
            onPaid={({ orderClosed, comprobante: emision }) => {
              if (emision?.outcome === "rechazada") {
                toast.warning(
                  `Mesa cobrada. El comprobante no se emitió: ${
                    emision.error ?? "error desconocido"
                  }. Reintentá desde Facturación.`,
                );
              }
              if (orderClosed) {
                toast.success("Mesa cobrada");
                // Con AFIP configurado NO nos vamos ni recargamos: la
                // sección de facturación se monta recién ahora, y tanto
                // salir como refetchear la haría inalcanzable (la orden
                // cerrada ya no vuelve a este panel). La salida es
                // explícita: el botón "Volver al salón".
                if (!afipConfigured) {
                  goHome();
                  return;
                }
                setClosedLocal(true);
                setActiveSplitId(null);
                return;
              }
              setActiveSplitId(null);
              reloadData();
            }}
            onClear={() => setActiveSplitId(null)}
          />
        ) : (
          <EmptyPanel allPaid={allPaid} />
        )}
      </aside>
    </div>
  );

  // Embebido en el panel del salón: header de panel + cuerpo scrolleable.
  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground text-2xl leading-none font-extrabold tracking-tight">
              {tableLabel}
            </h3>
            <p className="text-muted-foreground mt-1 text-[11px] font-semibold tracking-wider uppercase">
              Cobrar mesa
            </p>
          </div>
          <AyudaChip slug={slug} tema="cobrar" />
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-muted/60 flex-shrink-0 rounded-full p-1.5 text-zinc-500"
            aria-label="Cerrar cobro"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{body}</div>
      </div>
    );
  }

  // Página completa (fallback / deep-link).
  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={tableLabel}
        title="Cobrar mesa"
        description="Registrá pagos por sub-cuenta o cobro completo. Cada confirmación queda asentada en la caja seleccionada."
        size="compact"
        back={{ href: `/${slug}/admin/operacion`, label: "Volver al salón" }}
        action={<AyudaChip slug={slug} tema="cobrar" />}
      />
      {body}
    </PageShell>
  );
}

function implicitSplit(
  orderId: string,
  businessId: string,
  totalCents: number,
  tipCents: number,
): OrderSplit {
  return {
    id: "__implicit__",
    order_id: orderId,
    business_id: businessId,
    split_mode: "por_personas",
    split_index: 0,
    expected_amount_cents: totalCents,
    // Sin división, la sub-cuenta implícita ES la orden: se lleva toda la
    // propina (spec 177 · Parte 0).
    tip_cents: tipCents,
    paid_amount_cents: 0,
    status: "pending",
    label: null,
  };
}

// ── SplitRow ──────────────────────────────────────────────────────────────

function SplitRow({
  split,
  isActive,
  onSelect,
}: {
  split: OrderSplit;
  isActive: boolean;
  onSelect: () => void;
}) {
  const remaining = split.expected_amount_cents - split.paid_amount_cents;
  const done = split.status === "paid" || remaining <= 0;
  const cancelled = split.status === "cancelled";
  const pct =
    split.expected_amount_cents === 0
      ? 0
      : Math.min(
          100,
          (split.paid_amount_cents / split.expected_amount_cents) * 100,
        );

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={done || cancelled}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 transition",
        cancelled
          ? "cursor-not-allowed opacity-50 ring-zinc-200/70"
          : done
            ? "cursor-default bg-emerald-50/40 ring-emerald-200"
            : isActive
              ? "ring-2 ring-zinc-900"
              : "ring-zinc-200/70 hover:ring-zinc-300",
      )}
    >
      <div
        className={cn(
          "flex size-10 flex-shrink-0 items-center justify-center rounded-full",
          done
            ? "bg-emerald-500 text-white"
            : cancelled
              ? "bg-zinc-100 text-zinc-400"
              : "bg-zinc-100 text-zinc-700",
        )}
      >
        {done ? (
          <Check className="size-5" />
        ) : (
          <span className="text-sm font-bold">
            {split.split_index === 0 ? "$" : split.split_index}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900">
          {split.split_index === 0
            ? "Mesa completa"
            : `Sub-cuenta ${split.split_index}`}
          <span className="ml-1 text-xs font-normal text-zinc-500 tabular-nums">
            · {formatCurrency(split.expected_amount_cents)}
          </span>
        </p>
        {!done && !cancelled && split.paid_amount_cents > 0 && (
          <>
            <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
              Pagado {formatCurrency(split.paid_amount_cents)} · falta{" "}
              <span className="font-semibold text-zinc-900">
                {formatCurrency(remaining)}
              </span>
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
        {done && (
          <p className="mt-0.5 text-xs font-medium text-emerald-700">Cobrado</p>
        )}
        {cancelled && <p className="mt-0.5 text-xs text-zinc-500">Cancelado</p>}
      </div>
      {!done && !cancelled && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold",
            isActive ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700",
          )}
        >
          {isActive ? "Cobrando" : "Cobrar"}
        </span>
      )}
    </button>
  );
}

// ── Panel de cobro (lado derecho) ─────────────────────────────────────────

function CobrarSplitPanel({
  split,
  orderId,
  cajaId,
  slug,
  isImplicit,
  methodConfigs,
  clientesParaFiar,
  comprobante,
  onComprobanteChange,
  onPaid,
  onClear,
}: {
  split: OrderSplit;
  orderId: string;
  cajaId: string;
  slug: string;
  isImplicit: boolean;
  methodConfigs: PaymentMethodConfig[];
  /** spec 141 — con quién se puede fiar; vacío ⇒ el método no se ofrece. */
  clientesParaFiar: {
    id: string;
    name: string | null;
    phone: string;
    saldo_cents: number;
  }[];
  /** spec 156 · D1 — el comprobante se elige ANTES de cobrar, acá mismo. */
  comprobante: ComprobanteState;
  onComprobanteChange: (next: ComprobanteState) => void;
  onPaid: (result: {
    orderClosed: boolean;
    comprobante?: CobroData["comprobante"];
  }) => void;
  onClear: () => void;
}) {
  const remaining = split.expected_amount_cents - split.paid_amount_cents;

  return (
    <Surface padding="compact" className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
            {split.split_index === 0
              ? "Pago único"
              : `Sub-cuenta ${split.split_index}`}
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {formatCurrency(remaining)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-900"
        >
          Cerrar
        </button>
      </header>

      {/* spec 156 · D1 — colapsado en Factura B por defecto: es el 95 % de los
          cobros y no puede costar un tap de más en el camino caliente (D2). */}
      <div className="border-t border-zinc-100 pt-3">
        <ComprobanteFields
          slug={slug}
          value={comprobante}
          onChange={onComprobanteChange}
        />
      </div>

      <CobroForm<CobroData>
        amountDueCents={remaining}
        cajas={[]}
        cajaId={cajaId}
        methodConfigs={methodConfigs}
        // spec 098 — la propina viene de la cuenta, no se re-tipea acá.
        // Arrancaba `editable` en 0, así que cobrar la misma mesa desde el
        // desktop del encargado guardaba `tip_cents = 0` aunque el cliente
        // hubiera pagado propina: **la propina del mozo dependía de quién
        // apretaba el botón**.
        //
        // spec 177 · Parte 0 — y es la propina de ESTA sub-cuenta, no la de la
        // orden: pasando la de la orden, una cuenta dividida en 3 registraba
        // la propina 3 veces.
        tip={{ mode: "fixed", cents: split.tip_cents }}
        cuentaCorriente={
          clientesParaFiar.length > 0
            ? { slug, clientes: clientesParaFiar }
            : undefined
        }
        onSubmit={(input) => {
          // Tildó Factura A sin CUIT completo: se frena acá. Emitir una B que no
          // se pidió obliga después a una nota de crédito, que es un
          // comprobante fiscal real y no un undo.
          if (!comprobanteEsValido(comprobante)) {
            return Promise.resolve(
              actionError(
                "Para la Factura A falta el CUIT del receptor (11 dígitos).",
              ),
            );
          }
          return registrarPago({
            comprobante: comprobanteToInvoiceInput(comprobante),
            orderId,
            splitId: isImplicit ? null : split.id,
            method: input.method,
            amount_cents: input.amountCents,
            tip_cents: input.tipCents,
            caja_id: input.cajaId,
            last_four: input.lastFour,
            card_brand: input.cardBrand,
            notes: input.notes,
            adjustment_percent: input.adjustmentPercent,
            adjustment_cents: input.adjustmentCents,
            slug,
            requestId: input.requestId,
          });
        }}
        onPaid={(data) =>
          onPaid({
            orderClosed: data.orderClosed,
            comprobante: data.comprobante,
          })
        }
        mp={{
          start: (input) =>
            iniciarPagoMp({
              orderId,
              splitId: isImplicit ? null : split.id,
              method: input.method,
              amount_cents: input.amountCents,
              tip_cents: input.tipCents,
              caja_id: input.cajaId,
              slug,
              // issue #274 · 3 — la Factura A elegida viaja también por el ramal
              // de MP. Sin esto la elección moría en el navegador: el cobro se
              // completa fuera de la pantalla y el webhook, que es quien cierra
              // la orden, caía en la B automática.
              comprobante: comprobanteEsValido(comprobante)
                ? comprobanteToInvoiceInput(comprobante)
                : null,
            }).then((r) =>
              r.ok
                ? {
                    ok: true as const,
                    data: {
                      paymentId: r.data.paymentId,
                      initPoint: r.data.initPoint,
                    },
                  }
                : r,
            ),
          // El webhook de MP cierra la orden si correspondía; no tenemos la flag
          // acá, así que dejamos que el refresh del parent lo resuelva.
          onConfirmed: () => onPaid({ orderClosed: false }),
        }}
      />
    </Surface>
  );
}

function EmptyPanel({ allPaid }: { allPaid: boolean }) {
  return (
    <Surface
      padding="compact"
      className="flex h-full flex-col items-center justify-center gap-2 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        {allPaid ? (
          <CheckCircle2 className="size-5" />
        ) : (
          <Banknote className="size-5" />
        )}
      </div>
      <p className="text-sm font-semibold text-zinc-900">
        {allPaid ? "Mesa cobrada" : "Elegí una sub-cuenta"}
      </p>
      <p className="max-w-xs text-xs text-zinc-500">
        {allPaid
          ? "Todos los pagos quedaron registrados. Podés volver al salón."
          : "Tocá una fila a la izquierda para registrar el pago."}
      </p>
    </Surface>
  );
}

function AnularCobroSection({
  orderId,
  slug,
  onDone,
  existingInvoice = null,
}: {
  orderId: string;
  slug: string;
  onDone: () => void;
  /** Comprobante vigente de la cuenta: con uno arriba, primero va la NC. */
  existingInvoice?: Invoice | null;
}) {
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  // spec 100 — la guarda de verdad está en el server (`anularCobro` corta si
  // hay factura autorizada). Acá se adelanta el motivo para que el encargado
  // no llegue a escribir el motivo y se coma el rechazo recién al confirmar.
  const facturada =
    existingInvoice?.status === "authorized" &&
    (existingInvoice.tipo_comprobante === "factura_a" ||
      existingInvoice.tipo_comprobante === "factura_b")
      ? existingInvoice
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 @xl:w-auto"
      >
        <Trash2 className="size-3.5" />
        Anular cobro
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular cobro</DialogTitle>
          </DialogHeader>
          {facturada ? (
            <p className="-mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
              Esta cuenta tiene la{" "}
              <strong>
                {tipoLabel(facturada.tipo_comprobante)}{" "}
                {formatInvoiceNumber(facturada.punto_venta, facturada.numero)}
              </strong>{" "}
              autorizada. Anulá el comprobante desde Facturación —se emite la
              nota de crédito— y después volvé a anular el cobro.
            </p>
          ) : (
            <p className="-mt-2 text-sm text-zinc-600">
              Los pagos cobrados se marcan como reembolsados (auditoría) y la
              mesa vuelve al plano como estaba, con todos sus ítems.
            </p>
          )}
          <div className="grid gap-1.5">
            <Label>
              Motivo<span className="ml-1 text-rose-600">*</span>
            </Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              disabled={facturada != null}
              placeholder="Ej: cliente reclamó, pago doble, error de carga…"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={motivo.trim() === "" || facturada != null}
              onClick={() =>
                startTransition(async () => {
                  const r = await anularCobro(orderId, motivo, slug);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Cobro anulado");
                    setOpen(false);
                    onDone();
                  }
                })
              }
            >
              Anular cobro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
