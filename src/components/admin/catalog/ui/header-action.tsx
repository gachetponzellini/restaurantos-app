"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * La acción principal de cada tab del catálogo va en el header, siempre en el
 * mismo lugar (spec 205 · D6). Antes cada tab la ponía donde podía: «Nuevo
 * producto» arriba a la derecha, «Nuevo sector» adentro de la tab, «Configurar
 * productos» en otra fila.
 *
 * La tab es dueña del botón (y del diálogo que abre, con su estado); el header
 * sólo presta el lugar. Por eso es un portal y no una prop que suba.
 */

type Ctx = {
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
};

const HeaderActionContext = createContext<Ctx | null>(null);

export function CatalogHeaderActionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <HeaderActionContext.Provider value={{ target, setTarget }}>
      {children}
    </HeaderActionContext.Provider>
  );
}

/** El lugar del header donde aparecen las acciones de la tab activa. */
export function CatalogHeaderActionSlot({ className }: { className?: string }) {
  const ctx = useContext(HeaderActionContext);
  return (
    <div
      ref={ctx?.setTarget}
      data-slot="catalog-header-action"
      className={className ?? "flex items-center gap-2"}
    />
  );
}

/**
 * Declara la acción de la tab. Sin provider (la tab usada suelta) se pinta en
 * el lugar.
 */
export function CatalogHeaderAction({ children }: { children: ReactNode }) {
  const ctx = useContext(HeaderActionContext);
  if (!ctx) return <>{children}</>;
  if (!ctx.target) return null;
  return createPortal(children, ctx.target);
}
