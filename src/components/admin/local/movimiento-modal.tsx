"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/currency";

/**
 * El modal de "monto + motivo" de la caja: sangría e ingreso.
 *
 * Vivía adentro de `caja-admin-board.tsx` como función privada. La spec 168 lo
 * saca a su propio archivo para que la tarjeta de la Caja Mayor en Proveedores
 * pueda fondearla con el mismo formulario — mismo freno de monto, mismo motivo
 * obligatorio, misma ergonomía. Copiarlo habría sido tener dos.
 */
export function MovimientoModal({
  open,
  onOpenChange,
  title,
  description,
  requiereMotivo,
  ctaLabel,
  disponibleCents,
  icon,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  requiereMotivo: boolean;
  ctaLabel: string;
  /**
   * Efectivo que la caja debería tener ahora. Sólo lo pasa la sangría: sacar
   * más de lo que hay no es una operación, es un cero de más (issue #188 —
   * $100.000 sobre una caja de $55.800 entraban sin chistar y la dejaban en
   * −$44.200). No se bloquea, porque puede haber plata que no pasó por el
   * sistema; se hace pisar el freno una vez.
   */
  disponibleCents?: number;
  icon?: React.ReactNode;
  onSubmit: (amountCents: number, reason: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!open) { setAmount(""); setReason(""); }
  }, [open]);

  const cents = Math.max(0, Math.round(Number(amount) * 100));
  const canSubmit = cents > 0 && (!requiereMotivo || reason.trim() !== "");
  const excede = disponibleCents != null && cents > disponibleCents;

  // Cambiar el monto vuelve a pedir la confirmación: si corregiste el cero de
  // más, no querés que el botón siga armado para el número viejo.
  useEffect(() => {
    setConfirmando(false);
  }, [amount, open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="sm">
        <ModalHeader title={title} description={description} icon={icon} />
        <ModalBody className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Monto</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">$</span>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus inputMode="decimal" className="h-11 pl-7 text-base tabular-nums" />
            </div>
            {excede && (
              <p className="text-xs font-semibold text-amber-700">
                En la caja hay {formatCurrency(disponibleCents!)}. Con esta
                sangría queda en {formatCurrency(disponibleCents! - cents)}.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Motivo{requiereMotivo && <span className="ml-1 text-destructive">*</span>}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={requiereMotivo ? "Ej: depósito en banco / pago proveedor" : "Opcional"} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" size="xl" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            size="xl"
            disabled={!canSubmit}
            onClick={() => {
              if (excede && !confirmando) {
                setConfirmando(true);
                return;
              }
              onSubmit(cents, reason.trim() || null);
            }}
          >
            {excede && confirmando
              ? `Sacar igual ${formatCurrency(cents)}`
              : ctaLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
