"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getCartStore, type CartItem } from "@/stores/cart";

export function CartHandoff({
  slug,
  items,
}: {
  slug: string;
  items: CartItem[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // H-17 (QA #382): si el cliente ya tenía productos en el carrito, no se los
  // pisamos sin avisar: se le pregunta qué carrito quiere.
  const [preguntar, setPreguntar] = useState(false);
  // Evita volver a evaluar (y re-preguntar) si el efecto corre dos veces.
  const decidido = useRef(false);

  const irAlCarrito = () => router.replace(`/${slug}/carrito`);

  const reemplazar = () => {
    try {
      // Replace the cart wholesale: zustand exposes setState on the hook.
      getCartStore(slug).setState({ items });
      irAlCarrito();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    }
  };

  useEffect(() => {
    if (decidido.current) return;
    decidido.current = true;
    try {
      const locales = getCartStore(slug).getState().items;
      if (locales.length > 0) {
        setPreguntar(true);
        return;
      }
      getCartStore(slug).setState({ items });
      irAlCarrito();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, items, router]);

  if (preguntar) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 p-6 text-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="handoff-pregunta"
          className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm"
        >
          <p id="handoff-pregunta" className="text-base font-medium text-zinc-900">
            Ya tenés productos en tu carrito. ¿Los reemplazamos por los del chat?
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={reemplazar}
              className="h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Reemplazar
            </button>
            <button
              type="button"
              onClick={irAlCarrito}
              className="h-12 rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900"
            >
              Mantener el mío
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 p-6 text-center">
      <div className="size-10 animate-spin rounded-full border-4 border-zinc-300 border-t-primary" />
      <p className="text-sm text-zinc-600">Preparando tu pedido...</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
