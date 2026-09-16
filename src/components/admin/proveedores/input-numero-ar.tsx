"use client";

import { useState, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { parseNumeroAR } from "@/lib/proveedores/lectura/numeros-ar";

/**
 * Un número como se escribe acá — spec 198·D4.
 *
 * *«Cuando es algo con coma no me deja poner coma: 2,900 me escribe 2,90, y no
 * son 2,90 kilos, son 2 kilos 900»* — Rocío, 2026-09-16.
 *
 * Los campos del renglón eran inputs controlados que hacían `Number(valor)` en
 * cada tecla: `Number("2,")` es `NaN` —la coma borraba todo— y `Number("72.")` es
 * `72` —el punto desaparecía apenas se escribía—. El importe del comprobante ya
 * había pasado por lo mismo y se arregló con texto + `parseNumeroAR`; los
 * renglones no.
 *
 * La regla es una sola: **mientras el campo tiene el foco, se ve lo que se tipeó**.
 * El número se entiende en cada tecla —para que el subtotal de al lado se mueva—
 * pero no se reescribe el texto hasta salir del campo. Afuera del foco se muestra
 * el valor formateado, así que un renglón que borra otro, o una lectura que llega,
 * no deja un texto viejo pegado.
 */
export function InputNumeroAR({
  value,
  onValue,
  decimales = 3,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null;
  /** `null` cuando lo tipeado todavía no es un número (vacío, «,»). */
  onValue: (n: number | null) => void;
  /** Cuántos decimales se muestran afuera del foco. */
  decimales?: number;
}) {
  const [texto, setTexto] = useState<string | null>(null);

  const formateado =
    value === null || !Number.isFinite(value)
      ? ""
      : value.toLocaleString("es-AR", { maximumFractionDigits: decimales });

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={texto ?? formateado}
      onFocus={(e) => {
        setTexto(formateado);
        props.onFocus?.(e);
      }}
      onChange={(e) => {
        setTexto(e.target.value);
        onValue(parseNumeroAR(e.target.value));
      }}
      onBlur={(e) => {
        setTexto(null);
        props.onBlur?.(e);
      }}
    />
  );
}
