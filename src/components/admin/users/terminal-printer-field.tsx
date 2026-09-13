"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateTerminalPrinter } from "@/lib/admin/members-actions";

/**
 * La comandera de control de una terminal (spec 181 · D2).
 *
 * Aparece sólo en las filas con rol `terminal`: es un puesto, no una persona.
 * El control de lo que se manda desde esa compu sale por acá. Vacío = la del
 * negocio. Admite IP o `local:NOMBRE` — la impresora USB enchufada a esa
 * compu, atendida por el agente instalado ahí (D3).
 */
export function TerminalPrinterField({
  slug,
  userId,
  initialIp,
  initialPort,
  editable,
}: {
  slug: string;
  userId: string;
  initialIp: string | null;
  initialPort: number | null;
  editable: boolean;
}) {
  const [ip, setIp] = useState(initialIp ?? "");
  const [pending, startTransition] = useTransition();
  const esLocal = ip.trim().toLowerCase().startsWith("local:");
  const cambio = ip.trim() !== (initialIp ?? "");

  const guardar = () =>
    startTransition(async () => {
      const r = await updateTerminalPrinter({
        business_slug: slug,
        user_id: userId,
        control_printer_ip: ip.trim() || null,
        control_printer_port: esLocal ? null : (initialPort ?? 9100),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        ip.trim()
          ? `Los controles de esta terminal salen por ${ip.trim()}.`
          : "Esta terminal usa la comandera de control del negocio.",
      );
    });

  return (
    <div className="mt-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
      <label
        htmlFor={`ctrl-${userId}`}
        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900"
      >
        <Printer className="size-3.5" />
        Comandera de control de esta terminal
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Input
          id={`ctrl-${userId}`}
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="vacío = la del negocio · 192.168.10.61 · local:CONTROL-T1"
          disabled={!editable || pending}
          className="h-9 text-sm"
        />
        {editable && (
          <Button size="sm" onClick={guardar} disabled={pending || !cambio}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        El control de lo que se manda desde esta compu sale por acá.{" "}
        {esLocal
          ? "«local:» es una impresora USB de esta compu: la atiende el agente instalado en ella, con ese nombre en su alcance."
          : "Con una USB, poné local: y el nombre de la impresora en Windows."}
      </p>
    </div>
  );
}
