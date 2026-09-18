"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

import { EASE_OUT } from "./presets";

// Un valor que cambia (cantidad, total) se reemplaza deslizando: el nuevo sube
// desde abajo y el viejo se va para arriba. Da la sensación de contador sin
// animar número por número.
export function AnimatedValue({
  value,
  children,
  style,
}: {
  value: string | number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        overflow: "hidden",
        verticalAlign: "bottom",
        ...style,
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={value}
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={{ duration: 0.26, ease: EASE_OUT }}
          style={{ display: "inline-block" }}
        >
          {children ?? value}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
