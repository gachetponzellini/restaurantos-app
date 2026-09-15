import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El orquestador de páginas — spec 173.
 *
 * Se testea con la API mockeada porque lo que se está fijando acá no es lo que
 * el modelo entiende (eso se mira con fotos de verdad) sino tres cosas que se
 * rompen en silencio y cuestan plata:
 *
 * · el `media_type` que viaja tiene que ser el REAL, no el que declaró Storage;
 * · una página que revienta no se puede llevar puestas a las otras cuatro, que
 *   ya se pagaron;
 * · el «PÁGINA k DE n» no puede entrar al bloque `system`, que está cacheado.
 */

const { create, explotarAlConstruir } = vi.hoisted(() => ({
  create: vi.fn(),
  explotarAlConstruir: { valor: false },
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>();

  class AnthropicFake {
    messages = { create: (...args: unknown[]) => create(...args) };
    constructor() {
      // El constructor vive FUERA del try de `leerPagina`: si tira, la promesa
      // rechaza de verdad y es el único caso que ejercita el `allSettled`.
      if (explotarAlConstruir.valor) throw new Error("no se pudo construir el cliente");
    }
  }
  // Herencia de estáticos sin llamar al constructor real (que en jsdom pide
  // `dangerouslyAllowBrowser`): así `Anthropic.BadRequestError` y compañía
  // siguen siendo las clases posta que `leerPagina` compara con `instanceof`.
  Object.setPrototypeOf(AnthropicFake, real.default);

  return { ...real, default: AnthropicFake };
});

import { leerComprobantePaginas, leerPagina, MAX_PAGINAS } from "@/lib/proveedores/lectura/leer";

/** Una imagen con el header que corresponde y el peso que se pida. */
function imagen(tipo: "jpeg" | "png" | "heic", bytes = 64): ArrayBuffer {
  const buf = new Uint8Array(bytes);
  if (tipo === "jpeg") buf.set([0xff, 0xd8, 0xff]);
  if (tipo === "png") buf.set([0x89, 0x50, 0x4e, 0x47]);
  // ftyp en el offset 4 — lo que sale de un iPhone sin convertir.
  if (tipo === "heic") buf.set([0x66, 0x74, 0x79, 0x70], 4);
  return buf.buffer;
}

const LECTURA_OK = {
  es_comprobante: true,
  motivo_descarte: null,
  formato: "ticket_termico",
  cabecera: {
    proveedor_nombre: "FRIGORIFICO DEL SUR",
    proveedor_cuit: null,
    tipo_comprobante: "ticket",
    numero: null,
    fecha: null,
    total: null,
    origen_total: null,
    condicion_pago: null,
    neto: null,
    iva: null,
    percepciones: null,
  },
  renglones: [],
};

function respuesta(lectura: unknown = LECTURA_OK) {
  return { content: [{ type: "text", text: JSON.stringify(lectura) }], stop_reason: "end_turn" };
}

/** El `content` del único mensaje `user` de la llamada número `i`. */
function contenidoUser(i: number) {
  const args = create.mock.calls[i]![0] as {
    system: { text: string; cache_control?: unknown }[];
    messages: { content: { type: string; text?: string; source?: { media_type: string } }[] }[];
  };
  return args;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  explotarAlConstruir.valor = false;
  create.mockReset();
  create.mockResolvedValue(respuesta());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("el media_type que viaja es el de los bytes, no el declarado", () => {
  it("un PNG guardado como .jpg se lee igual", async () => {
    // Storage dice `image/jpeg` porque el browser lo adivinó por la extensión.
    // Mandando eso con bytes PNG, la API contesta 400 y la lectura muere con un
    // «fue un problema nuestro» que no ayuda a nadie.
    const r = await leerPagina(imagen("png"), "image/jpeg", 1, 1);

    expect(r.ok).toBe(true);
    const source = contenidoUser(0).messages[0]!.content[0]!.source!;
    expect(source.media_type).toBe("image/png");
  });

  it("un HEIC renombrado a .jpg cae en formato_no_soportado y no gasta la llamada", async () => {
    const r = await leerPagina(imagen("heic"), "image/jpeg", 1, 1);

    expect(r).toEqual({ ok: false, error: "formato_no_soportado" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("PÁGINA k DE n", () => {
  it("va en el mensaje user y nunca en el system", async () => {
    await leerComprobantePaginas([
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 2, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 3, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
    ]);

    const textos = create.mock.calls.map((c) => {
      const args = c[0] as { messages: { content: { type: string; text?: string }[] }[] };
      return args.messages[0]!.content.find((b) => b.type === "text")!.text!;
    });

    expect(textos.sort()).toEqual([
      expect.stringContaining("PÁGINA 1 DE 3"),
      expect.stringContaining("PÁGINA 2 DE 3"),
      expect.stringContaining("PÁGINA 3 DE 3"),
    ]);

    // El system es idéntico en las tres llamadas y conserva el cache_control:
    // una línea variable adentro rompería el caché en cada una de las N.
    const systems = create.mock.calls.map((c) => (c[0] as { system: unknown[] }).system);
    expect(JSON.stringify(systems[0])).toBe(JSON.stringify(systems[1]));
    expect(JSON.stringify(systems[0])).toBe(JSON.stringify(systems[2]));
    for (const s of systems) {
      const bloque = (s as { text: string; cache_control?: { type: string } }[])[0]!;
      expect(bloque.cache_control).toEqual({ type: "ephemeral" });
      expect(bloque.text).not.toMatch(/PÁGINA \d+ DE/);
    }
  });

  it("también se manda con una sola foto: le dice al modelo que no hay otra", async () => {
    await leerComprobantePaginas([
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
    ]);

    const args = contenidoUser(0);
    expect(args.messages[0]!.content.find((b) => b.type === "text")!.text).toContain(
      "PÁGINA 1 DE 1",
    );
  });
});

describe("una página caída no se lleva a las otras", () => {
  it("la que falla vuelve marcada y las demás traen su lectura", async () => {
    create.mockImplementation((args: { messages: { content: { text?: string }[] }[] }) => {
      const texto = args.messages[0]!.content.map((b) => b.text ?? "").join("");
      if (texto.includes("PÁGINA 2")) return Promise.reject(new Error("se cayó"));
      return Promise.resolve(respuesta());
    });

    const r = await leerComprobantePaginas([
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 2, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 3, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
    ]);

    expect(r.map((p) => [p.pagina, p.ok])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
    expect(r[1]).toMatchObject({ ok: false, error: "modelo_no_disponible" });
  });

  it("un error ANTES del try —el constructor— tampoco tumba la tanda", async () => {
    // `leerPagina` atrapa todo lo que pasa adentro del try, pero el cliente se
    // construye afuera. Sin el `allSettled`, esa promesa rechazada se llevaría
    // puestas las lecturas de las otras páginas, ya pagadas.
    explotarAlConstruir.valor = true;

    const r = await leerComprobantePaginas([
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 2, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
    ]);

    expect(r).toHaveLength(2);
    expect(r.every((p) => !p.ok)).toBe(true);
  });

  it("respeta el número de página que le dan, no el orden del array", async () => {
    const r = await leerComprobantePaginas([
      { pagina: 3, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
    ]);

    expect(r.map((p) => p.pagina)).toEqual([3, 1]);
  });
});

describe("las páginas salen en paralelo", () => {
  it("las N llamadas arrancan antes de que conteste la primera", async () => {
    let arrancadas = 0;
    let soltar: (() => void) | null = null;
    const todasArrancaron = new Promise<void>((res) => {
      soltar = res;
    });

    create.mockImplementation(async () => {
      arrancadas++;
      if (arrancadas === 4) soltar!();
      await todasArrancaron;
      return respuesta();
    });

    // Si fueran en serie, la primera llamada esperaría a `todasArrancaron`, que
    // sólo se cumple cuando arrancó la cuarta: el test colgaría hasta el timeout.
    const r = await leerComprobantePaginas(
      [1, 2, 3, 4].map((pagina) => ({
        pagina,
        bytes: imagen("jpeg"),
        mimeDeclarado: "image/jpeg",
      })),
    );

    expect(r.every((p) => p.ok)).toBe(true);
    expect(create).toHaveBeenCalledTimes(4);
  });
});

describe("los topes de peso", () => {
  it("una foto sola muy pesada falla ella y las otras se leen", async () => {
    const r = await leerComprobantePaginas([
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
      { pagina: 2, bytes: imagen("jpeg", 3_700_000), mimeDeclarado: "image/jpeg" },
    ]);

    expect(r[0]!.ok).toBe(true);
    expect(r[1]).toMatchObject({ ok: false, error: "imagen_muy_pesada" });
  });

  it("cuatro fotos que pasan de a una revientan por la SUMA, y no se llama a la API", async () => {
    const r = await leerComprobantePaginas(
      [1, 2, 3, 4].map((pagina) => ({
        pagina,
        bytes: imagen("jpeg", 3_500_000),
        mimeDeclarado: "image/jpeg",
      })),
    );

    expect(r.every((p) => !p.ok && p.error === "lote_muy_pesado")).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("más de cinco páginas se rechazan enteras", async () => {
    const r = await leerComprobantePaginas(
      Array.from({ length: MAX_PAGINAS + 1 }, (_, i) => ({
        pagina: i + 1,
        bytes: imagen("jpeg"),
        mimeDeclarado: "image/jpeg",
      })),
    );

    expect(r.every((p) => !p.ok && p.error === "demasiadas_paginas")).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("sin páginas no hay lectura ni llamada", async () => {
    expect(await leerComprobantePaginas([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("sin API key", () => {
  it("cada página vuelve con sin_api_key y no se llama a nadie", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const r = await leerComprobantePaginas([
      { pagina: 1, bytes: imagen("jpeg"), mimeDeclarado: "image/jpeg" },
    ]);

    expect(r[0]).toMatchObject({ ok: false, error: "sin_api_key" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("la respuesta del modelo se valida igual", () => {
  it("un JSON que no cumple el schema es respuesta_invalida", async () => {
    create.mockResolvedValue(respuesta({ es_comprobante: "sí" }));

    const r = await leerPagina(imagen("jpeg"), "image/jpeg", 1, 1);
    expect(r).toEqual({ ok: false, error: "respuesta_invalida" });
  });

  it("cortada por max_tokens también", async () => {
    create.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(LECTURA_OK) }],
      stop_reason: "max_tokens",
    });

    const r = await leerPagina(imagen("jpeg"), "image/jpeg", 1, 1);
    expect(r).toEqual({ ok: false, error: "respuesta_invalida" });
  });
});
