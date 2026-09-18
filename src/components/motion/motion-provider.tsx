"use client";

import { LazyMotion, MotionConfig, domMax } from "motion/react";

import { enter } from "./presets";

// `LazyMotion` + `m.*` en vez de `motion.*`: la carta pública se abre desde un
// QR con datos móviles, así que las features se cargan una vez acá y cada
// componente animado pesa casi nada. `strict` hace fallar a quien importe
// `motion.*` por error adentro de este árbol.
//
// `reducedMotion="user"`: si el celular pide menos movimiento, Motion apaga
// los desplazamientos y deja sólo los fundidos.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={enter}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
