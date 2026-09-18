"use client";

import { useEffect, useRef, useState } from "react";
import { Search, User } from "lucide-react";

import { buscarClientes, type ClienteMatch } from "@/lib/admin/customers-actions";

/**
 * Buscador de **clientes** para el momento de sentar (spec 067, FR-005).
 *
 * Es un campo de texto libre **con sugerencias**, no un `<select>`: lo tipeado
 * vale como nombre del walk-in aunque no matchee con nadie. Un cliente nuevo no
 * puede quedar bloqueado detrás de un buscador — sentar gente es el camino
 * caliente de la operación.
 *
 * **Sólo clientes.** Llama únicamente a `buscarClientes`, que consulta
 * `customers` scopeada por `business_id` con gate de staff. Ningún camino de
 * este componente puede devolver un producto: la queja de "aparecían productos"
 * venía de tipear el nombre en el buscador de productos del sheet de cargar
 * pedido, que es el que se llevaba el foco.
 *
 * Teclado (coherente con la spec 066): ↓/↑ recorren, Enter elige el marcado,
 * Escape cierra la lista **sin** cerrar el panel que la contiene.
 */
export function CustomerSearchField({
  slug,
  value,
  onChange,
  onPick,
  id = "cliente",
  autoFocus = false,
  placeholder = "Buscar cliente o escribir un nombre…",
  inputClassName = "h-12 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base",
}: {
  slug: string;
  value: string;
  onChange: (value: string) => void;
  /** Eligió un cliente existente: el caller decide qué prellenar. */
  onPick: (cliente: ClienteMatch) => void;
  id?: string;
  /** Spec 068 FR-002: el foco arranca acá al abrir mesa / nueva reserva. */
  autoFocus?: boolean;
  placeholder?: string;
  inputClassName?: string;
}) {
  const [results, setResults] = useState<ClienteMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  // Lo recién elegido no se vuelve a buscar: al setear el nombre del cliente
  // elegido, el effect dispararía otra búsqueda y la lista reaparecería sola.
  const justPicked = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Foco inicial. `preventScroll` para que el panel del salón no salte al
  // montarse dentro del `<aside>`.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      0,
    );
    return () => clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await buscarClientes(slug, q);
      const data = r.ok ? r.data : [];
      setResults(data);
      setLoading(false);
      setCursor(-1);
      setOpen(data.length > 0);
    }, 300);
    return () => clearTimeout(t);
  }, [value, slug]);

  // Cerrar la lista al tocar afuera (sin tocar el valor tipeado).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (c: ClienteMatch) => {
    justPicked.current = true;
    onPick(c);
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
      // Sólo intercepta Enter si hay un resultado marcado: si no, Enter sigue
      // siendo "abrir la mesa" (spec 066, FR-005).
      e.preventDefault();
      e.stopPropagation();
      const c = results[cursor];
      if (c) pick(c);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(results.length > 0)}
        className={inputClassName}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground/70">
          Buscando…
        </span>
      )}

      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-card p-1 shadow-lg ring-1 ring-border">
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => pick(c)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  i === cursor ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <User className="size-4 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {c.name?.trim() || "Sin nombre"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.phone}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
