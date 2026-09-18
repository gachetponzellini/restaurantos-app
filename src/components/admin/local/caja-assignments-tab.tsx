"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, User, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { Label } from "@/components/ui/label";
import {
  asignarCajaUsuario,
  desasignarCajaUsuario,
} from "@/lib/caja/actions";
import type { Caja, CajaUserAssignment } from "@/lib/caja/types";
import { cn } from "@/lib/utils";

type AssignmentWithNames = CajaUserAssignment & {
  user_name: string | null;
  caja_name: string;
};

type MemberOption = {
  user_id: string;
  full_name: string | null;
};

type Props = {
  slug: string;
  cajas: Caja[];
  assignments: AssignmentWithNames[];
  members: MemberOption[];
  /** Spec 103: re-sincroniza al que me renderiza (default: refresh de ruta). */
  onChanged?: () => void;
};

export function CajaAssignmentsPanel({
  slug,
  cajas,
  assignments: initialAssignments,
  members,
  onChanged,
}: Props) {
  const router = useRouter();
  // Spec 103: quien me renderiza decide cómo re-sincronizar. Sin esto se cae al
  // `router.refresh()` histórico, que re-corre las 7 tabs de operación.
  const resincronizar = () => (onChanged ? onChanged() : router.refresh());
  const [, startTransition] = useTransition();
  const [assignments, setAssignments] = useState(initialAssignments);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    setAssignments(initialAssignments);
  }, [initialAssignments]);

  const byCaja = cajas.map((c) => ({
    caja: c,
    assigned: assignments.filter((a) => a.caja_id === c.id),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Asignación caja → usuario
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="mr-1.5 size-3.5" />
          Asignar
        </Button>
      </div>

      {cajas.length === 0 ? (
        <Surface padding="default">
          <p className="py-4 text-center text-sm text-zinc-500">
            No hay cajas configuradas.
          </p>
        </Surface>
      ) : (
        <div className="space-y-3">
          {byCaja.map(({ caja, assigned }) => (
            <div
              key={caja.id}
              className="rounded-xl bg-white p-4 ring-1 ring-zinc-200/70"
            >
              <div className="flex items-center gap-2">
                <Wallet className="size-4 text-zinc-400" />
                <h4 className="text-sm font-semibold text-zinc-900">
                  {caja.name}
                </h4>
              </div>
              {assigned.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-400">
                  Sin usuarios asignados
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {assigned.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50"
                    >
                      <span className="inline-flex items-center gap-2 text-sm text-zinc-700">
                        <User className="size-3.5 text-zinc-400" />
                        {a.user_name ?? "Sin nombre"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          startTransition(async () => {
                            const r = await desasignarCajaUsuario(
                              a.caja_id,
                              a.user_id,
                              slug,
                            );
                            if (!r.ok) toast.error(r.error);
                            else {
                              toast.success("Asignación eliminada");
                              resincronizar();
                            }
                          })
                        }
                        className="rounded-full p-1 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Desasignar"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <AddAssignmentModal
        open={addOpen}
        onOpenChange={setAddOpen}
        cajas={cajas}
        members={members}
        existingAssignments={assignments}
        slug={slug}
        onSuccess={() => {
          setAddOpen(false);
          resincronizar();
        }}
      />
    </div>
  );
}

function AddAssignmentModal({
  open,
  onOpenChange,
  cajas,
  members,
  existingAssignments,
  slug,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cajas: Caja[];
  members: MemberOption[];
  existingAssignments: AssignmentWithNames[];
  slug: string;
  onSuccess: () => void;
}) {
  const [, startTransition] = useTransition();
  const [cajaId, setCajaId] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    if (!open) {
      setCajaId("");
      setUserId("");
    }
  }, [open]);

  const alreadyAssigned = existingAssignments.some(
    (a) => a.caja_id === cajaId && a.user_id === userId,
  );

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader title="Asignar caja a usuario" icon={<Plus />} />
        <ModalBody className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Caja</Label>
            <select
              value={cajaId}
              onChange={(e) => setCajaId(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950",
              )}
            >
              <option value="">Seleccioná una caja</option>
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Usuario</Label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className={cn(
                "flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950",
              )}
            >
              <option value="">Seleccioná un usuario</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.user_id}
                </option>
              ))}
            </select>
          </div>
          {alreadyAssigned && (
            <p className="text-xs text-amber-700">
              Este usuario ya está asignado a esta caja.
            </p>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" size="xl" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="xl"
            disabled={!cajaId || !userId || alreadyAssigned}
            onClick={() =>
              startTransition(async () => {
                const r = await asignarCajaUsuario(cajaId, userId, slug);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Caja asignada");
                  onSuccess();
                }
              })
            }
          >
            Asignar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
