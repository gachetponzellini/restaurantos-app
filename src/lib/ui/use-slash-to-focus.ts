"use client";

import { useEffect, type RefObject } from "react";

/**
 * «/» enfoca el buscador de la página (spec 205 · D2), como en GitHub o Linear.
 *
 * No actúa si el usuario está escribiendo en otro campo (ahí la barra es una
 * barra) ni si hay un modal abierto (el foco es del modal).
 */
export function useSlashToFocus(
  ref: RefObject<HTMLInputElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      )
        return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const input = ref.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref, enabled]);
}
