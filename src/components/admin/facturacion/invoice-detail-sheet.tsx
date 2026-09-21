"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Ban,
  Copy,
  ExternalLink,
  FileText,
  Printer,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { imprimirFactura } from "@/lib/print/factura-print-actions";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { anularFactura, emitInvoice, retryInvoice } from "@/lib/afip/emit-invoice";
import {
  CambiarAFacturaA,
  sePuedeCambiarAFacturaA,
} from "@/components/billing/cambiar-a-factura-a";
import { classifyProviderError } from "@/lib/afip/error-classification";
import { waitForInvoiceTerminal } from "@/lib/afip/poll";
import {
  formatInvoiceNumber,
  INVOICE_STATUS_META,
  tipoLabel,
} from "@/lib/afip/format";
import type { Invoice } from "@/lib/afip/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { TZ_AR } from "@/lib/timezone";

type Props = {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  onRetried?: () => void;
};

export function InvoiceDetailSheet({
  invoice,
  open,
  onOpenChange,
  slug,
  onRetried,
}: Props) {
  const [retrying, startRetry] = useTransition();
  const [anulando, startAnular] = useTransition();
  const [refacturando, startRefacturar] = useTransition();
  const [showRaw, setShowRaw] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [imprimiendo, startImprimir] = useTransition();

  // Imprimir el comprobante (spec 084). El action resuelve la comandera fiscal
  // de la caja del pago ANTES de encolar, así que si esa caja no tiene una, el
  // encargado se entera en el acto y con el nombre de la caja.
  const handleImprimir = () => {
    if (!invoice) return;
    startImprimir(async () => {
      const r = await imprimirFactura(invoice.id, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.data.reprint
          ? "Copia enviada a la comandera fiscal."
          : "Factura enviada a la comandera fiscal.",
      );
    });
  };

  if (!invoice) return null;

  const meta = INVOICE_STATUS_META[invoice.status];
  const dateStr = new Date(invoice.created_at).toLocaleString("es-AR", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleRetry = () => {
    startRetry(async () => {
      const result = await retryInvoice(invoice.id, slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // El gateway es asíncrono: esperamos el desenlace por polling.
      const terminal =
        result.data.invoice.status === "pending"
          ? await waitForInvoiceTerminal(result.data.invoice.id, slug)
          : result.data.invoice;
      if (terminal?.status === "authorized") {
        toast.success("Comprobante reintentado con éxito.");
      } else if (!terminal || terminal.status === "pending") {
        toast.message("El comprobante sigue en proceso en ARCA.");
      } else {
        toast.error(terminal.error_message ?? "El reintento falló.");
      }
      onRetried?.();
    });
  };

  const handleCopyCAE = async () => {
    if (!invoice.cae) return;
    await navigator.clipboard.writeText(invoice.cae);
    toast.success("CAE copiado.");
  };

  const handleAnular = () => {
    const motivoTrim = motivo.trim();
    if (!motivoTrim) {
      toast.error("Ingresá el motivo de la anulación.");
      return;
    }
    startAnular(async () => {
      const result = await anularFactura({
        invoiceId: invoice.id,
        motivo: motivoTrim,
        slug,
      });
      if (result.ok) {
        toast.success("Factura anulada. Se emitió la nota de crédito.");
        setMotivo("");
        onRetried?.();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleRefacturar = () => {
    if (!invoice.order_id) return;
    startRefacturar(async () => {
      // Re-facturar sobre una anulada: preservar la identidad fiscal del
      // comprobante original (tipo, CUIT, razón, condición IVA). Sin esto una
      // Factura A / B-con-CUIT se degradaba a B consumidor final anónima (spec 053).
      const result = await emitInvoice({
        orderId: invoice.order_id!,
        slug,
        tipoComprobante: invoice.tipo_comprobante,
        cuitReceptor: invoice.cuit_receptor ?? undefined,
        razonSocialReceptor: invoice.razon_social_receptor ?? undefined,
        condicionIvaReceptor: invoice.condicion_iva_receptor ?? undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const terminal =
        result.data.invoice.status === "pending"
          ? await waitForInvoiceTerminal(result.data.invoice.id, slug)
          : result.data.invoice;
      if (terminal?.status === "authorized") {
        toast.success("Orden re-facturada.");
      } else if (!terminal || terminal.status === "pending") {
        toast.message("La factura sigue en proceso en ARCA.");
      } else {
        toast.error(terminal.error_message ?? "La re-facturación falló.");
      }
      onRetried?.();
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                meta.bg,
                meta.color,
              )}
            >
              {meta.label}
            </span>
            <span className="text-sm font-medium text-zinc-600">
              {tipoLabel(invoice.tipo_comprobante)}
            </span>
          </div>
          <SheetTitle>
            {formatInvoiceNumber(invoice.punto_venta, invoice.numero)}
          </SheetTitle>
        </SheetHeader>

        <div className="grid gap-5 px-4 pb-6">
          <Row label="Fecha">{dateStr}</Row>

          {(invoice.tipo_comprobante === "factura_a" ||
            invoice.tipo_comprobante === "nota_credito_a") && (
            <>
              {invoice.cuit_receptor && (
                <Row label="CUIT receptor">{invoice.cuit_receptor}</Row>
              )}
              {invoice.razon_social_receptor && (
                <Row label="Razón social">{invoice.razon_social_receptor}</Row>
              )}
            </>
          )}

          <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60">
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Neto</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(invoice.neto_cents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">
                  IVA ({invoice.iva_rate}%)
                </span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(invoice.iva_cents)}
                </span>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-2">
                <span className="font-semibold text-zinc-900">Total</span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {formatCurrency(invoice.total_cents)}
                </span>
              </div>
            </div>
          </div>

          {invoice.cae && (
            <div>
              <Row label="CAE">
                <span className="flex items-center gap-1.5 font-mono text-xs">
                  {invoice.cae}
                  <button
                    onClick={handleCopyCAE}
                    className="text-zinc-400 transition hover:text-zinc-600"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </span>
              </Row>
              {invoice.cae_vencimiento && (
                <Row label="Vto. CAE">
                  {new Date(invoice.cae_vencimiento).toLocaleDateString("es-AR")}
                </Row>
              )}
            </div>
          )}

          {invoice.order_id && (
            <Row label="Pedido">
              <Link
                href={`/${slug}/admin/pedidos/${invoice.order_id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
              >
                Ver pedido
                <ExternalLink className="size-3" />
              </Link>
            </Row>
          )}

          {invoice.pdf_url && (
            <Row label="PDF">
              <a
                href={invoice.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
              >
                Descargar PDF
                <ExternalLink className="size-3" />
              </a>
            </Row>
          )}

          {invoice.status === "failed" &&
            (() => {
              const errorClass = classifyProviderError(invoice.error_message);
              const isFiscal = errorClass === "fiscal";
              return (
                <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-200/60">
                  {invoice.error_message && (
                    <p className="mb-2 text-sm text-rose-700">
                      {invoice.error_message}
                    </p>
                  )}
                  <p className="mb-3 text-xs font-medium text-rose-600">
                    {isFiscal
                      ? "Rechazo de datos de ARCA: revisá CUIT / datos del comprobante antes de reintentar."
                      : "Error temporario de conexión con el provider: podés reintentar tal cual."}
                  </p>
                  <Button
                    onClick={handleRetry}
                    disabled={retrying}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw
                      className={cn("size-3.5", retrying && "animate-spin")}
                    />
                    {retrying ? "Reintentando…" : "Reintentar"}
                  </Button>
                </div>
              );
            })()}

          {/* Spec 084: imprimir el comprobante en la comandera fiscal de la
              caja. Sólo autorizadas — una pending no tiene CAE ni QR. */}
          {invoice.status === "authorized" && (
            <Button
              onClick={handleImprimir}
              disabled={imprimiendo}
              variant="outline"
              size="sm"
              className="justify-self-start"
            >
              <Printer
                className={cn("size-3.5", imprimiendo && "animate-pulse")}
              />
              {imprimiendo ? "Enviando…" : "Imprimir factura"}
            </Button>
          )}

          {/* spec 156 · D5 — el cliente pide la A después, mirando el ticket
              que ya se le dio. Mismo componente que monta el cobro de mesa. */}
          {sePuedeCambiarAFacturaA(invoice) && (
            <CambiarAFacturaA
              invoice={invoice}
              slug={slug}
              onChanged={() => onRetried?.()}
            />
          )}

          {invoice.status === "authorized" && (
            <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60">
              <p className="mb-1 text-sm font-medium text-zinc-900">
                Anular comprobante
              </p>
              <p className="mb-3 text-xs text-zinc-500">
                Se emite la nota de crédito y la factura queda anulada. El motivo
                es obligatorio.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="anular-motivo" className="sr-only">
                  Motivo de anulación
                </Label>
                <Textarea
                  id="anular-motivo"
                  placeholder="Motivo (ej: factura mal hecha al mozo)"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  disabled={anulando}
                  className="min-h-14 bg-white text-sm"
                />
                <Button
                  onClick={handleAnular}
                  disabled={anulando}
                  variant="outline"
                  size="sm"
                  className="justify-self-start text-rose-700 hover:text-rose-800"
                >
                  <Ban
                    className={cn("size-3.5", anulando && "animate-pulse")}
                  />
                  {anulando ? "Anulando…" : "Anular y emitir NC"}
                </Button>
              </div>
            </div>
          )}

          {invoice.status === "cancelled" && (
            <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60">
              {invoice.cancelled_reason && (
                <Row label="Motivo anulación">
                  {invoice.cancelled_reason}
                </Row>
              )}
              {invoice.order_id && (
                <Button
                  onClick={handleRefacturar}
                  disabled={refacturando}
                  variant="outline"
                  size="sm"
                  className="mt-3"
                >
                  <RotateCcw
                    className={cn("size-3.5", refacturando && "animate-spin")}
                  />
                  {refacturando ? "Re-facturando…" : "Re-facturar"}
                </Button>
              )}
            </div>
          )}

          {invoice.provider_response != null && (
            <div>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="text-xs font-medium text-zinc-400 transition hover:text-zinc-600"
              >
                {showRaw ? "Ocultar" : "Ver"} respuesta del proveedor
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-300">
                  {JSON.stringify(invoice.provider_response, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-right text-sm font-medium text-zinc-900">
        {children}
      </span>
    </div>
  );
}
