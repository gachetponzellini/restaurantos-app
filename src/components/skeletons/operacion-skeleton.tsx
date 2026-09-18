import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton de `/admin/operacion` (spec 39, FR-001/FR-002). Calca el chrome
 * fullscreen: la barra de tabs (6 pills) y el plano del Salón (default), de
 * modo que al entrar se vea la estructura al instante en vez de la pantalla
 * anterior congelada. El streaming por tab (Suspense dentro de LocalShell)
 * toma la posta una vez que la page empieza a resolver.
 */
export function OperacionTabsBarSkeleton() {
  return (
    <div className="inline-flex gap-1 rounded-2xl bg-card p-1 ring-1 ring-border/70">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-24 rounded-xl" />
      ))}
    </div>
  );
}

export function SalonBoardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/**
 * Skeleton genérico para el contenido de las tabs no-default (Caja, Rendición,
 * Fichaje, Comandas, Pedidos) mientras streamea su promesa (spec 39, FR-005).
 */
export function TabContentSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function OperacionSkeleton() {
  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-muted/50 md:left-[var(--admin-sidebar-width,60px)] md:top-0">
      <div className="border-border/60 flex items-center gap-3 overflow-x-auto border-b bg-white/95 px-3 py-3 backdrop-blur sm:px-4">
        <OperacionTabsBarSkeleton />
      </div>
      <div className="flex-1 overflow-auto p-4">
        <SalonBoardSkeleton />
      </div>
    </div>
  );
}
