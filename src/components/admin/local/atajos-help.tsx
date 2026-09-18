"use client";

import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InlineModal, ModalBody, ModalHeader } from "@/components/ui/modal";

/**
 * Los atajos del panel de la operación, a la vista — spec 075, FR-022.
 *
 * Se abre con `?` desde cualquier lado del `<aside>` y muestra **los del modo
 * activo**: un encargado que está cobrando no necesita leer los del carrito.
 * Sin esto, todo lo que las specs 055/066/075 construyeron sólo lo sabe usar
 * quien leyó las specs.
 *
 * Se renderiza `absolute` dentro del panel (no `fixed`): igual que el
 * `ProductModal` en modo embebido, tapa el panel y deja el plano del salón a la
 * vista.
 */

export type ModoPanel =
  | "lista"
  | "detalle"
  | "pedir"
  | "walkin"
  | "venta"
  | "reserva"
  | "cuenta"
  | "cobro";

type Atajo = { teclas: string[]; que: string };

const COMUNES: Atajo[] = [
  { teclas: ["↑", "↓"], que: "Moverse. En el borde pasa a la zona de al lado" },
  { teclas: ["Enter"], que: "Abrir o confirmar lo que está marcado" },
  { teclas: ["Esc"], que: "Volver un paso atrás" },
  { teclas: ["?"], que: "Esta ayuda" },
];

const POR_MODO: Record<ModoPanel, Atajo[]> = {
  lista: [
    { teclas: ["Enter"], que: "Abrir la mesa, o las acciones de la reserva" },
  ],
  detalle: [
    { teclas: ["Enter"], que: "La acción grande de la mesa" },
    { teclas: ["Esc"], que: "Volver a la lista, parado en la misma mesa" },
  ],
  pedir: [
    { teclas: ["A-Z"], que: "Escribir busca, desde donde estés" },
    { teclas: ["/"], que: "Marcar el ítem «como entrada» (en su modal)" },
    {
      teclas: ["↓"],
      que: "Del buscador al catálogo, y del catálogo al pedido",
    },
    { teclas: ["←", "→"], que: "Cantidad de la línea del pedido" },
    { teclas: ["1-9"], que: "Fijar la cantidad de la línea" },
    { teclas: ["Supr"], que: "Quitar la línea" },
    { teclas: ["⌘", "Enter"], que: "Enviar la comanda" },
  ],
  walkin: [
    { teclas: ["1-9"], que: "Cuánta gente se sienta" },
    { teclas: ["+", "−"], que: "Una persona más o menos" },
    { teclas: ["Enter"], que: "Abrir la mesa" },
  ],
  venta: [
    { teclas: ["A-Z"], que: "Escribir busca, desde donde estés" },
    { teclas: ["←", "→"], que: "Cantidad de la línea" },
    { teclas: ["Supr"], que: "Quitar la línea" },
  ],
  reserva: [
    { teclas: ["1-9"], que: "Cuánta gente viene" },
    { teclas: ["+", "−"], que: "Una persona más o menos" },
    { teclas: ["←", "→"], que: "Moverse entre horarios de la misma fila" },
    { teclas: ["Enter"], que: "Elegir el servicio o el horario marcado" },
  ],
  cuenta: [{ teclas: ["Enter"], que: "Pasar a cobrar" }],
  cobro: [
    { teclas: ["1-9"], que: "Elegir el método de pago por su número" },
    { teclas: ["Esc"], que: "Volver a elegir método" },
    { teclas: ["⌘", "Enter"], que: "Cobrar" },
  ],
};

const TITULO: Record<ModoPanel, string> = {
  lista: "Mesas y reservas",
  detalle: "Detalle de la mesa",
  pedir: "Cargar pedido",
  walkin: "Abrir mesa",
  venta: "Venta rápida",
  reserva: "Nueva reserva",
  cuenta: "Cuenta",
  cobro: "Cobro",
};

export function AtajosHelp({
  modo,
  onClose,
}: {
  modo: ModoPanel;
  onClose: () => void;
}) {
  const atajos = [...POR_MODO[modo], ...COMUNES];
  const cerrarRef = useRef<HTMLButtonElement>(null);
  // Al cerrarse, el foco tiene que volver a donde estaba: si no, queda en el
  // `<body>` y el teclado del panel entero deja de responder — justo el panel
  // que esta ayuda vino a explicar.
  const origenRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const activo = document.activeElement;
    origenRef.current = activo instanceof HTMLElement ? activo : null;
    cerrarRef.current?.focus({ preventScroll: true });
    return () => {
      const origen = origenRef.current;
      if (origen?.isConnected) origen.focus({ preventScroll: true });
    };
  }, []);

  return (
    <InlineModal
      overlay="absolute"
      placement="bottom"
      zIndexClassName="z-50"
      aria-label="Atajos de teclado"
      onClose={onClose}
      // Focus-trap: sin esto se puede tabular al panel de atrás y operarlo sin
      // verlo (mismo patrón que `ProductModal` y el asistente del menú). Va en
      // el fondo (`backdropProps`), no en el diálogo: es el fondo el que
      // recibe el Tab cuando el foco intenta salir del diálogo hacia el resto
      // de la página.
      backdropProps={{
        onKeyDown: (e) => {
          if (e.key !== "Tab") return;
          e.preventDefault();
          cerrarRef.current?.focus({ preventScroll: true });
        },
      }}
    >
      <ModalHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Keyboard className="size-3.5" />
            Atajos
          </span>
        }
        title={TITULO[modo]}
        closeButton={
          <Button
            ref={cerrarRef}
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar atajos"
          >
            <X className="size-4" />
          </Button>
        }
      />
      <ModalBody>
        <ul className="space-y-1.5">
          {atajos.map((a) => (
            <li
              key={a.teclas.join("+") + a.que}
              className="flex items-center gap-3 text-sm"
            >
              <span className="flex w-24 shrink-0 justify-start gap-1">
                {a.teclas.map((t) => (
                  <kbd
                    key={t}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-bold text-foreground/80 ring-1 ring-border"
                  >
                    {t}
                  </kbd>
                ))}
              </span>
              <span className="min-w-0 flex-1 text-foreground/70">{a.que}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] text-muted-foreground/70">
          Tab y Shift+Tab siguen funcionando como siempre.
        </p>
      </ModalBody>
    </InlineModal>
  );
}
