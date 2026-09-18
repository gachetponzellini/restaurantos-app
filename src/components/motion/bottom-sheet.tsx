"use client";

import { AnimatePresence, useDragControls, type PanInfo } from "motion/react";
import * as m from "motion/react-m";

import { EASE_DRAWER, EASE_IN } from "./presets";

// Sheet inferior de la parte pública: entra con la curva de iOS, sale de
// verdad (antes desaparecía de golpe al cerrar) y se cierra arrastrándolo
// hacia abajo desde la manija. El arrastre arranca SÓLO en la manija: el resto
// del panel scrollea y tiene inputs, y no queremos que un scroll lo cierre.

const CLOSE_OFFSET_PX = 110;
const CLOSE_VELOCITY = 520;

export function BottomSheet({
  open,
  onClose,
  canClose = true,
  zIndex = 60,
  panelStyle,
  role,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** false mientras hay una acción en curso: ni backdrop ni arrastre cierran. */
  canClose?: boolean;
  zIndex?: number;
  panelStyle?: React.CSSProperties;
  role?: "dialog";
  children: React.ReactNode;
}) {
  const drag = useDragControls();

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (!canClose) return;
    if (info.offset.y > CLOSE_OFFSET_PX || info.velocity.y > CLOSE_VELOCITY) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="sheet"
          role={role}
          aria-modal={role ? true : undefined}
          onClick={() => canClose && onClose()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.22, ease: EASE_IN } }}
          transition={{ duration: 0.3, ease: "linear" }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            background: "rgba(0,0,0,0.38)",
          }}
        >
          <m.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: 0.24, ease: EASE_IN } }}
            transition={{ duration: 0.44, ease: EASE_DRAWER }}
            drag={canClose ? "y" : false}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.9 }}
            onDragEnd={handleDragEnd}
            style={{
              background: "var(--bg)",
              borderRadius: "18px 18px 0 0",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              maxWidth: 520,
              width: "100%",
              margin: "0 auto",
              willChange: "transform",
              ...panelStyle,
            }}
          >
            {/* Manija: zona de arrastre generosa (el dedo no apunta a 4px). */}
            <div
              onPointerDown={(e) => canClose && drag.start(e)}
              aria-hidden
              style={{
                padding: "8px 0 6px",
                display: "flex",
                justifyContent: "center",
                flexShrink: 0,
                touchAction: "none",
                cursor: canClose ? "grab" : "default",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 4,
                  background: "var(--hairline-2)",
                }}
              />
            </div>
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
