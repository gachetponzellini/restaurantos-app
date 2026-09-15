"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { updateControlPrinter } from "@/lib/admin/members-actions";

export type ControlPrinterOption = {
  id: string;
  name: string;
  printer_ip: string;
};

/**
 * Con qué comandera de control imprime este puesto (spec 190).
 *
 * Antes era un input de texto donde se escribía `local:CAJA2` a mano —y un
 * typo no se veía hasta que no salía el papel (specs 181/186). Ahora se
 * **elige** de la lista del negocio, que se arma en Configuración →
 * Comanderas. Vacío = la del negocio, que es el caso de casi todos.
 *
 * Aparece en las filas que pueden emitir un control: terminal, encargado,
 * admin. Ojo con lo que significa ponérsela a una persona: el papel sigue a la
 * **cuenta**, no a la máquina. Es lo que se quiere cuando esa cuenta atiende
 * siempre el mismo puesto —la segunda caja de KCC— y es justo lo que no se
 * quiere cuando el encargado rota: ahí se deja en «la del negocio».
 */
export function ControlPrinterField({
  slug,
  userId,
  esTerminal,
  comanderas,
  initialId,
  editable,
}: {
  slug: string;
  userId: string;
  /** Sólo para el texto: una terminal es una compu, un encargado es un puesto. */
  esTerminal: boolean;
  comanderas: ControlPrinterOption[];
  initialId: string | null;
  editable: boolean;
}) {
  const [elegida, setElegida] = useState(initialId ?? "");
  const [pending, startTransition] = useTransition();

  const guardar = (valor: string) => {
    const previa = elegida;
    setElegida(valor);
    startTransition(async () => {
      const r = await updateControlPrinter({
        business_slug: slug,
        user_id: userId,
        control_printer_id: valor || null,
      });
      if (!r.ok) {
        setElegida(previa);
        toast.error(r.error);
        return;
      }
      const quien = esTerminal ? "esta terminal" : "este puesto";
      const nombre = comanderas.find((c) => c.id === valor)?.name;
      toast.success(
        nombre
          ? `Los controles de ${quien} salen por «${nombre}».`
          : `${esTerminal ? "Esta terminal" : "Este puesto"} usa la comandera de control del negocio.`,
      );
    });
  };

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
      <select
        id={`ctrl-${userId}`}
        value={elegida}
        onChange={(e) => guardar(e.target.value)}
        disabled={!editable || pending}
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm disabled:opacity-60"
      >
        <option value="">La comandera de control del negocio</option>
        {comanderas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.printer_ip}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-zinc-500">
        {comanderas.length === 0
          ? "Todavía no hay comanderas de control cargadas. Se agregan en Configuración → Comanderas."
          : esTerminal
            ? "El control de lo que se manda desde esta compu sale por acá."
            : "El control de lo que esta persona manda sale por acá, esté donde esté."}
      </p>
    </div>
  );
}
