import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusinessIdBySlug, requireProveedorContext } from "@/lib/proveedores/auth";
import { getIngredientsForLinking } from "@/lib/proveedores/queries";
import { aPropuesta, type InsumoDelCatalogo } from "@/lib/proveedores/lectura/a-propuesta";
import { cuitValido, normalizarCuit } from "@/lib/proveedores/lectura/cuit";
import { parseFechaAR } from "@/lib/proveedores/lectura/fecha-ar";
import {
  hayApiKey,
  leerComprobantePaginas,
  MAX_PAGINAS,
  type PaginaParaLeer,
} from "@/lib/proveedores/lectura/leer";
import { unirPaginas, type PaginaLeida } from "@/lib/proveedores/lectura/unir-paginas";

/**
 * Leer un comprobante de proveedor — spec 172, ampliada en la 173.
 *
 * Route Handler y no Server Action **porque `maxDuration` sólo se puede declarar
 * acá**: no hay `vercel.json`, y una lectura de una factura manuscrita corre
 * 15-40 s. Con una Server Action no hay forma de subir el techo y el request
 * muere sin un mensaje útil. Es el mismo patrón que
 * `api/chatbot/whatsapp/[businessId]`.
 *
 * El archivo NUNCA viaja por acá: el uploader lo sube directo del browser a
 * Storage y esto recibe las RUTAS. Por eso el límite de 1 MB de payload de las
 * Server Actions no aplica — viajan ~50 bytes por página.
 *
 * Lo que cambió en la 173: el comprobante puede venir en hasta cinco fotos, las
 * cinco se leen en llamadas PARALELAS (ver `leer.ts`), y el resultado se une en
 * el código. De ahí las dos consecuencias visibles del contrato:
 *
 * · **La respuesta puede ser `ok` con páginas caídas.** Si tres de cinco se
 *   leyeron, esos renglones sirven y se muestran; las otras dos viajan en
 *   `paginasFallidas` para que el rail las pinte en rojo y se puedan reintentar.
 *   Fallar el pedido entero tiraría a la basura tres lecturas ya pagadas.
 * · **El proveedor se resuelve ACÁ, antes que los insumos.** El pedido del dueño
 *   era «que sea un botón general y que desde ahí busque todos los datos»: sacás
 *   la foto y el sistema te dice de quién es, en vez de tener que entrar primero
 *   a la ficha del proveedor. Y el orden importa por una razón concreta abajo.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type PropuestaRpc = {
  texto: string;
  ingredient_id: string | null;
  match_source: string | null;
};

type CandidatoProveedor = {
  id: string;
  name: string;
  cuit: string | null;
  score: number;
  via: string;
};

type ProveedorRpc = {
  estado: "resuelto" | "propuesto" | "no_encontrado";
  candidatos: CandidatoProveedor[];
};

/**
 * Las dos RPC de la 0092 y la 0095 todavía no están en `database.types.ts` (el
 * `pnpm db:types` necesita el CLI linkeado, y encima trunca el archivo). Mismo
 * escape hatch que el resto del módulo usa para las tablas de la 158 y la 165.
 */
type GenericRpc = {
  rpc(
    fn: "proponer_insumos_para_lineas",
    args: { p_business_id: string; p_supplier_id: string | null; p_lineas: string[] },
  ): Promise<{ data: PropuestaRpc[] | null; error: { message: string } | null }>;
  rpc(
    fn: "proponer_proveedor_para_cabecera",
    args: { p_business_id: string; p_nombre: string | null; p_cuit: string | null },
  ): Promise<{ data: ProveedorRpc | null; error: { message: string } | null }>;
};

const Path = z.string().min(1).max(300);

const Body = z
  .object({
    businessSlug: z.string().min(1).max(80),
    photoPaths: z.array(Path).min(1).max(MAX_PAGINAS).optional(),
    /**
     * El singular sigue aceptado UNA RELEASE MÁS.
     *
     * `invoice-dialog.tsx` todavía manda `photoPath` y va a seguir mandándolo
     * hasta que la pantalla nueva lo reemplace. Romperlo acá deja la carga de
     * compras rota en la ventana entre los dos deploys, que es exactamente el
     * modo de falla que la migración 0095 se cuidó de evitar del lado de la base.
     */
    photoPath: Path.optional(),
    /** Para que la memoria de aliases pueda proponer. Opcional. */
    supplierId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => (b.photoPaths?.length ?? 0) > 0 || Boolean(b.photoPath), {
    message: "Falta la foto.",
  });

/**
 * Los mensajes distinguen de quién es el problema.
 *
 * Sólo los que hablan de la foto mandan a sacar otra, y son los casos en que la
 * foto es efectivamente la causa. Todo lo demás dice «fue acá», porque pedirle a
 * la encargada que repita algo que no va a cambiar nada la hace sacar la misma
 * foto dos veces —ya pasó— y encima le deja la sensación de haber hecho algo mal.
 *
 * Con varias fotos estos textos aparecen además EN LA MINIATURA de la página que
 * falló, así que hablan de una foto y no del comprobante.
 */
const MENSAJES: Record<string, string> = {
  sin_api_key: "La lectura de facturas todavía no está prendida en este local.",
  imagen_muy_pesada: "Esta foto es muy pesada para leerla. Sacá una nueva sin zoom o recortala.",
  lote_muy_pesado:
    "Las fotos juntas pesan demasiado. Sacá alguna del comprobante o volvé a sacarlas sin zoom.",
  demasiadas_paginas: `Un comprobante entra en hasta ${MAX_PAGINAS} fotos.`,
  // spec 198 · el PDF ahora se lee: lo que llega acá es sobre todo la HEIC de un
  // iPhone que nadie convirtió, y el mensaje dice cómo convertirla.
  formato_no_soportado:
    "No pude leer este archivo. Si es una foto de iPhone (HEIC), mandala como JPG: en el iPhone, Ajustes → Cámara → Formatos → «Más compatible».",
  no_encontrada: "No encontramos esta foto. Volvé a subirla.",
  timeout: "La lectura tardó más de lo esperado. Cargalo a mano y avisanos.",
  request_rechazado: "Falló la lectura por un problema nuestro, no por la foto. Cargalo a mano y avisanos.",
  respuesta_invalida: "No pudimos leer esta foto. Cargala a mano.",
  modelo_no_disponible: "El lector no está respondiendo. Cargalo a mano y probá de nuevo en un rato.",
};

/**
 * El status sale del CÓDIGO, no de una cadena de ternarios.
 *
 * Un request rechazado es 500 y no 400: el problema es nuestro y tiene que
 * aparecer como error del server en las métricas, no como input inválido.
 */
const STATUS: Record<string, number> = {
  sin_api_key: 503,
  modelo_no_disponible: 503,
  timeout: 504,
  request_rechazado: 500,
  respuesta_invalida: 500,
  no_encontrada: 404,
  imagen_muy_pesada: 400,
  lote_muy_pesado: 400,
  demasiadas_paginas: 400,
  formato_no_soportado: 400,
};

export async function POST(req: Request) {
  if (!hayApiKey()) {
    return NextResponse.json({ ok: false, error: MENSAJES.sin_api_key }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Datos inválidos." }, { status: 400 });
  }
  const { businessSlug, supplierId } = parsed.data;

  /**
   * El singular se mapea a un array de uno y de acá para abajo hay UN solo
   * camino. Dos caminos paralelos —uno de una foto y otro de N— es como se
   * escriben las guardas que después sólo corren en uno de los dos.
   *
   * El `Set` no es paranoia de más: si el cliente manda el mismo path dos veces
   * (un reintento que no limpió el estado), sin esto se lee la misma imagen dos
   * veces —se paga dos veces— y `unirPaginas` marca cada renglón como posible
   * duplicado de sí mismo, que es ruido puro sobre una lectura perfecta.
   */
  const paths = [...new Set(parsed.data.photoPaths ?? [parsed.data.photoPath!])];

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) {
    return NextResponse.json({ ok: false, error: "Negocio no encontrado." }, { status: 404 });
  }

  const ctx = await requireProveedorContext(businessId);
  if (!ctx.ok) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: 403 });
  }

  /**
   * La guarda que no es opcional, sobre CADA path.
   *
   * Los paths los elige el cliente y la descarga va con service role, que
   * **bypassea** las policies de `storage.objects` — justamente las que chequean
   * que el primer segmento del path sea el negocio. `demo`, `golf-jcr` y `kcc`
   * comparten base y bucket: sin esto, un encargado lee las facturas de otro
   * local mandando su ruta.
   *
   * Antes esto corría sobre un solo path. Con un array, chequear el primero y
   * bajar los cinco es la misma vulnerabilidad con un paso más: se manda la foto
   * propia primero y la ajena atrás.
   */
  const ajeno = paths.find((p) => p.split("/")[0] !== businessId || p.split("/").includes(".."));
  if (ajeno) {
    return NextResponse.json(
      { ok: false, error: "Esa foto no es de este negocio." },
      { status: 403 },
    );
  }

  const service = createSupabaseServiceClient();

  // Las descargas también en paralelo: son cinco round-trips a Storage y en
  // serie se comen un pedazo del techo de 60 s antes de la primera lectura.
  const descargas = await Promise.all(
    paths.map((p) => service.storage.from("supplier-invoices").download(p)),
  );

  const paraLeer: PaginaParaLeer[] = [];
  const caidas: PaginaLeida[] = [];
  for (let i = 0; i < descargas.length; i++) {
    const pagina = i + 1;
    const { data: blob, error } = descargas[i]!;
    // Un objeto que no está tira SU página y nada más. Antes esto era un 404 del
    // pedido entero, que con una sola foto daba igual y con cinco tiraría cuatro
    // lecturas buenas por una foto que se borró del bucket.
    if (error || !blob) {
      caidas.push({ pagina, ok: false, error: "no_encontrada" });
      continue;
    }
    paraLeer.push({
      pagina,
      bytes: await blob.arrayBuffer(),
      mimeDeclarado: blob.type || "",
    });
  }

  const leidas = await leerComprobantePaginas(paraLeer);
  const unida = unirPaginas([...caidas, ...leidas]);

  /**
   * Ninguna página sobrevivió: ahí sí falla el pedido entero, con el status y el
   * mensaje del código real —504 si fue timeout, 503 si el modelo no contesta—
   * en vez de un `ok: true` vacío que la pantalla tendría que interpretar.
   *
   * Se usa el código de la PRIMERA página caída: cuando fallan todas suele ser
   * la misma causa (no hay API key, se cayó el proveedor), y elegir entre cinco
   * mensajes distintos para mostrar uno solo no le sirve a nadie.
   */
  if (unida.paginasFallidas.length === paths.length) {
    const codigo = unida.paginasFallidas[0]!.error;
    return NextResponse.json(
      { ok: false, error: MENSAJES[codigo] ?? MENSAJES.respuesta_invalida },
      { status: STATUS[codigo] ?? 500 },
    );
  }

  const { cabecera, renglones, esComprobante } = unida;

  /**
   * El CUIT y la fecha llegan VERBATIM de la foto: `unirPaginas` une lo que
   * escribió el modelo y no interpreta nada. Normalizarlos es trabajo de acá.
   *
   * El CUIT sólo se usa para buscar si pasa módulo 11. No es rigor de más: en
   * `suppliers` el CUIT **no es único** (golf-jcr tiene 71 bien formados y 69
   * distintos) y la RPC devuelve «resuelto» cuando encuentra uno solo. Un `6`
   * que se leyó `8` y por casualidad existe en el catálogo le escribe la compra
   * a la cuenta corriente equivocada, y eso se descubre en la conciliación de
   * fin de mes. Si no cierra, se cae al match por nombre, que tolera la letra fea.
   * Lo leído sigue disponible verbatim en `cabecera.proveedor_cuit`.
   */
  const cuitNormalizado = normalizarCuit(cabecera?.proveedor_cuit);
  const cuitLeido = cuitNormalizado && cuitValido(cuitNormalizado) ? cuitNormalizado : null;
  const nombreLeido = cabecera?.proveedor_nombre?.trim() || null;

  let proveedor: {
    estado: "sin_foto" | "resuelto" | "propuesto" | "no_encontrado";
    supplierId: string | null;
    candidatos: CandidatoProveedor[];
  } = { estado: "no_encontrado", supplierId: null, candidatos: [] };

  if (supplierId) {
    // Se entró desde la ficha de un proveedor: ese gana y no se pregunta nada.
    // Lo que el papel diga es, en el mejor caso, una confirmación; en el peor,
    // una discusión con la persona que ya eligió.
    proveedor = { estado: "resuelto", supplierId, candidatos: [] };
  } else if (esComprobante && (cuitLeido || nombreLeido)) {
    const { data, error } = await (service as unknown as GenericRpc).rpc(
      "proponer_proveedor_para_cabecera",
      { p_business_id: businessId, p_nombre: nombreLeido, p_cuit: cuitLeido },
    );
    if (error) {
      // El caso concreto: la 0095 le revoca el execute a anon y authenticated, y
      // si esto se llamara con la sesión del usuario en vez del service role
      // daría «permission denied for function» en TODAS las lecturas. Sin este
      // log, el síntoma sería «el proveedor nunca se encuentra».
      console.error("leer-comprobante · falló proponer_proveedor_para_cabecera", error.message);
    }
    const estado = data?.estado ?? "no_encontrado";
    const candidatos = Array.isArray(data?.candidatos) ? data.candidatos : [];
    proveedor = {
      estado,
      // Sólo «resuelto» deja un id elegido. «Propuesto» son candidatos para que
      // decida el que tiene el remito en la mano: la RPC devuelve propuesto
      // justamente cuando elegir sería tirar una moneda.
      supplierId: estado === "resuelto" ? (candidatos[0]?.id ?? null) : null,
      candidatos,
    };
  }

  /**
   * Y recién ahora los insumos, con el proveedor ya resuelto.
   *
   * `proponer_insumos_para_lineas` usa la memoria de aliases: «PALETA» de este
   * proveedor es tal insumo porque alguien ya lo emparejó antes en una compra de
   * este mismo proveedor. Llamarla con `p_supplier_id: null` —que es lo que
   * pasaba cuando no se entraba desde la ficha— tira esa memoria justo en la
   * pasada que más la necesita: la primera, la que la persona va a corregir a
   * mano renglón por renglón.
   *
   * Sólo viaja el proveedor cuando está RESUELTO. Con un «propuesto» todavía no
   * se sabe de quién es la factura, y los aliases del proveedor equivocado
   * proponen peor que ningún alias.
   */
  const supplierParaAliases = proveedor.estado === "resuelto" ? proveedor.supplierId : null;

  // Se deduplican las descripciones: con cinco páginas hay hasta 300 renglones y
  // los repetidos preguntan lo mismo. El resultado se mapea por texto, así que
  // los duplicados quedan igual resueltos.
  const lineas = [...new Set(renglones.map((r) => r.descripcion))];

  // Sin renglones no hay nada que matchear: la foto no era un comprobante, o era
  // una hoja del medio que sólo traía el membrete. Preguntarle igual a la RPC y
  // traerse el catálogo entero de insumos son dos round-trips para no usarlos.
  const [propuestas, catalogo] =
    lineas.length === 0
      ? [[] as PropuestaRpc[], [] as InsumoDelCatalogo[]]
      : await Promise.all([
          (service as unknown as GenericRpc)
            .rpc("proponer_insumos_para_lineas", {
              p_business_id: businessId,
              p_supplier_id: supplierParaAliases,
              p_lineas: lineas,
            })
            .then((r) => r.data ?? []),
          getIngredientsForLinking(businessId),
        ]);

  const porTexto = new Map(propuestas.map((p) => [p.texto, p]));
  const porId = new Map<string, InsumoDelCatalogo>(catalogo.map((i) => [i.id, i]));

  // El match corre en el server porque los umbrales viven en `pg_trgm` (0092).
  // Lo que sí se recalcula en el cliente es la CONVERSIÓN, que es pura: cuando
  // la persona corrige el insumo de un renglón, `aPropuesta` se vuelve a correr
  // ahí sin pedirle nada al server.
  const propuestos = renglones.map((r) => {
    const m = porTexto.get(r.descripcion);
    const insumo = m?.ingredient_id ? (porId.get(m.ingredient_id) ?? null) : null;
    // `pagina` y `posibleDuplicado` viajan hasta el renglón de la pantalla: uno
    // dice a qué foto saltar para revisarlo, el otro pinta el aviso de
    // solapamiento. `aPropuesta` no los conoce y no tiene por qué.
    return { ...aPropuesta(r, insumo, m?.match_source ?? null), pagina: r.pagina, posibleDuplicado: r.posibleDuplicado };
  });

  return NextResponse.json({
    ok: true,
    data: {
      esComprobante,
      motivoDescarte: unida.motivoDescarte,
      formato: unida.formato,
      cabecera,
      /**
       * Aditivo al contrato: la fecha ya parseada, «YYYY-MM-DD» o null.
       * `cabecera.fecha` queda verbatim como está escrita en el papel. Va acá y
       * no en el cliente porque `parseFechaAR` **nunca cae a hoy** ante la duda,
       * y una fecha inventada mueve el vencimiento de la cuenta corriente.
       */
      fechaISO: parseFechaAR(cabecera?.fecha),
      proveedor: { ...proveedor, nombreLeido, cuitLeido },
      renglones: propuestos,
      // El código se traduce acá porque esto se muestra EN LA MINIATURA de la
      // página que falló, no en un cartel global: con lecturas en paralelo,
      // «falló» sin decir cuál no informa nada.
      paginasFallidas: unida.paginasFallidas.map((p) => ({
        pagina: p.pagina,
        error: MENSAJES[p.error] ?? MENSAJES.respuesta_invalida!,
      })),
    },
  });
}
