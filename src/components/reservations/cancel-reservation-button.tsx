"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cancelOwnReservation } from "@/lib/reservations/booking-actions";

export function CancelReservationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Cerrar con Escape mientras el diálogo está abierto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  function confirmCancel() {
    start(async () => {
      const result = await cancelOwnReservation({ id });
      if (result.ok) {
        toast.success("Reserva cancelada");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        disabled={pending}
        style={{
          height: 44,
          padding: "0 18px",
          borderRadius: 12,
          background: "var(--bg)",
          color: "var(--ink-2)",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: -0.1,
          border: "1px solid var(--hairline-2)",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
          fontFamily: "inherit",
        }}
      >
        {pending ? "Cancelando…" : "Cancelar reserva"}
      </button>

      {open && mounted
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirmar cancelación de la reserva"
              onClick={() => {
                if (!pending) setOpen(false);
              }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 60,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(2px)",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: 320,
                  background: "var(--bg)",
                  borderRadius: 20,
                  padding: "24px 20px 20px",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
                  textAlign: "center",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: -0.3,
                    color: "var(--ink)",
                  }}
                >
                  ¿Cancelar la reserva?
                </h2>
                <p
                  style={{
                    margin: "8px 0 20px",
                    fontSize: 14,
                    lineHeight: 1.45,
                    color: "var(--ink-3)",
                  }}
                >
                  Esta acción no se puede deshacer.
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setOpen(false)}
                    disabled={pending}
                    style={{
                      flex: 1,
                      height: 46,
                      borderRadius: 12,
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 15,
                      fontWeight: 600,
                      border: "1px solid var(--hairline)",
                      cursor: pending ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    No, volver
                  </button>
                  <button
                    type="button"
                    onClick={confirmCancel}
                    disabled={pending}
                    style={{
                      flex: 1,
                      height: 46,
                      borderRadius: 12,
                      background: "#dc2626",
                      color: "#fff",
                      fontSize: 15,
                      fontWeight: 600,
                      border: "1px solid #dc2626",
                      cursor: pending ? "default" : "pointer",
                      opacity: pending ? 0.7 : 1,
                      fontFamily: "inherit",
                    }}
                  >
                    {pending ? "Cancelando…" : "Sí, cancelar"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** H-14 — en lugar del botón cuando ya pasó la ventana de cancelación online. */
export function CancelOutOfWindowNote() {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        color: "var(--ink-3)",
        lineHeight: 1.4,
        textAlign: "center",
      }}
    >
      Para cancelar, avisale al local.
    </p>
  );
}
