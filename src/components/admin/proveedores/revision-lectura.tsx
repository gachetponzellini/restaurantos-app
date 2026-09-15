"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  aPropuesta,
  type CodigoAviso,
  type InsumoDelCatalogo,
  type RenglonPropuesto,
} from "@/lib/proveedores/lectura/a-propuesta";
import { tasaDeRenglon, type PriceBase } from "@/lib/proveedores/iva";
import type { MATCH_SOURCES, SupplierInvoiceItemInput } from "@/lib/proveedores/schema";
import { LineaIva } from "./linea-iva";

export type OrigenAlias = "exacto" | "fuzzy" | "llm" | "manual" | "manual_corregido";

/**
 * Un renglón leído, con de qué foto salió — spec 173.
 *
 * Los dos campos son opcionales porque el diálogo viejo (`invoice-dialog`)
 * sigue mandando renglones de una sola foto, donde «de qué página» no significa
 * nada. Cuando la compra entró por varias fotos, `pagina` es lo que deja saltar
 * del renglón dudoso al papel donde está impreso.
 */
export type RenglonRevisable = RenglonPropuesto & {
  /** 1-based, como se numera el rail del visor. */
  pagina?: number;
  /** Aparece igual en la página anterior: se avisa, nunca se descarta. */
  posibleDuplicado?: boolean;
};

/** Qué se aprende de un renglón confirmado, por de dónde salió la propuesta. */
export type AliasAprendido = {
  aliasRaw: string;
  ingredientId: string;
  presentationId: string | null;
  origen: OrigenAlias;
};

const cantidad = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

const TEXTO_AVISO: Record<CodigoAviso, string> = {
  no_cuadra: "La cuenta de esta línea no cierra con lo que dice el papel.",
  reconstruido: "Este número no estaba impreso: lo saqué de los otros dos.",
  unidad_ambigua: "El papel no dice en qué unidad viene. Lo tomé como la del insumo.",
  sin_presentacion: "Este insumo no tiene envase cargado: entra el stock pero no se actualiza el costo.",
  cantidad_muy_chica: "La cantidad es demasiado chica para este envase.",
  costo_excede_columna: "El precio es demasiado grande para cargarlo.",
  salto_de_precio: "",
};

/**
 * La pantalla de revisión — spec 172.
 *
 * Es la ÚNICA oportunidad barata de corregir: los renglones no se editan después
 * de guardar (165, «qué no entra»: se anula y se rehace) y anular devuelve el
 * stock pero no el precio (165·D4).
 *
 * Tres zonas por renglón, siempre en el mismo orden:
 *   1 · lo que decía el papel, verbatim y entre comillas — el ancla
 *   2 · lo que entendió el sistema, editable
 *   3 · la conversión y el precio por unidad base contra el actual
 *
 * **La certeza está en el checkbox, no en el color.** Una fila destildada no
 * entra en el payload: es la prohibición de auto-asignar (172·D3) implementada
 * en el dato y no en la disciplina de la UI.
 */
export function RevisionLectura({
  renglones,
  insumos,
  totalComprobanteCents,
  baseDelPrecio = "final",
  tasaComprobante = null,
  onConfirmar,
  onDescartar,
  onIrAPagina,
}: {
  renglones: RenglonRevisable[];
  insumos: InsumoDelCatalogo[];
  totalComprobanteCents: number;
  /**
   * En qué base está el precio impreso — spec 188·D2. Sale del tipo de
   * comprobante, que es un campo de la pantalla de al lado.
   *
   * El default es `final` y no es pereza: con `final` el precio no se toca y la
   * pantalla no muestra ninguna línea de IVA, que es exactamente lo que
   * corresponde en el diálogo viejo, donde no hay de dónde sacar el tipo.
   */
  baseDelPrecio?: PriceBase;
  /** La tasa que hereda un renglón sin tasa impresa. Sólo para mostrar (D5). */
  tasaComprobante?: number | null;
  onConfirmar: (items: SupplierInvoiceItemInput[], aprender: AliasAprendido[]) => void;
  onDescartar: () => void;
  /**
   * Llevar el visor a la página de un renglón — spec 173. Opcional: en el
   * diálogo viejo no hay visor al lado al que llevar nada.
   */
  onIrAPagina?: (pagina: number) => void;
}) {
  const [filas, setFilas] = useState(renglones);

  const incluidas = filas.filter((f) => f.incluir && f.ingredientId && f.units && f.unitCostCents);
  const sumaCents = incluidas.reduce(
    (n, f) => n + Math.round((f.units ?? 0) * (f.unitCostCents ?? 0)),
    0,
  );

  const sinInsumo = filas.filter((f) => !f.ingredientId).length;

  const porId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);

  /**
   * Al cambiar el insumo se RECALCULA la conversión desde lo impreso.
   *
   * El editor viejo hacía lo contrario: pisaba `unit_cost_cents` con el costo
   * actual del insumo nuevo y tiraba el precio leído. Acá el papel manda — por
   * eso `aPropuesta` es puro y corre en el cliente.
   */
  const cambiarInsumo = (i: number, ingredientId: string) => {
    setFilas((prev) =>
      prev.map((f, j) => {
        if (j !== i) return f;
        const insumo = ingredientId ? (porId.get(ingredientId) ?? null) : null;
        const rehecho = aPropuesta(
          {
            descripcion: f.sourceText,
            cantidad: f.units !== null ? String(f.units) : null,
            unidad: null,
            precio_unitario: f.unitCostCents !== null ? String(f.unitCostCents / 100) : null,
            total_linea: null,
            // La tasa impresa sobrevive a que se corrija el insumo: es del
            // papel, no de la propuesta (188).
            tasa_iva: f.tasaIva !== null ? String(f.tasaIva) : null,
            origen: f.origen,
            confianza: "alta",
          },
          insumo,
          "manual_corregido",
        );
        // Una corrección explícita entra tildada: la persona ya decidió.
        // `pagina` y `posibleDuplicado` viajan aparte: `aPropuesta` sólo sabe de
        // la conversión, y perder de qué foto salió el renglón justo cuando se
        // lo corrige rompe el salto al papel en el momento en que más sirve.
        return {
          ...rehecho,
          pagina: f.pagina,
          posibleDuplicado: f.posibleDuplicado,
          incluir: Boolean(insumo),
        };
      }),
    );
  };

  const set = (i: number, patch: Partial<RenglonPropuesto>) =>
    setFilas((prev) => prev.map((f, j) => (i === j ? { ...f, ...patch } : f)));

  if (filas.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm text-zinc-700">
          No encontré renglones que sean insumos del sistema. Si es limpieza,
          descartables o bebida, eso no se detalla por insumo: va con el concepto
          de gasto y listo. La compra se carga igual, entera.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onDescartar}>
          Seguir sin detalle
        </Button>
      </div>
    );
  }

  return (
    <div className="@container space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold text-zinc-700">Leí esto del papel</p>
        <button
          type="button"
          onClick={onDescartar}
          className="text-[11px] text-zinc-400 underline hover:text-zinc-700"
        >
          Cargar sin detalle
        </button>
      </div>

      <ul className="divide-y">
        {filas.map((f, i) => {
          const insumo = f.ingredientId ? porId.get(f.ingredientId) : null;
          const salto = f.avisos.find((a) => a.codigo === "salto_de_precio");
          const otros = f.avisos.filter(
            (a) => a.codigo !== "salto_de_precio" && TEXTO_AVISO[a.codigo],
          );
          const dudoso =
            Boolean(salto) ||
            otros.some((a) => a.codigo === "no_cuadra") ||
            Boolean(f.posibleDuplicado);
          const costoBase =
            f.unitCostCents && insumo?.netQuantity
              ? f.unitCostCents / insumo.netQuantity
              : f.unitCostCents;

          return (
            <li
              key={i}
              // El hover va en la fila entera y no sólo en el chip: la gracia es
              // que al recorrer los renglones con el mouse, la foto de al lado
              // vaya siguiendo. Cruzar la lista para llegar al visor no la
              // atraviesa —el visor está del otro lado—, así que no salta sola.
              onMouseEnter={() => {
                if (f.pagina) onIrAPagina?.(f.pagina);
              }}
              className={cn("py-2", dudoso && "-mx-3 border-l-2 border-amber-400 px-3")}
            >
              <div className="flex items-baseline gap-2">
                {/* Lo que decía el papel. No se edita: es la evidencia. */}
                <p className="min-w-0 flex-1 text-xs text-zinc-500">«{f.sourceText}»</p>
                {f.pagina && onIrAPagina && (
                  <button
                    type="button"
                    onClick={() => onIrAPagina(f.pagina!)}
                    title="Ver esta página"
                    className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 transition hover:bg-zinc-900 hover:text-white"
                  >
                    pág. {f.pagina}
                  </button>
                )}
              </div>

              <div className="mt-1 flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => set(i, { incluir: !f.incluir })}
                  disabled={!f.ingredientId || !f.units}
                  aria-label={f.incluir ? "No cargar este insumo" : "Cargar este insumo"}
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition",
                    f.incluir
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white hover:border-zinc-400",
                    (!f.ingredientId || !f.units) && "cursor-not-allowed opacity-40",
                  )}
                >
                  {f.incluir && <Check className="size-3" />}
                </button>

                <div className="min-w-0 flex-1 space-y-1">
                  {/* En la pantalla nueva la fila mide ~520 px y no 328: el
                      insumo y los números entran en el mismo renglón, que es
                      como se leen en el papel. En el diálogo viejo la caja
                      sigue siendo angosta y siguen apilados. */}
                  <div className="space-y-1 @md:flex @md:items-center @md:gap-2 @md:space-y-0">
                    <select
                      value={f.ingredientId ?? ""}
                      onChange={(e) => cambiarInsumo(i, e.target.value)}
                      className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs @md:h-9 @md:min-w-0 @md:flex-1 @md:text-sm"
                      aria-label="Insumo"
                    >
                      <option value="">Elegí el insumo…</option>
                      {insumos.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>

                    {f.units !== null && f.unitCostCents !== null && (
                      <div className="flex items-center gap-1.5 @md:shrink-0">
                        <Input
                          className="h-7 w-16 text-xs @md:h-9 @md:w-20 @md:text-sm"
                          inputMode="decimal"
                          value={f.units}
                          onChange={(e) => set(i, { units: Number(e.target.value) || 0 })}
                          aria-label="Envases"
                        />
                        <span className="text-[11px] text-zinc-400">×</span>
                        <Input
                          className="h-7 w-24 text-xs @md:h-9 @md:w-28 @md:text-sm"
                          inputMode="decimal"
                          value={f.unitCostCents / 100}
                          onChange={(e) =>
                            set(i, {
                              unitCostCents: Math.round(
                                (Number(e.target.value.replace(",", ".")) || 0) * 100,
                              ),
                            })
                          }
                          aria-label="Precio por envase"
                        />
                        <span className="truncate text-[11px] text-zinc-400">
                          {f.presentationName ?? insumo?.unit}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* La conversión completa: la factura habla en kilos y el
                      sistema guarda envases. Sin los dos números al lado, «8,26»
                      no se puede contrastar contra el papel. */}
                  {f.quantityBase !== null && insumo && (
                    <p className="text-[11px] text-zinc-500 tabular-nums">
                      → entran {cantidad(f.quantityBase)} {insumo.unit}
                      {f.units !== null && f.unitCostCents !== null && (
                        <> · {formatCurrency(Math.round(f.units * f.unitCostCents))}</>
                      )}
                    </p>
                  )}

                  {/* El precio final — spec 188.
                      «¿Le pone el IVA a cada uno para dejarlos con el precio
                      final?» (Rocío, 2026-09-15). Sí, PARA MOSTRAR: lo que se
                      carga al costo sigue siendo el neto, porque el IVA de
                      compras es crédito fiscal y no es costo (D1). Sólo aparece
                      cuando hay un IVA que sumar: sobre un ticket el precio del
                      papel ya es el final y esta línea sería ruido. */}
                  <LineaIva
                    netoCents={costoBase ? Math.round(costoBase) : null}
                    tasa={tasaDeRenglon(f.tasaIva, tasaComprobante)}
                    base={baseDelPrecio}
                    prefijo={insumo ? (insumo.unit === "un" ? "La unidad" : `El ${insumo.unit}`) : "El precio"}
                  />


                  {/* El precio por unidad base es el número que EFECTIVAMENTE se
                      escribe y se propaga a las recetas. Es lo único que caza el
                      caso «4 maples o 4 cajas». */}
                  {salto && costoBase && insumo && (
                    <p className="flex items-start gap-1 text-[11px] text-amber-700">
                      <AlertTriangle className="mt-px size-3 shrink-0" />
                      <span>
                        {insumo.unit === "un" ? "La unidad" : `El ${insumo.unit}`} te queda a{" "}
                        {formatCurrency(Math.round(costoBase))} — es {salto.detalle} veces el
                        precio anterior. Fijate que el envase sea el que dice el papel.
                      </span>
                    </p>
                  )}
                  {/* El solapamiento se AVISA y no se destilda: al fotografiar
                      una tira larga se repite el último renglón para no cortarlo
                      por la mitad, pero dos cajones del mismo tomate también
                      aparecen dos veces y son dos. Destildarlo solo pierde plata
                      en silencio; avisar cuesta que se mire un renglón. */}
                  {f.posibleDuplicado && (
                    <p className="flex items-start gap-1 text-[11px] text-amber-700">
                      <AlertTriangle className="mt-px size-3 shrink-0" />
                      <span>
                        Este renglón también está en la página anterior. Puede ser el
                        solapamiento de la foto, o pueden ser dos de verdad — mirá el papel
                        antes de cargarlo.
                      </span>
                    </p>
                  )}
                  {otros.map((a, k) => (
                    <p key={k} className="text-[11px] text-zinc-400">
                      {TEXTO_AVISO[a.codigo]}
                    </p>
                  ))}
                  {!f.ingredientId && (
                    <p className="text-[11px] text-zinc-400">
                      No encontramos a qué insumo corresponde. Si no es un insumo,
                      queda dentro del importe y no se detalla.
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t pt-2 text-xs">
        <span className="text-zinc-500">Suma del detalle</span>
        <span className="font-semibold tabular-nums text-zinc-800">{formatCurrency(sumaCents)}</span>
      </div>
      {totalComprobanteCents > 0 && sumaCents !== totalComprobanteCents && (
        <p className="text-[11px] text-zinc-400">
          El total del comprobante es {formatCurrency(totalComprobanteCents)} — la
          diferencia queda sin detallar, y está bien.
        </p>
      )}
      {sinInsumo > 0 && (
        <p className="text-[11px] text-zinc-400">
          {sinInsumo === 1
            ? "1 renglón no es un insumo del sistema."
            : `${sinInsumo} renglones no son insumos del sistema.`}{" "}
          Quedan dentro del importe.
        </p>
      )}

      {/* El conteo va ADENTRO del botón: es un número que se ve sin leer nada
          más, y «3 de 5» molesta lo justo para que abra los otros dos. */}
      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={() =>
          onConfirmar(
            incluidas.map((f) => ({
              ingredient_id: f.ingredientId!,
              presentation_id: f.presentationId,
              units: f.units!,
              unit_cost_cents: f.unitCostCents!,
              // spec 188 · la tasa impresa, si el papel la traía. La heredada NO
              // viaja: lo que se guarda es lo que decía el renglón.
              tasa_iva: f.tasaIva,
              /**
               * spec 172·D6, que se declaró y nunca se implementó: las columnas
               * existen desde la 0092 y la RPC no las escribía. Sin
               * `match_source` no hay forma de responder «la máquina propuso X y
               * la persona lo corrigió a Y» después de cerrar el diálogo, y un
               * umbral que no se puede medir no se puede defender.
               */
              source_text: f.sourceText,
              match_source: (f.matchSource ??
                null) as (typeof MATCH_SOURCES)[number] | null,
            })),
            // Sólo se aprende de lo que se CONFIRMÓ. Un renglón que salió de la
            // memoria y nadie tocó no enseña nada nuevo; uno destildado tampoco:
            // ausencia de match no es match a nada.
            incluidas
              .filter((f) => f.matchSource && f.matchSource !== "memoria")
              .map((f) => ({
                aliasRaw: f.sourceText,
                ingredientId: f.ingredientId!,
                presentationId: f.presentationId,
                origen: f.matchSource as OrigenAlias,
              })),
          )
        }
      >
        {incluidas.length === 0
          ? "Cargar la compra sin detallar"
          : incluidas.length === filas.length
            ? `Cargar la compra con ${incluidas.length} ${incluidas.length === 1 ? "insumo" : "insumos"}`
            : `Cargar la compra con ${incluidas.length} de ${filas.length} insumos`}
      </Button>
    </div>
  );
}
