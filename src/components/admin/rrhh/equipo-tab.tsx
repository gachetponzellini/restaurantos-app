"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Eye, EyeOff, UserPlus, Users } from "lucide-react";

import { InviteUserForm } from "@/components/admin/users/invite-user-form";
import { UserRow } from "@/components/admin/users/user-row";
import type { ControlPrinterOption } from "@/components/admin/users/control-printer-field";
import { Surface } from "@/components/admin/shell/page-shell";
import { RoleFilter } from "@/components/admin/rrhh/role-filter";
import { SearchInput } from "@/components/admin/rrhh/search-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { BusinessMember } from "@/lib/admin/members-query";
import type { MonthlySummaryRow } from "@/lib/rrhh/clock-queries";
import { formatHours, formatHoursDecimal } from "@/lib/rrhh/format-utils";

export function EquipoTab({
  slug,
  businessName,
  members,
  currentUserId,
  includeDisabled,
  employeeClockData,
  comanderas = [],
}: {
  slug: string;
  businessName?: string;
  members: BusinessMember[];
  currentUserId: string;
  includeDisabled: boolean;
  employeeClockData?: MonthlySummaryRow[];
  /** Comanderas de control del negocio, para el selector de cada fila (190). */
  comanderas?: ControlPrinterOption[];
}) {
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const activeCount = members.filter((m) => !m.disabled_at).length;
  const disabledCount = members.filter((m) => m.disabled_at).length;

  const clockMap = useMemo(() => {
    const map = new Map<string, MonthlySummaryRow>();
    for (const row of employeeClockData ?? []) {
      map.set(row.userId, row);
    }
    return map;
  }, [employeeClockData]);

  const filtered = useMemo(() => {
    let list = members;
    if (roleFilter) list = list.filter((m) => m.role === roleFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          (m.full_name ?? "").toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [members, roleFilter, search]);

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold text-zinc-900">
            {activeCount} activos
            {disabledCount > 0 && (
              <span className="font-normal text-zinc-500">
                {" "}
                · {disabledCount} deshabilitados
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger
              render={
                <Button size="lg">
                  <UserPlus className="size-3.5" />
                  Nuevo empleado
                </Button>
              }
            />
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Sumar empleado</DialogTitle>
              </DialogHeader>
              <InviteUserForm slug={slug} businessName={businessName} />
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={
              <Link
                href={
                  includeDisabled
                    ? `/${slug}/admin/rrhh?tab=equipo`
                    : `/${slug}/admin/rrhh?tab=equipo&disabled=1`
                }
              />
            }
          >
            {includeDisabled ? (
              <>
                <EyeOff className="size-3.5" />
                Ocultar
              </>
            ) : (
              <>
                <Eye className="size-3.5" />
                Deshabilitados
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <RoleFilter value={roleFilter} onChange={setRoleFilter} />
        <SearchInput
          value={search}
          onChange={setSearch}
          aria-label="Buscar empleado"
          className="ml-auto w-full max-w-[12rem]"
        />
      </div>

      {/* Employee list */}
      {filtered.length === 0 ? (
        <Surface
          padding="default"
          className="grid place-items-center gap-3 p-12 text-center"
        >
          <div className="flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600">
            <Users className="size-5" strokeWidth={1.75} />
          </div>
          <p className="text-sm font-semibold text-zinc-900">
            {members.length === 0
              ? "Nadie tiene acceso todavía"
              : "Sin resultados"}
          </p>
          <p className="max-w-sm text-sm text-zinc-600">
            {members.length === 0
              ? "Sumá al primer empleado con el botón de arriba."
              : "Probá con otro filtro o buscá por nombre."}
          </p>
        </Surface>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((m) => {
            const clock = clockMap.get(m.user_id);
            return (
              <EmployeeCard
                key={m.user_id}
                slug={slug}
                member={m}
                canManage
                isCurrentUser={m.user_id === currentUserId}
                clockData={clock}
                comanderas={comanderas}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmployeeCard({
  slug,
  member,
  canManage,
  isCurrentUser,
  clockData,
  comanderas,
}: {
  slug: string;
  member: BusinessMember;
  canManage: boolean;
  isCurrentUser: boolean;
  clockData?: MonthlySummaryRow;
  comanderas: ControlPrinterOption[];
}) {
  return (
    <div className="space-y-2">
      <UserRow
        slug={slug}
        member={member}
        canManage={canManage}
        isCurrentUser={isCurrentUser}
        lastClockIn={clockData?.lastClockIn ?? null}
        comanderas={comanderas}
      />
      {/* Monthly stats bar */}
      {clockData && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 pl-[52px] text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3 text-zinc-400" />
            <span className="font-semibold text-zinc-700 tabular-nums">
              {formatHoursDecimal(clockData.totalMinutes)}
            </span>{" "}
            este mes
          </span>
          <span>
            <span className="font-semibold text-zinc-700 tabular-nums">
              {clockData.daysWorked}
            </span>{" "}
            días
          </span>
          <span>
            Prom{" "}
            <span className="font-semibold text-zinc-700 tabular-nums">
              {formatHours(clockData.avgMinutesPerDay)}
            </span>
            /día
          </span>
        </div>
      )}
    </div>
  );
}
