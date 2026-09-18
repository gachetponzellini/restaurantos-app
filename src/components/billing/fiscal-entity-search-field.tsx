"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { formatCuit } from "@/lib/afip/cuit";
import {
  buscarEntidadesFiscales,
  crearEntidadFiscal,
  type EntidadFiscalMatch,
} from "@/lib/afip/fiscal-entities-actions";
import type { CondicionIvaReceptor } from "@/lib/afip/types";
import { Button } from "@/components/ui/button";

// ============================================================================
// Buscador de entidades fiscales para el cobro (spec 150 · D2).
//
// Aparece SÓLO con Factura A: en B el receptor es consumidor final y no hay a
// quién buscar — el campo sería ruido en el camino más transitado.
//
// Elegir una entidad **completa** los tres campos pero no los congela (D3): la
// razón social se puede corregir sobre la marcha y la factura sale con lo
// corregido. Lo que NO cambia es la entidad guardada (D4): eso se hace en su
// pantalla, con la cabeza fría.
//
// Es un componente compartido: lo montan `ComprobanteFields` (cobro de un
// pedido) y `FacturacionSection` (cobro de mesa, mozo y encargado). Una
// implementación, todas las pantallas que facturan.
// ============================================================================

export function FiscalEntitySearchField({
  slug,
  cuit,
  razonSocial,
  condicionIva,
  entidadId,
  onSelect,
}: {
  slug: string;
  /** El CUIT del formulario, como se tipeó. */
  cuit: string;
  razonSocial: string;
  condicionIva: CondicionIvaReceptor;
  /** Entidad ya vinculada, si el operador eligió (o guardó) una. */
  entidadId: string | null;
  onSelect: (entidad: EntidadFiscalMatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntidadFiscalMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [guardando, setGuardando] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Lo recién elegido no se vuelve a buscar: el effect dispararía otra búsqueda
  // y la lista reaparecería sola.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = query.trim();
    // Con menos de 2 caracteres no buscamos, salvo que sean dígitos de un CUIT
    // que se está tipeando (3 ya acotan bastante).
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await buscarEntidadesFiscales(slug, q);
      const data = r.ok ? r.data : [];
      setResults(data);
      setLoading(false);
      setCursor(-1);
      setOpen(data.length > 0);
    }, 300);
    return () => clearTimeout(t);
  }, [query, slug]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (entidad: EntidadFiscalMatch) => {
    justPicked.current = true;
    onSelect(entidad);
    setQuery(entidad.razon_social);
    setOpen(false);
    setResults([]);
    setCursor(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && cursor >= 0) {
      // Sólo intercepta Enter si hay algo marcado: si no, Enter sigue siendo lo
      // que fuera en la pantalla que monta el buscador.
      e.preventDefault();
      e.stopPropagation();
      const entidad = results[cursor];
      if (entidad) pick(entidad);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  // Alta desde el cobro, sin abandonar la pantalla. Sin esto, la primera
  // factura a un receptor nuevo seguiría siendo la de hoy: tipear los tres
  // campos otra vez el mes que viene.
  const cuitDigits = cuit.replace(/\D/g, "");
  const puedeGuardar =
    !entidadId && cuitDigits.length === 11 && razonSocial.trim().length > 0;

  const guardar = async () => {
    setGuardando(true);
    const r = await crearEntidadFiscal({
      slug,
      cuit,
      razonSocial,
      condicionIva,
    });
    setGuardando(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const { entidad, creada } = r.data;
    justPicked.current = true;
    onSelect({
      id: entidad.id,
      cuit: entidad.cuit,
      razon_social: entidad.razon_social,
      condicion_iva: entidad.condicion_iva,
    });
    setQuery(entidad.razon_social);
    toast.success(
      creada
        ? "Receptor guardado — la próxima factura lo encuentra."
        : `Ese CUIT ya estaba cargado como «${entidad.razon_social}».`,
    );
  };

  return (
    <div className="grid gap-1.5">
      <label
        htmlFor="entidad-fiscal-buscador"
        className="text-xs font-semibold text-foreground/70"
      >
        Buscar receptor guardado
      </label>
      <div ref={boxRef} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
        <input
          id="entidad-fiscal-buscador"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(results.length > 0)}
          placeholder="Razón social o CUIT…"
          autoComplete="off"
          className="block h-10 w-full rounded-xl border border-border pl-9 pr-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground/70">
            Buscando…
          </span>
        )}

        {open && results.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-card p-1 shadow-lg ring-1 ring-border">
            {results.map((entidad, i) => (
              <li key={entidad.id}>
                <button
                  type="button"
                  onClick={() => pick(entidad)}
                  onMouseEnter={() => setCursor(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                    i === cursor ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <Building2 className="size-4 shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {entidad.razon_social}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatCuit(entidad.cuit)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {entidadId ? (
        <p className="flex items-center gap-1 text-xs font-medium text-emerald-700">
          <Check className="size-3.5" />
          Receptor guardado — podés corregir los datos para esta factura.
        </p>
      ) : puedeGuardar ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={guardar}
          disabled={guardando}
        >
          {guardando ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Building2 className="size-3" />
          )}
          Guardar este receptor
        </Button>
      ) : null}
    </div>
  );
}
