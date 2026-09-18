"use client";

import { useState } from "react";
import { Armchair, Check, MoveRight, Wine } from "lucide-react";
import { toast } from "sonner";

import { trasladarMesa } from "@/lib/mozo/actions";
import { Button } from "@/components/ui/button";
import { InlineModal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { SectionLabel } from "@/components/ui/section-label";

export type DestTable = {
  id: string;
  label: string;
  seats: number;
  is_bar?: boolean;
};

type Props = {
  fromTableId: string;
  fromLabel: string;
  /** Mesas destino candidatas (ya filtradas: libres, distintas de la origen). */
  tables: DestTable[];
  businessSlug: string;
  onClose: () => void;
  onSuccess: (toTableId: string) => void;
};

export function TrasladarMesaModal({
  fromTableId,
  fromLabel,
  tables,
  businessSlug,
  onClose,
  onSuccess,
}: Props) {
  const [toTableId, setToTableId] = useState<string>(tables[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!toTableId) {
      toast.error("Elegí una mesa destino.");
      return;
    }
    setSubmitting(true);
    const result = await trasladarMesa(fromTableId, toTableId, businessSlug);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Mesa trasladada.");
    onSuccess(toTableId);
  };

  return (
    <InlineModal overlay="fixed" zIndexClassName="z-[60]" onClose={onClose}>
      <ModalHeader title={`Trasladar mesa ${fromLabel}`} />
      <ModalBody>
        <div>
          <SectionLabel>Mover a</SectionLabel>
          {tables.length === 0 ? (
            <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
              No hay mesas libres para mover. Cobrá o liberá una primero.
            </p>
          ) : (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl ring-1 ring-zinc-200">
              {tables.map((t) => {
                const selected = t.id === toTableId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setToTableId(t.id)}
                    className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition last:border-b-0 active:bg-zinc-50 ${
                      selected ? "bg-sky-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
                        selected ? "bg-sky-600" : "bg-zinc-700"
                      }`}
                    >
                      {t.is_bar ? (
                        <Wine className="h-4 w-4" />
                      ) : (
                        <Armchair className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        Mesa {t.label}
                        {t.is_bar ? " · barra" : ""}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t.seats} {t.seats === 1 ? "silla" : "sillas"} · libre
                      </p>
                    </div>
                    {selected && <Check className="h-5 w-5 text-sky-600" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size="xl" disabled={submitting || !toTableId} onClick={onSubmit}>
          <MoveRight className="h-5 w-5" />
          {submitting ? "Trasladando…" : "Trasladar mesa"}
        </Button>
      </ModalFooter>
    </InlineModal>
  );
}
