"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Users } from "lucide-react";

import {
  comensalesDesdeTecla,
  MAX_PARTY_SIZE,
  MIN_PARTY_SIZE,
} from "@/lib/mozo/party-size-keys";
import { InlineModal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { SectionLabel } from "@/components/ui/section-label";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";

/**
 * Cuántos se sientan — spec 146, fast-follow 2.
 *
 * Segundo paso de la apertura de una mesa libre, encadenado al selector de
 * mozo: primero quién la atiende, después cuánta gente. Los dos son el mismo
 * gesto —abrir la mesa— y los dos se contestan con el teclado sin soltar la
 * mano.
 *
 * **Un dígito confirma y cierra.** Es el pedido textual de Juan: *"si pone 4,
 * que pase a la parte de adicionar productos, no que tenga que poner 4 más
 * Enter, son pasos extras que no queremos"*. `+`/`−` y las flechas ajustan sin
 * cerrar —son el camino a las mesas de 10 a 20, donde un dígito no alcanza— y
 * ahí sí confirma el Enter. `Esc` cierra sin tocar nada: la pregunta no
 * bloquea, el panel de abajo queda igual de usable.
 *
 * Los chips son el mismo vocabulario que «Personas» del header del panel
 * (spec 111 · FR-013), que sigue estando para corregir después.
 */

/** Los taps directos; para más está el `+`. Igual que `PersonasChips`. */
const QUICK = [1, 2, 3, 4, 5, 6];

export function ComensalesModal({
  tableLabel,
  valorInicial,
  onConfirmar,
  onCerrar,
}: {
  tableLabel: string;
  valorInicial: number;
  /** Confirmó: este es el número. El cierre lo hace el modal. */
  onConfirmar: (personas: number) => void;
  onCerrar: () => void;
}) {
  useEscapeToClose(onCerrar);
  const [valor, setValor] = useState(valorInicial);
  const cajaRef = useRef<HTMLDivElement>(null);

  // El foco entra al diálogo, no a un botón de adentro: las teclas son del
  // modal (un dígito, `+`, `−`, Enter), no de un control puntual. Sin esto los
  // dígitos se los quedaría el panel de abajo — donde `4` fija la cantidad de
  // una línea del carrito.
  useEffect(() => {
    cajaRef.current?.focus();
  }, []);

  const confirmar = (n: number) => {
    onConfirmar(n);
    onCerrar();
  };

  return (
    <InlineModal
      overlay="absolute"
      zIndexClassName="z-50"
      titleId="comensales-titulo"
      onClose={onCerrar}
      ref={cajaRef}
      tabIndex={-1}
      onKeyDown={(e) => {
          // Con modificador la tecla no es nuestra: `Ctrl+−` y `Ctrl+=` son el
          // zoom del navegador, y `⌘Enter` es «enviar la comanda» del panel de
          // abajo. Sin esto, achicar la pantalla cambiaba cuántos se sientan.
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          // El foco no se escapa del diálogo. Si se escapa, el Esc siguiente lo
          // agarra el panel —que lo lee como «volver un nivel»— y se cierra la
          // mesa entera en vez del modal.
          if (e.key === "Tab") {
            const focusables = Array.from(
              cajaRef.current?.querySelectorAll<HTMLElement>(
                "button:not([disabled])",
              ) ?? [],
            );
            if (focusables.length === 0) return;
            const i = focusables.indexOf(document.activeElement as HTMLElement);
            const siguiente = e.shiftKey
              ? focusables[(i <= 0 ? focusables.length : i) - 1]
              : focusables[i < 0 || i === focusables.length - 1 ? 0 : i + 1];
            e.preventDefault();
            siguiente?.focus();
            return;
          }
          const next = comensalesDesdeTecla(e.key, valor);
          if (next) {
            e.preventDefault();
            setValor(next.valor);
            // El dígito no espera nada: fija y sigue.
            if (next.confirma) confirmar(next.valor);
            return;
          }
          // Las flechas son la otra forma de ajustar, para la mano que ya está
          // en ellas (el resto del panel se recorre así, spec 075).
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setValor((v) =>
              e.key === "ArrowUp"
                ? Math.min(MAX_PARTY_SIZE, v + 1)
                : Math.max(MIN_PARTY_SIZE, v - 1),
            );
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            confirmar(valor);
          }
      }}
    >
      <ModalHeader title={`Comensales · Mesa ${tableLabel}`} />
      <ModalBody>
        <SectionLabel icon={<Users className="h-3.5 w-3.5" />}>
          Cuántos se sientan
        </SectionLabel>

        <div className="mt-3 flex items-center gap-2">
          {QUICK.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => confirmar(n)}
              aria-label={`${n} personas`}
              // El valor de ahora, para el lector de pantalla y para los tests
              // — mismo contrato que los chips «Personas» del header.
              aria-pressed={valor === n}
              className={`flex h-14 flex-1 items-center justify-center rounded-2xl text-lg font-bold tabular-nums transition active:scale-95 ${
                valor === n
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Más de 6 es minoría: no se le dan catorce botones, se ajusta. El
            número grande sólo aparece cuando se salió de los chips — si dice
            «4» arriba y «4» abajo, la fila de abajo no informa nada. */}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setValor((v) => Math.max(MIN_PARTY_SIZE, v - 1))}
            disabled={valor <= MIN_PARTY_SIZE}
            aria-label="Una persona menos"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 active:scale-95 disabled:opacity-30"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setValor((v) => Math.min(MAX_PARTY_SIZE, v + 1))}
            disabled={valor >= MAX_PARTY_SIZE}
            aria-label="Una persona más"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 active:scale-95 disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
          {valor > QUICK.length && (
            <span className="ml-1 text-2xl font-extrabold text-zinc-900 tabular-nums">
              {valor}
            </span>
          )}
          <button
            type="button"
            onClick={() => confirmar(valor)}
            className="ml-auto flex h-11 items-center justify-center rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
          >
            Listo
          </button>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500">
          Tecleá un número y seguís cargando. Con{" "}
          <span className="font-semibold text-zinc-700">+</span> y{" "}
          <span className="font-semibold text-zinc-700">−</span> para mesas de
          más de 9.
        </p>
      </ModalBody>
    </InlineModal>
  );
}
