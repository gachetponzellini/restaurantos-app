"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TestPrintButton } from "@/components/admin/settings/test-print-button";
import {
  createControlPrinter,
  deleteControlPrinter,
  updateControlPrinterRow,
} from "@/lib/print/control-printers-actions";

export type ControlPrinterListRow = {
  id: string;
  name: string;
  printer_ip: string;
  printer_port: number;
  is_active: boolean;
  usuarios: number;
};

/**
 * Las comanderas de control del negocio (spec 190).
 *
 * Existe para que la comandera sea una **cosa con nombre** y no un string que
 * se escribe a mano en la ficha de cada persona: en KCC la misma IP ya estaba
 * escrita cinco veces, y cada encargado con USB sumaba otra. Acá se cargan una
 * vez, se prueban, y en Empleados cada uno elige la suya de la lista.
 */
export function ControlPrintersList({
  slug,
  initial,
}: {
  slug: string;
  initial: ControlPrinterListRow[];
}) {
  const router = useRouter();
  const [nueva, setNueva] = useState({ name: "", ip: "", port: "9100" });
  const [pending, startTransition] = useTransition();

  const crear = () =>
    startTransition(async () => {
      const r = await createControlPrinter({
        business_slug: slug,
        name: nueva.name,
        printer_ip: nueva.ip,
        printer_port: Number(nueva.port) || 9100,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setNueva({ name: "", ip: "", port: "9100" });
      toast.success("Comandera agregada.");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {initial.length === 0 && (
        <p className="text-sm text-zinc-500">
          Todavía no hay ninguna. Agregá una acá y después elegí quién imprime
          en ella, en Empleados.
        </p>
      )}

      {initial.map((c) => (
        <Fila key={c.id} slug={slug} row={c} />
      ))}

      <div className="rounded-xl border border-dashed border-zinc-300 p-3">
        <p className="mb-2 text-xs font-semibold text-zinc-900">
          Agregar una comandera
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Nombre de la comandera"
            placeholder="Caja 2"
            value={nueva.name}
            onChange={(e) => setNueva({ ...nueva, name: e.target.value })}
            className="h-9 w-40 text-sm"
          />
          <Input
            aria-label="Destino de la comandera"
            placeholder="192.168.10.61 · local:CAJA2"
            value={nueva.ip}
            onChange={(e) => setNueva({ ...nueva, ip: e.target.value })}
            className="h-9 w-64 text-sm"
          />
          <Input
            aria-label="Puerto"
            value={nueva.port}
            onChange={(e) => setNueva({ ...nueva, port: e.target.value })}
            className="h-9 w-20 text-sm"
          />
          <Button
            size="sm"
            onClick={crear}
            disabled={pending || !nueva.name.trim() || !nueva.ip.trim()}
          >
            <Plus className="size-3.5" />
            Agregar
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500">
          Con una impresora USB poné <code>local:</code> y el nombre que tiene
          en Windows: la atiende el agente instalado en esa misma compu.
        </p>
      </div>
    </div>
  );
}

function Fila({ slug, row }: { slug: string; row: ControlPrinterListRow }) {
  const router = useRouter();
  const [name, setName] = useState(row.name);
  const [ip, setIp] = useState(row.printer_ip);
  const [port, setPort] = useState(String(row.printer_port));
  const [activa, setActiva] = useState(row.is_active);
  const [pending, startTransition] = useTransition();

  const sucia =
    name !== row.name ||
    ip !== row.printer_ip ||
    port !== String(row.printer_port) ||
    activa !== row.is_active;

  const guardar = () =>
    startTransition(async () => {
      const r = await updateControlPrinterRow({
        business_slug: slug,
        id: row.id,
        name,
        printer_ip: ip,
        printer_port: Number(port) || 9100,
        is_active: activa,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Comandera guardada.");
      router.refresh();
    });

  const borrar = () =>
    startTransition(async () => {
      const r = await deleteControlPrinter({ business_slug: slug, id: row.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Comandera borrada.");
      router.refresh();
    });

  return (
    <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Nombre de ${row.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-40 text-sm"
        />
        <Input
          aria-label={`Destino de ${row.name}`}
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          className="h-9 w-64 text-sm"
        />
        <Input
          aria-label={`Puerto de ${row.name}`}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="h-9 w-20 text-sm"
        />
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700">
          <input
            type="checkbox"
            checked={activa}
            onChange={(e) => setActiva(e.target.checked)}
          />
          Activa
        </label>
        <TestPrintButton slug={slug} label={name} ip={ip} port={port} />
        <Button size="sm" onClick={guardar} disabled={pending || !sucia}>
          Guardar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={borrar}
          disabled={pending}
          aria-label={`Borrar ${row.name}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        {row.usuarios === 0
          ? "Nadie la tiene asignada todavía."
          : row.usuarios === 1
            ? "1 persona imprime su control acá."
            : `${row.usuarios} personas imprimen su control acá.`}
      </p>
    </div>
  );
}
