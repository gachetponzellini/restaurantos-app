"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { cn } from "@/lib/utils";

/**
 * Editor de cualquier entidad del catálogo (spec 205 · D4/D6): producto,
 * categoría, menú, sector, insumo. Todos tienen la misma cáscara, sobre la
 * anatomía de la spec 204:
 *
 * - Header: miniatura, eyebrow, título, pills; **‹ 3 / 42 ›** para recorrer la
 *   lista filtrada (← → fuera de un campo); «‹ Volver a X» si se llegó por un
 *   enlace desde otro editor.
 * - Índice lateral de secciones con scroll-spy (tabs horizontales en teléfono).
 * - Footer fijo: acción destructiva a la izquierda, estado («● Cambios sin
 *   guardar» / «✓ Guardado»), Cancelar, Guardar (⌘↵).
 * - **Guardar no cierra.** Cerrar, ‹ ›, Volver o seguir un enlace con cambios
 *   pendientes piden confirmar.
 *
 * El contenido de cada sección lo pone quien lo usa; esto no sabe de productos.
 */

export type EditorSection = {
  id: string;
  label: string;
  /** Conteo chico en el índice (ej. grupos de adicionales). */
  count?: number;
  content: ReactNode;
};

type Guard = (proceed: () => void) => void;
const GuardContext = createContext<Guard>((proceed) => proceed());

/**
 * Para los enlaces dentro de un editor: `guard(() => abrirOtro())` pregunta
 * antes de descartar cambios.
 */
export function useEditorGuard(): Guard {
  return useContext(GuardContext);
}

export type EntityEditorProps = {
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  thumb?: ReactNode;
  /** Pills debajo del título (precio, estado). */
  meta?: ReactNode;
  nav?: {
    index: number;
    total: number;
    onPrev?: () => void;
    onNext?: () => void;
  } | null;
  back?: { label: string; onBack: () => void } | null;
  sections: EditorSection[];
  /** Sección a la que abre (ej. Costeo abre el producto en "precio"). */
  initialSection?: string;
  dirty: boolean;
  saving?: boolean;
  /** Se guardó en esta sesión del editor y no hay cambios nuevos. */
  saved?: boolean;
  /** `id` del `<form>` que dispara Guardar (el form puede vivir en cualquier lado). */
  formId?: string;
  onSave?: () => void;
  saveLabel?: string;
  /** Sin botón Guardar (editores de sólo lectura). */
  readOnly?: boolean;
  /** Pie izquierdo: eliminar / archivar. */
  destructive?: ReactNode;
  /** Pie: texto cuando no hay cambios (ej. «Editado hace 3 días»). */
  idleStatus?: ReactNode;
  /** Cosas fuera de las secciones (el `<form>` vacío que lleva el submit). */
  children?: ReactNode;
};

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return (
    t.isContentEditable ||
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    !!t.closest('[role="listbox"],[role="menu"],[role="combobox"]')
  );
}

export function EntityEditor({
  onClose,
  eyebrow,
  title,
  thumb,
  meta,
  nav,
  back,
  sections,
  initialSection,
  dirty,
  saving = false,
  saved = false,
  formId,
  onSave,
  saveLabel = "Guardar",
  readOnly = false,
  destructive,
  idleStatus,
  children,
}: EntityEditorProps) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [active, setActive] = useState(initialSection ?? sections[0]?.id);
  const scrollRef = useRef<HTMLDivElement>(null);

  const guard = useCallback<Guard>(
    (proceed) => {
      if (dirty) setPending(() => proceed);
      else proceed();
    },
    [dirty],
  );

  const save = useCallback(() => {
    if (readOnly || saving) return;
    if (onSave) onSave();
    else if (formId)
      (
        document.getElementById(formId) as HTMLFormElement | null
      )?.requestSubmit();
  }, [readOnly, saving, onSave, formId]);

  // Abrir en una sección (o volver arriba al cambiar de entidad).
  const sectionKey = sections.map((s) => s.id).join("|");
  useEffect(() => {
    const target = initialSection ?? sections[0]?.id;
    setActive(target);
    const box = scrollRef.current;
    if (!box) return;
    if (!initialSection) {
      box.scrollTop = 0;
      return;
    }
    requestAnimationFrame(() =>
      box
        .querySelector(`[data-section="${initialSection}"]`)
        ?.scrollIntoView({ block: "start" }),
    );
    // Sólo cuando cambia la entidad o la sección pedida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, initialSection, sectionKey]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    let current = sections[0]?.id;
    for (const s of sections) {
      const el = box.querySelector<HTMLElement>(`[data-section="${s.id}"]`);
      if (el && el.getBoundingClientRect().top - top <= 48) current = s.id;
    }
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4)
      current = sections[sections.length - 1]?.id;
    setActive(current);
  };

  const goTo = (id: string) => {
    setActive(id);
    scrollRef.current
      ?.querySelector(`[data-section="${id}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const many = sections.length > 1;

  return (
    <GuardContext.Provider value={guard}>
      <Modal
        open
        onOpenChange={(open, details) => {
          if (open) return;
          // Esc con pila vuelve un nivel; la X o el fondo cierran todo.
          if (details?.reason === "escape-key" && back) guard(back.onBack);
          else guard(onClose);
        }}
      >
        <ModalContent
          size="xl"
          className="max-sm:h-[94dvh] sm:h-[min(90dvh,820px)] sm:max-w-[880px]"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              save();
              return;
            }
            if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey)
              return;
            if (e.key === "ArrowLeft" && nav?.onPrev) {
              e.preventDefault();
              guard(nav.onPrev);
            } else if (e.key === "ArrowRight" && nav?.onNext) {
              e.preventDefault();
              guard(nav.onNext);
            }
          }}
        >
          {back && (
            <div className="flex items-center gap-1.5 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[12.5px] text-zinc-500">
              <button
                type="button"
                onClick={() => guard(back.onBack)}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-zinc-900 hover:bg-zinc-100"
              >
                <ChevronLeft className="size-3.5" />
                Volver a {back.label}
              </button>
            </div>
          )}
          <ModalHeader
            className="items-center border-b border-zinc-200/80 pb-3.5"
            eyebrow={eyebrow}
            title={title}
            titleClassName="truncate"
            icon={thumb}
            description={
              meta ? (
                <span className="flex flex-wrap gap-1.5">{meta}</span>
              ) : undefined
            }
            actions={
              nav && nav.index >= 0 ? (
                <div className="flex items-center gap-0.5 text-xs text-zinc-500">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Anterior"
                    disabled={!nav.onPrev}
                    onClick={() => nav.onPrev && guard(nav.onPrev)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span className="tabular-nums max-sm:hidden">
                    {nav.index + 1} / {nav.total}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Siguiente"
                    disabled={!nav.onNext}
                    onClick={() => nav.onNext && guard(nav.onNext)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              ) : undefined
            }
            showClose
          />

          <div
            className={cn(
              "grid min-h-0 flex-1",
              many
                ? "grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[190px_minmax(0,1fr)] sm:grid-rows-1"
                : "grid-cols-1",
            )}
          >
            {many && (
              <nav
                aria-label="Secciones"
                className="flex gap-0.5 overflow-x-auto border-b border-zinc-200/80 bg-zinc-50 px-2.5 py-2 [scrollbar-width:none] sm:flex-col sm:border-r sm:border-b-0 sm:py-3.5"
              >
                {sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => goTo(s.id)}
                    aria-current={active === s.id ? "true" : undefined}
                    className={cn(
                      "flex shrink-0 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium whitespace-nowrap",
                      active === s.id
                        ? "bg-white text-zinc-900 ring-1 ring-zinc-200"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
                    )}
                  >
                    {s.label}
                    {s.count ? (
                      <span className="text-[11px] text-zinc-400 tabular-nums max-sm:hidden">
                        {s.count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </nav>
            )}
            <ModalBody
              ref={scrollRef}
              onScroll={many ? onScroll : undefined}
              className="px-5 pt-1 pb-10 sm:px-7"
            >
              {sections.map((s, i) => (
                <section
                  key={s.id}
                  data-section={s.id}
                  aria-label={s.label}
                  className={cn(
                    "scroll-mt-2 pt-5",
                    i > 0 && "mt-5 border-t border-zinc-100",
                  )}
                >
                  {s.content}
                </section>
              ))}
            </ModalBody>
          </div>

          <ModalFooter className="flex-row items-center gap-2.5 max-sm:flex-wrap sm:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {destructive}
              <span
                className="text-[12.5px] text-zinc-500 max-sm:hidden"
                aria-live="polite"
              >
                {dirty ? (
                  <span className="font-medium text-amber-700">
                    ● Cambios sin guardar
                  </span>
                ) : saved ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <Check className="size-3.5" /> Guardado
                  </span>
                ) : (
                  idleStatus
                )}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => guard(onClose)}
            >
              {readOnly ? "Cerrar" : "Cancelar"}
            </Button>
            {!readOnly && (
              <Button type="button" size="xl" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : saveLabel}
                <kbd className="ml-1 rounded border border-white/30 px-1 font-mono text-[10px] font-normal max-sm:hidden">
                  ⌘↵
                </kbd>
              </Button>
            )}
          </ModalFooter>
          {children}
        </ModalContent>
      </Modal>

      <Modal open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <ModalContent size="sm">
          <ModalHeader
            icon={<AlertTriangle />}
            tone="warning"
            title="Tenés cambios sin guardar"
            description="Si seguís, se pierden."
          />
          <ModalFooter stretch>
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => setPending(null)}
            >
              Seguir editando
            </Button>
            <Button
              type="button"
              variant="destructive-solid"
              size="xl"
              onClick={() => {
                const go = pending;
                setPending(null);
                go?.();
              }}
            >
              Descartar cambios
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </GuardContext.Provider>
  );
}

/** Encabezado de una sección del editor. */
export function EditorSectionHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-zinc-900">{title}</h3>
        {description && (
          <p className="mt-0.5 text-[13px] text-zinc-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Una opción con interruptor y explicación (Visibilidad, Imprime comanda). */
export function EditorToggle({
  title,
  description,
  control,
  highlight = false,
}: {
  title: ReactNode;
  description: ReactNode;
  control: ReactNode;
  highlight?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3",
        highlight ? "border-emerald-200" : "border-zinc-200",
      )}
    >
      <span className="flex-1">
        <span className="block font-semibold text-zinc-900">{title}</span>
        <span className="text-[12.5px] text-zinc-500">{description}</span>
      </span>
      {control}
    </label>
  );
}

/** Lista de enlaces a otros editores (productos de una categoría, usos de un insumo). */
export function EditorLinkList({
  items,
  empty,
}: {
  items: {
    key: string;
    label: ReactNode;
    meta?: ReactNode;
    onOpen: () => void;
  }[];
  empty?: ReactNode;
}) {
  const guard = useEditorGuard();
  if (items.length === 0)
    return (
      <p className="text-[13px] text-zinc-500">{empty ?? "Nada todavía."}</p>
    );
  return (
    <ul className="overflow-hidden rounded-xl border border-zinc-200">
      {items.map((it) => (
        <li key={it.key} className="border-b border-zinc-100 last:border-b-0">
          <button
            type="button"
            onClick={() => guard(it.onOpen)}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-50"
          >
            <span className="truncate font-medium text-sky-700">
              {it.label}
            </span>
            <span className="text-[12.5px] text-zinc-500 tabular-nums">
              {it.meta}
            </span>
            <ChevronRight className="size-4 text-zinc-300" />
          </button>
        </li>
      ))}
    </ul>
  );
}
