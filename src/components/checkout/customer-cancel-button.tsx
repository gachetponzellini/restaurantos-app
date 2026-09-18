"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { BottomSheet } from "@/components/motion/bottom-sheet";
import { cancelOrderByCustomer } from "@/lib/orders/customer-cancel-actions";

export function CustomerCancelButton({
  orderId,
  businessSlug,
  wasPaid = false,
}: {
  orderId: string;
  businessSlug: string;
  /** Shows extra copy warning about the auto-refund attempt. */
  wasPaid?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      const r = await cancelOrderByCustomer({
        order_id: orderId,
        business_slug: businessSlug,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data.refund === "refunded") {
        toast.success(
          "Pedido cancelado y reembolso procesado. Puede tardar unos días en reflejarse.",
        );
      } else if (r.data.refund === "manual") {
        toast.success(
          "Pedido cancelado. El local va a gestionar el reembolso — podés consultarlo por WhatsApp.",
        );
      } else {
        toast.success("Pedido cancelado.");
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          height: 44,
          marginTop: 8,
          background: "none",
          border: "none",
          fontSize: 13,
          fontWeight: 500,
          color: "#B94A2A",
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Cancelar pedido
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        canClose={!pending}
        role="dialog"
        panelStyle={{ padding: "4px 20px 28px" }}
      >
        <div
          className="d-display"
          style={{ fontSize: 22, color: "var(--ink)", marginBottom: 6 }}
        >
          ¿Cancelar el pedido?
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-2)",
            marginBottom: 20,
            lineHeight: 1.4,
          }}
        >
          Se cancela solo si el local todavía no empezó a prepararlo.
          {wasPaid && (
            <>
              {" "}
              <strong style={{ color: "var(--ink)" }}>Como ya pagaste</strong>,
              intentamos el reembolso automático vía Mercado Pago. Si falla, el
              local se comunica con vos.
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 12,
              border: "1px solid var(--hairline-2)",
              background: "#fff",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ink)",
              cursor: pending ? "wait" : "pointer",
            }}
          >
            Volver
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 12,
              border: "none",
              background: pending ? "#C7BBA6" : "#B94A2A",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
            }}
          >
            {pending ? "Cancelando…" : "Sí, cancelar"}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
