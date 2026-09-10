"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ComprobanteFields,
  comprobanteEsValido,
  comprobanteInicial,
  comprobanteToInvoiceInput,
  type ComprobanteState,
} from "@/components/billing/comprobante-fields";
import { CobroForm } from "@/components/billing/cobro-form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { AdminOrder } from "@/lib/admin/orders-query";
import { actionError } from "@/lib/actions";
import {
  iniciarCobro,
  registrarPago,
  type IniciarCobroResult,
} from "@/lib/billing/cobro-actions";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
import { formatCurrency } from "@/lib/currency";

/** Lo que devuelve un cobro OK — incluye el desenlace del comprobante (spec 156). */
type CobroData = Extract<
  Awaited<ReturnType<typeof registrarPago>>,
  { ok: true }
>["data"];

/**
 * Cobrar / facturar un pedido para llevar o delivery **sin mesa**, desde el
 * board (spec 054).
 *
 * Ya no tiene formulario propio: monta el `CobroForm` compartido (spec 062).
 * Ese cambio es el que trae lo que acá faltaba — **el recargo/descuento por
 * método**, que hacía que el mismo negocio cobrara la misma tarjeta a distinto
 * precio en la mesa y en el pedido —, más pago mixto, propina, MP y la guarda
 * de efectivo.
 *
 * Lo que queda propio de este caller: de dónde sale lo que hay que cobrar
 * (`iniciarCobro` sobre una orden sin `table_id`), qué action registra el pago
 * y cuándo se emite el comprobante.
 *
 * **Sin MP link/QR** (spec 126). Sin el prop `mp`, el `CobroForm` no ofrece esos
 * métodos, y acá es lo correcto: generar una preference nueva no cobra nada —
 * deja el pedido abierto esperando que alguien pague *ese* link, y un pago
 * `pending` colgado para siempre. El cliente que paga con MP lo hace en el
 * checkout; el que ya pagó por un link mandado a mano se asienta por el método
 * que corresponda. Generar link con el cliente delante sigue estando en la mesa.
 */
export function CobrarPedidoSheet({
  order,
  slug,
  open,
  onClose,
  onDone,
}: {
  order: AdminOrder;
  slug: string;
  open: boolean;
  onClose: () => void;
  /** Corre tras cobrar con éxito (ej: cerrar el detalle del pedido). */
  onDone?: () => void;
}) {
  const [init, setInit] = useState<IniciarCobroResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cajaId, setCajaId] = useCajaPreferida(slug, init?.cajas ?? []);
  const [comprobante, setComprobante] =
    useState<ComprobanteState>(comprobanteInicial());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    iniciarCobro(order.id, slug).then((r) => {
      if (r.ok) {
        // La caja la resuelve `useCajaPreferida` cuando llega la lista.
        setInit(r.data);
      } else {
        setLoadError(r.error);
      }
      setLoading(false);
    });
  }, [open, order.id, slug]);

  // Lo que falta cobrar. Un pedido normalmente no tiene splits, pero si tuviera
  // un pago parcial el saldo es el que manda — no el total.
  const amountDueCents = init
    ? Math.max(0, init.order.total_cents - init.order.total_paid_cents)
    : order.total_cents;

  /** El comprobante lo emite el cobro (spec 156 · D1), así que acá sólo se
   *  traduce el desenlace: si no salió, el pago igual quedó registrado y se
   *  reintenta desde Facturación. La plata nunca depende de ARCA. */
  function avisarComprobante(data: CobroData) {
    if (data.comprobante?.outcome !== "rechazada") return;
    toast.warning(
      `Pago registrado. El comprobante no se emitió: ${
        data.comprobante.error ?? "error desconocido"
      }. Reintentá desde Facturación.`,
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetTitle className="border-border/60 border-b px-5 py-4 text-lg font-bold">
          Cobrar pedido #{order.daily_number}
        </SheetTitle>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
              {loadError}
            </div>
          ) : init ? (
            <div className="space-y-5">
              <div className="bg-muted/50 flex items-baseline justify-between rounded-xl px-4 py-3">
                <span className="text-muted-foreground text-sm font-medium">
                  Total a cobrar
                </span>
                <span className="text-2xl font-extrabold tabular-nums">
                  {formatCurrency(amountDueCents)}
                </span>
              </div>

              {/* spec 156 · D1 · 157 · D3 — el comprobante se elige ANTES de
                  cobrar, y en el mismo lugar que en la mesa y en el mostrador:
                  arriba del cobro. Estaba abajo, así que la única de las tres
                  pantallas que lo pedía después era ésta. */}
              <div className="border-border/60 border-t pt-4">
                <ComprobanteFields
                  slug={slug}
                  value={comprobante}
                  onChange={setComprobante}
                />
              </div>

              <CobroForm<CobroData>
                amountDueCents={amountDueCents}
                cajas={init.cajas}
                cajaId={cajaId}
                onCajaChange={setCajaId}
                methodConfigs={init.methodConfigs}
                // spec 098 — la propina sale de la cuenta, no se tipea al
                // cobrar. En `editable` el monto quedaba en el saldo y la
                // propina se sumaba **por encima**, así que el pago guardaba
                // `amount` sin la plata que de verdad entró: el cadete volvía
                // con $11.000, la caja esperaba $10.000 y el arqueo cerraba con
                // sobrante todos los días.
                tip={{ mode: "fixed", cents: init.order.tip_cents ?? 0 }}
                onSubmit={(input) => {
                  // Tildó Factura A y el CUIT no está completo: se frena ACÁ, no
                  // después de cobrar. Con la elección antes del cobro (spec
                  // 156) las dos salidas malas serían emitir una B que no se
                  // pidió, o no emitir nada — y las dos se arreglan con dos
                  // taps: completar el CUIT o destildar la A.
                  if (!comprobanteEsValido(comprobante)) {
                    return Promise.resolve(
                      actionError(
                        "Para la Factura A falta el CUIT del receptor (11 dígitos).",
                      ),
                    );
                  }
                  return registrarPago({
                    // spec 156 · D1 — lo elegido viaja CON el cobro. Antes se
                    // emitía después, y la B automática ya había salido.
                    comprobante: comprobanteToInvoiceInput(comprobante),
                    orderId: order.id,
                    splitId: null,
                    method: input.method,
                    amount_cents: input.amountCents,
                    tip_cents: input.tipCents,
                    // spec 177 · Parte A — sin esto el server acota el excedente
                    // con el default del método y «se lo dejan de propina» no hace
                    // nada: la propina se pierde y la caja registra sólo la cuenta.
                    destino_excedente: input.destinoExcedente,
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
                onPaid={(data) => {
                  toast.success(`Pedido #${order.daily_number} cobrado.`);
                  avisarComprobante(data);
                  onDone?.();
                  onClose();
                }}
              />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
