"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { achicarImagen, LADO_LARGO_DEFAULT } from "@/lib/images/achicar";
import {
  clasificarArchivo,
  esHeic,
  MENSAJE_HEIC,
  TOPE_PDF_BYTES,
} from "@/lib/proveedores/archivos";
import { InvoiceVisor, type EstadoPagina, type PaginaFoto } from "./invoice-visor";

/** El techo del endpoint de lectura: las páginas se leen en llamadas paralelas. */
export const MAX_FOTOS = 5;

const BUCKET = "supplier-invoices";
const TOPE_BYTES = 5 * 1024 * 1024;

const extensionDe = (file: File, tipo: "imagen" | "pdf") =>
  tipo === "pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";

/** Un rechazo que ya sabe explicarse: se muestra tal cual en la miniatura. */
class ErrorDeSubida extends Error {}

export type FotosComprobante = {
  paginas: PaginaFoto[];
  activa: number;
  setActiva: (i: number) => void;
  agregar: (files: File[]) => void;
  quitar: (id: string) => void;
  reordenar: (desde: number, hasta: number) => void;
  /** Marca el estado de algunas páginas, o de todas: `marcarEstado("todas", "leyendo")`. */
  marcarEstado: (ids: string[] | "todas", estado: EstadoPagina, error?: string) => void;
  limpiar: () => void;
  /** Como `limpiar`, pero además borra del bucket lo que se subió y no se guardó. */
  descartar: () => Promise<void>;
  /** Las rutas ya subidas, en el orden del rail. Es lo que va al endpoint. */
  paths: string[];
  /** Hay fotos, ninguna sigue subiendo y al menos una llegó: recién ahí se lee. */
  listasParaLeer: boolean;
  max: number;
};

/**
 * Las fotos de una compra — spec 173.
 *
 * «A veces los tickets son muy largos»: la compra pasa de tener UNA foto a
 * tener hasta cinco páginas, que se suben en paralelo y se leen en llamadas
 * paralelas (una sola llamada con las cinco imágenes revienta el techo de 45 s
 * del endpoint).
 *
 * **La foto se ve antes de terminar de subir.** El `URL.createObjectURL` del
 * archivo elegido se pinta en el acto y recién después arrancan el achicado y
 * el upload. Sin eso, entre elegir la foto y verla pasan el resize, la subida y
 * los 15-40 s de lectura: casi un minuto de panel vacío al lado de un
 * formulario que ya te está pidiendo el importe. Con el uploader viejo eso ya
 * costó dos objetos huérfanos en el bucket de golf-jcr contra cero
 * comprobantes: alguien subió, no vio nada, y volvió a subir.
 *
 * El achicado no es cosmético (ver `lib/images/achicar.ts`): el bucket corta en
 * 5 MB, una foto de celular pesa 4-6 MB y sale en HEIC, que el modelo de visión
 * no lee.
 *
 * El estado vive en un ref además de en `useState`. No es paranoia: los uploads
 * terminan en cualquier orden y desde afuera del render, y necesitan responder
 * dos preguntas en el momento exacto en que terminan —cuántas páginas hay ya, y
 * si ésta se quitó mientras subía—. Con `useState` solo, la respuesta es la del
 * render viejo.
 */
export function useFotosComprobante({
  businessId,
  max = MAX_FOTOS,
}: {
  businessId: string;
  max?: number;
}): FotosComprobante {
  const [paginas, setPaginas] = useState<PaginaFoto[]>([]);
  const [activa, setActiva] = useState(0);

  const paginasRef = useRef<PaginaFoto[]>([]);
  /** Sólo los object URLs que creamos acá: los firmados de la base no se revocan. */
  const objectUrls = useRef<Map<string, string>>(new Map());

  const aplicar = useCallback((fn: (prev: PaginaFoto[]) => PaginaFoto[]) => {
    const proximas = fn(paginasRef.current);
    paginasRef.current = proximas;
    setPaginas(proximas);
  }, []);

  const olvidar = useCallback((id: string) => {
    const url = objectUrls.current.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(id);
  }, []);

  const sigueViva = useCallback((id: string) => paginasRef.current.some((p) => p.id === id), []);

  // Al desmontar, los object URLs quedan reservados en el browser hasta que se
  // recargue la pestaña. En una pantalla que se abre y se cierra por cada compra
  // del día, son decenas de fotos de 3 MB colgadas.
  useEffect(() => {
    const mapa = objectUrls.current;
    return () => {
      mapa.forEach((url) => URL.revokeObjectURL(url));
      mapa.clear();
    };
  }, []);

  const agregar = useCallback(
    (files: File[]) => {
      const lugar = max - paginasRef.current.length;
      // Se corta ANTES de crear los previews: un archivo que no va a entrar no
      // tiene que dejar un object URL colgado ni un upload en vuelo.
      const aceptados = files.slice(0, Math.max(lugar, 0));
      if (aceptados.length === 0) return;

      const eraVacio = paginasRef.current.length === 0;
      // El visor ya descartó —y avisó— lo que no es foto ni PDF (198·D1). Acá
      // se clasifica de nuevo sólo para saber CÓMO subir cada uno.
      const tipos = aceptados.map((file) => {
        const c = clasificarArchivo(file);
        return c.ok ? c.tipo : "imagen";
      });

      const nuevas: PaginaFoto[] = aceptados.map((file, idx) => {
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.set(id, previewUrl);
        return { id, path: null, previewUrl, tipo: tipos[idx], estado: "subiendo" as const };
      });

      aplicar((prev) => [...prev, ...nuevas]);
      // La primera foto que entra es la que se mira: si el panel estaba vacío,
      // la activa tiene que caer sobre ella y no quedarse en un índice viejo.
      if (eraVacio) setActiva(0);

      const supabase = createSupabaseBrowserClient();
      nuevas.forEach(async (pagina, idx) => {
        try {
          const original = aceptados[idx]!;
          const tipo = tipos[idx]!;

          let file: File;
          if (tipo === "pdf") {
            // spec 198·D2 · el PDF sube tal cual: no hay nada que achicar, y la
            // API lo lee nativo. El tope es propio porque no pasa por el achicado.
            if (original.size > TOPE_PDF_BYTES) {
              throw new ErrorDeSubida("El PDF pesa más de 10 MB.");
            }
            file = original;
          } else {
            file = await achicarImagen(original, LADO_LARGO_DEFAULT);
            /**
             * spec 198·D3 · la HEIC que el navegador no pudo abrir.
             *
             * `achicarImagen` devuelve el MISMO archivo cuando no lo puede
             * decodificar. Con una HEIC eso pasa en Chrome/Windows, y antes se
             * subía igual con extensión `.jpg` y bytes HEIC adentro: ni se veía
             * la vista previa ni la leía el modelo. Se corta acá y se dice cómo.
             */
            if (file === original && esHeic(original)) {
              throw new ErrorDeSubida(MENSAJE_HEIC);
            }
            if (file.size > TOPE_BYTES) {
              throw new ErrorDeSubida("La foto pesa más de 5 MB incluso achicada.");
            }
          }

          const path = `${businessId}/${pagina.id}.${extensionDe(file, tipo)}`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            // Explícito: un PDF bajado de WhatsApp llega como octet-stream, y
            // sin esto Storage lo guarda así y el visor lo descarga en vez de
            // mostrarlo.
            contentType: tipo === "pdf" ? "application/pdf" : file.type || "image/jpeg",
          });
          if (error) throw error;

          // Se quitó mientras subía: el archivo ya está en el bucket y nadie lo
          // va a referenciar nunca. Se borra acá o queda de basura para siempre.
          if (!sigueViva(pagina.id)) {
            void supabase.storage.from(BUCKET).remove([path]);
            return;
          }
          aplicar((prev) =>
            prev.map((p) =>
              p.id === pagina.id ? { ...p, path, estado: "lista", error: undefined } : p,
            ),
          );
        } catch (e) {
          if (!sigueViva(pagina.id)) return;
          // Los errores con motivo propio se muestran tal cual; el resto es un
          // problema de red o de Storage, y ahí el mensaje genérico es el honesto.
          const mensaje =
            e instanceof ErrorDeSubida ? e.message : "No pudimos subir este archivo. Probá de nuevo.";
          aplicar((prev) =>
            prev.map((p) => (p.id === pagina.id ? { ...p, estado: "error", error: mensaje } : p)),
          );
          toast.error(mensaje);
        }
      });
    },
    [businessId, max, aplicar, sigueViva],
  );

  const quitar = useCallback(
    (id: string) => {
      const idx = paginasRef.current.findIndex((p) => p.id === id);
      if (idx === -1) return;
      olvidar(id);
      aplicar((prev) => prev.filter((p) => p.id !== id));
      const quedan = paginasRef.current.length;
      setActiva((a) => Math.min(a > idx ? a - 1 : a, Math.max(quedan - 1, 0)));
    },
    [aplicar, olvidar],
  );

  const reordenar = useCallback(
    (desde: number, hasta: number) => {
      const largo = paginasRef.current.length;
      if (desde < 0 || hasta < 0 || desde >= largo || hasta >= largo || desde === hasta) return;
      aplicar((prev) => {
        const copia = [...prev];
        const [movida] = copia.splice(desde, 1);
        copia.splice(hasta, 0, movida);
        return copia;
      });
      // La selección sigue a la FOTO, no al lugar: si movés con ↑/↓ la que
      // estás mirando, tenés que seguir mirando esa y no la que la reemplazó.
      setActiva((a) => {
        if (a === desde) return hasta;
        if (desde < a && a <= hasta) return a - 1;
        if (hasta <= a && a < desde) return a + 1;
        return a;
      });
    },
    [aplicar],
  );

  const marcarEstado = useCallback(
    (ids: string[] | "todas", estado: EstadoPagina, error?: string) => {
      aplicar((prev) =>
        prev.map((p) => (ids === "todas" || ids.includes(p.id) ? { ...p, estado, error } : p)),
      );
    },
    [aplicar],
  );

  const limpiar = useCallback(() => {
    paginasRef.current.forEach((p) => olvidar(p.id));
    aplicar(() => []);
    setActiva(0);
  }, [aplicar, olvidar]);

  /**
   * Tirar la carga: además de limpiar la pantalla, borra del bucket lo que se
   * subió y no se va a guardar.
   *
   * `limpiar()` se usa DESPUÉS de guardar, y ahí los objetos quedan porque son
   * la foto del comprobante. Acá es al revés: nadie los va a referenciar nunca,
   * y con cinco fotos por compra y una pantalla que se abre por cada
   * comprobante del día, el goteo deja de ser goteo.
   *
   * El borrado es best-effort: si falla, se pierde el archivo pero no la
   * navegación. Un huérfano molesta; quedarse trabado saliendo, más.
   */
  const descartar = useCallback(async () => {
    const paths = paginasRef.current
      .map((p) => p.path)
      .filter((p): p is string => Boolean(p));
    limpiar();
    if (paths.length === 0) return;
    try {
      await createSupabaseBrowserClient().storage.from(BUCKET).remove(paths);
    } catch {
      // Silencio a propósito: la persona ya se está yendo de la pantalla.
    }
  }, [limpiar]);

  const paths = useMemo(
    () => paginas.map((p) => p.path).filter((p): p is string => Boolean(p)),
    [paginas],
  );
  const listasParaLeer =
    paginas.length > 0 && paginas.every((p) => p.estado !== "subiendo") && paths.length > 0;

  return {
    paginas,
    activa,
    setActiva,
    agregar,
    quitar,
    reordenar,
    marcarEstado,
    limpiar,
    descartar,
    paths,
    listasParaLeer,
    max,
  };
}

/**
 * El visor ya cableado al hook — para que la pantalla nueva sea una línea:
 *
 *     const fotos = useFotosComprobante({ businessId });
 *     <InvoicePhotosUploader fotos={fotos} />
 *
 * El hook se usa suelto cuando la pantalla necesita además disparar la lectura
 * (`fotos.paths`, `fotos.marcarEstado`).
 */
export function InvoicePhotosUploader({ fotos }: { fotos: FotosComprobante }) {
  return (
    <InvoiceVisor
      paginas={fotos.paginas}
      activa={fotos.activa}
      onActiva={fotos.setActiva}
      onReordenar={fotos.reordenar}
      onQuitar={fotos.quitar}
      onAgregar={fotos.agregar}
      maxPaginas={fotos.max}
    />
  );
}
