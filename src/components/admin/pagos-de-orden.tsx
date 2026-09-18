"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

import { SectionLabel } from "@/components/ui/section-label";
import {
  listarPagosDeOrden,
  type PagoDeOrden,
} from "@/lib/billing/pagos-de-orden";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

const METODO: Record<string, string> = {
  cash: "Efectivo",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  mp_manual: "Mercado Pago",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  other: "Otro",
  cuenta_corriente: "Cuenta corriente",
};

/**
 * Cada línea de cobro de la orden — issue #339.
 *
 * Sin esto, una cuenta con un pago cargado dos veces o una línea anulada se
 * veía igual que cualquier otra: un total y un chip. Las anuladas se muestran
 * tachadas con su motivo, que es justo lo que hay que mirar cuando la cuenta
 * quedó con saldo.
 *
 * Sólo encargado / admin: la action rechaza al resto y la sección no aparece.
 */
export function PagosDeOrden({
  slug,
  orderId,
  timezone,
  /** Cambia cuando hay que volver a pedir (después de cobrar). */
  version = 0,
}: {
  slug: string;
  orderId: string;
  timezone: string;
  version?: number;
}) {
  const [pagos, setPagos] = useState<PagoDeOrden[] | null>(null);

  useEffect(() => {
    let vigente = true;
    listarPagosDeOrden(slug, orderId).then((r) => {
      if (vigente) setPagos(r.ok ? r.data : null);
    });
    return () => {
      vigente = false;
    };
  }, [slug, orderId, version]);

  if (!pagos || pagos.length === 0) return null;

  return (
    <section className="border-border/60 border-t px-5 py-4">
      <SectionLabel>Pagos</SectionLabel>
      <ul className="mt-3 flex flex-col gap-2.5">
        {pagos.map((p) => (
          <li key={p.id} className="text-sm">
            <div className="flex items-baseline gap-2.5">
              <span className="text-muted-foreground w-11 shrink-0 text-xs tabular-nums">
                {formatInTimeZone(p.created_at, timezone, "HH:mm")}
              </span>
              <span
                className={cn(
                  "text-foreground flex-1 font-medium",
                  p.anulado && "text-muted-foreground line-through",
                )}
              >
                {METODO[p.method] ?? p.method}
                {p.tip_cents > 0 && (
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    propina {formatCurrency(p.tip_cents)}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  p.anulado && "text-muted-foreground line-through",
                )}
              >
                {formatCurrency(p.amount_cents)}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 pl-[3.375rem] text-xs">
              {[p.caja, p.operado_por && `cobró ${p.operado_por}`, p.mozo && `mozo ${p.mozo}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {p.anulado && (
              <p className="mt-0.5 pl-[3.375rem] text-xs font-medium text-rose-700">
                Anulado{p.refunded_reason ? ` — ${p.refunded_reason}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
