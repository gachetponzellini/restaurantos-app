"use client";

import { useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cambiarTipoDeComprobante } from "@/lib/afip/emit-invoice";
import type { Invoice } from "@/lib/afip/types";

import {
  ComprobanteFields,
  comprobanteEsValido,
  comprobanteInicial,
  type ComprobanteState,
} from "./comprobante-fields";

// ============================================================================
// «El cliente pide la A después» (spec 156 · D5).
//
// Con la elección antes de cobrar (D1) el caso «la eligió y salió otra cosa»
// desaparece. Éste no: nadie puede adivinar que el comensal iba a pedir factura
// al irse, mirando el ticket que ya se le dio.
//
// Antes esto era un instructivo adentro de un mensaje de error —«anulala antes
// de emitir otro tipo de comprobante»— y un viaje de cinco pantallas que
// terminaba sin salida, porque la orden ya está cerrada y el cobro no vuelve.
//
// Se monta en los dos lugares donde el operador se entera: el detalle del
// comprobante en Facturación y el cobro de mesa recién cerrado.
// ============================================================================

/** ¿Este comprobante se puede cambiar por una Factura A? */
export function sePuedeCambiarAFacturaA(invoice: Invoice | null): boolean {
  return (
    invoice?.status === "authorized" &&
    invoice.tipo_comprobante === "factura_b" &&
    Boolean(invoice.order_id)
  );
}

export function CambiarAFacturaA({
  invoice,
  slug,
  onChanged,
}: {
  invoice: Invoice;
  slug: string;
  /**
   * La orden quedó con tres comprobantes (B anulada, NC, A). Recibe la Factura
   * A cuando salió bien; sin argumento cuando falló, para que el caller igual
   * refresque — la B pudo quedar anulada.
   */
  onChanged: (facturaA?: Invoice) => void;
}) {
  const [pending, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  // Arranca en A porque es el único cambio que existe: nadie baja una A a B.
  const [comprobante, setComprobante] = useState<ComprobanteState>({
    ...comprobanteInicial(),
    tipo: "factura_a",
  });

  const cambiar = () => {
    if (!comprobanteEsValido(comprobante)) {
      toast.error("El CUIT del receptor debe tener 11 dígitos.");
      return;
    }
    start(async () => {
      const r = await cambiarTipoDeComprobante({
        invoiceId: invoice.id,
        slug,
        cuitReceptor: comprobante.cuit,
        razonSocialReceptor: comprobante.razonSocial.trim() || undefined,
        condicionIvaReceptor: comprobante.condicionIva,
        fiscalEntityId: comprobante.fiscalEntityId ?? undefined,
      });
      if (!r.ok) {
        // Dos errores muy distintos y el mensaje del server los distingue: «no
        // se anuló» (todo intacto, se reintenta) y «se anuló pero la A falló»
        // (la nota de crédito ya tiene CAE y no se deshace).
        toast.error(r.error);
        onChanged();
        return;
      }
      toast.success("Factura A emitida. La B quedó anulada con su nota de crédito.");
      setAbierto(false);
      onChanged(r.data.facturaA);
    });
  };

  return (
    <div className="rounded-xl bg-muted/50 p-4 ring-1 ring-border/60">
      <p className="mb-1 text-sm font-medium text-foreground">
        Cambiar a Factura A
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Se anula esta Factura B con su nota de crédito y se emite la Factura A al
        CUIT que indiques. Los tres comprobantes quedan registrados.
      </p>

      {abierto ? (
        <div className="grid gap-3">
          <ComprobanteFields
            slug={slug}
            value={comprobante}
            onChange={setComprobante}
          />
          <div className="flex gap-2">
            <Button onClick={cambiar} disabled={pending} size="sm">
              {pending ? "Cambiando…" : "Anular y emitir Factura A"}
            </Button>
            <Button
              onClick={() => setAbierto(false)}
              disabled={pending}
              variant="ghost"
              size="sm"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setAbierto(true)}
          variant="outline"
          size="sm"
          className="justify-self-start"
        >
          <FileText className="size-3.5" />
          Cambiar a Factura A
        </Button>
      )}
    </div>
  );
}
