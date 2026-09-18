import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeletons de las rutas de mesa del mozo/admin (spec 39, FR-001/FR-002).
 * Calcan el header sticky (botón volver + eyebrow + título de mesa) y los
 * placeholders del contenido principal de cada destino, de modo que al
 * reemplazarse por el contenido real no haya salto de layout.
 *
 * Los tres destinos comparten el mismo header; cambia el cuerpo:
 * - `pedir`  → buscador + chips de categoría + grilla de productos.
 * - `cuenta` → líneas de items + totales.
 * - `cobrar` → barra de progreso + KPI "falta cobrar" + splits.
 */
export type MesaRouteVariant = "pedir" | "cuenta" | "cobrar";

const MAX_WIDTH: Record<MesaRouteVariant, string> = {
  pedir: "max-w-md",
  cuenta: "max-w-screen-md",
  cobrar: "max-w-screen-md",
};

function MesaHeaderSkeleton({ variant }: { variant: MesaRouteVariant }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur-md">
      <div
        className={`mx-auto flex ${MAX_WIDTH[variant]} items-center gap-3 px-4 py-3`}
      >
        {/* botón volver */}
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
        {variant !== "pedir" && <Skeleton className="h-8 w-20 rounded-md" />}
      </div>
    </header>
  );
}

/**
 * Skeleton del panel de carga **embebido** en el sidebar del salón (spec 115).
 *
 * Sólo se ve la primera vez que se abre el operativo en un dispositivo: desde
 * que el catálogo está cacheado, el panel monta con la columna de carga ya
 * pintada y esta pantalla no aparece más.
 *
 * Calca el panel de dos columnas de la spec 111 —la mesa a un lado, la carga
 * al otro— y no una lista suelta: si el esqueleto no tiene la forma de lo que
 * viene, no sirve de nada. El corte es por ancho **del panel** (container
 * query), igual que el real, y abajo del corte la mesa se apila en vez de
 * esconderse (spec 146 · C).
 */
export function PedirPanelSkeleton() {
  return (
    <div
      role="status"
      aria-label="Cargando la mesa"
      className="flex min-h-0 flex-1 flex-col @min-[600px]:flex-row"
    >
      {/* La mesa: al lado de la carga con el panel ancho, apilada abajo con el
          panel angosto — nunca escondida. */}
      <div className="order-2 max-h-[45%] shrink-0 space-y-3 overflow-hidden border-t border-border px-3 py-3 @min-[600px]:order-1 @min-[600px]:flex @min-[600px]:max-h-none @min-[600px]:w-[46%] @min-[600px]:max-w-[520px] @min-[600px]:flex-col @min-[600px]:border-t-0 @min-[600px]:border-r">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
          >
            <div className="border-b border-border/60 bg-muted/30 px-3 py-2">
              <Skeleton className="h-3 w-24 rounded" />
            </div>
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* La carga: el buscador fijo y la lista de productos. */}
      <div className="order-1 flex min-h-0 flex-1 flex-col @min-[600px]:order-2">
        <div className="shrink-0 space-y-2 border-b border-border bg-card px-3 py-2.5">
          <Skeleton className="h-11 w-full rounded-2xl" />
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 px-3 py-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PedirBodySkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function CuentaBodySkeleton() {
  return (
    <div className="mx-auto max-w-screen-md space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
      <div className="mt-6 space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
    </div>
  );
}

function CobrarBodySkeleton() {
  return (
    <div className="mx-auto max-w-screen-md space-y-4 p-4">
      {/* barra de progreso */}
      <Skeleton className="h-2 w-full rounded-full" />
      {/* KPI "falta cobrar" */}
      <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="h-8 w-40" />
      </div>
      {/* splits */}
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function MesaRouteSkeleton({ variant }: { variant: MesaRouteVariant }) {
  return (
    <div className="min-h-dvh bg-muted/60">
      <MesaHeaderSkeleton variant={variant} />
      {variant === "pedir" && <PedirBodySkeleton />}
      {variant === "cuenta" && <CuentaBodySkeleton />}
      {variant === "cobrar" && <CobrarBodySkeleton />}
    </div>
  );
}
