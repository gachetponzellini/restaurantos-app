"use client";

/**
 * Spec 204 — la anatomía única de los modales.
 *
 * Todo modal se arma con las mismas piezas (`ModalHeader` / `ModalBody` /
 * `ModalFooter`) dentro de una de tres cáscaras que se ven igual:
 *
 * - `ModalContent` — diálogo centrado (base-ui: portal, foco, Esc). Para
 *   confirmar algo o un formulario corto.
 * - `PanelContent` — panel lateral derecho (base-ui). Para ver un detalle o un
 *   flujo largo.
 * - `InlineModal` — `div role="dialog"` propio. Para los modales que se anclan
 *   **dentro del panel del salón** (`overlay="absolute"`, dejan el plano vivo)
 *   o que ya resuelven foco y teclas a mano. No cambia su comportamiento: sólo
 *   les pone la misma cáscara.
 *
 * En teléfono las cáscaras centradas bajan a hoja desde abajo, con manija.
 */

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ModalSize = "sm" | "md" | "lg" | "xl";
export type ModalTone = "default" | "danger" | "success" | "warning" | "info";

/** Ancho máximo por tamaño, desde `sm` (en teléfono la hoja va a lo ancho). */
const SIZE: Record<ModalSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-3xl",
};

const PANEL_SIZE: Record<ModalSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
};

const TONE: Record<ModalTone, string> = {
  default: "bg-muted text-foreground",
  danger: "bg-destructive/10 text-destructive",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const BACKDROP = "bg-black/40 supports-backdrop-filter:backdrop-blur-[2px]";

const SURFACE =
  "flex w-full flex-col overflow-hidden bg-popover text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none";

/**
 * Quién aloja al header: un diálogo de base-ui (título y descripción van por
 * sus primitivas, que cablean `aria-*` solas) o un `InlineModal` (h2 plano con
 * el id que el contenedor usa en `aria-labelledby`).
 */
type ShellContextValue =
  | { kind: "dialog" }
  | { kind: "inline"; titleId: string; onClose: () => void };

const ShellContext = React.createContext<ShellContextValue>({ kind: "dialog" });

function Handle({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/25",
        className,
      )}
    />
  );
}

// ─── Cáscaras ───────────────────────────────────────────────────────────────

function Modal(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="modal" {...props} />;
}

function ModalContent({
  size = "md",
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props & { size?: ModalSize }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="modal-overlay"
        className={cn(
          "fixed inset-0 isolate z-50 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          BACKDROP,
        )}
      />
      <DialogPrimitive.Popup
        data-slot="modal-content"
        className={cn(
          SURFACE,
          "fixed z-50 max-h-[min(90dvh,880px)] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          // Teléfono: hoja desde abajo.
          "inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom-6",
          // `sm` en adelante: centrado.
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0 sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-95 sm:data-closed:zoom-out-95",
          SIZE[size],
          className,
        )}
        {...props}
      >
        <Handle className="sm:hidden" />
        <ShellContext.Provider value={{ kind: "dialog" }}>
          {children}
        </ShellContext.Provider>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function PanelContent({
  size = "md",
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props & { size?: ModalSize }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="panel-overlay"
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
          BACKDROP,
        )}
      />
      <DialogPrimitive.Popup
        data-slot="panel-content"
        className={cn(
          SURFACE,
          "fixed inset-y-0 right-0 z-50 h-full ring-0 border-l border-border transition duration-200 ease-out data-ending-style:translate-x-10 data-ending-style:opacity-0 data-starting-style:translate-x-10 data-starting-style:opacity-0",
          PANEL_SIZE[size],
          className,
        )}
        {...props}
      >
        <ShellContext.Provider value={{ kind: "dialog" }}>
          {children}
        </ShellContext.Provider>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

type InlineModalProps = React.ComponentProps<"div"> & {
  onClose: () => void;
  /**
   * `"fixed"` — pantalla completa (el teléfono del mozo). `"absolute"` — dentro
   * del contenedor posicionado más cercano (el `<aside>` del salón), que deja
   * el plano vivo.
   */
  overlay?: "fixed" | "absolute";
  size?: ModalSize;
  /** `"bottom"`: siempre hoja desde abajo (ayuda de atajos). */
  placement?: "center" | "bottom";
  /** z-index del fondo; cada modal conserva el que ya tenía. */
  zIndexClassName?: string;
  /** Click en el fondo. Default: `onClose`. `false` = no cierra. */
  onBackdropClick?: (() => void) | false;
  /** Props del fondo (ej. un `onKeyDown` que atrapa el Tab). */
  backdropProps?: Omit<React.ComponentProps<"div">, "onClick">;
  /** Id del título; si no viene, se genera. Se ignora con `aria-label`. */
  titleId?: string;
};

function InlineModal({
  onClose,
  overlay = "fixed",
  size = "md",
  placement = "center",
  zIndexClassName = "z-50",
  onBackdropClick,
  backdropProps,
  titleId: titleIdProp,
  className,
  children,
  onClick,
  ...props
}: InlineModalProps) {
  const autoId = React.useId();
  const titleId = titleIdProp ?? `modal-titulo-${autoId}`;
  const labelledBy = props["aria-label"] ? undefined : titleId;
  const centered = placement === "center";

  return (
    <div
      data-slot="inline-modal-overlay"
      {...backdropProps}
      className={cn(
        overlay,
        "inset-0 flex items-end justify-center",
        centered && "sm:items-center sm:p-4",
        BACKDROP,
        zIndexClassName,
        backdropProps?.className,
      )}
      onClick={
        onBackdropClick === false ? undefined : (onBackdropClick ?? onClose)
      }
    >
      <div
        data-slot="inline-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        {...props}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        className={cn(
          SURFACE,
          "rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
          overlay === "absolute" ? "max-h-full" : "max-h-[min(92dvh,880px)]",
          centered && "sm:rounded-2xl sm:pb-0",
          centered ? SIZE[size] : "",
          className,
        )}
      >
        <Handle className={centered ? "sm:hidden" : undefined} />
        <ShellContext.Provider value={{ kind: "inline", titleId, onClose }}>
          {children}
        </ShellContext.Provider>
      </div>
    </div>
  );
}

// ─── Anatomía ───────────────────────────────────────────────────────────────

type ModalHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Línea chica arriba del título (ej. «Mesa 12», «Pedido #34»). */
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: ModalTone;
  /** Acciones a la izquierda del cerrar (ej. imprimir). */
  actions?: React.ReactNode;
  showClose?: boolean;
  closeLabel?: string;
  /** Reemplaza el cerrar (ej. un «volver» con ref para el foco). */
  closeButton?: React.ReactNode;
  titleClassName?: string;
};

function ModalHeader({
  title,
  description,
  eyebrow,
  icon,
  tone = "default",
  actions,
  showClose = true,
  closeLabel = "Cerrar",
  closeButton,
  titleClassName,
  className,
  ...props
}: ModalHeaderProps) {
  const shell = React.useContext(ShellContext);
  const titleCls = cn(
    "font-heading text-lg leading-tight font-semibold tracking-tight text-foreground",
    titleClassName,
  );
  const descCls = "mt-1 text-sm text-muted-foreground";

  const closeCls = "-mt-1 -mr-2 shrink-0 text-muted-foreground";
  const close =
    closeButton ??
    (!showClose ? null : shell.kind === "dialog" ? (
      <DialogPrimitive.Close
        data-slot="modal-close"
        render={
          <Button variant="ghost" size="icon" className={closeCls} />
        }
      >
        <XIcon />
        <span className="sr-only">{closeLabel}</span>
      </DialogPrimitive.Close>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={shell.onClose}
        aria-label={closeLabel}
        className={closeCls}
      >
        <XIcon />
      </Button>
    ));

  return (
    <div
      data-slot="modal-header"
      className={cn("flex shrink-0 items-start gap-3 px-5 pt-5 pb-4", className)}
      {...props}
    >
      {icon && (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg:not([class*='size-'])]:size-[18px]",
            TONE[tone],
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="mb-0.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        )}
        {shell.kind === "dialog" ? (
          <DialogPrimitive.Title data-slot="modal-title" className={titleCls}>
            {title}
          </DialogPrimitive.Title>
        ) : (
          <h2 id={shell.titleId} data-slot="modal-title" className={titleCls}>
            {title}
          </h2>
        )}
        {description &&
          (shell.kind === "dialog" ? (
            <DialogPrimitive.Description
              data-slot="modal-description"
              className={descCls}
            >
              {description}
            </DialogPrimitive.Description>
          ) : (
            <div data-slot="modal-description" className={descCls}>
              {description}
            </div>
          ))}
      </div>
      {actions}
      {close}
    </div>
  );
}

function ModalBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-body"
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5", className)}
      {...props}
    />
  );
}

function ModalFooter({
  className,
  stretch = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Botones a lo ancho, repartidos (confirmaciones de dos opciones). */
  stretch?: boolean;
}) {
  return (
    <div
      data-slot="modal-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-end",
        stretch && "sm:*:flex-1",
        className,
      )}
      {...props}
    />
  );
}

const ModalClose = DialogPrimitive.Close;

export {
  Modal,
  ModalContent,
  PanelContent,
  InlineModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalClose,
};
