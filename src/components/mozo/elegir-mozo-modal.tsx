"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search, UserMinus, X } from "lucide-react";
import { toast } from "sonner";

import { assignMozoToTable, transferTable } from "@/lib/mozo/actions";
import { filterMozos, shouldShowMozoSearch } from "@/lib/mozo/mozo-search";
import type { MozoMember } from "@/lib/mozo/queries";
import { Button } from "@/components/ui/button";
import { InlineModal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { SectionLabel } from "@/components/ui/section-label";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";
import { useRovingList } from "@/lib/ui/use-roving-list";

/**
 * Elegir el mozo de una mesa — spec 146 · A (era `transfer-table-modal.tsx`).
 *
 * Un solo modal, dos modos, y el modo decide la action:
 *
 * - **`asignar`** — la mesa no tiene mozo. `assignMozoToTable`: sin motivo, sin
 *   notificación, y **elegir es confirmar** (un paso). Es el pedido de la
 *   encargada de Golf: *"entrar en la mesa, elegir el mozo y ya empezar a
 *   comandar"*, sobre un salón con un solo mozo donde no hay nada que
 *   distribuir.
 * - **`transferir`** — la mesa ya tiene dueño. `transferTable`, como siempre
 *   (spec 079): elegir marca, el motivo es opcional y el CTA confirma, porque
 *   al destino le llega una notificación.
 *
 * No se unifican las dos actions: asignar no es transferir. No hay de quién
 * sacar la mesa, no hay motivo que escribir, y avisarle a un mozo que le
 * «transfirieron» una mesa que nunca tuvo es ruido en el teléfono de alguien
 * que está laburando.
 *
 * El teclado es el del resto del panel (spec 075): ↑/↓ mueven el foco real por
 * la lista, Enter hace lo del modo, Esc cierra. `conTeclado` lo prende: en el
 * teléfono del mozo no hay flechas y el autofoco abriría el teclado virtual
 * justo encima de la lista que venís a mirar.
 */

type Props = {
  modo: "asignar" | "transferir";
  tableId: string;
  tableLabel: string;
  currentMozoId: string | null;
  mozos: MozoMember[];
  businessSlug: string;
  /** La superficie tiene teclado físico (el salón sí, el teléfono no). */
  conTeclado?: boolean;
  /**
   * Puede **dejar la mesa sin mozo** (`canAssignMozo`). Sacar es asignar a
   * nadie, así que pasa por el mismo permiso: el mozo desde su teléfono puede
   * pasarle la mesa a otro, no dejarla huérfana.
   */
  puedeSacar?: boolean;
  /**
   * Dónde se ancla el overlay.
   *
   * - `"absolute"` — **dentro del panel** del salón, que ya scopea sus modales
   *   al `<aside>` (igual que el modal de producto y la ayuda de atajos). Tapa
   *   el panel y **deja el plano vivo**: tocar otra mesa sigue siendo un solo
   *   gesto, en vez de uno para cerrar el modal y otro para la mesa.
   * - `"fixed"` (default) — pantalla completa, que es lo que quiere el teléfono
   *   del mozo: ahí el modal es una hoja que sube desde abajo.
   */
  overlay?: "fixed" | "absolute";
  onClose: () => void;
  /** Recibe el `user_id` elegido —o `null` si se sacó el mozo—, para el overlay
   *  optimista del llamador. */
  onSuccess: (mozoId: string | null) => void;
};

export function ElegirMozoModal({
  modo,
  tableId,
  tableLabel,
  currentMozoId,
  mozos,
  businessSlug,
  conTeclado = false,
  puedeSacar = false,
  overlay = "fixed",
  onClose,
  onSuccess,
}: Props) {
  useEscapeToClose(onClose);
  const candidates = mozos.filter((m) => m.user_id !== currentMozoId);
  const [toMozoId, setToMozoId] = useState<string>(
    candidates[0]?.user_id ?? "",
  );
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  /**
   * ¿Va el buscador?
   *
   * Donde hay **teclado** (el salón), siempre: se entra tipeando dos letras y
   * Enter, que es más rápido que mirar una lista aunque tenga cuatro nombres —y
   * mucho más ahora que el selector se abre solo al entrar a la mesa.
   *
   * Donde no (el teléfono del mozo), sigue la regla de la spec 079 · FR-002: a
   * partir de 7 candidatos. Ahí el modal es un bottom sheet y el input empuja
   * hacia abajo justo la lista que venís a mirar, con el teclado virtual
   * comiéndose el resto.
   */
  const showSearch = conTeclado || shouldShowMozoSearch(candidates.length);
  const visibles = showSearch ? filterMozos(candidates, search) : candidates;

  /**
   * Sólo se transfiere a quien está viendo (spec 079 · FR-003): si el elegido
   * quedó fuera de la búsqueda, el destino vale vacío y el CTA se apaga. Es
   * derivado y no un `useEffect` que borre `toMozoId`, así al limpiar la
   * búsqueda el que habías elegido vuelve a estar elegido.
   */
  const effectiveToMozoId = visibles.some((m) => m.user_id === toMozoId)
    ? toMozoId
    : "";

  const lista = useRovingList<HTMLButtonElement>({
    length: visibles.length,
    onExitUp: () => searchRef.current?.focus(),
    onExitDown: () => reasonRef.current?.focus(),
  });
  const { focusFirst } = lista;

  // Al abrir, el foco entra donde se empieza a trabajar: el buscador si está
  // (se entra tipeando el nombre), y si no la primera fila.
  //
  // `tableId` en las deps porque el modal **no se desmonta al cambiar de mesa**:
  // con el selector abierto se puede tocar otra mesa en el plano —el modal vive
  // dentro del panel y lo deja vivo a propósito— y el mismo componente se
  // reapunta a la mesa nueva. Sin esto, el foco se quedaba en el plano y el
  // modal aparecía mudo.
  useEffect(() => {
    if (!conTeclado) return;
    if (showSearch) searchRef.current?.focus();
    else focusFirst();
  }, [conTeclado, showSearch, focusFirst, tableId]);

  const asignar = async (mozoId: string | null) => {
    setSubmitting(true);
    const result = await assignMozoToTable(tableId, mozoId, businessSlug);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    // Sin toast: asignar no tiene nada que avisar que no se vea solo. La mesa
    // pasa a decir el nombre en el header y el plano lo escribe debajo, en el
    // acto (overlay optimista). Un cartel encima de eso es ruido en la pantalla
    // donde se trabaja apurado. El error sí avisa — eso no se ve.
    onSuccess(mozoId);
  };

  const transferir = async () => {
    if (!effectiveToMozoId) {
      toast.error("Elegí un mozo destino.");
      return;
    }
    setSubmitting(true);
    const result = await transferTable(
      tableId,
      effectiveToMozoId,
      businessSlug,
      reason.trim() || undefined,
    );
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Mesa transferida.");
    onSuccess(effectiveToMozoId);
  };

  /** Tocar (o Enter sobre) una fila. En `asignar` **es** la acción. */
  const elegir = (mozoId: string) => {
    setToMozoId(mozoId);
    if (modo === "asignar") void asignar(mozoId);
  };

  const titulo = modo === "asignar" ? "Asignar mozo" : "Transferir mozo";

  return (
    // `role="dialog"` (que pone `InlineModal`) no es decoración: es el
    // contrato con el que las otras superficies deciden que las teclas son de
    // acá. El panel del salón ignora Esc/Backspace/`?` cuando el evento sale
    // de un diálogo, y el ⌘Enter de «enviar la comanda» (spec 143 · D5) se
    // corta cuando hay un diálogo de afuera abierto. Sin el rol, el modal
    // abierto encima dejaba pasar el atajo y se iba una comanda a cocina
    // desde abajo.
    <InlineModal
      overlay={overlay}
      zIndexClassName="z-[60]"
      titleId="elegir-mozo-titulo"
      onClose={onClose}
    >
      <ModalHeader title={`${titulo} · Mesa ${tableLabel}`} />
      <ModalBody className="space-y-4">
        <div>
          <SectionLabel>
            {modo === "asignar" ? "Quién la atiende" : "Pasar a"}
          </SectionLabel>
            {showSearch && (
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  // Mismo contrato que el buscador de productos del panel
                  // (specs 073/075): ↓ baja el foco a la lista y Enter se queda
                  // con el primero de lo que quedó a la vista. Tipear «ped» +
                  // Enter tiene que alcanzar para poner a Pedro en la mesa.
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      focusFirst();
                      return;
                    }
                    if (e.key !== "Enter") return;
                    const primero = visibles[0];
                    if (!primero) return;
                    e.preventDefault();
                    elegir(primero.user_id);
                  }}
                  placeholder="Buscar mozo…"
                  aria-label="Buscar mozo"
                  autoComplete="off"
                  className="block h-11 w-full rounded-2xl border border-zinc-200 bg-white pr-9 pl-9 text-base focus:border-sky-400 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                />
                {search.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-zinc-400 active:bg-zinc-100"
                    aria-label="Limpiar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {candidates.length === 0 ? (
              <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                No hay otros mozos disponibles.
              </p>
            ) : visibles.length === 0 ? (
              <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                Ningún mozo coincide con la búsqueda.
              </p>
            ) : (
              <div
                onKeyDown={lista.handleKeyDown}
                className="mt-2 max-h-64 overflow-y-auto rounded-2xl ring-1 ring-zinc-200"
              >
                {visibles.map((m, i) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => elegir(m.user_id)}
                    disabled={submitting}
                    {...lista.itemProps(i)}
                    className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition outline-none last:border-b-0 focus-visible:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-400 active:bg-zinc-50 ${
                      m.user_id === effectiveToMozoId ? "bg-sky-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white ${
                        m.user_id === effectiveToMozoId
                          ? "bg-sky-600"
                          : "bg-zinc-700"
                      }`}
                    >
                      {(m.full_name ?? "??")
                        .split(" ")
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase() ?? "")
                        .join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {m.full_name ?? m.user_id}
                      </p>
                      <p className="text-xs text-zinc-500 capitalize">
                        {m.role}
                      </p>
                    </div>
                    {m.user_id === effectiveToMozoId && modo === "transferir" && (
                      <Check className="h-5 w-5 text-sky-600" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sacar el mozo — spec 146, pedido de Juan. Es `assignMozoToTable`
              con `null`: la misma action y la misma auditoría que ponerlo. No
              es destructivo ni pide confirmación —se deshace eligiendo a
              cualquiera de la lista de arriba— así que va discreto y en zinc,
              no en rojo. Sólo aparece si hay mozo puesto: en una mesa sin mozo
              no hay nada que sacar. */}
          {puedeSacar && currentMozoId && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void asignar(null)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-100 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-50"
            >
              <UserMinus className="h-4 w-4" />
              Sacar el mozo
            </button>
          )}

          {modo === "transferir" && (
            <div>
              <SectionLabel as="label" htmlFor="elegir-mozo-motivo">
                Motivo (opcional)
              </SectionLabel>
              <textarea
                id="elegir-mozo-motivo"
                ref={reasonRef}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-base"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: salgo a fumar, cambio de turno…"
              />
            </div>
          )}
      </ModalBody>

      {/* En `asignar` no hay CTA: la fila es la acción. Un botón de confirmar
          sería el paso de más que el pedido vino a sacar. */}
      {modo === "transferir" && (
        <ModalFooter>
          <Button
            size="xl"
            disabled={submitting || !effectiveToMozoId}
            onClick={() => void transferir()}
          >
            {submitting ? "Transfiriendo…" : "Transferir mozo"}
          </Button>
        </ModalFooter>
      )}
    </InlineModal>
  );
}
