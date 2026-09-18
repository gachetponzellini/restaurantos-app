"use client";

import {
  Banknote,
  BookUser,
  CreditCard,
  Link as LinkIcon,
  MoreHorizontal,
  QrCode,
  Smartphone,
  Wallet,
} from "lucide-react";

import { calculateAdjustment } from "@/lib/billing/adjustment";
import type { PaymentMethod, PaymentMethodConfig } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { indexFromDigit } from "@/lib/ui/roving";
import type { RovingListApi } from "@/lib/ui/use-roving-list";
import { cn } from "@/lib/utils";

// ============================================================================
// Elegir con qué se paga — una sola vez para todas las pantallas que cobran.
//
// Nació adentro de `CobroForm` (spec 062) y vive acá desde la spec 157, cuando
// la venta rápida dejó de tener su grilla propia. Se separó del formulario
// porque hay una pantalla que necesita **el selector y nada más**: la cobranza
// de una cuenta corriente (spec 141 · US4) no lleva propina, ni split, ni
// ajuste por método, ni fiado —no se paga una deuda con otra deuda— y sí admite
// pagar de menos, que es justo lo que la guarda de efectivo del formulario
// impide. Meterla a la fuerza en `CobroForm` habría costado cuatro excepciones;
// lo que de verdad comparte es esto.
//
// La lista de métodos vive acá: agregar uno es un renglón, y aparece en las
// cuatro pantallas (spec 157, escenario 4).
// ============================================================================

export const METHODS: Array<{
  value: PaymentMethod;
  label: string;
  /**
   * Etiqueta del flujo rápido. El cobro del mostrador comparte columna con el
   * carrito y el catálogo: ahí «Transferencia» entra truncada, que es peor que
   * abreviada. Son las mismas palabras que usaba la grilla propia de la venta
   * rápida antes de la spec 157.
   */
  corto?: string;
  icon: typeof Banknote;
}> = [
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "card_manual", label: "Tarjeta", icon: CreditCard },
  {
    value: "mp_link",
    label: "Link Mercado Pago",
    corto: "Link MP",
    icon: LinkIcon,
  },
  { value: "mp_qr", label: "QR Mercado Pago", corto: "QR MP", icon: QrCode },
  // #350 — MP cobrado por fuera (la app o el QR fijo del local): sólo se
  // registra, como la tarjeta manual. No es `isMpMethod`: no abre ningún flujo.
  { value: "mp_manual", label: "Mercado Pago", corto: "MP", icon: Smartphone },
  {
    value: "transfer",
    label: "Transferencia",
    corto: "Transfer.",
    icon: Wallet,
  },
  { value: "other", label: "Otro", icon: MoreHorizontal },
  // spec 141 — el fiado. Va último a propósito: cierra el ticket sin que entre
  // plata, así que no compite con los métodos que sí cobran.
  {
    value: "cuenta_corriente",
    label: "Cuenta corriente",
    corto: "Cuenta cte.",
    icon: BookUser,
  },
];

export function isMpMethod(m: PaymentMethod | null): m is "mp_link" | "mp_qr" {
  return m === "mp_link" || m === "mp_qr";
}

/**
 * Los métodos que esta pantalla ofrece.
 *
 * Vive afuera del componente porque el flujo rápido necesita el primero **en el
 * `useState` inicial**, antes de que haya render. Es también lo que hace que
 * agregar un método sea un renglón acá y no tres archivos (spec 157, esc. 4).
 */
export function metodosOfrecidos(opts: {
  allowedMethods?: PaymentMethod[];
  mp: boolean;
  cuentaCorriente: boolean;
}) {
  return METHODS.filter((m) => {
    if (opts.allowedMethods && !opts.allowedMethods.includes(m.value))
      return false;
    // #350 — Link y QR de MP ocultos por ahora: el local cobra MP por fuera y
    // lo registra con `mp_manual`. El flujo sigue en el código; volver a
    // mostrarlos es borrar este renglón.
    if (isMpMethod(m.value)) return false;
    if (isMpMethod(m.value) && !opts.mp) return false;
    // Sin la prop no hay fiado: el rol no puede, o el negocio no lo usa.
    if (m.value === "cuenta_corriente" && !opts.cuentaCorriente) return false;
    return true;
  });
}

export type MetodoOfrecido = (typeof METHODS)[number];

export function SelectorDeMetodo({
  metodos,
  methodConfigs,
  baseCents,
  value,
  onChange,
  zona,
  compacto = false,
  touch = false,
}: {
  metodos: MetodoOfrecido[];
  methodConfigs: PaymentMethodConfig[];
  /** Sobre qué se calcula el «+10 % · $11.000» de cada método. */
  baseCents: number;
  /** El elegido. Sólo se marca en modo compacto, donde la grilla no se desmonta. */
  value: PaymentMethod | null;
  onChange: (m: PaymentMethod) => void;
  /** La zona de teclado, del caller: el paso 2 de `CobroForm` necesita volver
   *  el foco al método que estaba elegido cuando se aprieta Esc. */
  zona: RovingListApi<HTMLButtonElement>;
  /** Chips de un renglón en vez de tarjetas: la grilla convive con el carrito. */
  compacto?: boolean;
  /** El mozo, en el celular. */
  touch?: boolean;
}) {
  return (
    <div
      onKeyDown={(e) => {
        if (zona.handleKeyDown(e)) return;
        const i = indexFromDigit(e.key, metodos.length);
        if (i === null) return;
        e.preventDefault();
        onChange(metodos[i].value);
      }}
      className={cn("grid grid-cols-2", compacto ? "gap-1.5" : "gap-2")}
    >
      {metodos.map((m, i) => {
        const adj =
          methodConfigs.find((c) => c.method === m.value)?.adjustment_percent ??
          0;
        const { finalCents: adjFinal } = calculateAdjustment(baseCents, adj);
        const Icon = m.icon;
        // Marcar el elegido no depende de la variante sino de si la grilla
        // sigue montada. En el paso 1 de `CobroForm` `value` es null —elegir
        // desmonta el selector—, así que ahí no marca nada; donde la grilla se
        // queda (mostrador, cobranza) el elegido tiene que verse.
        const elegido = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            data-metodo="true"
            {...zona.itemProps(i)}
            className={cn(
              "rounded-2xl bg-card text-left ring-1 ring-border transition outline-none hover:ring-foreground/20 active:scale-[0.98]",
              "focus-visible:ring-2 focus-visible:ring-primary",
              compacto
                ? "flex items-center gap-1.5 px-2.5 py-2"
                : "flex flex-col items-start gap-1 p-3",
              !compacto && touch && "p-4",
              elegido && "bg-primary text-white ring-primary",
            )}
          >
            {compacto ? (
              // Sin ícono: el ancho que ocupa es el que le falta a la etiqueta.
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {m.corto ?? m.label}
                </span>
                {adj !== 0 && (
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-bold",
                      elegido
                        ? "text-white/70"
                        : adj < 0
                          ? "text-emerald-600"
                          : "text-rose-600",
                    )}
                  >
                    {adj > 0 ? "+" : ""}
                    {adj}%
                  </span>
                )}
                {i < 9 && (
                  <kbd
                    className={cn(
                      "shrink-0 rounded px-1 text-[10px] font-bold",
                      elegido
                        ? "bg-white/15 text-white/70"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </kbd>
                )}
              </>
            ) : (
              // Los colores del contenido son condicionales porque acá la
              // tarjeta **puede estar elegida**: en el paso 1 de `CobroForm`
              // nunca lo está (elegir desmonta la grilla), pero en la cobranza
              // sí, y sobre el fondo oscuro un `text-foreground` no se lee.
              <>
                <div className="flex w-full items-center justify-between gap-2">
                  <Icon
                    className={cn(
                      "size-4",
                      elegido ? "text-white/70" : "text-muted-foreground",
                      touch && "size-5",
                    )}
                  />
                  {i < 9 && (
                    <kbd
                      className={cn(
                        "rounded px-1 text-[10px] font-bold",
                        elegido
                          ? "bg-white/15 text-white/70"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </kbd>
                  )}
                </div>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    elegido ? "text-white" : "text-foreground",
                    touch && "text-base",
                  )}
                >
                  {m.label}
                </span>
                {adj !== 0 && (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      elegido
                        ? "text-white/70"
                        : adj < 0
                          ? "text-emerald-700"
                          : "text-rose-600",
                    )}
                  >
                    {adj > 0 ? "+" : ""}
                    {adj}% · {formatCurrency(adjFinal)}
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
