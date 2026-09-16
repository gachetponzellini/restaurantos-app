"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import type { PriceBase } from "@/lib/proveedores/iva";
import type { SupplierInvoiceItemInput } from "@/lib/proveedores/schema";

import {
  aEnvases,
  aUnidades,
  precioDelEnvaseDesdeTotal,
  precioUnitarioCents,
  subtotalCents,
  type ModoCarga,
} from "@/lib/proveedores/renglon-en-unidades";

import { InputNumeroAR } from "./input-numero-ar";
import { LineaIva } from "./linea-iva";

const cantidad = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

export type InsumoOption = {
  id: string;
  name: string;
  unit: string;
  /** La presentación default: cuántas unidades base trae un envase y qué costó. */
  presentationId?: string | null;
  /**
   * Cómo se llama el envase («Compra 10kg»). Ya venía en `IngredientOption`;
   * faltaba acá. Con la fila angosta del diálogo no entraba, pero en la pantalla
   * nueva es lo que evita el error de «4 maples o 4 cajas»: sin el nombre del
   * envase al lado, «4 × $8.260» no se puede contrastar contra el papel.
   */
  presentationName?: string | null;
  netQuantity?: number;
  costCents?: number;
};

type Renglon = SupplierInvoiceItemInput & { key: string };

/**
 * El detalle por insumo de una compra — spec 165.
 *
 * **Es opcional a propósito**: el 92% de los comprobantes del Golf se cargan sólo
 * con concepto de gasto, y la ayuda de MaxiRest bendice ese camino. Por eso
 * arranca cerrado y hay que abrirlo.
 *
 * Lo que cambia al usarlo: la compra **da de alta stock** y **actualiza el costo
 * del insumo**. Hoy el stock sólo baja —golf-jcr tiene 7 insumos en negativo— y
 * el costo no se movió nunca (`ingredient_price_log` tenía 0 filas).
 *
 * La suma de los renglones **no** tiene que dar el total del comprobante: en
 * 2026 sólo 585 de 1.502 comprobantes del Golf cuadran exacto.
 */
export function RenglonesEditor({
  insumos,
  value,
  onChange,
  totalComprobanteCents,
  baseDelPrecio = "final",
  tasaComprobante = null,
}: {
  insumos: InsumoOption[];
  value: SupplierInvoiceItemInput[];
  onChange: (items: SupplierInvoiceItemInput[]) => void;
  totalComprobanteCents: number;
  /**
   * En qué base está el precio que se tipea — spec 188.
   *
   * El editor manual no tenía esto y era un agujero real: después de confirmar
   * la lectura, la pantalla de revisión desaparece y **lo que queda a la vista
   * es esto**, así que el IVA se veía un momento y después no más. El default
   * `final` deja igual al diálogo viejo, que no sabe de qué tipo es el
   * comprobante.
   */
  baseDelPrecio?: PriceBase;
  tasaComprobante?: number | null;
}) {
  /**
   * Abierto si hay renglones — spec 172.
   *
   * Era `useState(value.length > 0)`, que sólo mira el valor del primer render.
   * Mientras los renglones se tipeaban a mano daba igual: se abría el editor y
   * recién ahí aparecía el primero. Pero el lector de facturas los carga
   * **después** de montar, y ahí el `useState` dejaba el editor CERRADO con
   * renglones adentro que el submit mandaba igual: stock y costos escritos por
   * líneas que nadie llegó a ver.
   *
   * El efecto sólo abre, nunca cierra: «Cargar sin detalle» vacía `value`, y si
   * el efecto también cerrara, un `onChange` a cero volvería a taparlo justo
   * cuando el usuario acaba de elegir lo contrario.
   */
  const [abierto, setAbierto] = useState(value.length > 0);
  useEffect(() => {
    if (value.length > 0) setAbierto(true);
  }, [value.length]);

  /**
   * «Cómo viene» cada renglón — 198·D5. Vive al lado de `value` y no adentro:
   * es cómo se LEE el renglón, no lo que se guarda (lo guardado son siempre
   * envases), así que no viaja al server. Default: la unidad del insumo.
   */
  const [modos, setModos] = useState<ModoCarga[]>([]);
  const modoDe = (i: number): ModoCarga => modos[i] ?? "unidad";

  /**
   * El total de la línea TIPEADO, por renglón — spec 199·D2.
   *
   * «Yo quiero cargar la cantidad que me vino, lo que me salió, y listo» (Rocío).
   * El total es lo que se escribe, pero no es lo que se guarda: lo guardado son
   * envases y el precio de UN envase, redondeado al centavo. Cuando la división no
   * es exacta el recalculado queda a centavos del papel, así que se recuerda lo
   * tipeado para mostrarlo tal cual. Un renglón que vino de la lectura no tiene
   * total tipeado y muestra el recalculado.
   */
  const [totales, setTotales] = useState<(number | null)[]>([]);
  const totalDe = (i: number, it: SupplierInvoiceItemInput) =>
    totales[i] ?? subtotalCents(it.units, it.unit_cost_cents);
  const setTotal = (i: number, cents: number | null) =>
    setTotales((prev) => {
      const copia = [...prev];
      copia[i] = cents;
      return copia;
    });

  const filas: Renglon[] = value.map((v, i) => ({ ...v, key: `${i}` }));
  const sumaCents = value.reduce((n, it, i) => n + totalDe(i, it), 0);

  /**
   * Enter avanza — spec 199·D3. «Estaría bueno que con el Enter se pueda correr,
   * aparte del tabulador, y darle el ok final.» Cantidad → total → cantidad del
   * renglón siguiente; desde el último total, el foco va a «Cargar compra», donde
   * un Enter guarda. Un Enter en un campo nunca guarda (173).
   */
  const avanzarConEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;
    const actual = e.target as HTMLElement;
    if (!actual.dataset.campo) return;
    e.preventDefault();
    const campos = Array.from(
      e.currentTarget.querySelectorAll<HTMLInputElement>("input[data-campo]"),
    );
    const siguiente = campos[campos.indexOf(actual as HTMLInputElement) + 1];
    if (siguiente) {
      siguiente.focus();
      siguiente.select();
      return;
    }
    actual.closest("form")?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  };

  const set = (i: number, patch: Partial<SupplierInvoiceItemInput>) =>
    onChange(value.map((v, j) => (i === j ? { ...v, ...patch } : v)));

  function agregar() {
    const primero = insumos[0];
    if (!primero) return;
    onChange([
      ...value,
      {
        ingredient_id: primero.id,
        presentation_id: primero.presentationId ?? null,
        units: 1,
        unit_cost_cents: primero.costCents ?? 0,
      },
    ]);
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          if (value.length === 0) agregar();
        }}
        className="w-full rounded-lg border border-dashed border-zinc-200 py-2.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-800"
      >
        + Detallar por insumo (da de alta stock y actualiza el costo)
      </button>
    );
  }

  return (
    <div
      className="@container space-y-2 rounded-lg border border-zinc-200 bg-white p-3"
      onKeyDown={avanzarConEnter}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-700">Detalle por insumo</p>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            onChange([]);
          }}
          className="text-[11px] text-zinc-400 underline hover:text-zinc-700"
        >
          Cargar sin detalle
        </button>
      </div>

      {filas.map((f, i) => {
        const ins = insumos.find((x) => x.id === f.ingredient_id);
        const neto = ins?.netQuantity ?? 0;
        const tieneEnvase = Boolean(ins?.presentationId) && neto > 0;
        // Sin envase no hay nada que elegir: la cantidad ya es la unidad base.
        const modo: ModoCarga = tieneEnvase ? modoDe(i) : "unidad";
        const enPantalla = aUnidades(modo, f.units, f.unit_cost_cents, neto);
        const unidadDeCarga = modo === "envase" ? (ins?.presentationName ?? "envase") : (ins?.unit ?? "");
        const total = totalDe(i, f);
        // El precio que se MUESTRA: total ÷ la cantidad en la unidad de carga.
        const precioMostrado = precioUnitarioCents(total, enPantalla.cantidad);

        return (
          <div key={f.key} className="space-y-0.5">
            <div className="flex flex-wrap items-end gap-1.5 @md:flex-nowrap @md:gap-2">
              <div className="min-w-0 basis-full @md:basis-auto @md:flex-1">
                <select
                  value={f.ingredient_id}
                  onChange={(e) => {
                    const nuevo = insumos.find((x) => x.id === e.target.value);
                    set(i, {
                      ingredient_id: e.target.value,
                      presentation_id: nuevo?.presentationId ?? null,
                      // Con un total ya tipeado manda el papel; sin él, el último
                      // costo conocido del insumo es una sugerencia razonable.
                      unit_cost_cents:
                        totales[i] != null
                          ? precioDelEnvaseDesdeTotal(totales[i]!, f.units)
                          : (nuevo?.costCents ?? 0),
                    });
                  }}
                  className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs @md:h-9 @md:text-sm"
                  aria-label="Insumo"
                >
                  {insumos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* La cantidad, en lo que diga la factura (198·D4 y D5). */}
              <div className="w-20 @md:w-24">
                <InputNumeroAR
                  className="h-8 text-right text-xs tabular-nums @md:h-9 @md:text-sm"
                  value={enPantalla.cantidad}
                  aria-label={`Cantidad en ${unidadDeCarga}`}
                  data-campo="cantidad"
                  onValue={(cantidad) => {
                    const envases = aEnvases(modo, cantidad ?? 0, 0, neto).units;
                    // 199 · el total se queda: cambiar la cantidad cambia el
                    // precio, que es lo que se deriva. Sin total tipeado, se
                    // conserva el precio del envase como antes.
                    set(i, {
                      units: envases,
                      ...(totales[i] != null
                        ? { unit_cost_cents: precioDelEnvaseDesdeTotal(totales[i]!, envases) }
                        : null),
                    });
                  }}
                />
              </div>

              {/* «Cómo viene» — «seleccionamos si se cuenta por kilos o por
                  litros» (Rocío). La unidad del insumo es el default; el envase
                  queda para la factura que sí dice «3 cajas». Cambiarlo NO
                  cambia la plata: lo guardado sigue igual, sólo cambia cómo se
                  lee. */}
              {tieneEnvase ? (
                <select
                  value={modo}
                  onChange={(e) => {
                    const nuevo = e.target.value as ModoCarga;
                    setModos((prev) => {
                      const copia = [...prev];
                      copia[i] = nuevo;
                      return copia;
                    });
                  }}
                  className="h-8 max-w-28 truncate rounded-md border border-zinc-200 bg-white px-1.5 text-xs @md:h-9"
                  aria-label="Cómo viene"
                >
                  <option value="unidad">{ins?.unit}</option>
                  <option value="envase">{ins?.presentationName ?? "envase"}</option>
                </select>
              ) : (
                <span className="mb-2 shrink-0 text-xs text-zinc-500">{ins?.unit}</span>
              )}

              {/* El precio unitario, CALCULADO — spec 199·D1. «Que sólo lo
                  muestre, que se calcula con los otros dos» (Juan). En gris y
                  sin borde: se ve que no se escribe. */}
              <span
                className="mb-2 min-w-24 shrink-0 text-right text-xs tabular-nums text-zinc-500"
                aria-label={`Precio por ${unidadDeCarga}`}
              >
                {precioMostrado === null ? "—" : `${formatCurrency(precioMostrado)}/${unidadDeCarga}`}
              </span>

              {/* El total de la línea, que es lo que dice la factura — 199. */}
              <div className="w-28 @md:w-32">
                <InputNumeroAR
                  className="h-8 text-right text-xs font-semibold tabular-nums @md:h-9 @md:text-sm"
                  decimales={2}
                  value={total / 100}
                  aria-label="Total de la línea"
                  data-campo="total"
                  onValue={(pesos) => {
                    const cents = pesos === null ? null : Math.round(pesos * 100);
                    setTotal(i, cents);
                    set(i, { unit_cost_cents: precioDelEnvaseDesdeTotal(cents ?? 0, f.units) });
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setModos((prev) => prev.filter((_, j) => j !== i));
                  setTotales((prev) => prev.filter((_, j) => j !== i));
                  onChange(value.filter((_, j) => j !== i));
                }}
                className="mb-1 rounded p-1 text-zinc-300 transition hover:bg-zinc-100 hover:text-red-600"
                aria-label="Quitar renglón"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {/* La conversión, cuando la hay: es lo que va a entrar al stock y a
                cuánto queda el envase, que es el costo que se propaga. */}
            {modo === "unidad" && tieneEnvase && f.units > 0 && (
              <p className="pl-0.5 text-[11px] text-zinc-500 tabular-nums">
                Entran {cantidad(enPantalla.cantidad)} {ins?.unit} ·{" "}
                {cantidad(f.units)} × {ins?.presentationName} a{" "}
                {formatCurrency(f.unit_cost_cents)} c/u
              </p>
            )}
            {ins && !tieneEnvase && (
              <p className="pl-0.5 text-[11px] text-zinc-400">
                Este insumo no tiene envase cargado: entra el stock, pero no se actualiza
                el costo.
              </p>
            )}

            {/* spec 188 · el IVA, sobre el precio que se está tipeando. */}
            <LineaIva
              netoCents={precioMostrado}
              tasa={tasaComprobante}
              base={baseDelPrecio}
              prefijo={`El ${unidadDeCarga || "precio"}`}
              className="pl-0.5 text-[11px] text-zinc-500 tabular-nums"
            />
          </div>
        );
      })}

      <Button type="button" variant="ghost" size="sm" onClick={agregar} className="h-7 text-xs">
        <Plus className="mr-1 size-3" />
        Agregar insumo
      </Button>

      <div className="flex items-center justify-between border-t pt-2 text-xs">
        <span className="text-zinc-500">Suma del detalle</span>
        <span className="font-semibold tabular-nums text-zinc-800">
          {formatCurrency(sumaCents)}
        </span>
      </div>
      {/* Se muestra la diferencia, no se bloquea: en 2026 sólo 585 de 1.502
          comprobantes del Golf cuadran exacto entre detalle y total. */}
      {totalComprobanteCents > 0 && sumaCents !== totalComprobanteCents && (
        <p className="text-[11px] text-zinc-400">
          El total del comprobante es {formatCurrency(totalComprobanteCents)} — la
          diferencia queda sin detallar, y está bien.
        </p>
      )}
    </div>
  );
}
