"use client";

import { useCallback, useState } from "react";
import Image, { type ImageProps } from "next/image";

// Foto que aparece fundiéndose cuando termina de bajar, en vez de pintarse a
// renglones. Dos excepciones, las dos para no demorar lo que ya se puede ver:
//  - `priority` (la portada): se pinta directo; su entrada la hace el CSS
//    (`.m-settle`) sin esperar a que hidrate el JS.
//  - ya estaba en caché al montar (volver al menú desde el carrito): aparece
//    sin transición. El fundido es para la carga, no para cada render.
type Phase = "loading" | "fade" | "instant";

export function FadeImage({ alt, style, onLoad, priority, ...props }: ImageProps) {
  const [phase, setPhase] = useState<Phase>("loading");

  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setPhase("instant");
  }, []);

  if (priority) {
    return <Image {...props} alt={alt} priority style={style} onLoad={onLoad} />;
  }

  return (
    <Image
      {...props}
      alt={alt}
      ref={ref}
      onLoad={(e) => {
        setPhase((p) => (p === "instant" ? p : "fade"));
        onLoad?.(e);
      }}
      style={{
        ...style,
        opacity: phase === "loading" ? 0 : 1,
        transition:
          phase === "fade"
            ? "opacity 420ms cubic-bezier(0.23, 1, 0.32, 1)"
            : undefined,
      }}
    />
  );
}
