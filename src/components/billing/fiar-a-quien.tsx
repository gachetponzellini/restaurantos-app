"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import {
  buscarParaFiar,
  crearClienteParaFiar,
} from "@/lib/caja/cuenta-corriente-actions";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";

export type ClienteParaFiar = {
  id: string;
  name: string | null;
  phone: string;
  saldo_cents: number;
  habilitado?: boolean;
};

/**
 * A quién se le fía — spec 141 · D2 (revisada 2026-09-03).
 *
 * Antes era un `<select>` con los clientes previamente habilitados desde su
 * ficha, y eso hacía el flujo impracticable: el socio dice «ponelo en mi cuenta»
 * y el encargado tenía que salir del cobro, ir a Clientes, prender un switch y
 * volver. En hora pico eso no pasa — se cobra en efectivo y el fiado queda sin
 * registrar, que es justo lo que la feature viene a evitar.
 *
 * Ahora: busca sobre todos, los que ya tienen cuenta salen primero, y si no está
 * se lo da de alta acá mismo con nombre y teléfono. **Fiarle a alguien lo
 * habilita** — el control es el rol (`canFiar`) más el saldo a la vista, no una
 * lista blanca.
 */
export function FiarAQuien({
  slug,
  iniciales,
  value,
  onChange,
}: {
  slug: string;
  /** Los que ya tienen cuenta, del server: la lista de apertura sin tipear. */
  iniciales: ClienteParaFiar[];
  value: ClienteParaFiar | null;
  onChange: (c: ClienteParaFiar | null) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClienteParaFiar[]>(iniciales);
  const [buscando, startBuscar] = useTransition();
  const [creando, setCreando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTel, setNuevoTel] = useState("");
  const [guardando, startGuardar] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startBuscar(async () => {
        const r = await buscarParaFiar(slug, q);
        if (r.ok) setResultados(r.data);
      });
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, slug, value]);

  // Elegido: se muestra a quién, con su saldo. El saldo antes de confirmar es lo
  // único que ve `terminal`, que fía pero no entra a la tab de cuentas (D7).
  if (value) {
    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold text-foreground/70">Se le fía a</span>
        <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-emerald-900">
              {value.name ?? value.phone}
            </p>
            {value.saldo_cents > 0 && (
              <p className="text-xs text-emerald-800">
                ya debe {formatCurrency(value.saldo_cents)}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-800"
            onClick={() => {
              onChange(null);
              setQ("");
            }}
            aria-label="Elegir otro cliente"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (creando) {
    return (
      <div className="grid gap-2 rounded-xl bg-muted/50 p-3 ring-1 ring-border">
        <div className="grid gap-0.5">
          <span className="text-xs font-semibold text-foreground/70">
            Abrir cuenta corriente
          </span>
          {/* El teléfono es la clave única de `customers`: si el cliente ya
              existe en el negocio, esto NO lo duplica — le abre la cuenta al que
              ya estaba. Decirlo evita que el encargado dude y vaya a buscarlo a
              Clientes, que es el viaje que esta pantalla vino a sacar. */}
          <span className="text-[11px] text-muted-foreground">
            Si el teléfono ya está cargado, se le abre la cuenta a ese mismo
            cliente.
          </span>
        </div>
        <input
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          placeholder="Nombre"
          autoFocus
          className="h-10 rounded-lg border border-border px-3 text-sm focus:border-emerald-400 focus:outline-none"
        />
        <input
          value={nuevoTel}
          onChange={(e) => setNuevoTel(e.target.value)}
          placeholder="Teléfono"
          inputMode="tel"
          className="h-10 rounded-lg border border-border px-3 text-sm tabular-nums focus:border-emerald-400 focus:outline-none"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={() => setCreando(false)}
          >
            Volver
          </Button>
          <Button
            type="button"
            size="lg"
            className="flex-1"
            disabled={guardando || !nuevoNombre.trim()}
            onClick={() =>
              startGuardar(async () => {
                const r = await crearClienteParaFiar({
                  name: nuevoNombre,
                  phone: nuevoTel,
                  slug,
                });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                onChange({ ...r.data, saldo_cents: 0, habilitado: true });
                setCreando(false);
              })
            }
          >
            {guardando ? "Abriendo…" : "Abrir cuenta"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-semibold text-foreground/70">
        ¿A quién se le fía?
      </span>
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o teléfono"
          className="h-11 w-full rounded-xl border border-border pr-3 pl-9 text-base focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
        />
      </div>

      <ul className="max-h-52 overflow-y-auto rounded-xl ring-1 ring-border/70">
        {resultados.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onChange(c)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {c.name ?? c.phone}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c.habilitado === false
                    ? "primera vez que se le fía"
                    : c.saldo_cents > 0
                      ? `debe ${formatCurrency(c.saldo_cents)}`
                      : "sin deuda"}
                </span>
              </span>
              {c.saldo_cents > 0 && (
                <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">
                  {formatCurrency(c.saldo_cents)}
                </span>
              )}
            </button>
          </li>
        ))}
        {resultados.length === 0 && (
          <li className="px-3 py-3 text-center text-sm text-muted-foreground">
            {buscando
              ? "Buscando…"
              : q.trim().length >= 2
                ? "No hay nadie con ese nombre."
                : "Todavía nadie tiene cuenta. Buscá o creá uno."}
          </li>
        )}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full border-dashed"
        onClick={() => {
          setCreando(true);
          // Lo tipeado en el buscador suele ser el nombre: no se pierde.
          setNuevoNombre(/\d/.test(q) ? "" : q.trim());
          setNuevoTel(/\d/.test(q) ? q.replace(/\D/g, "") : "");
        }}
      >
        <UserPlus className="size-4" />
        Abrir cuenta a alguien más
      </Button>
    </div>
  );
}
