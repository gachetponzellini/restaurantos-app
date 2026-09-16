"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  ImagePlus,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  Scan,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ImagenAmpliable } from "@/components/shared/imagen-ampliable";
import { clasificarArchivo } from "@/lib/proveedores/archivos";
import { cn } from "@/lib/utils";

export type EstadoPagina = "subiendo" | "lista" | "leyendo" | "leida" | "error";

export type PaginaFoto = {
  id: string;
  /**
   * spec 198·D2 · el PDF no se muestra en un `<img>`: va al visor de PDF del
   * navegador. Opcional porque las fotos de antes de la 198 no lo traen, y son
   * todas imagen.
   */
  tipo?: "imagen" | "pdf";
  /** La ruta en el bucket. `null` mientras sube: recién ahí se puede leer. */
  path: string | null;
  /** `URL.createObjectURL` del archivo, o la URL firmada si viene de la base. */
  previewUrl: string;
  estado: EstadoPagina;
  error?: string;
};

const ESCALA_MIN = 1;
const ESCALA_MAX = 6;
const acotar = (v: number) => Math.min(Math.max(v, ESCALA_MIN), ESCALA_MAX);

const TEXTO_ESTADO: Record<EstadoPagina, string> = {
  subiendo: "Subiendo…",
  lista: "Lista",
  leyendo: "Leyendo…",
  leida: "Leída",
  error: "Falló",
};

/**
 * El visor de la compra — spec 173, la columna izquierda de la pantalla nueva.
 *
 * El diálogo viejo ponía la foto ÚLTIMA, debajo de los renglones: mientras
 * corregías las líneas, el papel no se veía. Y medía 384 px de ancho, así que
 * la foto entraba del tamaño de una estampilla. Acá la foto es el panel: ocupa
 * la altura del viewport y se queda quieta al lado del formulario.
 *
 * Tres decisiones que salen del papel real, no del diseño:
 *
 *  · **Se ajusta al ancho, no al alto.** Un ticket de verdulería es angosto y
 *    larguísimo; con `object-contain` entra entero en la pantalla y no se lee
 *    un renglón. Se encuadra a lo ancho y se scrollea, como el papel en la mano.
 *  · **La rueda hace zoom, el arrastre panea.** Sobre una foto que ya scrollea
 *    sola, la rueda tiene que hacer la otra cosa. Ojo: React registra `wheel`
 *    como pasivo, así que `onWheel` no puede frenar el scroll — el listener va
 *    a mano con `passive: false`.
 *  · **El rail dice el orden y por qué importa.** Un ticket largo se saca en
 *    dos o tres fotos; si van desordenadas, el lector arma la cabecera de una
 *    página del medio y el total sale de cualquier lado. De ahí el cartel.
 *
 * El visor no toca la selección al reordenar: quien recibe `onReordenar`
 * decide si la página activa sigue a la foto que se movió.
 */
export function InvoiceVisor({
  paginas,
  activa,
  onActiva,
  onReordenar,
  onQuitar,
  onAgregar,
  maxPaginas,
}: {
  paginas: PaginaFoto[];
  activa: number;
  onActiva: (i: number) => void;
  onReordenar: (desde: number, hasta: number) => void;
  onQuitar: (id: string) => void;
  onAgregar: (files: File[]) => void;
  maxPaginas: number;
}): ReactElement {
  const total = paginas.length;
  const i = Math.min(Math.max(activa, 0), Math.max(total - 1, 0));
  const pagina = paginas[i];
  const hayFotos = total > 0;
  const lleno = total >= maxPaginas;

  const inputRef = useRef<HTMLInputElement>(null);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [sobrevolando, setSobrevolando] = useState(false);
  const [paneando, setPaneando] = useState(false);
  /** De dónde salió la miniatura que se está arrastrando dentro del rail. */
  const arrastreDesde = useRef<number | null>(null);
  /** Punto de la imagen bajo el cursor, para que el zoom no se escape de ahí. */
  const anclaRef = useRef<{ rx: number; ry: number; ox: number; oy: number } | null>(null);
  const paneoRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  const sumarArchivos = useCallback(
    (entrada: FileList | File[] | null) => {
      /**
       * spec 198·D1 · lo que no entra se DICE.
       *
       * Acá había un `filter(type.startsWith("image/"))` y un `return` pelado:
       * se elegía un PDF —o una foto de iPhone, que Chrome en Windows reporta
       * sin tipo— y no pasaba absolutamente nada. «No me deja cargar la foto
       * desde los archivos, no sé por qué.»
       */
      const todos = Array.from(entrada ?? []);
      const files: File[] = [];
      for (const f of todos) {
        const c = clasificarArchivo(f);
        if (c.ok) files.push(f);
        else toast.error(`«${f.name}» ${c.motivo}`);
      }
      if (files.length === 0) return;
      const lugar = maxPaginas - total;
      if (lugar <= 0) {
        toast.error(`Son ${maxPaginas} páginas como máximo. Quitá alguna para sumar otra.`);
        return;
      }
      if (files.length > lugar) {
        toast.warning(
          `Entraban ${lugar} ${lugar === 1 ? "página más" : "páginas más"}: sumé ${lugar === 1 ? "la primera" : `las primeras ${lugar}`}.`,
        );
      }
      onAgregar(files.slice(0, lugar));
    },
    [maxPaginas, total, onAgregar],
  );

  /**
   * Pegar con Ctrl+V — el caso real es la compu del salón con el celular
   * sincronizado: sacás la foto con el teléfono y la pegás acá, sin pasar por
   * el explorador de archivos ni por el mail.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Sólo se intercepta si hay ALGÚN archivo: pegar texto en el importe no
      // puede disparar un aviso de «no es una foto».
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      sumarArchivos(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [sumarArchivos]);

  // Cada foto arranca encuadrada: heredar el zoom de la anterior deja la página
  // nueva mostrando un pedazo del medio, sin encabezado ni total a la vista.
  useEffect(() => {
    setEscala(1);
    setNatural(null);
  }, [pagina?.id]);

  useEffect(() => {
    const el = lienzoRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      anclaRef.current = {
        rx: el.scrollWidth ? (el.scrollLeft + ox) / el.scrollWidth : 0,
        ry: el.scrollHeight ? (el.scrollTop + oy) / el.scrollHeight : 0,
        ox,
        oy,
      };
      setEscala((v) => {
        const proxima = acotar(v * Math.exp(-e.deltaY / 400));
        // Si ya está en el tope, no hay re-render y el ancla quedaría guardada
        // para el próximo zoom, corrigiendo el scroll hacia un punto viejo.
        if (proxima === v) anclaRef.current = null;
        return proxima;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hayFotos]);

  // El scroll se corrige DESPUÉS del layout y antes de pintar: si esperara a un
  // `useEffect` normal, se vería el salto de la imagen antes del reencuadre.
  useLayoutEffect(() => {
    const el = lienzoRef.current;
    const ancla = anclaRef.current;
    anclaRef.current = null;
    if (!el || !ancla) return;
    el.scrollLeft = ancla.rx * el.scrollWidth - ancla.ox;
    el.scrollTop = ancla.ry * el.scrollHeight - ancla.oy;
  }, [escala]);

  const alternarZoom = () => {
    const el = lienzoRef.current;
    if (!el) return;
    if (escala > 1.02 || !natural) {
      setEscala(1);
      return;
    }
    setEscala(acotar(natural.w / Math.max(el.clientWidth, 1)));
  };

  const iniciarPaneo = (e: React.PointerEvent) => {
    const el = lienzoRef.current;
    if (!el || e.button !== 0) return;
    const hayADonde =
      el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (!hayADonde) return;
    el.setPointerCapture(e.pointerId);
    paneoRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    setPaneando(true);
  };
  const seguirPaneo = (e: React.PointerEvent) => {
    const el = lienzoRef.current;
    const p = paneoRef.current;
    if (!el || !p) return;
    el.scrollLeft = p.sl - (e.clientX - p.x);
    el.scrollTop = p.st - (e.clientY - p.y);
  };
  const soltarPaneo = (e: React.PointerEvent) => {
    paneoRef.current = null;
    setPaneando(false);
    if (lienzoRef.current?.hasPointerCapture(e.pointerId)) {
      lienzoRef.current.releasePointerCapture(e.pointerId);
    }
  };

  const etiquetaDe = (idx: number) =>
    total > 1 ? `Página ${idx + 1} de ${total}` : "Foto del comprobante";

  const aviso = (
    <p className="text-[11px] leading-snug text-zinc-500">
      La 1 tiene el encabezado, la última el total.
    </p>
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition",
        sobrevolando && "border-zinc-900 ring-2 ring-zinc-900/10",
      )}
      onDragOver={(e) => {
        // Sin este chequeo, arrastrar una miniatura para reordenarla prende el
        // dropzone de archivos y el rail queda tapado por el cartel de soltar.
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setSobrevolando(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setSobrevolando(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setSobrevolando(false);
        sumarArchivos(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        // `.heic` explícito: en Windows el tipo viene vacío y `image/*` la deja
        // gris en el explorador de archivos.
        accept="image/*,application/pdf,.pdf,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          sumarArchivos(e.target.files);
          e.target.value = "";
        }}
      />

      {hayFotos ? (
        <>
          <div className="flex min-h-0 flex-1 gap-3">
            {/* El rail. Vertical porque las páginas de un ticket se leen de
                arriba hacia abajo, y porque así ↑/↓ mueven en la dirección en
                la que se ven moverse. */}
            <div className="flex w-28 shrink-0 flex-col gap-2 overflow-y-auto">
              {paginas.map((p, idx) => (
                <div
                  key={p.id}
                  className="group relative"
                  draggable
                  onDragStart={(e) => {
                    arrastreDesde.current = idx;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(idx));
                  }}
                  onDragOver={(e) => {
                    if (arrastreDesde.current !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const desde = arrastreDesde.current;
                    arrastreDesde.current = null;
                    if (desde === null || desde === idx) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onReordenar(desde, idx);
                  }}
                  onDragEnd={() => {
                    arrastreDesde.current = null;
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onActiva(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" && idx > 0) {
                        e.preventDefault();
                        onReordenar(idx, idx - 1);
                      }
                      if (e.key === "ArrowDown" && idx < total - 1) {
                        e.preventDefault();
                        onReordenar(idx, idx + 1);
                      }
                    }}
                    aria-current={idx === i}
                    title={`${etiquetaDe(idx)} · ↑/↓ para moverla de lugar`}
                    className={cn(
                      "relative block w-full cursor-grab overflow-hidden rounded-lg border-2 bg-zinc-100 text-left transition active:cursor-grabbing",
                      idx === i
                        ? "border-zinc-900"
                        : "border-transparent hover:border-zinc-300",
                    )}
                  >
                    {p.tipo === "pdf" ? (
                      <span className="flex h-24 w-full flex-col items-center justify-center gap-1 text-zinc-500">
                        <FileText className="size-6" />
                        <span className="text-[10px] font-semibold">PDF</span>
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.previewUrl}
                        alt={etiquetaDe(idx)}
                        draggable={false}
                        className="h-24 w-full object-cover"
                      />
                    )}
                    <span className="absolute left-1 top-1 grid size-5 place-items-center rounded bg-zinc-900/85 text-[11px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 px-1 py-0.5 text-[10px] font-medium",
                        p.estado === "error"
                          ? "bg-red-600 text-white"
                          : p.estado === "leida"
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-900/75 text-white",
                      )}
                    >
                      {(p.estado === "subiendo" || p.estado === "leyendo") && (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      {p.estado === "leida" && <Check className="size-3" />}
                      {p.estado === "error" && <AlertTriangle className="size-3" />}
                      {TEXTO_ESTADO[p.estado]}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Quitar ${etiquetaDe(idx)}`}
                    onClick={() => onQuitar(p.id)}
                    className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-zinc-900 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3" strokeWidth={2.5} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={lleno}
                className="flex h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-200 text-[11px] font-medium text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-40 disabled:hover:border-zinc-200"
              >
                <ImagePlus className="size-4" />
                {lleno ? `Máx. ${maxPaginas}` : "Agregar"}
              </button>

              {aviso}
            </div>

            {/* La foto grande. */}
            <div
              ref={lienzoRef}
              onPointerDown={iniciarPaneo}
              onPointerMove={seguirPaneo}
              onPointerUp={soltarPaneo}
              onPointerCancel={soltarPaneo}
              onDoubleClick={alternarZoom}
              className={cn(
                "relative min-w-0 flex-1 overflow-auto rounded-lg bg-zinc-100",
                paneando ? "cursor-grabbing" : "cursor-grab",
              )}
            >
              {pagina && (
                <>
                  {pagina.tipo === "pdf" ? (
                    // spec 198·D2 · el visor de PDF del navegador, que ya trae su
                    // zoom y sus hojas. El paneo y el zoom de la foto no aplican.
                    <iframe
                      key={pagina.id}
                      src={pagina.previewUrl}
                      title={etiquetaDe(i)}
                      className="h-full min-h-[60vh] w-full rounded-lg bg-white"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={pagina.id}
                      src={pagina.previewUrl}
                      alt={etiquetaDe(i)}
                      draggable={false}
                      onLoad={(e) =>
                        setNatural({
                          w: e.currentTarget.naturalWidth,
                          h: e.currentTarget.naturalHeight,
                        })
                      }
                      style={{ width: `${escala * 100}%`, maxWidth: "none" }}
                      className="block h-auto select-none"
                    />
                  )}
                  {(pagina.estado === "subiendo" || pagina.estado === "leyendo") && (
                    <span className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-900/85 px-3 py-1.5 text-xs font-medium text-white">
                      <Loader2 className="size-3.5 animate-spin" />
                      {pagina.estado === "subiendo"
                        ? pagina.tipo === "pdf"
                          ? "Subiendo el PDF…"
                          : "Subiendo la foto…"
                        : "Leyendo la factura…"}
                    </span>
                  )}
                  {pagina.estado === "error" && (
                    <span className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      {pagina.error ?? "No pudimos subir esta foto."}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Barra de herramientas. Sobre un PDF no aplica: el visor del
              navegador trae su propio zoom, y «ampliar» un PDF en el visor de
              fotos mostraría una imagen rota. */}
          <div className={cn("flex shrink-0 items-center gap-1", pagina?.tipo === "pdf" && "hidden")}>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Alejar"
              disabled={escala <= ESCALA_MIN}
              onClick={() => setEscala((v) => acotar(v - 0.25))}
            >
              <Minus />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Acercar"
              disabled={escala >= ESCALA_MAX}
              onClick={() => setEscala((v) => acotar(v + 0.25))}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={alternarZoom}
              title="Doble click en la foto hace lo mismo"
            >
              <Scan />
              {escala > 1.02 ? "Ajustar" : "Tamaño real"}
            </Button>
            <span className="ml-auto text-xs tabular-nums text-zinc-400">
              {Math.round(escala * 100)}%
            </span>
            <ImagenAmpliable
              paginas={paginas.map((p, idx) => ({
                id: p.id,
                url: p.previewUrl,
                etiqueta: etiquetaDe(idx),
              }))}
              indice={i}
              onIndice={onActiva}
            >
              <Button type="button" size="sm" variant="outline">
                <Maximize2 />
                Ampliar
              </Button>
            </ImagenAmpliable>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 p-6 text-center transition hover:border-zinc-400"
        >
          <ImagePlus className="size-8 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-700">
            Sacale una foto al comprobante
          </span>
          <span className="max-w-xs text-xs leading-relaxed text-zinc-500">
            Arrastrala acá, pegala con Ctrl+V o elegí el archivo. Si el ticket es
            largo, sacá varias: hasta {maxPaginas} páginas.
          </span>
          {aviso}
        </button>
      )}
    </div>
  );
}
