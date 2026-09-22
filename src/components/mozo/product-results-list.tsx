"use client";

import { Pencil, Plus } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import { etiquetaDePrecio } from "@/lib/catalog/variantes";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";
import { isItemLibreEntry } from "@/lib/mozo/item-libre-entry";

/**
 * Resultados del buscador de productos, compartidos por los tres panales de
 * carga: mesa (`pedir-client`), para llevar/delivery (`cargar-pedido-sheet`) y
 * venta rápida de mostrador (`venta-rapida-panel`). Spec 066, FR-001/002/003.
 *
 * **Una sola columna, a propósito.** Antes esto era una `grid grid-cols-2` en
 * cada panel, con el índice del teclado moviéndose ±1: en una grilla de dos
 * columnas, "+1" es la celda de al lado, así que ↓ movía la selección al
 * costado. La alternativa —grilla + ↓/↑ de a dos y ←/→ de a uno— no sirve
 * porque el foco vive en el `<input>` de búsqueda y secuestrar ←/→ le saca al
 * usuario el cursor del texto que está tipeando. En fila, ↓ baja y listo.
 *
 * La densidad no se pierde: una fila compacta ocupa lo mismo que media grilla
 * de tarjetas de 84px. Desde la spec 073 el catálogo por categoría usa esta
 * misma lista, así que no queda ninguna grilla de productos: ↓ baja y listo.
 *
 * Spec 075: las filas dejaron de tener un resaltado virtual y pasaron a recibir
 * **foco real** (`itemProps`, que arma el caller con `useRovingList`). Con el
 * foco parado en la fila, ←/→ y Supr quedan libres para operar sobre ella.
 */
export function ProductResultsList({
  products,
  onPick,
  enterTargetId,
  itemProps,
}: {
  products: CatalogProduct[];
  onPick: (p: CatalogProduct) => void;
  /** El que abre Enter desde el buscador (el primero de la lista): se marca
   *  para que se vea qué va a pasar antes de apretar. */
  enterTargetId?: string;
  /**
   * Props de teclado de la fila, por id de producto (spec 075). Las da el
   * caller porque la zona navegable puede abarcar más que esta lista — en la
   * mesa arranca con los menús del día y sigue con varias secciones de
   * categoría, todas parte del mismo recorrido de ↓.
   */
  itemProps?: (productId: string) => Partial<React.ComponentProps<"button">>;
}) {
  return (
    <ul className="space-y-1.5">
      {products.map((p) => {
        const isEnterTarget = p.id === enterTargetId;
        // Spec 174 — la fila «no existe» no es un producto: no tiene precio que
        // mostrar (lo escribe el encargado) y si se pintara igual que el resto
        // se leería como un artículo de $0 de la carta.
        const esLibre = isItemLibreEntry(p);
        return (
          <li key={p.id}>
            <button
              onClick={() => onPick(p)}
              {...itemProps?.(p.id)}
              // El anillo del foco y el de «esto abre Enter» tienen que
              // distinguirse: con los dos iguales no se sabía dónde estabas
              // parado. Foco = anillo grueso con offset; target de Enter =
              // anillo fino.
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:scale-[0.99] ${
                esLibre
                  ? "border border-dashed border-amber-300 bg-amber-50/60 active:bg-amber-100"
                  : "bg-card active:bg-muted/50"
              } ${
                isEnterTarget
                  ? "ring-1 ring-emerald-400"
                  : esLibre
                    ? ""
                    : "ring-border ring-1"
              }`}
            >
              <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
                {esLibre ? "Cargar un artículo que no existe" : p.name}
              </span>
              {esLibre ? (
                <span className="shrink-0 text-xs font-medium text-amber-700">
                  nombre y precio a mano
                </span>
              ) : (
                <span className="shrink-0 text-sm font-bold text-emerald-700 tabular-nums">
                  {etiquetaDePrecio(p, formatCurrency)}
                </span>
              )}
              <span
                className={`shrink-0 rounded-full p-1 ${
                  esLibre
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {esLibre ? (
                  <Pencil className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
