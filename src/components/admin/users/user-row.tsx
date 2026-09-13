"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RolePicker } from "@/components/admin/users/role-picker";
import { TerminalPrinterField } from "@/components/admin/users/terminal-printer-field";
import {
  generateAccessLink,
  type AccessLinkPayload,
  disableBusinessMember,
  enableBusinessMember,
} from "@/lib/admin/members-actions";
import type { BusinessMember } from "@/lib/admin/members-query";
import { cn } from "@/lib/utils";

export function UserRow({
  slug,
  member,
  canManage,
  isCurrentUser,
  lastClockIn,
}: {
  slug: string;
  member: BusinessMember;
  canManage: boolean;
  isCurrentUser: boolean;
  lastClockIn?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const isDisabled = Boolean(member.disabled_at);

  // Spec 142 · D5 — el link de acceso. `null` = todavía no se pidió; una vez
  // generado se muestra para copiar, porque el token es de un solo uso y
  // regenerarlo invalida el anterior.
  const [acceso, setAcceso] = useState<AccessLinkPayload | null>(null);
  const [copiado, setCopiado] = useState(false);

  const handleAccessLink = () => {
    startTransition(async () => {
      const r = await generateAccessLink({
        business_slug: slug,
        user_id: member.user_id,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setAcceso(r.data);
    });
  };

  const copiarMensaje = async () => {
    if (!acceso) return;
    try {
      await navigator.clipboard.writeText(acceso.message);
      setCopiado(true);
      toast.success("Mensaje copiado");
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error("No pudimos copiar. Seleccionalo a mano.");
    }
  };

  const handleDisable = () => {
    startTransition(async () => {
      const r = await disableBusinessMember(slug, member.user_id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Empleado deshabilitado.");
      setOpen(false);
      router.refresh();
    });
  };

  const handleEnable = () => {
    startTransition(async () => {
      const r = await enableBusinessMember(slug, member.user_id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Empleado reactivado.");
      router.refresh();
    });
  };

  const displayName = member.full_name?.trim() || member.email;
  const showEmailSubtitle = Boolean(member.full_name?.trim());

  return (
    <li
      className={cn(
        "rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 transition hover:ring-zinc-300",
        isDisabled && "bg-zinc-50 opacity-70 hover:ring-zinc-200/70",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-black/10",
              isDisabled && "grayscale",
            )}
            style={{
              background: "var(--brand)",
              color: "var(--brand-foreground)",
            }}
          >
            {displayName[0]?.toUpperCase() ?? "?"}
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                "truncate text-sm font-semibold text-zinc-900",
                isDisabled && "text-zinc-500",
              )}
            >
              {displayName}
              {isCurrentUser && (
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  (vos)
                </span>
              )}
              {isDisabled && (
                <span className="ml-2 inline-flex items-center rounded-full bg-zinc-200 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wider text-zinc-700 uppercase">
                  Deshabilitado
                </span>
              )}
            </p>
            {showEmailSubtitle && (
              <p className="truncate text-xs text-zinc-500">{member.email}</p>
            )}
            {member.phone && (
              <p className="truncate text-xs text-zinc-500">{member.phone}</p>
            )}
            {member.pin && (
              <p className="text-xs text-zinc-500">
                PIN: <span className="font-mono">{member.pin}</span>
              </p>
            )}
            <p className="text-xs text-zinc-500">
              Desde{" "}
              {new Intl.DateTimeFormat("es-AR", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }).format(new Date(member.created_at))}
              {lastClockIn && (
                <>
                  {" · "}Última fichada:{" "}
                  {(() => {
                    const now = new Date();
                    const d = new Date(lastClockIn);
                    const diffDays = Math.floor(
                      (now.getTime() - d.getTime()) / 86400000,
                    );
                    if (diffDays === 0)
                      return `Hoy ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
                    if (diffDays === 1) return "Ayer";
                    if (diffDays < 7) return `Hace ${diffDays}d`;
                    return d.toLocaleDateString("es-AR", {
                      day: "2-digit",
                      month: "short",
                    });
                  })()}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RolePicker
            slug={slug}
            userId={member.user_id}
            role={member.role}
            displayName={displayName}
            editable={canManage && !isCurrentUser && !isDisabled}
          />
          {canManage && !isDisabled && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAccessLink}
              disabled={pending}
              aria-label={`Generar link de acceso para ${displayName}`}
            >
              <Link2 className="size-3.5" />
              {acceso ? "Otro link" : "Link de acceso"}
            </Button>
          )}
          {canManage && !isCurrentUser && !isDisabled && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Deshabilitar empleado"
                  >
                    <UserMinus className="size-3.5" />
                    Deshabilitar
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Deshabilitar a {displayName}</DialogTitle>
                </DialogHeader>
                <p className="text-muted-foreground text-sm">
                  Pierde acceso al panel del negocio. La cuenta y su historial
                  (pedidos, comandas) quedan intactos. Podés reactivarla cuando
                  quieras.
                </p>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={pending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDisable}
                    disabled={pending}
                  >
                    Deshabilitar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canManage && isDisabled && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleEnable}
              disabled={pending}
              aria-label="Reactivar empleado"
            >
              <RotateCcw className="size-3.5" />
              Reactivar
            </Button>
          )}
        </div>
      </div>

      {/* Spec 181 — sólo la terminal tiene impresora: es un puesto. */}
      {member.role === "terminal" && !isDisabled && (
        <TerminalPrinterField
          slug={slug}
          userId={member.user_id}
          initialIp={member.control_printer_ip}
          initialPort={member.control_printer_port}
          editable={canManage}
        />
      )}

      {acceso && (
        <div className="mt-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
          <p className="text-xs font-semibold text-zinc-900">
            {acceso.yaTienePassword
              ? "Link para entrar directo"
              : "Link para que elija su contraseña"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-600">
            Un solo uso, vence en 1 hora. Si generás otro, este deja de servir.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-white p-2.5 font-sans text-xs whitespace-pre-wrap text-zinc-700 ring-1 ring-zinc-200/60">
            {acceso.message}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={copiarMensaje}>
              {copiado ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copiado ? "Copiado" : "Copiar mensaje"}
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(acceso.message)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600"
            >
              Mandar por WhatsApp
            </a>
            <button
              type="button"
              onClick={() => setAcceso(null)}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
