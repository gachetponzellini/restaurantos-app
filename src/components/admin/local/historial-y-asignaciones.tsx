"use client";

import { ChevronDown } from "lucide-react";

import { CajaAssignmentsPanel } from "@/components/admin/local/caja-assignments-tab";
import { ImprimirRendicionBoton } from "./imprimir-rendicion-boton";
import type { Caja, CajaUserAssignment, MozoRendicion } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { TZ_AR } from "@/lib/timezone";

/**
 * Lo que quedaba al pie de la vieja «rendición en caja» (spec 211): el
 * historial de rendiciones, con su papel, y la asignación caja ↔ usuario. La
 * rendición en sí ahora está en «Efectivo: dónde está».
 */

export type HistorialRendicion = MozoRendicion & {
  mozo_name: string;
  registered_by_name: string | null;
  /** Ya tiene su papel (print_job de la rendición). Issue #297. */
  ya_impresa?: boolean;
};

type AssignmentWithNames = CajaUserAssignment & {
  user_name: string | null;
  caja_name: string;
};

export function HistorialYAsignaciones({
  slug,
  historial,
  cajas,
  assignments,
  members,
  showAssignments,
  onChanged,
}: {
  slug: string;
  historial: HistorialRendicion[];
  cajas: Caja[];
  assignments: AssignmentWithNames[];
  members: { user_id: string; full_name: string | null }[];
  showAssignments: boolean;
  onChanged: () => void;
}) {
  if (historial.length === 0 && !showAssignments) return null;
  return (
    <details className="group rounded-xl bg-card ring-1 ring-border/70">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground/80">
        Rendiciones anteriores{showAssignments ? " y asignación de cajas" : ""}
        <ChevronDown className="size-4 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border/60 p-4">
        {historial.length > 0 && <HistorialRendiciones slug={slug} historial={historial} />}
        {showAssignments && (
          <CajaAssignmentsPanel
            slug={slug}
            cajas={cajas}
            assignments={assignments}
            onChanged={onChanged}
            members={members}
          />
        )}
      </div>
    </details>
  );
}

function HistorialRendiciones({
  slug,
  historial,
}: {
  slug: string;
  historial: HistorialRendicion[];
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-3 text-[0.6rem] font-semibold tracking-[0.14em] uppercase">
        Últimas rendiciones
      </p>
      <div className="ring-border/70 overflow-x-auto rounded-lg ring-1">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border/60 bg-muted/30 border-b">
              <th className="text-muted-foreground px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Mozo
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Esperado
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Entregado
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Dif.
              </th>
              <th className="text-muted-foreground px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Registrado por
              </th>
              <th className="text-muted-foreground px-3 py-2 text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
                Hora
              </th>
              {/* Spec 178 — el papel del mozo, a pedido. Sin rótulo: el
                      botón se explica solo y la columna queda angosta. */}
              <th className="px-3 py-2" aria-label="Imprimir" />
            </tr>
          </thead>
          <tbody className="divide-border/60 divide-y">
            {historial.map((r) => {
              const diff = r.difference_cents;
              return (
                <tr key={r.id}>
                  <td className="text-foreground px-3 py-2 font-medium">
                    {r.mozo_name}
                  </td>
                  <td className="text-foreground/80 px-3 py-2 text-right tabular-nums">
                    {formatCurrency(r.expected_cash_cents)}
                  </td>
                  <td className="text-foreground/80 px-3 py-2 text-right tabular-nums">
                    {formatCurrency(r.delivered_cash_cents)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-semibold tabular-nums",
                      diff === 0
                        ? "text-emerald-700"
                        : diff < 0
                          ? "text-rose-700"
                          : "text-amber-700",
                    )}
                  >
                    {diff === 0
                      ? "OK"
                      : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`}
                  </td>
                  <td className="text-foreground/70 px-3 py-2">
                    {r.registered_by_name ?? "—"}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 tabular-nums">
                    {new Date(r.created_at).toLocaleTimeString("es-AR", {
                      timeZone: TZ_AR,
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ImprimirRendicionBoton
                      slug={slug}
                      rendicionId={r.id}
                      mozoName={r.mozo_name}
                      yaImpresa={r.ya_impresa ?? false}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Los canales con efectivo a entregar (spec 203). Con más de uno —o con uno que
 * no sea el salón— se rinde y se muestra por separado.
 */
