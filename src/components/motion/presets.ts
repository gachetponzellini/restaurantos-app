import type { Transition } from "motion/react";

// Lenguaje de movimiento de la parte pública (issue #336). Una sola fuente de
// curvas y duraciones para que todo se mueva igual: rápido al entrar, sin
// rebotes llamativos, nada que haga esperar al cliente en hora pico.

/** Salida fuerte, llegada suave: la curva de todo lo que entra o se reacomoda. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** La curva de los sheets de iOS: arranca rápido y se asienta largo. */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
/** Para lo que se va: acelera hacia afuera, no se queda flotando. */
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const enter: Transition = { duration: 0.32, ease: EASE_OUT };
export const exit: Transition = { duration: 0.18, ease: EASE_IN };

/** Resorte sin rebote visible: para indicadores y cosas que siguen al dedo. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.9,
};

/** Resorte con un rastro mínimo de rebote: badges y contadores. */
export const springPop: Transition = {
  type: "spring",
  stiffness: 600,
  damping: 30,
};

/** Stagger de listas: corto y con techo, para que una categoría de 40
 *  productos no tarde en aparecer más que una de 4. */
export function staggerDelay(index: number, step = 0.028, max = 8): number {
  return Math.min(index, max) * step;
}
