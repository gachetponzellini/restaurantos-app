"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { toast } from "sonner";

import { I } from "@/components/delivery/primitives";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { EASE_IN, springSnappy } from "@/components/motion/presets";
import { deleteSavedAddress } from "@/lib/customers/addresses-actions";
import type { SavedAddress } from "@/lib/customers/addresses";
import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";

export function AddressesScreen({
  slug,
  addresses,
}: {
  slug: string;
  addresses: SavedAddress[];
}) {
  // Spec 194 — en un negocio que reparte por lote, acá se guardan lotes.
  const entrega = copyDeEntrega(slug);
  const [confirming, setConfirming] = useState<SavedAddress | null>(null);
  // La calle sigue visible mientras el sheet se va (confirming ya es null).
  const lastStreet = useRef("");
  if (confirming) lastStreet.current = confirming.street;
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = (addr: SavedAddress) => {
    startTransition(async () => {
      const r = await deleteSavedAddress(slug, addr.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(entrega.porLote ? "Lote borrado." : "Dirección borrada.");
      setConfirming(null);
      router.refresh();
    });
  };

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header slug={slug} title={entrega.guardadasLabel} />

      <div style={{ flex: 1, padding: "8px 16px 40px" }}>
        {addresses.length === 0 ? (
          <EmptyState porLote={entrega.porLote} />
        ) : (
          <>
            <p
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                margin: "4px 4px 14px",
              }}
            >
              Se guardan solas cada vez que hacés un pedido con envío.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {/* La borrada se va de costado y las de abajo suben a ocupar
                  su lugar. */}
              <AnimatePresence initial={false} mode="popLayout">
                {addresses.map((a) => (
                  <m.div
                    key={a.id}
                    layout
                    exit={{
                      opacity: 0,
                      x: -28,
                      transition: { duration: 0.2, ease: EASE_IN },
                    }}
                    transition={springSnappy}
                  >
                    <AddressRow address={a} onDelete={() => setConfirming(a)} />
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        street={lastStreet.current}
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && handleDelete(confirming)}
      />
    </div>
  );
}

function Header({ slug, title }: { slug: string; title: string }) {
  return (
    <div
      style={{
        paddingTop: 12,
        paddingBottom: 14,
        paddingLeft: 8,
        paddingRight: 16,
        display: "flex",
        alignItems: "center",
        gap: 4,
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <Link
        href={`/${slug}/perfil`}
        aria-label="Volver"
        style={{
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {I.chevLeft("var(--ink)", 22)}
      </Link>
      <div
        className="d-display"
        style={{ fontSize: 22, lineHeight: 1.1, color: "var(--ink)" }}
      >
        {title}
      </div>
    </div>
  );
}

function AddressRow({
  address,
  onDelete,
}: {
  address: SavedAddress;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        border: "1px solid var(--hairline)",
        borderRadius: 14,
        padding: "14px 14px 14px 16px",
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "#F1EBDF",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {I.pin("var(--ink-2)", 18)}
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          color: "var(--ink)",
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={address.street}
      >
        {address.street}
      </div>
      <button
        onClick={onDelete}
        aria-label="Borrar dirección"
        style={{
          width: 36,
          height: 36,
          border: "none",
          background: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 10,
          color: "var(--ink-3)",
          flexShrink: 0,
        }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M8 6v-2a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function EmptyState({ porLote }: { porLote: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "60px 24px 20px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 99,
          background: "#F1EBDF",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {I.pin("var(--ink-3)", 24)}
      </span>
      <div className="d-display" style={{ fontSize: 22, color: "var(--ink)" }}>
        {porLote
          ? "Todavía no guardaste lotes"
          : "Todavía no guardaste direcciones"}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-3)", maxWidth: 320 }}>
        {porLote ? "Tus lotes aparecen" : "Tus direcciones aparecen"} acá
        automáticamente cuando hacés tu primer envío.
      </div>
    </div>
  );
}

function ConfirmDialog({
  open,
  street,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  street: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      canClose={!pending}
      zIndex={50}
      role="dialog"
      panelStyle={{ padding: "4px 20px 28px" }}
    >
      <div
        className="d-display"
        style={{ fontSize: 22, color: "var(--ink)", marginBottom: 6 }}
      >
        Borrar dirección
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--ink-2)",
          marginBottom: 20,
          lineHeight: 1.4,
        }}
      >
        Vas a borrar <strong style={{ color: "var(--ink)" }}>{street}</strong>.
        Si pedís de nuevo a esa dirección, se guarda otra vez sola.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onCancel}
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
          Cancelar
        </button>
        <button
          onClick={onConfirm}
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
          {pending ? "Borrando…" : "Borrar"}
        </button>
      </div>
    </BottomSheet>
  );
}
