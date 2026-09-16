// Render del ticket de comanda — spec 051 (print-agent como relay).
//
// Portado 1:1 desde `print-agent/agent.mjs` (las 3 funciones puras de formato)
// para que el "qué/cómo imprimir" viva en el server y un cambio de formato sea
// solo un deploy de Vercel, sin recompilar ni re-descargar el .exe. El agente
// pasa a imprimir los bytes que este módulo produce; conserva su copia local
// solo como fallback (ver plan 051, D1-D5).
//
// PARIDAD: este módulo DEBE producir exactamente los mismos bytes que el agente
// imprime hoy en golf (test de paridad en `ticket.test.ts` contra fixtures
// congelados). Única desviación intencional del código del agente: la fecha se
// formatea con `timeZone` explícito America/Argentina/Buenos_Aires (constitución
// + necesario para que el server, que corre en UTC, produzca la MISMA hora local
// que la PC de golf; en golf, que ya está en AR, el resultado es idéntico).
//
// 2026-08-20: `toLocaleString("es-AR")` usa reloj de 12h y mostraba las 18:30
// como "06:30" — en una comanda de cocina, a la hora de la cena, eso es
// directamente una hora equivocada. Va con `hour12: false`. El fallback del
// agente se actualizó en el mismo commit para no romper la paridad.

const ESC = "\x1b";
const GS = "\x1d";

// Tamaño de carácter (GS ! n): nibble alto = ancho, nibble bajo = alto.
//   sm   → normal          tall → doble alto (0x01)
//   xl   → doble alto Y doble ancho (0x11), reservado para los ítems.
const CHAR_SIZE: Record<Size, string> = {
  sm: "\x00",
  tall: "\x01",
  xl: "\x11",
};

// Ancho útil en columnas por tamaño (58mm ≈ 384 pt de ancho de cabezal).
// Celda Font A = 12 pt + CHAR_RIGHT_SPACING → 16 pt ⇒ 24 col. En doble ancho la
// celda y el espaciado se duplican (24 + 8 = 32 pt) ⇒ 12 col; usamos 11 para
// dejar margen. Se usa para cortar por palabra en vez de que la impresora parta
// el nombre del producto a la mitad.
export const COLS: Record<Size, number> = { sm: 24, tall: 24, xl: 11 };

/**
 * Ancho de la **Font B** (condensada), en la misma comandera de 58 mm.
 *
 * Celda Font B = 9 pt ⇒ 384 / 9 = 42 col, y sin `ESC SP` extra. Es el ancho al
 * que MaxiRest imprime el cierre en golf: la línea más larga de su ticket
 * (`IVA: Resp. Inscripto   CUIT: 30-71323440-7`) mide exactamente 42, y 42 no
 * entran en Font A en este cabezal (techo 32). Mismo papel, otra tipografía.
 *
 * No se usa para comandas: la cocina lee de lejos y por eso va Font A con
 * espaciado. El cierre se lee en la mano.
 */
export const COLS_COND = 42;

// Espaciado lateral por carácter (ESC SP n) ≈ +33% de ancho sin duplicarlo.
const CHAR_RIGHT_SPACING = 4;

// Interlineado (ESC 3 n): más alto = más espaciado y evita que el doble alto se pise.
const LINE_SPACING = 64;

/**
 * Interlineado para un bloque de cuerpo normal que no necesita el aire del
 * doble alto: la lista de ítems del control de pedido. La mitad de
 * `LINE_SPACING`, que sigue dejando 8 pt de margen sobre los 24 que mide un
 * carácter Font A. Es lo único que de verdad acorta el papel — el `size` de la
 * línea no lo toca.
 */
export const COMPACT_SPACING = 32;

export const RULE = "------------------------"; // 24 col (≈ ancho útil 58mm con el espaciado)
/** Separador a lo ancho de la condensada (42 col), para el papel del cierre. */
export const RULE_COND = "-".repeat(COLS_COND);

// Renglones en blanco arriba y abajo del bloque de ítems (entre ítem e ítem va
// uno solo). Despega la lista de la línea separadora y del corte del papel.
const EDGE_PADDING = 3;

/**
 * Renglones en blanco **arriba de todo** el ticket de comanda (#289).
 *
 * En la cocina la comanda cuelga de un porta-comandas, y el riel tapa los
 * primeros ~3 cm del papel: justo el `ENTREGAR 20:15` que se puso arriba de
 * todo para leerse de lejos. La impresora ya deja ~1 cm entre el corte y la
 * primera línea (distancia cabezal→cuchilla); con 3 renglones más a
 * `LINE_SPACING` (64 pt ≈ 8 mm c/u) el primer contenido arranca a ~3,5 cm del
 * borde, fuera del clip. Aplica a TODAS las comandas —anuladas y
 * reimpresiones incluidas—, no a la cuenta ni al control, que no se cuelgan.
 */
export const TOP_MARGIN = 3;

export const TIMEZONE = "America/Argentina/Buenos_Aires";

export type TicketItem = {
  product_name: string;
  quantity: number;
  notes?: string | null;
  // Post-`.filter(Boolean)` el caller puede tipar esto laxo; en runtime son strings.
  modifiers?: ReadonlyArray<string | null | undefined> | null;
  /**
   * De qué menú del día / combo viene este plato (spec 145): el
   * `product_name` del ítem PADRE, congelado al enviar la comanda.
   *
   * Un combo se guarda partido: el padre tiene el nombre del menú y el precio
   * pero NO tiene sector, así que no va a ninguna comandera; los hijos tienen
   * su sector pero no saben de dónde vienen. Sin esto la Fritera lee
   * «Milanesa» y manda la de la carta, que no es la porción del ejecutivo.
   *
   * Es snapshot y no el `daily_menus.name` de hoy: si el admin renombra el
   * menú a mitad de servicio, la reimpresión saca el ticket que salió.
   *
   * Campo aditivo: los fixtures congelados no lo traen.
   */
  combo_name?: string | null;
};

/** Lo que el MISMO pedido lleva en otro sector. */
export type TicketSectorHermano = {
  station_name: string;
  items: TicketItem[];
};

export type TicketComanda = {
  comanda_id: string;
  station_name: string;
  table_label: string;
  batch: number | string;
  emitted_at: string;
  cancelled?: boolean;
  cancelled_reason?: string | null;
  reprint?: boolean;
  items?: TicketItem[] | null;
  /**
   * `orders.delivery_type`. Ausente ⇒ salón (encabezado «MESA x», el de
   * siempre). Campo aditivo: los fixtures congelados no lo traen.
   */
  delivery_type?: "dine_in" | "delivery" | "pickup" | null;
  /**
   * Con qué combina: los items del mismo pedido que se preparan en OTROS
   * sectores. Sin esto la parrilla no sabe que el entrecot sale con las papas de
   * fritera, y cada sector cocina a destiempo. Campo aditivo.
   */
  otros_sectores?: TicketSectorHermano[] | null;
  /**
   * `orders.kitchen_notes`: la indicación del encargado PARA COCINA sobre cómo
   * sacar el plato («junto con la mesa 5»). Sale arriba de todo, debajo de la
   * hora. Desde la spec 127 es sólo eso, una nota: el «cuándo» tiene su propio
   * campo (`kitchen_time`), y no hay que escribirlo más acá adentro.
   *
   * NO confundir con `orders.delivery_notes`, que es la nota del CLIENTE sobre
   * la entrega («tocar timbre», «depto 3B»): ésa no le sirve a la parrilla y va
   * sólo en el ticket de control. Campo aditivo.
   */
  kitchen_notes?: string | null;
  /**
   * `orders.kitchen_at` ya formateado como `HH:MM` en la hora del local (spec
   * 127): **para cuándo el plato tiene que estar listo**. Es lo primero del
   * ticket, en el cuerpo más grande.
   *
   * Hasta la 127 esta hora vivía adentro de `kitchen_notes` —el encargue
   * telefónico no tenía dónde escribirla— y por eso el banner era la nota. Ya
   * no: la hora tiene su campo y la nota volvió a ser una nota. Llega formateada
   * y no como instante porque el ticket es puro: el TZ lo resuelve quien arma
   * el payload. Campo aditivo.
   */
  kitchen_time?: string | null;
  /**
   * `comandas.notes` (spec 128): la observación que el mozo escribió para
   * **este envío**, la misma en las comandas de todos los sectores de la tanda
   * («va todo junto», «la mesa tiene apuro»).
   *
   * Va con la COMANDA y no con la orden: así la reimpresión saca el ticket tal
   * cual salió, y una tanda no arrastra la observación de otra. NO confundir
   * con `kitchen_notes` —que es del pedido y define el CUÁNDO— ni con la nota
   * del ítem, que es de un plato. Campo aditivo.
   */
  comanda_notes?: string | null;
  /**
   * `orders.daily_number`: el número de pedido DEL DÍA — arranca en 1 cada
   * jornada (corte 6 AM) y es el mismo que el mozo y el encargado ven en
   * pantalla. Es lo que la cocina usa para juntar los tickets del MISMO pedido
   * que salieron por sectores distintos; el `comanda_id` no sirve para eso,
   * porque es distinto en cada sector. Campo aditivo: sin él se cae al
   * identificador de la comanda.
   */
  daily_number?: number | null;
  /**
   * El mozo que tiene la mesa, ya en su nombre corto («Pedro», «Juan B.»), el
   * mismo que muestra el plano (#325). En el pase la cocina sabe a quién
   * llamar sin salir a preguntar.
   *
   * Sale de `tables.mozo_id` y NO de `orders.mozo_id`: ése es quien ABRIÓ el
   * pedido, y en un local que carga desde la compu compartida (spec 140) es
   * siempre la terminal. Sin mozo asignado llega `null` y el renglón no sale.
   * Campo aditivo — un agente viejo lo ignora.
   */
  mozo_name?: string | null;
};

export type Size = "sm" | "tall" | "xl";
export type Align = "left" | "center" | "right";
export type Line = {
  text: string;
  size?: Size;
  bold?: boolean;
  align?: Align;
  /**
   * Spec 084: imprime este contenido como **código QR nativo** de la impresora
   * en vez de como texto. Se usa para el QR de ARCA (RG 4892) de la factura,
   * que tiene que ser escaneable — la URL en texto no cumple.
   * El `text` de la línea se ignora al renderear ESC/POS y se usa como fallback
   * legible en `renderPlain`.
   */
  qr?: string;
  /**
   * Interlineado (`ESC 3 n`) para esta línea, en puntos. Sin esto, todo el
   * documento avanza `LINE_SPACING` (64) por renglón — un valor elegido para
   * que el doble alto no se pise, y que por eso **no cambia** aunque la línea
   * sea `sm`: bajar el `size` achica la letra, no el papel.
   *
   * Se emite sólo cuando cambia respecto de la línea anterior, igual que
   * `size`/`bold`/`align`, y el `ESC @` del cierre devuelve la impresora a
   * fábrica. Campo aditivo: una línea sin `spacing` produce exactamente los
   * mismos bytes que antes, así que los fixtures congelados no se mueven.
   */
  spacing?: number;
};

// Reemplazos de los caracteres no-ASCII más comunes. La térmica no recibe
// codepage, así que todo lo que pase de 0x7e sale como el símbolo que tenga
// cargado la impresora en su tabla — o sea, basura.
const ASCII_MAP: Record<string, string> = {
  "\u00a0": " ", // nbsp / espacio fino / narrow-nbsp (los mete el formato de hora)
  "\u202f": " ",
  "\u2009": " ",
  "\u2013": "-", // – — ‒ −
  "\u2014": "-",
  "\u2012": "-",
  "\u2212": "-",
  "\u201c": '"', // “ ” „ « »
  "\u201d": '"',
  "\u201e": '"',
  "\u00ab": '"',
  "\u00bb": '"',
  "\u2018": "'", // ‘ ’ ‚
  "\u2019": "'",
  "\u201a": "'",
  "\u2026": "...",
  "\u2022": "*", // •
  "\u00b7": "-", // ·
  "\u00b0": "o", // ° º ª
  "\u00ba": "o",
  "\u00aa": "a",
  "\u00bf": "", // ¿ ¡
  "\u00a1": "",
  "\u20ac": "EUR",
  "\u00d7": "x",
  "\u00df": "ss",
  "\u00c6": "AE",
  "\u00e6": "ae",
  "\u0152": "OE",
  "\u0153": "oe",
  "\u00d8": "O",
  "\u00f8": "o",
};

/**
 * Deja el texto en ASCII imprimible: traduce los símbolos del mapa, saca
 * tildes y diéresis vía NFD (Ñoquis → Noquis, Café → Cafe) y descarta
 * cualquier resto fuera de 0x20–0x7e (emoji, alfabetos no latinos).
 */
export function toAscii(text: string): string {
  return String(text)
    .replace(/[^\x20-\x7e]/g, (ch) => ASCII_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacríticos sueltos que dejó el NFD
    .replace(/[^\x20-\x7e]/g, "");
}

/**
 * Corta `text` por palabra a `cols` columnas. Una palabra más larga que el
 * ancho se parte a lo bruto (mejor cortada que desbordada). Devuelve al menos
 * una línea para no perder el renglón.
 */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = "";
  // Se traduce acá también (es idempotente con el `push`): algunos reemplazos
  // cambian el largo (… → ...), así que hay que contar los caracteres finales.
  for (const word of toAscii(text).split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > cols) {
      if (line) {
        out.push(line);
        line = "";
      }
      out.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!w) continue;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= cols) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Arma el ticket como líneas con formato (tamaño/negrita/alineación). */
export function buildTicketLines(c: TicketComanda): Line[] {
  const L: Line[] = [];
  // Todo el texto del ticket pasa por `toAscii`: la térmica solo imprime ASCII.
  const push = (text: string, opts: Omit<Line, "text"> = {}) =>
    L.push({ text: toAscii(text), ...opts });
  const pad = (n: number) => {
    for (let i = 0; i < n; i++) push("");
  };

  // Los avisos y el encabezado van en el tamaño más grande (doble alto Y doble
  // ancho, wrap a `COLS.xl`): son lo que la cocina lee de lejos, antes de
  // acercarse al papel. Los `***` se sacaron — a doble ancho no entran en el
  // renglón y el texto solo ya grita bastante.
  const banner = (text: string) => {
    for (const l of wrap(text, COLS.xl))
      push(l, { size: "xl", bold: true, align: "center" });
  };

  pad(TOP_MARGIN); // lo que el porta-comandas tapa (#289)

  // Lo PRIMERO del ticket, arriba incluso del sector: cuándo sale el plato
  // manda sobre qué plato es. El prefijo lo pone el sistema, así que siempre se
  // lee igual. En una comanda anulada no va: no hay nada que entregar.
  //
  // Spec 127 — la hora sale de `kitchen_time` y la nota baja un renglón. Cuando
  // no hay hora, la nota vuelve a ocupar el banner: es el pedido viejo, que
  // tiene su «21:30» escrito adentro del texto libre y seguiría necesitando
  // leerse de lejos.
  if (!c.cancelled && (c.kitchen_time || c.kitchen_notes)) {
    banner(`ENTREGAR ${c.kitchen_time ?? c.kitchen_notes}`);
    if (c.kitchen_time && c.kitchen_notes)
      for (const l of wrap(c.kitchen_notes, COLS.tall))
        push(l, { size: "tall", bold: true, align: "center" });
    push(RULE);
  }

  // Spec 049: comanda anulada → ticket ANULADA destacado para que cocina
  // descarte lo que ya tenía impreso.
  if (c.cancelled) {
    banner("ANULADA");
    push(RULE);
  } else if (c.reprint) {
    // Spec 35: reimpresión (por editar o reimprimir manual). Aviso a cocina de
    // que este ticket reemplaza a uno ya impreso, para que no prepare dos veces.
    banner("REIMPRESION");
    push("reemplaza al anterior", {
      size: "tall",
      bold: true,
      align: "center",
    });
    push(RULE);
  }

  // Sector / estación + destino: lo primero que lee la cocina, bien grande.
  banner(String(c.station_name).toUpperCase());
  // El destino manda: un pedido de delivery no tiene mesa (salía «MESA —») y la
  // cocina necesita ver de una que ese plato se lo lleva el repartidor, no un
  // mozo al salón. `dine_in` / ausente = comportamiento de siempre.
  // Los subtítulos van cortos a propósito: entran en un renglón de `COLS.tall`
  // (24 col). «pasa a buscarlo el cliente» son 26 y salía partido, con un «te»
  // suelto y centrado en doble alto.
  const subtitulo = (text: string) => {
    for (const l of wrap(text, COLS.tall))
      push(l, { size: "tall", bold: true, align: "center" });
  };
  if (c.delivery_type === "delivery") {
    banner("DELIVERY");
    subtitulo("lo lleva el repartidor");
  } else if (c.delivery_type === "pickup") {
    banner("RETIRA");
    subtitulo("lo retira el cliente");
  } else if (!c.table_label || c.table_label === "—" || c.table_label === "-") {
    // Venta de mostrador: se persiste `dine_in` SIN mesa (venta-mostrador.ts),
    // así que caía en el else y salía «MESA —».
    banner("MOSTRADOR");
  } else {
    banner(`MESA ${c.table_label}`);
  }

  // El número del pedido, en el mismo cuerpo grande que la mesa: es lo que la
  // cocina lee para armar el pedido. Un pedido se parte en una comanda por
  // sector (parrilla, fritera, postres) y las tres tienen que volver a
  // encontrarse en el pase; el `comanda_id` no sirve —es distinto en cada
  // sector— y salía como un código alfanumérico que en cocina no significaba
  // nada. Se reinicia en 1 cada jornada (`orders.daily_number`): un correlativo
  // que no se reinicia nunca termina en números largos, incómodos de cantar en
  // el pase. Va sin `#`: «PEDIDO 9999» entra justo en el renglón de doble ancho
  // (11 col) y con el `#` se partía en dos.
  if (c.daily_number != null) banner(`PEDIDO ${c.daily_number}`);
  push(`Tanda ${c.batch}`, { size: "tall", bold: true, align: "center" });
  // El mozo de la mesa (#325). Sólo en salón: delivery, retiro y mostrador no
  // tienen mozo. Va también en la anulada, que es cuando la cocina más necesita
  // saber a quién avisarle.
  const esDeMesa =
    c.delivery_type !== "delivery" &&
    c.delivery_type !== "pickup" &&
    Boolean(c.table_label) &&
    c.table_label !== "—" &&
    c.table_label !== "-";
  if (esDeMesa && c.mozo_name?.trim())
    push(`Mozo: ${c.mozo_name.trim()}`, {
      size: "tall",
      bold: true,
      align: "center",
    });

  // Metadata de referencia (no operativa): la más chica del ticket, pero igual
  // en doble alto — nada sale en cuerpo normal salvo las líneas separadoras.
  // El id de la comanda queda SOLO como fallback de un payload sin
  // `daily_number`: con el número de pedido arriba, el hash es ruido.
  if (c.daily_number == null)
    push(`Comanda #${String(c.comanda_id).slice(0, 8)}`, { size: "tall" });
  try {
    push(
      new Date(c.emitted_at).toLocaleString("es-AR", {
        timeZone: TIMEZONE,
        hour12: false, // 18:30, no "06:30": en el pase la hora se lee de un vistazo
      }),
      { size: "tall" },
    );
  } catch {
    /* fecha opcional */
  }
  if (c.cancelled && c.cancelled_reason)
    for (const l of wrap(`Motivo: ${c.cancelled_reason}`, COLS.tall))
      push(l, { size: "tall", bold: true });

  push(RULE);

  // La observación de la tanda (spec 128), entre el encabezado y los ítems:
  // es la instrucción CON LA QUE se lee la lista de abajo («va todo junto»,
  // «la mesa tiene apuro»), así que tiene que estar leída antes del primer
  // plato. En doble alto y negrita, no en el cuerpo `xl`: ese tamaño está
  // reservado para lo que cambia el momento de salida (ENTREGAR, ANULADA,
  // REIMPRESION) y se lee de lejos; ésta se lee con el ticket ya en la mano.
  // En una comanda anulada no va: no hay nada que preparar.
  if (c.comanda_notes && !c.cancelled) {
    for (const l of wrap(`OBS: ${c.comanda_notes}`, COLS.tall))
      push(l, { size: "tall", bold: true });
    push(RULE);
  }

  pad(EDGE_PADDING); // aire entre la línea y el primer ítem

  // Ítems: el corazón de la comanda. Doble alto Y doble ancho, con un renglón
  // en blanco entre ítem e ítem — la cocina los lee de lejos y de un vistazo,
  // así que se prioriza legibilidad sobre ahorro de papel.
  const items = c.items ?? [];
  items.forEach((it, i) => {
    if (i > 0) push(""); // padding entre ítems
    const prefix = c.cancelled ? "ANULADO " : "";
    // De qué menú viene el plato (spec 145). Va ARRIBA del nombre porque
    // cambia CÓMO se lee lo que sigue —«Milanesa» del ejecutivo no es la
    // milanesa de la carta—, igual que la observación de la tanda se puso
    // antes de los ítems. Abajo, pegado a los modificadores, se leería como un
    // ingrediente más. En `tall` y no en `xl`: el cuerpo grande está reservado
    // para lo que cambia el momento de salida (ENTREGAR, ANULADA, REIMPRESION)
    // y dos renglones en doble ancho seguidos compiten entre sí.
    if (it.combo_name)
      for (const l of wrap(it.combo_name.toUpperCase(), COLS.tall))
        push(l, { size: "tall", bold: true });
    for (const l of wrap(
      `${prefix}${it.quantity}x ${it.product_name}`,
      COLS.xl,
    ))
      push(l, { size: "xl", bold: true });
    if (it.modifiers && it.modifiers.length)
      for (const l of wrap(`+ ${it.modifiers.join(", ")}`, COLS.tall))
        push(l, { size: "tall" });
    if (it.notes)
      for (const l of wrap(`obs: ${it.notes}`, COLS.tall))
        push(l, { size: "tall", bold: true });
  });
  if (items.length === 0) banner("(sin items)");

  // ── Con qué combina ──────────────────────────────────────────────────────
  // Los items del mismo pedido que salen de otros sectores. Es referencia, no
  // trabajo de este sector: va en `tall` (no `xl`) y con sangría, para que no
  // compita con la lista de arriba. En una comanda anulada no se imprime — no
  // hay nada que coordinar.
  const otros = (c.otros_sectores ?? []).filter((s) => s.items.length > 0);
  if (otros.length > 0 && !c.cancelled) {
    pad(1);
    push(RULE);
    push("COMBINA CON", { size: "tall", bold: true, align: "center" });
    for (const sector of otros) {
      for (const l of wrap(
        String(sector.station_name).toUpperCase(),
        COLS.tall,
      ))
        push(l, { size: "tall", bold: true });
      for (const it of sector.items)
        // La marca del menú también acá (spec 145, D5): sin esto la guarnición
        // del ejecutivo aparece tres renglones más abajo como si fuera un plato
        // suelto de otra mesa. Entre paréntesis y no arriba: es una lista de
        // referencia, y el renglón ya viene sangrado con `-`.
        for (const l of wrap(
          `- ${it.quantity}x ${it.product_name}${it.combo_name ? ` (${it.combo_name})` : ""}`,
          COLS.tall,
        ))
          push(l, { size: "tall" });
    }
  }

  pad(EDGE_PADDING); // aire entre el último ítem y el corte (o la línea del pie)

  if (c.cancelled) {
    push(RULE);
    banner("NO PREPARAR");
  }
  return L;
}

/**
 * Comandos ESC/POS de código QR (`GS ( k`, funciones 165/167/169/180/181).
 *
 * Los soportan las térmicas modernas; una vieja sin soporte **ignora la
 * secuencia** y sale sin QR en vez de escupir basura — por eso es seguro
 * mandarlo, pero hay que verificarlo contra la impresora real antes de dar por
 * bueno un comprobante fiscal.
 *
 * `pL`/`pH` son el largo del payload en little-endian: para almacenar datos, es
 * `len + 3` (los 3 bytes de `cn fn m` que van antes del contenido).
 */
function escPosQr(data: string, moduleSize = 6): string {
  const gsK = (payload: string) => {
    const len = payload.length;
    return (
      GS +
      "(k" +
      String.fromCharCode(len & 0xff) +
      String.fromCharCode((len >> 8) & 0xff) +
      payload
    );
  };
  // fn 165: modelo 2 (el estándar). fn 167: tamaño de módulo (1–16 px).
  // fn 169: corrección de errores — nivel M (49), que aguanta un ticket algo
  // manchado sin agrandar el QR de más. fn 180: cargar datos. fn 181: imprimir.
  return (
    gsK("1A2\x00") +
    gsK("1C" + String.fromCharCode(moduleSize)) +
    gsK("1E1") +
    gsK("1P0" + data) +
    gsK("1Q0")
  );
}

/** Renderiza las líneas como ESC/POS para térmica de red (producción). */
/**
 * Perfil tipográfico del documento. `comanda` es el de siempre —Font A con
 * espaciado lateral, para leer de lejos—; `cierre` es Font B sin espaciado, que
 * es como imprime el papel del cierre (42 col).
 */
export type Perfil = "comanda" | "cierre";

export function renderEscPos(
  lines: Line[],
  perfil: Perfil = "comanda",
): string {
  const condensada = perfil === "cierre";
  let out = ESC + "@"; // init (resetea tamaño, énfasis, interlineado y espaciado)
  out += ESC + "3" + String.fromCharCode(LINE_SPACING); // interlineado espaciado
  // ESC M 1 — Font B. Sólo se emite en condensada **a propósito**: el `ESC @`
  // de arriba ya deja la impresora en Font A, así que mandarlo también para la
  // comanda serían dos bytes que no cambian nada — y los fixtures de paridad
  // byte-a-byte con el agente están congelados justamente para cazar eso.
  if (condensada) out += ESC + "M" + "\x01";
  // En condensada el espaciado extra se va a cero: con 4 pt más por carácter
  // las 42 columnas no entran.
  out += ESC + " " + String.fromCharCode(condensada ? 0 : CHAR_RIGHT_SPACING);
  let align: Align | null = null;
  let size: Size | null = null;
  let bold: boolean | null = null;
  let spacing: number = LINE_SPACING;
  for (const ln of lines) {
    const a: Align = ln.align ?? "left";
    const s: Size = ln.size ?? "sm";
    const b = ln.bold ?? false;
    const sp = ln.spacing ?? LINE_SPACING;
    if (sp !== spacing) {
      out += ESC + "3" + String.fromCharCode(sp);
      spacing = sp;
    }
    if (a !== align) {
      out +=
        ESC + "a" + (a === "center" ? "\x01" : a === "right" ? "\x02" : "\x00");
      align = a;
    }
    if (s !== size) {
      out += GS + "!" + CHAR_SIZE[s];
      size = s;
    }
    if (b !== bold) {
      out += ESC + "E" + (b ? "\x01" : "\x00");
      bold = b;
    }
    if (ln.qr) {
      // El QR respeta la alineación ya seteada arriba (va centrado).
      out += escPosQr(ln.qr) + "\n";
      continue;
    }
    out += (ln.text ?? "") + "\n";
  }
  // Reset de estilo + avance + corte parcial.
  out += GS + "!" + "\x00" + ESC + "E" + "\x00" + ESC + "a" + "\x00";
  out += "\n\n\n" + GS + "V" + "\x00";
  // Init final: DEJAR LA IMPRESORA COMO ESTABA. `ESC 3` (interlineado) y
  // `ESC SP` (espaciado lateral) son estados que quedan pegados en la comandera
  // después del corte, así que el siguiente que imprima los hereda. En golf la
  // misma comandera la comparte MaxiRest, que no manda `ESC @` al empezar: sus
  // tickets salían con nuestro interlineado y nuestro ancho. Con esto, cada job
  // devuelve la impresora a fábrica al terminar.
  out += ESC + "@";
  return out;
}

/**
 * Renderiza las líneas como texto plano (transporte windows / dry-run). Un QR
 * cae a su contenido legible: en texto plano no hay forma de dibujarlo, y
 * perder la URL sería perder el dato.
 */
export function renderPlain(lines: Line[]): string {
  return (
    lines.map((ln) => (ln.qr ? ln.qr : (ln.text ?? ""))).join("\r\n") +
    "\r\n\r\n"
  );
}

/**
 * SEGURIDAD: este módulo asume que los campos de texto (station_name, notes,
 * product_name, etc.) ya vienen **saneados** de bytes de control por el caller
 * (el `GET /api/print-agent` los pasa por `sanitizeTicketText`, security review
 * #8). Acá se agregan los códigos ESC/POS de confianza; no se re-sanea.
 *
 * Contenido pre-renderizado que el server manda al agente relay (spec 051, D1):
 * - `escpos_b64`: los bytes ESC/POS (los mismos que `renderEscPos`) en base64
 *   desde `latin1`, para viajar en JSON. El relay hace `Buffer.from(b64,'base64')`
 *   y los escribe al socket tal cual.
 * - `plain`: el texto de `renderPlain` para el transporte windows / dry-run.
 */
export function buildComandaContent(c: TicketComanda): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildTicketLines(c);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
