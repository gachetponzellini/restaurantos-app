import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { PROMPT_LECTURA } from "./prompt";
import { LecturaModelo } from "./schema-modelo";
import type { PaginaLeida } from "./unir-paginas";

/**
 * La única capa no determinística del lector — spec 172, ampliada en la 173.
 *
 * El modelo transcribe y nada más: la conversión, la verificación aritmética y
 * el match viven en módulos puros que se testean sin gastar un peso.
 *
 * **Un comprobante puede venir en varias fotos, y cada foto es UNA llamada.**
 * El ticket del mayorista es una tira de 80 cm y no entra legible en una imagen.
 * La tentación es mandar las cinco imágenes en un solo `messages.create`, y es la
 * decisión equivocada por dos razones medidas:
 *
 * · **El techo.** La ruta tiene `maxDuration = 60` y acá `TECHO_MS = 45_000`. Una
 *   lectura manuscrita sola tarda 15-40 s; cinco imágenes en un request tardan lo
 *   que tardan las cinco juntas y se comen el presupuesto entero. Cuando corta,
 *   se pierden las cinco. En paralelo el reloj es el de la página más lenta.
 * · **El aislamiento.** Una foto movida, un HEIC renombrado o un objeto que
 *   desapareció del bucket tiran SU llamada y nada más. Las otras cuatro llegan,
 *   y `unirPaginas` arma el comprobante con lo que hay. Por eso el orquestador
 *   devuelve `PaginaLeida[]` con fallas adentro en vez de tirar una excepción:
 *   que una página falle es un resultado, no un error del sistema.
 *
 * El modelo se puede pisar por env, como el chatbot (`CHATBOT_MODEL`) y el
 * asistente de la guía (`AYUDA_MODEL`): bajar a `claude-sonnet-5` es una decisión
 * de config, no un cambio de código.
 */
const MODELO = process.env.COMPROBANTE_MODEL ?? "claude-opus-5";

/** 45 s de los 60 de `maxDuration`, para que quede margen de respuesta. */
const TECHO_MS = 45_000;

/**
 * Cinco fotos por comprobante. El mismo número que el CHECK de la migración 0095
 * y que el `MAX_FOTOS` del uploader — acá es una regla de plata (cinco llamadas
 * en paralelo con `effort: "high"` es lo que el techo de 45 s tolera), allá es
 * una regla de integridad.
 */
export const MAX_PAGINAS = 5;

/**
 * El techo por imagen de la API es 5 MB y el base64 infla 4/3, así que el
 * archivo tiene que quedar debajo de ~3,6 MB. El uploader ya achica a 2200 px,
 * pero esto es la red: un objeto viejo del bucket puede ser más grande.
 */
const MAX_BYTES = 3_600_000;

/**
 * El PDF no pasa por el achicado: su techo es el del uploader (198·D2). Sigue
 * cortando el techo del lote, que es el que protege a la función serverless.
 */
const MAX_BYTES_PDF = 10 * 1024 * 1024;

/**
 * Y un techo sobre la SUMA, que el de arriba no cubre.
 *
 * Cinco imágenes de 3,5 MB pasan el control de a una y son 17,5 MB de buffers que
 * después se vuelven ~23 MB de base64, todo vivo al mismo tiempo en una función
 * serverless. El caso normal —lo que sale del uploader— son 5 fotos de ~800 KB:
 * 12 MB deja margen de sobra para eso y corta el caso patológico antes de gastar
 * un peso en la API.
 */
const MAX_BYTES_TOTAL = 12_000_000;

const MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type MimeSoportado = (typeof MIMES)[number];

/**
 * El tipo real del archivo, leído de sus primeros bytes.
 *
 * NO se confía en el MIME que reporta Storage: es el que el browser adivinó al
 * subir, y puede venir vacío, como `application/octet-stream`, o simplemente
 * mentir. Los bytes no mienten, y acá el costo de equivocarse es un mensaje que
 * manda a la encargada a sacar otra foto por un problema que no es de la foto.
 */
export function detectarMime(bytes: ArrayBuffer): MimeSoportado | "application/pdf" | null {
  const b = new Uint8Array(bytes.slice(0, 16));
  const es = (...xs: number[]) => xs.every((x, i) => b[i] === x);

  if (es(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (es(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (es(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (es(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  // RIFF....WEBP
  if (es(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  // ftyp{heic,heix,hevc,mif1} — lo que sale de un iPhone sin convertir.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return null;
  return null;
}

export type ErrorLectura =
  | "sin_api_key"
  | "imagen_muy_pesada"
  /** No la foto sola: las N juntas. Es un problema del lote, no de una página. */
  | "lote_muy_pesado"
  | "demasiadas_paginas"
  | "formato_no_soportado"
  | "timeout"
  | "respuesta_invalida"
  /**
   * La API rechazó NUESTRO request. No tiene nada que ver con la foto.
   *
   * Antes esto caía en `formato_no_soportado`, cuyo mensaje manda a sacar otra
   * foto — y eso hizo que un schema mal armado de nuestro lado se leyera como
   * culpa de la encargada, que sacó la misma foto dos veces. Un error nuestro
   * nunca se muestra como un error del usuario.
   */
  | "request_rechazado"
  | "modelo_no_disponible";

export type ResultadoLectura =
  | { ok: true; lectura: LecturaModelo }
  | { ok: false; error: ErrorLectura };

/** Una foto ya bajada del bucket, con el lugar que ocupa en el comprobante. */
export type PaginaParaLeer = {
  /** 1-based, en el orden del rail. Es el que viaja hasta el renglón. */
  pagina: number;
  bytes: ArrayBuffer;
  /**
   * Lo que dice Storage. Sólo sirve para el log: el que viaja a la API sale de
   * `detectarMime`. Ver el comentario de `leerPagina`.
   */
  mimeDeclarado: string;
};

export function hayApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Una página, una llamada.
 *
 * `pagina` y `deCuantas` NO son decorativos y NO van al bloque `system`: viajan
 * en el mensaje `user` porque el system está cacheado con `cache_control:
 * ephemeral` y cualquier cosa variable adentro rompe el caché en cada llamada —
 * con cinco páginas en paralelo eso es cinco veces el prompt entero a precio
 * lleno, en cada comprobante. El prompt (v2) explica qué hacer con ese dato: una
 * página sin encabezado sigue siendo un comprobante, y el total es el de ESTA
 * página o ninguno.
 */
export async function leerPagina(
  bytes: ArrayBuffer,
  mimeDeclarado: string,
  pagina: number,
  deCuantas: number,
): Promise<ResultadoLectura> {
  if (!hayApiKey()) return { ok: false, error: "sin_api_key" };

  const real = detectarMime(bytes);
  if (real === null) return { ok: false, error: "formato_no_soportado" };

  /**
   * spec 198·D2 · el PDF se lee como PDF.
   *
   * Acá había un `return formato_no_soportado` para el PDF, y un mensaje que
   * mandaba a sacarle una foto al papel. Pero es como mandan la factura A casi
   * todos los proveedores con facturación electrónica, y la API lo lee nativo
   * —con sus varias hojas— como bloque `document`. Convertirlo a imagen sería
   * hacer peor algo que el modelo hace directo.
   */
  const esPdf = real === "application/pdf";
  if (bytes.byteLength > (esPdf ? MAX_BYTES_PDF : MAX_BYTES)) {
    return { ok: false, error: "imagen_muy_pesada" };
  }

  /**
   * El `media_type` que viaja es el DETECTADO, no el declarado.
   *
   * Hasta acá se mandaba `blob.type`, o sea lo que el browser adivinó al subir el
   * archivo. Un PNG que alguien guardó con extensión `.jpg` sube como
   * `image/jpeg`: los bytes son PNG, el header dice JPEG, y la API contesta 400.
   * El 400 cae en `request_rechazado`, cuyo mensaje dice «fue un problema
   * nuestro» — verdad a medias que no ayuda a nadie, porque la lectura de esa
   * foto no iba a funcionar nunca. Mandando el tipo real, el mismo archivo se lee
   * sin que nadie se entere de que la extensión estaba mal.
   */
  // Sólo se avisa cuando el declarado DICE algo y dice otra cosa: Storage
  // devuelve el tipo vacío bastante seguido, y un warn por página en el caso
  // normal es ruido que después tapa al que importa.
  if (mimeDeclarado && real !== mimeDeclarado) {
    console.warn(`leerPagina · la página ${pagina} dice ser ${mimeDeclarado} y es ${real}; va el real`);
  }

  const client = new Anthropic({ timeout: TECHO_MS });

  let texto: string;
  try {
    const res = await client.messages.create({
      model: MODELO,
      max_tokens: 8000,
      // El system va PRIMERO y cacheado: las instrucciones son lo estable entre
      // comprobantes y la imagen cambia siempre. Con el orden al revés el caché
      // no pega nunca, y Rocío carga los comprobantes de a pila.
      system: [
        { type: "text", text: PROMPT_LECTURA, cache_control: { type: "ephemeral" } },
      ],
      output_config: {
        // Leer una manuscrita y emparejar las columnas de un ticket es
        // percepción difícil: acá el rato de razonamiento se paga solo.
        effort: "high",
        /**
         * El formato lo deriva `zodOutputFormat` del mismo Zod que valida la
         * respuesta — una sola fuente de verdad.
         *
         * El JSON Schema que había acá escrito a mano usaba `type: ["string",
         * "null"]` para los campos opcionales, que el validador de structured
         * outputs NO acepta: espera `anyOf: [{type:"string"},{type:"null"}]`.
         * La API devolvía 400 en TODAS las lecturas, con cualquier foto.
         */
        format: zodOutputFormat(LecturaModelo),
      },
      messages: [
        {
          role: "user",
          content: [
            esPdf
              ? {
                  type: "document" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "application/pdf" as const,
                    data: Buffer.from(bytes).toString("base64"),
                  },
                }
              : {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: real as MimeSoportado,
                    data: Buffer.from(bytes).toString("base64"),
                  },
                },
            // «PÁGINA 1 DE 1» también se manda a propósito: le dice al modelo que
            // no hay otra foto, y por lo tanto que el total tiene que estar acá o
            // no está en ningún lado.
            {
              type: "text",
              text: esPdf
                ? // Un PDF puede traer varias hojas en UNA «página» del rail: el
                  // total está en la última hoja, no en la primera.
                  `PÁGINA ${pagina} DE ${deCuantas}. Es un PDF: puede tener varias hojas, transcribilas todas como un solo comprobante.\n\nTranscribí lo que hay en este documento.`
                : `PÁGINA ${pagina} DE ${deCuantas}.\n\nTranscribí lo que hay en esta foto.`,
            },
          ],
        },
      ],
    });

    const bloque = res.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text") return { ok: false, error: "respuesta_invalida" };
    // Cortado a la mitad es JSON roto: se trata como basura, no se intenta
    // reparar. `max_tokens: 8000` da margen de sobra para 60 renglones.
    if (res.stop_reason === "max_tokens") return { ok: false, error: "respuesta_invalida" };
    texto = bloque.text;
  } catch (e) {
    // Clases tipadas del SDK, nunca string-matching sobre el mensaje.
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: "timeout" };
    if (e instanceof Anthropic.BadRequestError) {
      // Un 400 es SIEMPRE culpa nuestra: schema inválido, imagen que la API no
      // digiere, parámetro mal. El mensaje va entero al log porque es lo único
      // que después permite saber cuál de esas fue.
      console.error(`leerPagina · la API rechazó el request (página ${pagina})`, e.message);
      return { ok: false, error: "request_rechazado" };
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`leerPagina · error del proveedor (página ${pagina})`, e.status, e.message);
      return { ok: false, error: "modelo_no_disponible" };
    }
    console.error(`leerPagina · error inesperado (página ${pagina})`, e);
    return { ok: false, error: "modelo_no_disponible" };
  }

  // El structured output garantiza la FORMA; esto garantiza que el contenido
  // sea el que esperamos. Nunca se propaga el mensaje del proveedor al
  // encargado: el error que ve es nuestro.
  try {
    const parsed = LecturaModelo.safeParse(JSON.parse(texto));
    if (!parsed.success) {
      console.error(
        `leerPagina · payload fuera de contrato (página ${pagina})`,
        parsed.error.issues.slice(0, 3),
      );
      return { ok: false, error: "respuesta_invalida" };
    }
    return { ok: true, lectura: parsed.data };
  } catch {
    console.error(`leerPagina · JSON ilegible (página ${pagina})`, texto.slice(0, 500));
    return { ok: false, error: "respuesta_invalida" };
  }
}

/** El mismo error para las N páginas: el problema es del lote, no de una foto. */
function todasFallan(paginas: PaginaParaLeer[], error: ErrorLectura): PaginaLeida[] {
  return paginas.map((p) => ({ pagina: p.pagina, ok: false as const, error }));
}

/**
 * Las N páginas, en paralelo, y el resultado de cada una por separado.
 *
 * El `Promise.allSettled` es cinturón y tirantes: `leerPagina` atrapa todo y no
 * tira. Pero «no tira» es una propiedad que se rompe con cualquier refactor —
 * alcanza un `Buffer.from` que se queda sin memoria— y si una promesa rechazara,
 * un `Promise.all` se llevaría puestas las otras cuatro lecturas ya pagadas. El
 * `allSettled` convierte ese caso en una página fallida más.
 *
 * Los números de página se respetan tal como vienen: el orden del rail es el
 * orden del papel, y `unirPaginas` lo usa para saber cuál es «la última», que es
 * de donde sale el total.
 */
export async function leerComprobantePaginas(
  paginas: PaginaParaLeer[],
): Promise<PaginaLeida[]> {
  if (paginas.length === 0) return [];
  if (paginas.length > MAX_PAGINAS) return todasFallan(paginas, "demasiadas_paginas");

  const total = paginas.reduce((suma, p) => suma + p.bytes.byteLength, 0);
  if (total > MAX_BYTES_TOTAL) return todasFallan(paginas, "lote_muy_pesado");

  const n = paginas.length;
  const resultados = await Promise.allSettled(
    paginas.map((p) => leerPagina(p.bytes, p.mimeDeclarado, p.pagina, n)),
  );

  return resultados.map((r, i) => {
    const pagina = paginas[i]!.pagina;
    if (r.status === "rejected") {
      console.error(`leerComprobantePaginas · la página ${pagina} rechazó`, r.reason);
      return { pagina, ok: false as const, error: "modelo_no_disponible" };
    }
    return r.value.ok
      ? { pagina, ok: true as const, lectura: r.value.lectura }
      : { pagina, ok: false as const, error: r.value.error };
  });
}
