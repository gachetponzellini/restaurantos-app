"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";

/**
 * Spec 115 — el shell de las dos pantallas donde el personal carga un pedido:
 * el panel del salón (`pedir-client.tsx`) y la hoja de pedidos online
 * (`cargar-pedido-sheet.tsx`).
 *
 * Las piezas de adentro ya eran las mismas (`ProductSearchInput`,
 * `ProductResultsList`, `ProductModal`, `useCartZone`); lo que divergía era el
 * layout. La 111 rediseñó el salón y la hoja quedó a mitad de camino: mismo
 * dibujo, otro breakpoint, y el selector de categoría todavía puesto. Con el
 * shell acá las dos cambian juntas o no cambian.
 *
 * La forma es siempre la misma: **contexto a la izquierda, carga a la derecha**.
 * A la izquierda va lo que el pedido ya tiene (la mesa en el salón; el cliente,
 * la entrega y el carrito en la hoja); a la derecha, el camino feliz —buscar y
 * agregar— que se queda con el ancho que sobra.
 */

/**
 * El ancho de panel a partir del cual entran las dos columnas.
 *
 * Era 672 (`@2xl` de Tailwind) y **no se cumplía nunca** en las pantallas
 * reales: con el panel expandido (spec 122) mide 480 de 1024 a 1279, y ~628 a
 * ~668 de 1280 a 1400. O sea que en la notebook del salón la columna de la
 * mesa quedaba escondida siempre, y lo que se había escrito como «modo
 * angosto» terminó siendo el modo normal. Con 600, un viewport de 1280 ya
 * muestra las dos partes: la mesa se lleva 46% (≈285px) y la carga el resto
 * (spec 146 · D-C1).
 *
 * El número vive acá y en las clases `@min-[600px]:` de abajo — Tailwind no
 * puede leer una variante armada en tiempo de ejecución, así que la variante va
 * escrita entera. Si cambia, cambia en los dos lados.
 */
export const ANCHO_DOS_COLUMNAS = 600;

/**
 * ¿El panel es lo bastante ancho para las dos columnas?
 *
 * Mide el **contenedor**, no la ventana, contra el mismo umbral que usa la CSS
 * (`@min-[600px]`). Antes la hoja duplicaba el breakpoint en JS con un `matchMedia` de
 * viewport (`useSheetAncho`), que es otra medida: una hoja de 448 px dentro de
 * una pantalla de 1400 px daba «ancho» en JS y una sola columna en pantalla, y
 * ⌘Enter confirmaba un pedido con la mitad del formulario fuera de la vista.
 *
 * Arranca en `false`: hasta la primera medición no hay dos columnas a la vista,
 * así que el atajo hace el camino largo (el de dos pasos), que nunca confirma
 * de más.
 */
export function useAnchoDePanel(ref: RefObject<HTMLElement | null>): boolean {
  const [ancho, setAncho] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // jsdom y navegadores viejos no lo tienen; sin observer nos quedamos en el
    // camino largo, que es el seguro.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entrada]) => {
      setAncho(entrada.contentRect.width >= ANCHO_DOS_COLUMNAS);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return ancho;
}

/**
 * El cuerpo de dos columnas.
 *
 * `relative` porque la columna lateral se abre encima cuando el panel es
 * angosto, y porque los modales de carga se scopean acá adentro.
 */
export function PanelDeCarga({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col @min-[600px]:flex-row",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * La columna de contexto (izquierda).
 *
 * Ancha: al lado de la carga, con ancho propio —el detalle por ítem no entra en
 * una columna angosta— pero nunca más que la de carga.
 * Angosta: depende del `modoAngosto`. `"encima"` se abre tapando la carga y la
 * abre el padre (en la hoja online, el paso «datos»); `"apilada"` se queda
 * debajo, siempre a la vista — es lo que usa la mesa desde la spec 146, porque
 * lo que hay en esa columna no puede depender de que te acuerdes de abrirla.
 */
export function ColumnaLateral({
  abierta,
  modoAngosto = "encima",
  children,
  className,
}: {
  abierta: boolean;
  /**
   * Qué hace cuando el panel es angosto y no entran las dos columnas.
   *
   * - `"encima"` (default) — se abre tapando la carga, y `abierta` la controla.
   *   Es lo que quieren la mesa y la hoja online: son dos vistas de lo mismo y
   *   se alterna entre ellas.
   * - `"apilada"` — se queda en el flujo, debajo de la carga, como una franja.
   *   Es lo que quieren la venta rápida y —desde la spec 146— la mesa: el total
   *   y el botón de cobrar no pueden depender de que te acuerdes de abrir otra
   *   vista. Quien la usa le pone el techo (`max-h-*`) por `className`: el alto
   *   de la franja depende de qué lleva adentro.
   */
  modoAngosto?: "encima" | "apilada";
  children: ReactNode;
  className?: string;
}) {
  const anchoDeColumna =
    "@min-[600px]:w-[46%] @min-[600px]:max-w-[520px] @min-[600px]:shrink-0";
  if (modoAngosto === "apilada") {
    return (
      <div
        className={cn(
          // Apilada es lo que hace **abajo** del umbral; arriba es una columna
          // más. El `flex-1` le gana al 46% de `anchoDeColumna` (en un flex row
          // el `flex-basis: 0` pisa al ancho) y eso es a propósito: el reparto
          // sale del contenido. La columna de carga tiene piso —la fila de
          // «Personas» no baja de ~390px— así que a 620 de panel un 46% duro
          // para la lateral la desbordaba. Con `flex-1` cada una arranca en lo
          // que necesita y el sobrante se reparte parejo; el techo de 520 sigue
          // valiendo en pantallas grandes.
          "flex min-h-0 shrink-0 flex-col @min-[600px]:min-h-0 @min-[600px]:flex-1",
          anchoDeColumna,
          className,
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        abierta
          ? `absolute inset-0 z-10 bg-muted/50 @min-[600px]:static @min-[600px]:z-auto ${anchoDeColumna}`
          : `hidden @min-[600px]:flex ${anchoDeColumna}`,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * La columna de carga (derecha): buscador fijo arriba, catálogo con scroll en el
 * medio, y un pie opcional.
 *
 * El `onKeyDown` de la zona de resultados es el mismo contrato en las dos
 * pantallas (spec 073): las flechas las maneja el roving del catálogo, y
 * cualquier tecla imprimible vuelve al buscador en vez de perderse — escribir
 * siempre busca, estés donde estés.
 *
 * `pie` es todo lo que va después del scroll: una franja fija, o los modales
 * que tienen que quedar scopeados a esta columna (elegir modificadores tapa la
 * carga, nunca el contexto de la izquierda).
 */
export function ColumnaDeCarga({
  encabezado,
  onKeyDownResultados,
  children,
  pie,
  className,
}: {
  encabezado: ReactNode;
  onKeyDownResultados: React.KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
  pie?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div className="shrink-0 space-y-2 border-b border-border bg-card px-3 py-2.5">
        {encabezado}
      </div>
      <div
        onKeyDown={onKeyDownResultados}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {children}
      </div>
      {pie}
    </div>
  );
}
