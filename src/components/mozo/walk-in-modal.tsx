"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  MAX_PARTY_SIZE,
  MIN_PARTY_SIZE,
  partySizeFromKey,
} from "@/lib/mozo/party-size-keys";
import { CustomerFields } from "@/components/shared/customer-fields";
import { sentarWalkIn } from "@/lib/mozo/walk-in";
import { InlineModal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { useArrowFocus } from "@/lib/ui/use-arrow-focus";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";

const FormSchema = z.object({
  partySize: z.number().int().min(MIN_PARTY_SIZE).max(MAX_PARTY_SIZE),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

type FormInput = z.input<typeof FormSchema>;

type Props = {
  tableId: string;
  tableLabel: string;
  businessSlug: string;
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * Formulario de walk-in ("abrir mesa"), keyboard-first (spec 066, FR-004/005).
 *
 * Vive en dos envoltorios: [`WalkInModal`] (overlay, app del mozo en mobile) y
 * [`WalkInPanel`] (dentro del `<aside>` del salón, donde el resto del recorrido
 * —cargar pedido, cuenta, cobro— ya vive). Un solo formulario, dos marcos.
 *
 * Teclado: `+`/`−`/dígitos mueven Personas (salvo escribiendo en un campo de
 * texto) y el foco arranca en «Abrir mesa», así el caso común —mesa para 2—
 * es Enter y listo. El buscador de cliente NO se lleva el foco acá: si lo
 * hiciera, el cursor quedaría en un `INPUT` y los atajos numéricos morirían.
 */
function WalkInForm({
  tableId,
  tableLabel,
  businessSlug,
  onSuccess,
  variant,
}: Omit<Props, "onClose"> & { variant: "modal" | "panel" }) {
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormInput>({
    resolver: zodResolver(FormSchema),
    defaultValues: { partySize: 2, name: "", phone: "", notes: "" },
  });

  const partySize = watch("partySize");

  // El foco arranca en «Abrir mesa», NO en el buscador de cliente.
  //
  // La spec 068 (FR-002) lo había movido al cliente, y con eso rompió el
  // keyboard-first de la 066 sin que se notara: `handleKeyDown` sale por el
  // early return de `INPUT`, así que con el cursor en el buscador las teclas
  // 1-9/+/− dejaban de mover Personas — el atajo seguía existiendo en el
  // código pero era inalcanzable. Revertido por pedido de Juan (2026-07-30):
  // abrir una mesa es sobre todo decir cuánta gente se sienta, y el caso común
  // —mesa para 2— vuelve a ser **Enter y listo**. El nombre del cliente es
  // opcional y se tipea después, con un Tab.
  //
  // En los otros dos flujos del bloque unificado (nueva reserva, cargar
  // pedido) el foco en el cliente SÍ se conserva: ahí no hay atajos numéricos
  // que pisar y el cliente es el primer dato real del formulario.
  useEffect(() => {
    submitRef.current?.focus();
  }, []);

  const onSubmit = async (values: FormInput) => {
    setSubmitting(true);
    const result = await sentarWalkIn({
      tableId,
      partySize: values.partySize,
      name: values.name?.trim() || undefined,
      phone: values.phone?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      slug: businessSlug,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Mesa abierta.");
    onSuccess();
  };

  // ↑/↓ recorren los controles del panel (spec 075, FR-016): Personas, el
  // cliente, las notas y «Abrir mesa», sin tener que cambiar a Tab.
  const formRef = useRef<HTMLFormElement>(null);
  const { handleKeyDown: handleArrows } = useArrowFocus(formRef);

  // `+` / `−` / dígitos mueven la cantidad de personas. Escribiendo en Nombre,
  // Teléfono o Notas no aplica: ahí `-` es un guion y `4` es un cuatro. FR-004.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      // En un `<input>` de una línea ↑/↓ no hacen nada útil: se usan para
      // moverse de campo. En un `<textarea>` sí mueven el cursor y no se tocan
      // (lo decide `useArrowFocus`).
      handleArrows(e);
      return;
    }
    if (handleArrows(e)) return;
    const next = partySizeFromKey(e.key, partySize);
    if (next === null) return;
    e.preventDefault();
    setValue("partySize", next);
  };

  const isPanel = variant === "panel";

  return (
    <form
      ref={formRef}
      className={
        isPanel
          ? "flex min-h-0 flex-1 flex-col"
          : "mt-4 space-y-4"
      }
      onKeyDown={handleKeyDown}
      onSubmit={handleSubmit(onSubmit)}
    >
      {/* En el panel ancho (spec 111) el cuerpo pasa a dos columnas: Cliente y
          Teléfono son un par natural y quedaban apilados a 868px cada uno.
          `CustomerFields` devuelve dos `<div>` hermanos, así que caen solos en
          la misma fila sin tocar el componente compartido. */}
      <div
        className={
          isPanel
            ? "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 @xl:grid @xl:grid-cols-2 @xl:gap-x-3 @xl:gap-y-4 @xl:space-y-0"
            : "space-y-4"
        }
      >
        {/* Party size: quick-pick directo + stepper */}
        <div className="@xl:col-span-2 @xl:max-w-md">
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            Personas
            <span className="ml-1.5 font-semibold normal-case tracking-normal text-zinc-400">
              · teclas 1-9, + y −
            </span>
          </label>
          {/* Toque directo a las cantidades más comunes */}
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} personas`}
                aria-pressed={partySize === n}
                onClick={() => setValue("partySize", n)}
                className={`flex h-12 items-center justify-center rounded-xl text-lg font-extrabold tabular-nums transition active:scale-95 ${
                  partySize === n
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {/* Stepper para ajustar o más de 6 */}
          <div className="mt-2 flex items-center justify-between rounded-2xl bg-zinc-50 p-2 ring-1 ring-zinc-200">
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-zinc-700 ring-1 ring-zinc-200 transition active:scale-95 disabled:opacity-30"
              disabled={partySize <= MIN_PARTY_SIZE}
              aria-label="Disminuir"
              onClick={() =>
                setValue("partySize", Math.max(MIN_PARTY_SIZE, partySize - 1))
              }
            >
              <Minus className="h-5 w-5" />
            </button>
            <span className="font-heading text-3xl font-extrabold tabular-nums text-zinc-900">
              {partySize}
            </span>
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-zinc-700 ring-1 ring-zinc-200 transition active:scale-95 disabled:opacity-30"
              disabled={partySize >= MAX_PARTY_SIZE}
              aria-label="Aumentar"
              onClick={() =>
                setValue("partySize", Math.min(MAX_PARTY_SIZE, partySize + 1))
              }
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {errors.partySize && (
            <p className="mt-1 text-xs text-red-600">
              {errors.partySize.message}
            </p>
          )}
        </div>

        {/* Spec 068: el bloque de cliente es el mismo en abrir mesa, nueva
            reserva y cargar pedido — incluida la regla de la spec 067 de que
            el teléfono no se edita con un cliente del CRM elegido. */}
        <CustomerFields
          slug={businessSlug}
          idPrefix="walkin"
          name={watch("name") ?? ""}
          phone={watch("phone") ?? ""}
          onNameChange={(v) => setValue("name", v)}
          onPhoneChange={(v) => setValue("phone", v)}
        />

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            Notas (opcional)
          </label>
          <textarea
            {...register("notes")}
            rows={2}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-base"
            placeholder="Ej: alérgico a maní, cumpleaños…"
          />
        </div>
      </div>

      <div className={isPanel ? "shrink-0 border-t border-zinc-200 p-3" : ""}>
        <button
          ref={submitRef}
          type="submit"
          disabled={submitting}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-bold text-white shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? "Abriendo…" : `Abrir ${tableLabel}`}
          {!submitting && (
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
              ↵
            </span>
          )}
        </button>
      </div>
    </form>
  );
}

/**
 * Walk-in como overlay: app del mozo (mobile), donde no hay sidebar.
 *
 * `WalkInForm` es compartido con [`WalkInPanel`] (fuera de alcance de la spec
 * 204) y arma su propio `<form>` con el submit adentro (el foco keyboard-first
 * de la spec 066 depende de que sea un `type="submit"` real). Sacarlo a un
 * `ModalFooter` afuera del form rompería el Enter-para-abrir y le cambiaría el
 * pie a `WalkInPanel` de paso — se queda dentro de `ModalBody`, tal cual venía.
 */
export function WalkInModal(props: Props) {
  useEscapeToClose(props.onClose);

  return (
    <InlineModal overlay="fixed" zIndexClassName="z-[60]" onClose={props.onClose}>
      <ModalHeader
        title={`Walk-in · ${props.tableLabel}`}
        description="Solo la cantidad es obligatoria. Si dejás teléfono, entra al CRM."
      />
      <ModalBody>
        <WalkInForm {...props} variant="modal" />
      </ModalBody>
    </InlineModal>
  );
}

/**
 * Walk-in embebido en el panel lateral del salón (spec 066, FR-006). Mismo
 * marco que "cargar pedido" / cuenta / cobro: header con volver, cuerpo con
 * scroll, acción primaria al pie. El plano sigue visible al lado.
 */
export function WalkInPanel(props: Props) {
  useEscapeToClose(props.onClose);

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      <header className="shrink-0 border-b border-zinc-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="-ml-1 rounded-full p-2 text-zinc-700 transition active:bg-zinc-100"
            aria-label="Volver al salón"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Walk-in
            </p>
            <h2 className="font-heading text-base font-bold leading-tight text-zinc-900">
              Abrir {props.tableLabel}
            </h2>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500">
          Solo la cantidad es obligatoria. Si dejás teléfono, entra al CRM.
        </p>
      </header>

      <WalkInForm {...props} variant="panel" />
    </div>
  );
}
