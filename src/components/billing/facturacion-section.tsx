"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  CONDICION_IVA_LABEL,
  condicionesValidasPara,
} from "@/lib/afip/condicion-iva";
import { formatCuit } from "@/lib/afip/cuit";
import { emitInvoice, retryInvoice } from "@/lib/afip/emit-invoice";
import { waitForInvoiceTerminal } from "@/lib/afip/poll";
import type {
  CondicionIvaReceptor,
  Invoice,
  TipoComprobante,
} from "@/lib/afip/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { FiscalEntitySearchField } from "./fiscal-entity-search-field";
import {
  CambiarAFacturaA,
  sePuedeCambiarAFacturaA,
} from "./cambiar-a-factura-a";

// ============================================================================
// Facturación AFIP post-cobro (spec 06 · 053), compartida.
//
// Vivía dentro del cobro del mozo. Se extrajo para que el cobro de mesa del
// ENCARGADO (admin/mesa/[id]/cobrar) pida el comprobante igual que el mozo:
// era el único de los cuatro puntos de cobro que no facturaba (#137), y el
// encargado no tiene acceso a la sección Facturación (`sections.ts`), así que
// para él no había NINGUNA pantalla desde donde emitir.
//
// Es sólo la UI + el ciclo emitir/pollear/reintentar: quién la monta y cuándo
// lo decide el caller, porque el momento de facturar difiere en cada flujo.
// ============================================================================

/** Etiqueta por tipo. `getInvoiceForOrder` devuelve el comprobante autorizado
 *  de la orden sin filtrar tipo, así que puede ser una nota de crédito (una
 *  factura anulada deja su NC `authorized`): mostrarla como "Factura B" le
 *  diría al encargado que la mesa tiene factura cuando la tiene anulada. */
const TIPO_LABEL: Record<TipoComprobante, string> = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  nota_credito_a: "Nota de crédito A",
  nota_credito_b: "Nota de crédito B",
};

export function FacturacionSection({
  orderId,
  totalCents,
  slug,
  existingInvoice,
}: {
  orderId: string;
  totalCents: number;
  slug: string;
  existingInvoice: Invoice | null;
}) {
  const [, startTransition] = useTransition();
  const [invoice, setInvoice] = useState<Invoice | null>(existingInvoice);
  const [tipoA, setTipoA] = useState(false);
  const [cuit, setCuit] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  // Condición de IVA del receptor (spec 053). Solo se envía cuando hay CUIT.
  const [condicionIva, setCondicionIva] = useState<CondicionIvaReceptor>(6);
  // Receptor guardado elegido en el buscador (spec 150). Sólo se ofrece en A.
  const [fiscalEntityId, setFiscalEntityId] = useState<string | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipo: TipoComprobante = tipoA ? "factura_a" : "factura_b";
  const cuitDigits = cuit.replace(/\D/g, "");
  const hasCuit = cuitDigits.length >= 11;
  // Los datos del receptor (CUIT, razón, condición) se piden en A siempre y en B
  // solo si el operador carga un CUIT (Factura B a un identificado).
  const showReceptor = tipoA || hasCuit;

  const handleEmit = () => {
    if (tipoA && !hasCuit) {
      toast.error("El CUIT debe tener 11 dígitos.");
      return;
    }
    // B con CUIT a medio cargar: exigir 11 dígitos o vaciarlo.
    if (!tipoA && cuitDigits.length > 0 && !hasCuit) {
      toast.error("El CUIT debe tener 11 dígitos (o dejalo vacío para consumidor final).");
      return;
    }
    setEmitting(true);
    setError(null);
    startTransition(async () => {
      const r = await emitInvoice({
        orderId,
        tipoComprobante: tipo,
        cuitReceptor: hasCuit ? cuitDigits : undefined,
        razonSocialReceptor: showReceptor && razonSocial ? razonSocial : undefined,
        condicionIvaReceptor: hasCuit ? condicionIva : undefined,
        fiscalEntityId: fiscalEntityId ?? undefined,
        slug,
      });
      if (!r.ok) {
        setEmitting(false);
        setError(r.error);
        toast.error(r.error);
        return;
      }
      await resolveInvoice(r.data.invoice);
    });
  };

  const handleRetry = (invoiceId: string) => {
    setEmitting(true);
    setError(null);
    startTransition(async () => {
      const r = await retryInvoice(invoiceId, slug);
      if (!r.ok) {
        setEmitting(false);
        setError(r.error);
        toast.error(r.error);
        return;
      }
      await resolveInvoice(r.data.invoice);
    });
  };

  // El gateway es asíncrono: `emit`/`retry` devuelven la factura `pending` y acá
  // la polleamos hasta el CAE (o el rechazo). El sandbox ya viene `authorized`.
  //
  // El polling es CORTESÍA, no el contrato (spec 088): si el CAE sale en
  // segundos el operador lo ve sin moverse, pero puede irse cuando quiera —
  // el cron de reconciliación cierra la factura igual. Antes esto era la única
  // forma de que una `pending` llegara a terminal, y encima cortaba a los 120s,
  // así que ni quedándose se garantizaba ver el desenlace.
  const resolveInvoice = async (initial: Invoice) => {
    setInvoice(initial);
    if (initial.status !== "pending") {
      setEmitting(false);
      if (initial.status === "authorized") toast.success("Factura emitida");
      return;
    }
    // La emisión ya quedó registrada: liberamos la UI acá, no cuando ARCA
    // conteste. La caja no se traba esperando al gateway.
    setEmitting(false);
    const terminal = await waitForInvoiceTerminal(initial.id, slug, {
      onUpdate: setInvoice,
    });
    if (!terminal || terminal.status === "pending") {
      toast.message(
        "ARCA la está procesando. Podés seguir: el comprobante queda en Facturación.",
      );
    } else if (terminal.status === "authorized") {
      toast.success("Factura emitida");
    } else {
      setError(terminal.error_message ?? "No se pudo emitir el comprobante");
      toast.error(terminal.error_message ?? "No se pudo emitir el comprobante");
    }
  };

  // Emisión en curso — el gateway está resolviendo el CAE (polling).
  if (invoice && invoice.status === "pending") {
    return (
      <section className="rounded-2xl bg-card p-4 ring-1 ring-amber-200">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Emitiendo comprobante…
            </p>
            <p className="text-xs text-muted-foreground">
              ARCA la está procesando. Podés cerrar: queda en Facturación.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Ya facturada OK
  if (invoice && invoice.status === "authorized") {
    return (
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border/70">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {TIPO_LABEL[invoice.tipo_comprobante] ?? "Comprobante"}{" "}
              <span className="font-normal text-muted-foreground">
                #{String(invoice.punto_venta).padStart(4, "0")}-
                {String(invoice.numero).padStart(8, "0")}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              CAE: {invoice.cae} · {formatCurrency(invoice.total_cents)}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-800">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Emitida
          </span>
        </div>
        {invoice.pdf_url && (
          <a
            href={invoice.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/70 transition hover:text-foreground"
          >
            <FileText className="size-3" /> Ver PDF
          </a>
        )}

        {/* spec 156 · D5 — acá es donde el operador se entera: el cliente pide
            la A mirando el ticket que le acaba de dar. Antes tenía que ir a
            Facturación, anular a mano y quedarse sin dónde emitir la A. */}
        {sePuedeCambiarAFacturaA(invoice) && (
          <div className="mt-3">
            <CambiarAFacturaA
              invoice={invoice}
              slug={slug}
              onChanged={(facturaA) => facturaA && setInvoice(facturaA)}
            />
          </div>
        )}
      </section>
    );
  }

  // Factura fallida — retry
  if (invoice && invoice.status === "failed") {
    return (
      <section className="rounded-2xl bg-card p-4 ring-1 ring-rose-200">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Factura no emitida
            </p>
            <p className="text-xs text-rose-600">
              {invoice.error_message ?? "Error al emitir el comprobante"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={emitting}
            onClick={() => handleRetry(invoice.id)}
          >
            {emitting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RotateCcw className="size-3" />
            )}
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  // Sin factura — formulario de emisión
  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-border/70 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground/80">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Emitir comprobante
          </p>
          <p className="text-xs text-muted-foreground">
            Opcional — {formatCurrency(totalCents)}
          </p>
        </div>
      </div>

      {/* Toggle A/B */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setTipoA(false);
            setCondicionIva(6); // B con CUIT: Monotributo por defecto
            setFiscalEntityId(null);
          }}
          className={cn(
            "flex-1 rounded-xl px-3 py-2.5 text-center text-xs font-semibold transition ring-1",
            !tipoA
              ? "bg-primary text-white ring-primary"
              : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
          )}
        >
          Factura B
          <span className="block text-[0.6rem] font-normal opacity-70">
            Consumidor final / Monotributo
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTipoA(true);
            setCondicionIva(1); // A: Responsable Inscripto por defecto
          }}
          className={cn(
            "flex-1 rounded-xl px-3 py-2.5 text-center text-xs font-semibold transition ring-1",
            tipoA
              ? "bg-primary text-white ring-primary"
              : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
          )}
        >
          Factura A
          <span className="block text-[0.6rem] font-normal opacity-70">
            Con CUIT
          </span>
        </button>
      </div>

      {/* Datos del receptor: CUIT (obligatorio en A, opcional en B) + razón +
          condición de IVA (spec 053). El CUIT en B habilita facturar B a un
          identificado (Monotributo/Exento) declarando su condición real. */}
      <div className="space-y-2.5">
        {tipoA && (
          <FiscalEntitySearchField
            slug={slug}
            cuit={cuit}
            razonSocial={razonSocial}
            condicionIva={condicionIva}
            entidadId={fiscalEntityId}
            onSelect={(entidad) => {
              setCuit(formatCuit(entidad.cuit));
              setRazonSocial(entidad.razon_social);
              setCondicionIva(entidad.condicion_iva);
              setFiscalEntityId(entidad.id);
            }}
          />
        )}

        <div className="grid gap-1">
          <Label className="text-xs text-foreground/70">
            CUIT del cliente{" "}
            {tipoA ? (
              <span className="text-rose-600">*</span>
            ) : (
              <span className="text-muted-foreground/70">(opcional)</span>
            )}
          </Label>
          <Input
            value={cuit}
            onChange={(e) => {
              setCuit(e.target.value.replace(/[^\d\-]/g, ""));
              // Otro CUIT es otro receptor: el vínculo con la entidad elegida
              // deja de valer. La razón social sí se corrige sobre la misma
              // entidad (D3) y no la desvincula.
              setFiscalEntityId(null);
            }}
            placeholder="20-12345678-9"
            maxLength={13}
            inputMode="numeric"
          />
        </div>

        {showReceptor && (
          <>
            <div className="grid gap-1">
              <Label className="text-xs text-foreground/70">Razón social</Label>
              <Input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Nombre de la empresa"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-foreground/70">
                Condición de IVA <span className="text-rose-600">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {condicionesValidasPara(tipo).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCondicionIva(value)}
                    className={cn(
                      "rounded-xl px-3 py-2 text-center text-xs font-semibold transition ring-1",
                      condicionIva === value
                        ? "bg-primary text-white ring-primary"
                        : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
                    )}
                  >
                    {CONDICION_IVA_LABEL[value]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}

      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={emitting}
        onClick={handleEmit}
      >
        {emitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Emitiendo…
          </>
        ) : (
          <>
            <FileText className="size-4" />
            Emitir {tipoA ? "Factura A" : "Factura B"}
          </>
        )}
      </Button>
    </section>
  );
}
