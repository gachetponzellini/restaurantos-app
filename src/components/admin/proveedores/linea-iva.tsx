import { formatCurrency } from "@/lib/currency";
import { aFinalCents, ivaDeCents, TASA_POR_DEFECTO, type PriceBase } from "@/lib/proveedores/iva";

/**
 * El IVA de un renglón, en pesos — spec 188.
 *
 * *«¿El sistema discrimina los artículos y le pone iva a cada uno para dejarlos
 * con el precio final?»* — Rocío, 2026-09-15. Esto es ese cartel, y vive en un
 * componente solo porque aparece en **tres pantallas** que no se hablan entre
 * ellas: la revisión de la lectura, el editor manual de renglones y el
 * comprobante ya cargado en la cuenta corriente. Tres copias del mismo cálculo
 * se desincronizan solas, y acá lo que se desincroniza es un número de plata.
 *
 * **No aparece cuando el precio ya es final** (ticket, factura B o C, compra sin
 * comprobante): ahí no hay IVA discriminado que mostrar, y escribir «+ 0% de
 * IVA» sobre un ticket sería inventar un crédito fiscal que no existe. Devolver
 * `null` es la respuesta correcta, no una omisión.
 *
 * Y termina siempre en la misma aclaración: **al costo va el neto**. El número
 * grande de la fila es el que se propaga a las recetas, y es el chico de los dos
 * (188·D1).
 */
export function LineaIva({
  netoCents,
  tasa,
  base,
  prefijo,
  className,
}: {
  /** El importe SIN IVA: el precio por unidad base, por envase, o el de la línea. */
  netoCents: number | null;
  tasa: number | null;
  base: PriceBase;
  /** Qué es ese importe: «El kg», «Por envase», «La línea». */
  prefijo: string;
  className?: string;
}) {
  if (base !== "neto" || !netoCents) return null;

  const t = tasa ?? TASA_POR_DEFECTO;
  const iva = ivaDeCents(netoCents, t, "neto");
  const final = aFinalCents(netoCents, t, "neto");

  return (
    <p className={className ?? "text-[11px] text-zinc-500 tabular-nums"}>
      {prefijo}: {formatCurrency(netoCents)} + {formatCurrency(iva)} de IVA (
      {t.toLocaleString("es-AR")}%) ={" "}
      <span className="font-medium text-zinc-700">{formatCurrency(final)}</span> final ·
      al costo va el neto
    </p>
  );
}
