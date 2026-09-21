"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * Un `<Link>` que prefetchea recién cuando el usuario muestra intención de
 * tocarlo (hover, foco o touch), no apenas entra en pantalla (#371).
 *
 * Por qué: todas las rutas del panel son `force-dynamic`, y el prefetch de una
 * ruta dinámica renderiza en el server los layouts hasta el `loading.tsx` más
 * cercano — o sea el layout `(authed)` entero: auth + su tanda de 8 queries.
 * El sidebar tiene ~16 links, así que cada carga de CUALQUIER página admin
 * disparaba ~18 renders de ese layout en paralelo con la página que el usuario
 * sí quería ver. Medido en prod: ~220 queries extra por carga, la base
 * saturándose sola, y la caja de Operación en 10–14 s.
 *
 * Con la intención se conserva lo que el prefetch daba —al clickear, el
 * skeleton del `loading.tsx` pinta al instante (spec 104)— pero sólo del link
 * que se va a tocar. Es el patrón de la doc de Next: `prefetch={false}` hasta
 * la intención y después `null` (el automático de siempre).
 */
export function IntentLink({
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [intencion, setIntencion] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intencion ? null : false}
      onMouseEnter={(e) => {
        setIntencion(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setIntencion(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntencion(true);
        onTouchStart?.(e);
      }}
    />
  );
}
