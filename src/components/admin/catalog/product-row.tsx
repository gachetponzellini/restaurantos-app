"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight, EyeOff, ImageOff } from "lucide-react";

import type { AdminProduct } from "@/lib/admin/catalog-query";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

export function ProductRow({
  slug,
  product,
  onEdit,
}: {
  slug: string;
  product: AdminProduct;
  /** Abre el modal de edición. Si no viene, la fila navega a la página. */
  onEdit?: () => void;
}) {
  const dimmed = !product.is_active;

  return (
    <li>
      {/*
        Sigue siendo un link a la página: así el cmd+click y el «abrir en otra
        pestaña» funcionan como en cualquier lista. El click normal lo
        interceptamos y abrimos el modal, que no navega.
      */}
      <Link
        href={`/${slug}/admin/catalogo/productos/${product.id}`}
        onClick={(e) => {
          if (!onEdit) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onEdit();
        }}
        className={cn(
          "bg-card hover:bg-muted/40 group flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors",
          "ring-border/60 ring-1",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
          dimmed && "opacity-70",
        )}
      >
        {product.image_url ? (
          <div className="bg-muted relative size-12 shrink-0 overflow-hidden rounded-lg">
            <Image
              src={product.image_url}
              alt=""
              fill
              sizes="48px"
              className="object-cover"
            />
          </div>
        ) : (
          <div className="bg-muted/60 text-muted-foreground/60 flex size-12 shrink-0 items-center justify-center rounded-lg">
            <ImageOff className="size-4" strokeWidth={1.5} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {product.name}
            </span>
            {dimmed && (
              <EyeOff
                className="text-muted-foreground size-3 shrink-0"
                aria-label="Oculto"
              />
            )}
            {!product.is_available && product.is_active && (
              <span className="bg-amber-50 text-amber-800 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider">
                No disponible
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatCurrency(product.price_cents)}
          </p>
        </div>

        <ChevronRight className="text-muted-foreground/40 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
