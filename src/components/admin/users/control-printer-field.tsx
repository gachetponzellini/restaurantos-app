"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateControlPrinter } from "@/lib/admin/members-actions";

/**
 * La comandera de control de un puesto (spec 181 · D2, generalizada en la
 * 186 · D1).
 *
 * Aparece en las filas que pueden emitir un control —terminal, encargado,
 * admin—: el control de lo que se manda desde ese puesto sale por acá. Vacío =
 * la del negocio, que es el caso de casi todos. Admite IP o `local:NOMBRE`: la
 * impresora USB enchufada a esa compu, atendida por el agente instalado ahí.
 *
 * Ojo con lo que significa ponerla en una persona (186 · D1): el papel sigue a
 * la **cuenta**, no a la máquina. Es lo que se quiere cuando esa cuenta atiende
 * siempre el mismo puesto —la segunda caja de KCC— y es justo lo que no se
 * quiere cuando el encargado rota: ahí se deja vacío.
 */
export function ControlPrinterField({
  slug,
  userId,
  esTerminal,
  initialIp,
  initialPort,
  editable,
}: {
  slug: string;
  userId: string;
  /** Sólo para el texto: una terminal es una compu, un encargado es un puesto. */
  esTerminal: boolean;
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
      const r = await updateControlPrinter({
        business_slug: slug,
        user_id: userId,
        control_printer_ip: ip.trim() || null,
        control_printer_port: esLocal ? null : (initialPort ?? 9100),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const quien = esTerminal ? "esta terminal" : "este puesto";
      toast.success(
        ip.trim()
          ? `Los controles de ${quien} salen por ${ip.trim()}.`
          : `${esTerminal ? "Esta terminal" : "Este puesto"} usa la comandera de control del negocio.`,
      );
    });

  return (
    <div className="mt-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
      <label
        htmlFor={`ctrl-${userId}`}
        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900"
      >
        <Printer className="size-3.5" />
        {esTerminal
          ? "Comandera de control de esta terminal"
          : "Comandera de control de este puesto"}
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
        {esTerminal
          ? "El control de lo que se manda desde esta compu sale por acá. "
          : "El control de lo que esta persona manda sale por acá, esté donde esté. "}
        {esLocal
          ? "«local:» es una impresora USB: la atiende el agente instalado en esa misma compu, con ese nombre en su alcance."
          : "Con una USB, poné local: y el nombre de la impresora en Windows."}
      </p>
    </div>
  );
}
