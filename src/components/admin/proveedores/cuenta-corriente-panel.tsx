"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Pencil } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  etiquetaMetodo,
  etiquetaTipo,
  filtrarPorPeriodo,
  pagosDeComprobante,
  totalesDelPeriodo,
  type ComprobanteConSaldo,
  type DocumentType,
  type ImputacionPago,
  type PagoProveedor,
} from "@/lib/proveedores/cuenta-corriente";
import { hoyAR, primerDiaDelMesAR } from "@/lib/proveedores/fechas-ar";
import type { SupplierInvoiceItem } from "@/lib/proveedores/types";
import { EditarComprobanteDialog } from "./editar-comprobante-dialog";
import type { ConceptOption } from "./invoice-dialog";
import { LineaIva } from "./linea-iva";

type Props = {
  /** El saldo TOTAL del proveedor: no depende del período que se mire (D3). */
  saldoCents: number;
  compras: ComprobanteConSaldo[];
  pagos: PagoProveedor[];
  imputaciones: ImputacionPago[];
  /** id del comprobante → URL firmada de su foto (1h). */
  fotos?: Record<string, string | null>;
  /**
   * id del comprobante → sus renglones por insumo — spec 172.
   *
   * La 165 los escribía y nadie los leía. Importan acá porque son las líneas que
   * movieron stock y pisaron el costo de un insumo, **no se pueden editar** (se
   * anula y se rehace) y el precio no vuelve al anular. Verlos es lo único que
   * queda entre el encargado y una auditoría a ciegas.
   */
  renglones?: Record<string, SupplierInvoiceItem[]>;
  onAnularComprobante?: (id: string) => void;
  /** spec 163 · para corregir un comprobante desde acá. */
  slug?: string;
  conceptos?: ConceptOption[];
};

/**
 * Cantidades con coma decimal — spec 172.
 *
 * `formatCurrency` ya localiza la plata, pero los envases y los kilos salían
 * crudos del `numeric`: «8.26 × Compra 10kg · entraron 82.6 kg» en una pantalla
 * donde todo lo demás usa coma. Un punto decimal acá se lee como separador de
 * miles, y son justo los números que hay que contrastar contra el papel.
 */
const cantidad = (n: number) =>
  n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

const nombreComprobante = (c: ComprobanteConSaldo) =>
  c.invoice_number?.trim()
    ? `#${c.invoice_number.trim()}`
    : etiquetaTipo((c.document_type ?? "interno") as DocumentType);

/**
 * Cta. Cte. del proveedor — spec 159.
 *
 * Es la estructura del «Manejo Integral de Proveedores» de MaxiRest: período
 * arriba, COMPRAS a la izquierda con su saldo por fila, y los PAGOS de la compra
 * seleccionada al lado. Sin el aspecto de FoxPro y sin cambiar de pantalla para
 * ver con qué se pagó una factura.
 */
export function CuentaCorrientePanel({
  saldoCents,
  compras,
  pagos,
  imputaciones,
  fotos = {},
  renglones = {},
  onAnularComprobante,
  slug,
  conceptos = [],
}: Props) {
  const [desde, setDesde] = useState(primerDiaDelMesAR());
  const [hasta, setHasta] = useState(hoyAR());
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [editando, setEditando] = useState<ComprobanteConSaldo | null>(null);

  const delPeriodo = useMemo(
    () => filtrarPorPeriodo(compras, desde, hasta),
    [compras, desde, hasta],
  );

  const totales = useMemo(
    () => totalesDelPeriodo(delPeriodo, imputaciones, pagos),
    [delPeriodo, imputaciones, pagos],
  );

  const detalle = useMemo(
    () => (seleccionada ? pagosDeComprobante(seleccionada, imputaciones, pagos) : []),
    [seleccionada, imputaciones, pagos],
  );

  const elegida = delPeriodo.find((c) => c.id === seleccionada) ?? null;

  return (
    <>
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-zinc-900">Cta. Cte.</h3>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="h-8 rounded-md border border-zinc-200 px-2 text-xs"
            aria-label="Período desde"
          />
          <span className="text-xs text-zinc-400">a</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="h-8 rounded-md border border-zinc-200 px-2 text-xs"
            aria-label="Período hasta"
          />
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-5">
        {/* COMPRAS */}
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-semibold text-zinc-500">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Comprobante</th>
                  <th className="px-3 py-2 text-right">Importe</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {delPeriodo.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-zinc-400">
                      Sin compras en el período.
                    </td>
                  </tr>
                ) : (
                  delPeriodo.map((c) => {
                    const activa = c.id === seleccionada;
                    const anulado = Boolean(c.cancelled_at);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSeleccionada(activa ? null : c.id)}
                        className={cn(
                          "cursor-pointer transition",
                          activa ? "bg-zinc-100" : "hover:bg-zinc-50",
                          anulado && "text-zinc-400",
                        )}
                      >
                        <td className="px-3 py-2 tabular-nums">{c.invoice_date}</td>
                        <td className={cn("px-3 py-2", anulado && "line-through")}>
                          {nombreComprobante(c)}
                          {anulado && (
                            <span className="ml-1.5 text-xs text-zinc-400">anulado</span>
                          )}
                          {/* Spec 172 · qué comprobantes movieron stock y costo,
                              visible SIN abrir. Es la mitad de la auditoría: la
                              otra mitad es el detalle al costado. */}
                          {(renglones[c.id]?.length ?? 0) > 0 && (
                            <span className="ml-1.5 text-xs text-zinc-400">
                              · {renglones[c.id]!.length}{" "}
                              {renglones[c.id]!.length === 1 ? "insumo" : "insumos"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(c.total_cents)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-semibold tabular-nums",
                            !anulado && c.saldo_cents > 0 ? "text-amber-700" : "text-zinc-400",
                          )}
                        >
                          {formatCurrency(anulado ? 0 : c.saldo_cents)}
                        </td>
                        <td className="pr-2">
                          <div className="flex items-center justify-end gap-0.5">
                            {slug && !anulado && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditando(c);
                                }}
                                className="rounded p-1 text-zinc-300 transition hover:bg-zinc-200 hover:text-zinc-700"
                                aria-label={`Corregir ${nombreComprobante(c)}`}
                                title="Corregir"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            )}
                            <ChevronRight
                              className={cn(
                                "size-4 text-zinc-300 transition",
                                activa && "rotate-90 text-zinc-500",
                              )}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {delPeriodo.length > 0 && (
                <tfoot>
                  <tr className="border-t bg-zinc-50 text-xs font-semibold text-zinc-700">
                    <td className="px-3 py-2" colSpan={2}>
                      Totales del período
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totales.total_cents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totales.saldo_cents)}
                    </td>
                    <td />
                  </tr>
                  {totales.pago_a_cuenta_cents > 0 && (
                    <tr className="border-t bg-zinc-50 text-xs text-zinc-500">
                      <td className="px-3 py-2" colSpan={3}>
                        Total pago a cuenta
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(totales.pago_a_cuenta_cents)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
          {/* El saldo NO se filtra por período: lo que se debe es lo que se debe. */}
          <p className="mt-1.5 px-1 text-xs text-zinc-500">
            Saldo del proveedor (todo el historial):{" "}
            <strong className="tabular-nums text-zinc-900">
              {formatCurrency(saldoCents)}
            </strong>
          </p>
        </div>

        {/* DETALLE: los pagos de la compra seleccionada */}
        <div className="lg:col-span-2">
          <div className="h-full overflow-hidden rounded-xl border bg-white">
            <div className="border-b bg-zinc-50 px-3 py-2">
              <p className="text-xs font-semibold text-zinc-500">
                {elegida ? `Pagos de ${nombreComprobante(elegida)}` : "Pagos"}
              </p>
            </div>

            {!elegida ? (
              <p className="px-3 py-8 text-center text-sm text-zinc-400">
                Tocá una compra para ver con qué se pagó.
              </p>
            ) : detalle.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <FileText className="mx-auto size-5 text-zinc-300" />
                <p className="mt-1.5 text-sm text-zinc-400">Sin pagos imputados.</p>
                {elegida.saldo_cents > 0 && !elegida.cancelled_at && (
                  <p className="mt-0.5 text-xs text-amber-700">
                    Debe {formatCurrency(elegida.saldo_cents)}
                  </p>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {detalle.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">
                        {etiquetaMetodo(p.method)}
                      </p>
                      <p className="text-xs text-zinc-500 tabular-nums">{p.paid_at}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(p.imputado_cents)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {/* Los insumos que entraron con esta compra — spec 172. Sólo si los
                tiene: la mayoría de los comprobantes se cargan sin detalle y un
                bloque vacío en cada uno los haría parecer incompletos. */}
            {elegida && (renglones[elegida.id]?.length ?? 0) > 0 && (
              <div className="border-t">
                <div className="bg-zinc-50 px-3 py-2">
                  <p className="text-xs font-semibold text-zinc-500">
                    Insumos ({renglones[elegida.id]!.length})
                  </p>
                </div>
                <ul className="divide-y">
                  {renglones[elegida.id]!.map((r) => (
                    <li key={r.id} className="px-3 py-2">
                      <div className="flex items-baseline gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                          {r.ingredientName}
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-zinc-900">
                          {formatCurrency(Math.round(r.units * r.unitCostCents))}
                        </p>
                      </div>
                      {/* La conversión completa: la factura habla en kilos y el
                          sistema guarda envases (165·D5). Sin los dos números al
                          lado, «8,26» no se puede contrastar contra el papel. */}
                      <p className="text-xs text-zinc-500 tabular-nums">
                        {cantidad(r.units)} ×{" "}
                        {r.presentationName ?? `${r.ingredientUnit} (sin envase)`}
                        {" · entraron "}
                        {cantidad(r.quantityBase)} {r.ingredientUnit}
                        {" · "}
                        {formatCurrency(r.unitCostCents)} por envase
                      </p>
                      {/* spec 188 · el IVA del renglón, sobre la plata de la
                          línea entera — que es lo que se mira cuando se controla
                          una compra vieja contra el papel. Sólo aparece si el
                          renglón se cargó en base neto (factura A); `price_base`
                          se guardó con la compra, así que editarle el tipo al
                          comprobante después no reescribe este cartel. */}
                      <LineaIva
                        netoCents={Math.round(r.units * r.unitCostCents)}
                        tasa={r.tasaIva}
                        base={r.priceBase ?? "final"}
                        prefijo="La línea"
                      />
                    </li>
                  ))}
                </ul>
                {!elegida.cancelled_at && (
                  <p className="px-3 pb-2 text-[11px] text-zinc-400">
                    Los renglones no se editan. Si hay uno mal, anulá la compra y
                    cargala de nuevo: el stock vuelve, el precio del insumo no.
                  </p>
                )}
              </div>
            )}

            {elegida && fotos[elegida.id] && (
              <div className="border-t p-3">
                <a
                  href={fotos[elegida.id] ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-lg border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fotos[elegida.id] ?? undefined}
                    alt="Foto del comprobante"
                    className="max-h-48 w-full object-cover"
                  />
                </a>
              </div>
            )}

            {elegida && !elegida.cancelled_at && onAnularComprobante && (
              <div className="border-t px-3 py-2">
                <button
                  type="button"
                  onClick={() => onAnularComprobante(elegida.id)}
                  className="text-xs font-medium text-zinc-500 underline transition hover:text-red-600"
                >
                  Anular este comprobante
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>

      {editando && slug && (
        <EditarComprobanteDialog
          slug={slug}
          comprobante={editando}
          conceptos={conceptos}
          // Un pago vivo imputado a ESTE comprobante: lo que la guarda del
          // server mira. Se calcula acá para deshabilitar los campos de plata
          // con el motivo a la vista, no para reemplazar esa guarda.
          tienePagoVivo={imputaciones.some(
            (im) =>
              im.invoice_id === editando.id &&
              pagos.some((p) => p.id === im.payment_id && !p.cancelled_at),
          )}
          onClose={() => setEditando(null)}
        />
      )}
    </>
  );
}
