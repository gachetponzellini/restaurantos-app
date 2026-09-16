/**
 * Qué se puede subir como comprobante — spec 198.
 *
 * *«No me deja cargar la foto desde los archivos, no sé por qué»* — Rocío,
 * 2026-09-16. El visor filtraba `type.startsWith("image/")` y, si no quedaba
 * nada, volvía sin decir una palabra. Se elegía el archivo y no pasaba nada.
 *
 * Esto decide mirando el tipo **y** la extensión, porque el tipo solo miente de
 * las dos formas que importan: Chrome en Windows reporta una HEIC de iPhone con
 * tipo vacío, y un PDF bajado de WhatsApp a veces llega como
 * `application/octet-stream`.
 *
 * Y nunca descarta callado (198·D1): lo que no entra vuelve con el motivo, para
 * que la pantalla lo diga con el nombre del archivo.
 */

export type ArchivoLike = { name: string; type: string; size: number };

export type Clasificacion =
  | { ok: true; tipo: "imagen" | "pdf" }
  | { ok: false; motivo: string };

/** El PDF no se achica: entra en el techo de 12 MB del lote de `leer.ts`. */
export const TOPE_PDF_BYTES = 10 * 1024 * 1024;

const EXT_IMAGEN = ["jpg", "jpeg", "png", "webp", "gif"];
const EXT_HEIC = ["heic", "heif"];

const extension = (nombre: string) => nombre.split(".").pop()?.toLowerCase() ?? "";

export function esHeic(f: Pick<ArchivoLike, "name" | "type">): boolean {
  const t = f.type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || EXT_HEIC.includes(extension(f.name));
}

export function clasificarArchivo(f: ArchivoLike): Clasificacion {
  const t = f.type.toLowerCase();
  const ext = extension(f.name);

  if (t === "application/pdf" || ext === "pdf") {
    if (f.size > TOPE_PDF_BYTES) {
      return { ok: false, motivo: "el PDF pesa más de 10 MB." };
    }
    return { ok: true, tipo: "pdf" };
  }

  // La HEIC entra como imagen: en Safari el achicado la convierte a JPG. Si el
  // navegador no la puede abrir, lo detecta el uploader después de intentarlo —
  // decidirlo acá por el nombre le cerraría la puerta a quien sí puede.
  if (t.startsWith("image/") || EXT_IMAGEN.includes(ext) || esHeic(f)) {
    return { ok: true, tipo: "imagen" };
  }

  return {
    ok: false,
    motivo: "no es una foto ni un PDF. Subí la foto del comprobante o el PDF de la factura.",
  };
}

/**
 * Lo que se le dice a quien sube una HEIC que el navegador no abre — 198·D3.
 *
 * Convertirla acá es una librería pesada para un caso que se resuelve con un
 * ajuste del teléfono. Lo honesto es decir cuál.
 */
export const MENSAJE_HEIC =
  "Es una foto de iPhone en formato HEIC y esta compu no la puede abrir. En el iPhone: Ajustes → Cámara → Formatos → «Más compatible», o mandátela por WhatsApp y bajala desde ahí (llega como JPG).";
