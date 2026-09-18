"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parsePesos } from "@/lib/catalog/money-input";
import { formatCurrency } from "@/lib/currency";

export type ItemLibreDraft = {
  name: string;
  unit_price_cents: number;
  quantity: number;
};

/**
 * Spec 174 — el «no existe»: un renglón con nombre y precio tipeados en el
 * momento.
 *
 * No toca el servidor: devuelve el borrador para que el carrito lo guarde y
 * viaje con el envío. La validación real (rol + forma) la rehace el server en
 * `validateItemLibre` — acá sólo evitamos llegar al botón con el formulario a
 * medias.
 *
 * Compartido por las tres pantallas de carga, como el
 * [`PriceOverrideModal`](./price-override-modal.tsx) de la 069: el mismo
 * renglón se carga desde la mesa, desde el pedido sin mesa y desde el
 * mostrador, y tiene que pedir exactamente lo mismo en los tres lados.
 */
export function ItemLibreModal({
  nombreSugerido,
  onConfirm,
  onClose,
}: {
  /**
   * Lo que se tipeó en el buscador. Nueve de cada diez veces ya *es* el nombre
   * del artículo («torta del cliente»), así que entra escrito: el gesto es
   * buscar algo, no encontrarlo y cargarlo igual — no volver a tipearlo.
   */
  nombreSugerido: string;
  onConfirm: (draft: ItemLibreDraft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(nombreSugerido);
  const [pesos, setPesos] = useState("");
  const [quantity, setQuantity] = useState(1);
  const nameId = useId();
  const priceId = useId();
  const qtyId = useId();

  // El mismo parser que el resto de los campos de plata (issue #269): «18.500»
  // son dieciocho mil quinientos pesos, no dieciocho con cincuenta.
  const parsed = parsePesos(pesos);
  const cents = parsed.ok ? parsed.cents : 0;
  const nombreOk = name.trim().length > 0;
  const canConfirm = nombreOk && parsed.ok;

  const confirmar = () => {
    if (!canConfirm) return;
    onConfirm({ name: name.trim(), unit_price_cents: cents, quantity });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Artículo que no existe</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Un renglón suelto, con el nombre y el precio que pongas acá.{" "}
          <span className="text-foreground font-semibold">No va a cocina</span>{" "}
          — sale sólo en la cuenta y en el ticket del cliente. El catálogo no se
          toca.
        </p>

        <label htmlFor={nameId} className="block space-y-1.5">
          <span className="text-sm font-medium">Nombre</span>
          <input
            id={nameId}
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Ej: Torta del cliente, Menú sanatorio"
            className="border-input bg-background focus-visible:ring-ring h-12 w-full rounded-lg border px-3 text-base font-semibold outline-none focus-visible:ring-2"
          />
          <span className="text-muted-foreground block text-xs">
            Es lo que va a leer el cliente en el ticket.
          </span>
        </label>

        <div className="flex gap-3">
          <label htmlFor={priceId} className="block flex-1 space-y-1.5">
            <span className="text-sm font-medium">Precio ($)</span>
            <input
              id={priceId}
              type="text"
              inputMode="decimal"
              value={pesos}
              onChange={(e) => setPesos(e.target.value)}
              placeholder="0"
              className="border-input bg-background focus-visible:ring-ring h-12 w-full rounded-lg border px-3 text-lg font-semibold outline-none focus-visible:ring-2"
            />
          </label>

          <label htmlFor={qtyId} className="block w-28 space-y-1.5">
            <span className="text-sm font-medium">Cantidad</span>
            <input
              id={qtyId}
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={quantity}
              onChange={(e) => {
                const n = Number(e.target.value);
                setQuantity(Number.isInteger(n) && n >= 1 && n <= 99 ? n : 1);
              }}
              className="border-input bg-background focus-visible:ring-ring h-12 w-full rounded-lg border px-3 text-lg font-semibold outline-none focus-visible:ring-2"
            />
          </label>
        </div>

        {parsed.ok && quantity > 1 && (
          <p className="text-muted-foreground text-xs font-medium">
            {quantity} × {formatCurrency(cents)} ={" "}
            <span className="text-foreground font-semibold">
              {formatCurrency(cents * quantity)}
            </span>
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={confirmar}
            disabled={!canConfirm}
          >
            <Plus className="size-4" strokeWidth={2.5} />
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
