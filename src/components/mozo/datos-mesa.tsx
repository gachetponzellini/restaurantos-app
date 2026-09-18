"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Minus, Plus, Users } from "lucide-react";
import { toast } from "sonner";

import { CustomerFields } from "@/components/shared/customer-fields";
import { guardarDatosMesa } from "@/lib/mozo/datos-mesa";
import { MAX_PARTY_SIZE, MIN_PARTY_SIZE } from "@/lib/mozo/party-size-keys";
import { Button } from "@/components/ui/button";
import { InlineModal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";

/** Los taps directos; para más se usa el `+`. */
const QUICK = [1, 2, 3, 4, 5, 6];

/**
 * «Personas» arriba del buscador (spec 111, FR-013).
 *
 * Es **un tap, no un paso**: no tiene pantalla propia, no bloquea y el foco
 * sigue arrancando en el buscador. Antes vivía en el formulario de walk-in,
 * que era lo único que separaba tocar una mesa libre de empezar a cargar.
 *
 * Dónde se guarda depende de si la mesa ya tiene pedido abierto:
 *  - **sin orden todavía** (nada enviado): queda en el estado del panel y
 *    viaja con el primer envío (`enviarComanda.partySize`), que es el que
 *    crea la orden.
 *  - **con orden**: se persiste en el momento, porque el envío ya no la va a
 *    crear y el dato se perdería.
 *
 * Los dígitos NO son atajo acá: el foco está en el buscador y ahí `4` es un
 * cuatro. Los atajos 1-9 siguen viviendo en el walk-in con formulario.
 */
/** Lo que se espera a que el de la mesa termine de decidir cuántos son. */
const GUARDADO_DEBOUNCE_MS = 700;

export function PersonasChips({
  slug,
  tableId,
  value,
  onChange,
  /** `true` si la mesa ya tiene orden abierta (hay algo enviado). */
  persistir,
}: {
  slug: string;
  tableId: string;
  value: number;
  onChange: (n: number) => void;
  persistir: boolean;
}) {
  /**
   * El tap se ve al instante y el guardado va por atrás (spec 111).
   *
   * Antes cada tap entraba en un `useTransition` y los ocho botones quedaban
   * `disabled` hasta que volvía el server: tocabas «4», se congelaba el
   * control, y si eran 6 tenías que esperar a que se descongelara para
   * corregir. Encima la action revalidaba la ruta, así que la transición
   * quedaba abierta hasta que se re-renderizaba `/admin/operacion` entera.
   *
   * Personas no es plata: no hay nada que confirmar antes de mostrarlo. Se
   * pinta el número elegido y se manda **una** escritura cuando el de la mesa
   * dejó de tocar (de 2 a 6 son cuatro taps y un solo viaje).
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendienteRef = useRef<number | null>(null);

  const guardar = useCallback(
    (n: number) => {
      pendienteRef.current = null;
      void guardarDatosMesa({ tableId, slug, partySize: n }).then((r) => {
        if (!r.ok) toast.error(r.error);
      });
    },
    [tableId, slug],
  );

  // Si el panel se cierra con un guardado en el aire, se manda igual: perder
  // el dato por cerrar rápido sería peor que un viaje de más.
  useEffect(() => {
    const t = timer;
    const p = pendienteRef;
    return () => {
      if (t.current) clearTimeout(t.current);
      if (p.current != null) guardar(p.current);
    };
  }, [guardar]);

  const set = (n: number) => {
    const clamped = Math.min(MAX_PARTY_SIZE, Math.max(MIN_PARTY_SIZE, n));
    onChange(clamped);
    if (!persistir) return;
    pendienteRef.current = clamped;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => guardar(clamped), GUARDADO_DEBOUNCE_MS);
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        <Users className="h-3.5 w-3.5" />
        Personas
      </span>
      <div className="flex items-center gap-1">
        {QUICK.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => set(n)}
            aria-pressed={value === n}
            aria-label={`${n} personas`}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold tabular-nums transition active:scale-95 ${
              value === n
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {n}
          </button>
        ))}
        {/* Más de 6 es minoría: no se le dan seis botones más, se ajusta. */}
        <button
          type="button"
          onClick={() => set(value - 1)}
          disabled={value <= MIN_PARTY_SIZE}
          aria-label="Una persona menos"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 active:scale-95 disabled:opacity-30"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => set(value + 1)}
          disabled={value >= MAX_PARTY_SIZE}
          aria-label="Una persona más"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 active:scale-95 disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {value > QUICK.length && (
          <span className="ml-0.5 text-sm font-bold text-zinc-900 tabular-nums">
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * «Cargar cliente» (spec 111, FR-015) — el bloque de nombre y teléfono que
 * antes había que pasar **para sentar a alguien**, ahora detrás de una acción
 * opcional. La mayoría de las mesas no lo necesita; las que sí (cuenta a
 * nombre de, cliente del CRM, delivery de un conocido) lo cargan cuando hace
 * falta, antes o después de enviar.
 */
export function CargarClienteModal({
  slug,
  tableId,
  tableLabel,
  onClose,
  onSaved,
  overlay = "fixed",
}: {
  slug: string;
  tableId: string;
  tableLabel: string;
  onClose: () => void;
  onSaved?: () => void;
  /** `absolute` cuando se abre **dentro** del panel de carga (que ya scopea sus
   *  modales al `<aside>`); `fixed` cuando lo abre el ⋯ del salón. */
  overlay?: "absolute" | "fixed";
}) {
  useEscapeToClose(onClose);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();

  const guardar = () => {
    if (!name.trim() && !phone.trim()) {
      onClose();
      return;
    }
    startTransition(async () => {
      const r = await guardarDatosMesa({
        tableId,
        slug,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Cliente cargado.");
      onSaved?.();
      onClose();
    });
  };

  return (
    <InlineModal overlay={overlay} zIndexClassName="z-50" onClose={onClose}>
      <ModalHeader
        title={`Cliente · ${tableLabel}`}
        description="Todo opcional. Si dejás teléfono, entra al CRM."
      />
      <ModalBody>
        <CustomerFields
          slug={slug}
          idPrefix="datos-mesa"
          name={name}
          phone={phone}
          onNameChange={setName}
          onPhoneChange={setPhone}
          autoFocus
        />
      </ModalBody>
      <ModalFooter>
        <Button size="xl" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </ModalFooter>
    </InlineModal>
  );
}
