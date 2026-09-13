"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type RrhhTab = "asistencia" | "equipo";

export function RrhhShell({
  activeTab,
  showEquipo = true,
  children,
}: {
  activeTab: RrhhTab;
  /**
   * Spec 179 · D4 — la encargada ve Asistencia (`rrhh: limited`) pero Equipo
   * (PINs, roles, altas) sigue siendo del admin. La page ya no la renderiza;
   * acá se saca el botón para que no exista una pestaña que lleva a nada.
   */
  showEquipo?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setTab = (next: RrhhTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "asistencia") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : `?`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <nav
        aria-label="Secciones RRHH"
        className="inline-flex rounded-2xl bg-white p-1 ring-1 ring-zinc-200/70"
      >
        <TabButton active={activeTab === "asistencia"} onClick={() => setTab("asistencia")}>
          Asistencia
        </TabButton>
        {showEquipo && (
          <TabButton active={activeTab === "equipo"} onClick={() => setTab("equipo")}>
            Equipo
          </TabButton>
        )}
      </nav>

      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-900",
      )}
    >
      {children}
    </button>
  );
}
