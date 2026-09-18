"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { AmountCard } from "@/components/ui/amount-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  SelectorDeMetodo,
  metodosOfrecidos,
} from "@/components/billing/selector-de-metodo";
import { registrarCobranza } from "@/lib/caja/cuenta-corriente-actions";
import type { DeudorRow } from "@/lib/caja/cuenta-corriente-queries";
import type { Caja } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { useRovingList } from "@/lib/ui/use-roving-list";

/**
 * Los métodos que `registrarCobranza` sabe registrar. Se listan explícitos —y
 * no se deja pasar la lista entera— porque el límite acá lo pone el server: un
 * método que la action no acepta sería un botón que siempre falla. Mercado Pago
 * y «Cuenta corriente» quedan afuera solos (no se paga una deuda con otra).
 */
const METODOS_DE_COBRANZA = [
  "cash",
  "card_manual",
  "transfer",
  "other",
] as const;

type MetodoDeCobranza = (typeof METODOS_DE_COBRANZA)[number];

/**
 * Cobrar el saldo de una cuenta corriente — spec 141 · US4.
 *
 * El monto arranca en el saldo entero, que es el caso normal: el socio viene a
 * saldar. Se puede bajar para un pago parcial, y el server no acepta más de lo
 * que se debe.
 */
export function CobrarSaldoModal({
  slug,
  cajas,
  deudor,
  onClose,
}: {
  slug: string;
  cajas: Caja[];
  deudor: DeudorRow;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [monto, setMonto] = useState(String(deudor.saldo_cents / 100));
  const [metodo, setMetodo] = useState<MetodoDeCobranza>("cash");

  // El mismo selector de la mesa, el pedido y el mostrador (spec 157 · D1): la
  // grilla propia que vivía acá era la cuarta copia. Con él vienen los dígitos
  // 1-4 y las flechas de la spec 075, que esta pantalla no tenía.
  //
  // Lo que NO viene es el resto de `CobroForm`, y es a propósito: una cobranza
  // no lleva propina, ni split, ni fiado, no se puede facturar —la venta ya se
  // facturó al fiar (spec 141 · D1), emitir acá sería declararla dos veces— y
  // **sí admite pagar de menos**, que es justo lo que la guarda de efectivo del
  // formulario impide. Un saldo se paga de a poco: eso es lo que lo hace una
  // cuenta corriente y no un ticket.
  const metodos = useMemo(
    () =>
      metodosOfrecidos({
        allowedMethods: [...METODOS_DE_COBRANZA],
        mp: false,
        cuentaCorriente: false,
      }),
    [],
  );
  const zonaMetodos = useRovingList<HTMLButtonElement>({
    length: metodos.length,
    columns: 2,
  });
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? "");
  const [notas, setNotas] = useState("");

  const cents = Math.round(Number(monto.replace(",", ".")) * 100);
  const invalido =
    !Number.isFinite(cents) ||
    cents <= 0 ||
    cents > deudor.saldo_cents ||
    // El efectivo entra al cajón, así que hay que decir a cuál (D5).
    (metodo === "cash" && !cajaId);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent size="md">
        <ModalHeader title={`Pago de ${deudor.name ?? deudor.phone}`} />
        <ModalBody className="grid gap-4">
          <AmountCard label="Debe" value={formatCurrency(deudor.saldo_cents)} />

          <div className="grid gap-1.5">
            <Label htmlFor="cobranza-monto">Cuánto paga</Label>
            <Input
              id="cobranza-monto"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="text-base tabular-nums"
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Cómo paga</Label>
            <SelectorDeMetodo
              metodos={metodos}
              // Sin ajuste por método: lo que entra es lo que se debe. Recargarle
              // un 10 % al que viene a saldar cambiaría la deuda al cobrarla, y el
              // server rechaza cobrar más que el saldo.
              methodConfigs={[]}
              baseCents={deudor.saldo_cents}
              value={metodo}
              onChange={(m) => setMetodo(m as MetodoDeCobranza)}
              zona={zonaMetodos}
            />
          </div>

          {/* Sólo el efectivo pide caja: lo demás no toca el cajón, y preguntarlo
              sugeriría que el arqueo lo va a esperar. */}
          {metodo === "cash" && cajas.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="cobranza-caja">Entra en</Label>
              <select
                id="cobranza-caja"
                value={cajaId}
                onChange={(e) => setCajaId(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-card px-3 text-base"
              >
                {cajas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="cobranza-notas">Nota (opcional)</Label>
            <Input
              id="cobranza-notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: pagó por transferencia el viernes"
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" size="xl" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="xl"
            disabled={invalido || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await registrarCobranza({
                  customerId: deudor.customer_id,
                  amount_cents: cents,
                  method: metodo,
                  cajaId: metodo === "cash" ? cajaId : null,
                  notes: notas,
                  slug,
                });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(
                  r.data.saldo_cents > 0
                    ? `Pago registrado. Queda debiendo ${formatCurrency(r.data.saldo_cents)}`
                    : "Pago registrado. Cuenta saldada",
                );
                onClose();
              })
            }
          >
            {pending ? "Registrando…" : "Registrar pago"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
