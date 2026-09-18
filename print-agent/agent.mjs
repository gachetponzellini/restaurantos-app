// ─────────────────────────────────────────────────────────────────────────
// Print agent de referencia (spec 28). Loop: pull → imprimir → confirmar.
//
//   GET  /api/print-agent?business_id=…   (Bearer PRINT_AGENT_KEY)
//        → es también el latido de salud (spec 183 · D1): un request por vuelta,
//          con la versión del agente en `x-agent-version`. Si no hay nada para
//          imprimir, el server RETIENE la respuesta hasta ~25 s y contesta
//          apenas aparece algo (D5): el loop se pacea solo, sin tocar pollMs.
//   por cada comanda `pendiente` → imprimir el ticket
//   POST /api/print-agent { comanda_id }  → pendiente → en_preparacion
//
// Dos transportes (config.transport):
//   "network" → socket TCP a printer_ip:printer_port con ESC/POS. Es el flujo
//               de PRODUCCIÓN on-site (comandera térmica de red). Usa la IP que
//               viene en cada comanda (spec 28) → cero mapeo local.
//   "windows" → imprime por el driver de Windows (Out-Printer) a config.printerName.
//               Para PROBAR con una impresora USB / no-térmica (ej. HP LaserJet).
//               En este modo la printer_ip de la comanda no se usa.
//
// Destino local (spec 181): un trabajo cuya printer_ip es `local:NOMBRE` es una
// térmica USB enchufada a ESTA compu. Se imprime en cualquier transporte,
// mandando los bytes ESC/POS crudos al spooler de Windows (datatype RAW) a la
// impresora de ese nombre — con el driver «Genérico / Solo texto». El server
// sólo se lo sirve al agente que lo lista en su alcance.
//
// Flags:
//   --once         una sola pasada (sin loop)
//   --dry-run      no imprime ni confirma; muestra el ticket en consola
//   --no-confirm   imprime pero NO hace el POST (no cambia el estado)
//   --limit=N      imprime como máximo N comandas en esta corrida
//
// Correr:  node print-agent/agent.mjs --once --dry-run
// ─────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Con Node: config.json está al lado de este archivo. Empaquetado con pkg (.exe),
// __dirname apunta al snapshot virtual, así que el config.json por-negocio (que
// vive AL LADO del .exe, spec 046) se lee desde la carpeta del ejecutable.
const cfgDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, "config.json"), "utf8"));

/**
 * Versión de este agente (issue #278). Fecha del release, no semver: lo que se
 * necesita saber en el local es "¿el .exe que corre acá es más nuevo que el
 * cambio que estoy buscando?", y una fecha se compara sin tabla de traducción.
 *
 * SUBIRLA al empaquetar un .exe nuevo. Si no se sube, el panel va a decir que
 * el local corre una versión que no corre — peor que no mostrar nada.
 */
const AGENT_VERSION = "2026-09-18.2";

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const DRY = args.includes("--dry-run");
const NO_CONFIRM = args.includes("--no-confirm");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.slice("--limit=".length), 10) : Infinity;

const base = String(cfg.serverUrl).replace(/\/$/, "");
const authHeaders = { authorization: `Bearer ${cfg.printAgentKey}` };

// Tras fallar la impresión de una comanda se avisa al local (spec 33). El
// server deduplica igual (comandas.print_failed_at), pero la gracia evita
// avisar por un blip de red de la comandera.
//
// Spec 183 · D5: la gracia se mide en TIEMPO, no en vueltas del loop. Antes era
// `FAIL_THRESHOLD = 5` intentos, o sea ≈ pollMs × 5: con el poll en 1 s eran 5
// segundos, pero con golf en 10 s pasaron a ser 50 — cincuenta segundos para
// avisar que una comanda no salió, con la cocina esperándola. Y la cadencia
// ahora la decide el server (next_poll_ms), así que atar el aviso al poll es
// atarlo a algo que ya no controla el local.
//
// Dos condiciones, las dos necesarias: que haya reintentado al menos una vez
// (un solo fallo puede ser el blip) y que hayan pasado 10 s desde el primero.
const FAIL_GRACE_MS = 10_000;
const FAIL_MIN_INTENTOS = 2;
const failState = new Map(); // comanda_id → { intentos, desde, avisado }

// ── Formato del ticket (FALLBACK) ─────────────────────────────────────────
// Spec 051: el render primario vive en el server (`src/lib/print/ticket.ts`,
// portado 1:1 de acá) y llega pre-renderizado en el pull. Estas funciones
// quedan SOLO como fallback si el server no manda contenido (server viejo,
// rollback o error). Mantener en paridad con el módulo del server.
// El ticket se arma como una lista de líneas con atributos de tamaño/énfasis y
// se renderiza según el transporte:
//   • red (térmica ESC/POS) → renderEscPos: letra grande, ancha y espaciada.
//   • windows / dry-run     → renderPlain: texto monoespaciado plano.
const ESC = "\x1b";
const GS = "\x1d";

// Tamaño de carácter (GS ! n): nibble alto = ancho, nibble bajo = alto.
//   sm   → normal          tall → doble alto (0x01)
//   xl   → doble alto Y doble ancho (0x11), reservado para los ítems.
const CHAR_SIZE = { sm: "\x00", tall: "\x01", xl: "\x11" };

// Ancho útil en columnas por tamaño (58mm ≈ 384 pt). Celda Font A = 12 pt +
// CHAR_RIGHT_SPACING → 16 pt ⇒ 24 col; en doble ancho se duplica (32 pt) ⇒ 12
// col, usamos 11 para dejar margen. Sirve para cortar por palabra.
const COLS = { sm: 24, tall: 24, xl: 11 };

// Espaciado lateral por carácter (ESC SP n, en puntos). Ensancha el texto sin
// duplicarlo: celda Font A ≈ 12pt, así que 4 ≈ +33% de ancho. Subir/bajar acá.
// Ojo: agranda el ancho de línea → RULE se acortó a 24 col para no desbordar.
const CHAR_RIGHT_SPACING = 4;

// Interlineado (ESC 3 n, en puntos). Más alto = comanda más espaciada y evita
// que las líneas de doble alto se pisen. Ajustar acá si queda muy junto/suelto.
const LINE_SPACING = 64;

const RULE = "------------------------"; // 24 col (≈ ancho útil 58mm con el espaciado)

// Renglones en blanco arriba y abajo del bloque de ítems (entre ítem e ítem va
// uno solo). Despega la lista de la línea separadora y del corte del papel.
const EDGE_PADDING = 3;

// Renglones en blanco arriba de todo (#289): el porta-comandas de la cocina
// tapa los primeros ~3 cm del papel, y ahí quedaba el «ENTREGAR».
const TOP_MARGIN = 3;

// Reemplazos de los caracteres no-ASCII más comunes. La térmica no recibe
// codepage, así que todo lo que pase de 0x7e sale como el símbolo que tenga
// cargado la impresora en su tabla — o sea, basura.
const ASCII_MAP = {
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

/** Deja el texto en ASCII imprimible (Ñoquis → Noquis, Café → Cafe). */
function toAscii(text) {
  return String(text)
    .replace(/[^\x20-\x7e]/g, (ch) => ASCII_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacríticos sueltos que dejó el NFD
    .replace(/[^\x20-\x7e]/g, "");
}

/** Corta `text` por palabra a `cols` columnas (palabra más larga → corte duro). */
function wrap(text, cols) {
  const out = [];
  let line = "";
  // Idempotente con el `push`; algunos reemplazos cambian el largo (… → ...),
  // así que se cuentan los caracteres finales.
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
function ticketLines(c) {
  const L = [];
  // Todo el texto del ticket pasa por `toAscii`: la térmica solo imprime ASCII.
  const push = (text, opts = {}) => L.push({ text: toAscii(text), ...opts });
  const pad = (n) => {
    for (let i = 0; i < n; i++) push("");
  };

  // Avisos y encabezado en el tamaño más grande (doble alto + doble ancho,
  // wrap a COLS.xl): es lo que la cocina lee de lejos. Sin los `***`: a doble
  // ancho no entran en el renglón.
  const banner = (text) => {
    for (const l of wrap(text, COLS.xl)) push(l, { size: "xl", bold: true, align: "center" });
  };

  pad(TOP_MARGIN); // lo que el porta-comandas tapa (#289)

  // Lo PRIMERO del ticket, arriba incluso del sector: cuándo sale el plato
  // manda sobre qué plato es. En una comanda anulada no va.
  if (c.kitchen_notes && !c.cancelled) {
    banner(`ENTREGAR ${c.kitchen_notes}`);
    push(RULE);
  }

  // Spec 049: comanda anulada → ticket ANULADA destacado para que cocina
  // descarte lo que ya tenía impreso. Campo aditivo: un agente viejo no recibe
  // `c.cancelled` y reimprime el ticket normal (degradación aceptable).
  if (c.cancelled) {
    banner("ANULADA");
    push(RULE);
  } else if (c.reprint) {
    // Spec 35: reimpresión (por editar o por reimprimir manual). Aviso a cocina
    // de que este ticket reemplaza a uno que ya tenía impreso, para que no
    // prepare dos veces. En la anulada no va: su propio ticket ya lo comunica.
    banner("REIMPRESION");
    push("reemplaza al anterior", { size: "tall", bold: true, align: "center" });
    push(RULE);
  }

  // Sector / estación + destino: lo primero que lee la cocina, bien grande.
  banner(String(c.station_name).toUpperCase());
  // Delivery / retiro no tienen mesa (salía «MESA —»): la cocina ve de una que
  // ese plato se lo lleva el repartidor. `dine_in` / ausente = el de siempre.
  // Los subtítulos van cortos: entran en un renglón de COLS.tall (24 col).
  const subtitulo = (text) => {
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
    // Venta de mostrador: `dine_in` sin mesa → salía «MESA —».
    banner("MOSTRADOR");
  } else {
    banner(`MESA ${c.table_label}`);
  }

  // El número del pedido, en el mismo cuerpo grande que la mesa: es lo que la
  // cocina lee para armar el pedido (un pedido se parte en una comanda por
  // sector y las tres tienen que reencontrarse en el pase). Es el número del
  // día: arranca en 1 cada jornada. Sin `#`: «PEDIDO 9999» entra justo en el
  // renglón de doble ancho.
  if (c.daily_number != null) banner(`PEDIDO ${c.daily_number}`);
  push(`Tanda ${c.batch}`, { size: "tall", bold: true, align: "center" });
  // El mozo de la mesa (#325) — espejo de src/lib/print/ticket.ts.
  const esDeMesa =
    c.delivery_type !== "delivery" &&
    c.delivery_type !== "pickup" &&
    Boolean(c.table_label) &&
    c.table_label !== "—" &&
    c.table_label !== "-";
  if (esDeMesa && c.mozo_name && String(c.mozo_name).trim())
    push(`Mozo: ${String(c.mozo_name).trim()}`, {
      size: "tall",
      bold: true,
      align: "center",
    });

  // Metadata de referencia: lo más chico del ticket, pero igual en doble alto
  // (nada sale en cuerpo normal salvo las líneas separadoras). El id de la
  // comanda queda SOLO como fallback de un payload sin `daily_number`.
  if (c.daily_number == null)
    push(`Comanda #${String(c.comanda_id).slice(0, 8)}`, { size: "tall" });
  try {
    // `hour12: false`: 18:30 y no "06:30" (paridad con `src/lib/print/ticket.ts`).
    push(new Date(c.emitted_at).toLocaleString("es-AR", { hour12: false }), {
      size: "tall",
    });
  } catch {
    /* fecha opcional */
  }
  if (c.cancelled && c.cancelled_reason)
    for (const l of wrap(`Motivo: ${c.cancelled_reason}`, COLS.tall))
      push(l, { size: "tall", bold: true });

  push(RULE);
  pad(EDGE_PADDING); // aire entre la línea y el primer ítem

  // Ítems: el corazón de la comanda. Doble alto Y doble ancho, con un renglón
  // en blanco entre ítem e ítem — se lee de lejos, se prioriza legibilidad.
  const items = c.items ?? [];
  items.forEach((it, i) => {
    if (i > 0) push(""); // padding entre ítems
    const prefix = c.cancelled ? "ANULADO " : "";
    // De qué menú viene el plato (spec 145): arriba del nombre, porque cambia
    // cómo se lee lo que sigue. En `tall`, para no competir con el plato.
    if (it.combo_name)
      for (const l of wrap(it.combo_name.toUpperCase(), COLS.tall))
        push(l, { size: "tall", bold: true });
    for (const l of wrap(`${prefix}${it.quantity}x ${it.product_name}`, COLS.xl))
      push(l, { size: "xl", bold: true });
    if (it.modifiers && it.modifiers.length)
      for (const l of wrap(`+ ${it.modifiers.join(", ")}`, COLS.tall)) push(l, { size: "tall" });
    if (it.notes)
      for (const l of wrap(`obs: ${it.notes}`, COLS.tall)) push(l, { size: "tall", bold: true });
  });
  if (items.length === 0) banner("(sin items)");

  // Con qué combina: lo del MISMO pedido que sale de otros sectores. Referencia,
  // no trabajo de este sector → `tall`, no `xl`. En una anulada no va.
  const otros = (c.otros_sectores ?? []).filter((s) => s.items.length > 0);
  if (otros.length > 0 && !c.cancelled) {
    pad(1);
    push(RULE);
    push("COMBINA CON", { size: "tall", bold: true, align: "center" });
    for (const sector of otros) {
      for (const l of wrap(String(sector.station_name).toUpperCase(), COLS.tall))
        push(l, { size: "tall", bold: true });
      for (const it of sector.items)
        // También acá (spec 145, D5): si no, la guarnición del menú aparece
        // como un plato suelto de otra mesa.
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

/** Renderiza las líneas como ESC/POS para térmica de red (producción). */
function renderEscPos(lines) {
  let out = ESC + "@"; // init (resetea tamaño, énfasis, interlineado y espaciado)
  out += ESC + "3" + String.fromCharCode(LINE_SPACING); // interlineado espaciado
  out += ESC + " " + String.fromCharCode(CHAR_RIGHT_SPACING); // ancho extra (ESC SP)
  let align = null;
  let size = null;
  let bold = null;
  for (const ln of lines) {
    const a = ln.align ?? "left";
    const s = ln.size ?? "sm";
    const b = ln.bold ?? false;
    if (a !== align) {
      out += ESC + "a" + (a === "center" ? "\x01" : a === "right" ? "\x02" : "\x00");
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
    out += (ln.text ?? "") + "\n";
  }
  // Reset de estilo + avance + corte parcial.
  out += GS + "!" + "\x00" + ESC + "E" + "\x00" + ESC + "a" + "\x00";
  out += "\n\n\n" + GS + "V" + "\x00";
  // Init final: dejar la impresora como estaba. `ESC 3` (interlineado) y
  // `ESC SP` (espaciado lateral) quedan pegados después del corte y los hereda
  // el que imprima después — en golf, MaxiRest, que no manda `ESC @` al
  // empezar. Sus tickets salían con nuestro interlineado y nuestro ancho.
  out += ESC + "@";
  return out;
}

/** Renderiza las líneas como texto plano (windows / dry-run). */
function renderPlain(lines) {
  return lines.map((ln) => ln.text ?? "").join("\r\n") + "\r\n\r\n";
}

/** Imprime por el driver de Windows (GDI) a una impresora instalada. */
function printWindows(text, printerName) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(
      os.tmpdir(),
      `comanda-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`,
    );
    fs.writeFileSync(tmp, text, "utf8");
    const safeName = String(printerName).replace(/'/g, "''");
    const cmd = `Get-Content -Encoding UTF8 -Path '${tmp}' | Out-Printer -Name '${safeName}'`;
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { windowsHide: true },
    );
    let err = "";
    ps.stderr.on("data", (d) => (err += d));
    ps.on("error", reject);
    ps.on("exit", (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best-effort */
      }
      code === 0
        ? resolve()
        : reject(new Error(`powershell exit ${code}: ${err.trim()}`));
    });
  });
}

const LOCAL_PREFIX = "local:";

/**
 * Manda bytes ESC/POS crudos al spooler de Windows (spec 181 · D5).
 *
 * `Out-Printer` pasa por GDI y «dibuja» texto: sirve para una láser de prueba,
 * no para una térmica. Acá se abre la impresora por nombre y se escribe el
 * buffer con datatype RAW (OpenPrinter / StartDocPrinter / WritePrinter): con
 * el driver «Genérico / Solo texto» la impresora recibe los mismos bytes que
 * recibiría por el socket 9100.
 *
 * ⚠️ Sin probar en el fierro al momento de escribirse (se prueba por
 * TeamViewer con la térmica enchufada). Dos cosas que ahí fallan seguido: un
 * driver propietario que «interpreta» los bytes en vez de pasarlos, y un
 * puerto USB que cambia de nombre al reconectar.
 */
function printWindowsRaw(payload, printerName) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(
      os.tmpdir(),
      `ticket-${Date.now()}-${Math.floor(Math.random() * 1e6)}.bin`,
    );
    fs.writeFileSync(tmp, Buffer.from(payload, "latin1"));
    const safeName = String(printerName).replace(/'/g, "''");
    const safeTmp = tmp.replace(/'/g, "''");
    // El helper clásico de RAW printing, vía Add-Type: no hay módulo nativo
    // que empaquetar en el .exe (spec 046) ni dependencia nueva.
    const cmd = `
$src = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendFile(string printer, string file) {
    byte[] bytes = File.ReadAllBytes(file);
    IntPtr h; DOCINFOA di = new DOCINFOA(); di.pDocName = "RestaurantOS"; di.pDataType = "RAW";
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    bool ok = false;
    if (StartDocPrinter(h, 1, di)) { if (StartPagePrinter(h)) { IntPtr p = Marshal.AllocCoTaskMem(bytes.Length); Marshal.Copy(bytes, 0, p, bytes.Length); int w; ok = WritePrinter(h, p, bytes.Length, out w) && w == bytes.Length; Marshal.FreeCoTaskMem(p); EndPagePrinter(h); } EndDocPrinter(h); }
    ClosePrinter(h); return ok;
  }
}
"@
Add-Type -TypeDefinition $src
if (-not [RawPrinter]::SendFile('${safeName}', '${safeTmp}')) { Write-Error "WritePrinter fallo para '${safeName}'"; exit 2 }
`;
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { windowsHide: true },
    );
    let err = "";
    ps.stderr.on("data", (d) => (err += d));
    ps.on("error", reject);
    ps.on("exit", (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best-effort */
      }
      code === 0
        ? resolve()
        : reject(new Error(`powershell exit ${code}: ${err.trim()}`));
    });
  });
}

/** Envía un payload ESC/POS ya armado a una térmica de red por socket TCP. */
function printNetwork(payload, ip, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: port || 9100 }, () => {
      socket.write(Buffer.from(payload, "latin1"), () => socket.end());
    });
    socket.setTimeout(5000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timeout TCP"));
    });
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

// ═════════════════════════════════════════════════════════════════════════
// Spec 206 — el agente habla con SUPABASE, no con Vercel.
//
//   aviso:   Realtime (websocket) en el canal privado `print-agent:<negocio>`.
//            La base avisa al toque cuando aparece algo para imprimir.
//   pedir:   POST <supabase>/functions/v1/print-agent/pull   (Edge Function)
//   confirmar: POST …/print-agent/ack
//   sesión:  POST …/print-agent/session  → credenciales de Realtime
//
// La Edge Function corre en `us-east-1` (header `x-region`), pegada a la base:
// sin eso Supabase la corre en São Paulo y cada query cruza el continente.
//
// Red de seguridad, en este orden (D4):
//   con canal     → un pull por aviso + uno cada 30 s (latido)
//   sin canal     → pull a la Edge Function cada 5 s
//   sin función   → el loop de la 183 contra Vercel (`serverUrl`), igual que
//                   siempre. Se vuelve a probar la función cada tanto, así que
//                   cuando se publique el server el agente se pasa SOLO, sin
//                   tocar la PC del local.
// ═════════════════════════════════════════════════════════════════════════

/** Proyecto de producción. La publishable key es pública por diseño (va en el
 *  navegador de cualquier cliente); lo que autentica al agente es su key. */
const SUPABASE_PROD_URL = "https://tjfufswzsxfujcpoxapx.supabase.co";
const SUPABASE_PROD_PUBLISHABLE_KEY = "sb_publishable_jIllwnCCBgFoYXlO3lsZ7g_B_21nUmM";

const esLocalhost = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
// `supabaseUrl: null` en el config apaga el modo Supabase a propósito.
const supabaseUrl =
  cfg.supabaseUrl === null
    ? null
    : String(cfg.supabaseUrl ?? (esLocalhost ? "" : SUPABASE_PROD_URL)).replace(/\/$/, "") || null;
const publishableKey =
  cfg.publishableKey ?? (esLocalhost ? null : SUPABASE_PROD_PUBLISHABLE_KEY);
const fnBase = supabaseUrl ? `${supabaseUrl}/functions/v1/print-agent` : null;
const fnHeaders = {
  ...authHeaders,
  "x-agent-version": AGENT_VERSION,
  "x-region": "us-east-1",
  ...(publishableKey ? { apikey: publishableKey } : {}),
};

const LATIDO_CON_CANAL_MS = 30_000;
const POLL_SIN_CANAL_MS = 5_000;
/** Tras un 404 (función no publicada) no se insiste: se reprueba cada 10 min. */
const REPROBAR_SIN_FUNCION_MS = 10 * 60_000;
/** Tras un error de red o 5xx de la función, se reprueba al minuto. */
const REPROBAR_FUNCION_CAIDA_MS = 60_000;

/**
 * ¿Hay que usar la Edge Function en esta vuelta? Pura, para testearla.
 * `hasta` es el instante hasta el cual la función se da por no disponible.
 */
function usarFuncion({ hayFuncion, hasta, ahora }) {
  if (!hayFuncion) return false;
  return !(hasta && ahora < hasta);
}

/** Cuánto no reprobar la función según cómo falló. */
function penalidadFuncion(status) {
  return status === 404 ? REPROBAR_SIN_FUNCION_MS : REPROBAR_FUNCION_CAIDA_MS;
}

/** Backoff de reconexión del websocket: 1 s, 2 s, 4 s … techo 30 s. */
function backoffMs(intento) {
  return Math.min(1000 * 2 ** Math.max(0, intento), 30_000);
}

/** Cuándo refrescar el token: 5 min antes de que venza, nunca en menos de 30 s. */
function refrescarEnMs(expiresAtSeg, ahoraMs) {
  return Math.max(expiresAtSeg * 1000 - ahoraMs - 5 * 60_000, 30_000);
}

class FuncionNoDisponible extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

let funcionHasta = 0; // hasta cuándo la Edge Function se da por caída

function funcionDisponible() {
  return usarFuncion({
    hayFuncion: Boolean(fnBase) && !DRY_SIN_FUNCION,
    hasta: funcionHasta,
    ahora: Date.now(),
  });
}
// `--vercel` fuerza el camino viejo (para comparar o para salir del paso).
const DRY_SIN_FUNCION = args.includes("--vercel");

async function llamarFuncion(ruta, body) {
  let res;
  try {
    res = await fetch(`${fnBase}/${ruta}`, {
      method: "POST",
      headers: { ...fnHeaders, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    throw new FuncionNoDisponible(0, `función ${ruta}: ${e.message}`);
  }
  if (res.status === 401) {
    // Key mala: no es la función la que está caída, pero tampoco hay nada
    // que hacer contra ella. Se cae a Vercel, que va a contestar lo mismo y
    // el panel lo va a mostrar.
    throw new FuncionNoDisponible(401, `función ${ruta}: 401`);
  }
  if (res.status === 404 || res.status >= 500) {
    throw new FuncionNoDisponible(res.status, `función ${ruta}: ${res.status}`);
  }
  if (!res.ok) throw new Error(`función ${ruta}: ${res.status}`);
  return res.json();
}

function marcarFuncionCaida(e) {
  funcionHasta = Date.now() + penalidadFuncion(e.status);
  const min = Math.round(penalidadFuncion(e.status) / 60_000);
  console.error(`⚠ ${e.message} → sigo por Vercel; reintento en ${min} min`);
  canal.cerrar();
}

/**
 * Pull de trabajos contra Vercel (el camino de la 183). Es TAMBIÉN el latido
 * de salud (spec 183 · D1): el server lo registra como efecto de esta misma
 * llamada, con la versión que va en `x-agent-version`.
 *
 * `--once` pide `wait_ms=0`: sin eso el server retiene la respuesta hasta 25 s
 * cuando no hay nada (D5) y una corrida manual parecería colgada. `--dry-run`
 * pide `beat=0`: probar desde una máquina de desarrollo no tiene que hacer que
 * el panel del local diga «conectado».
 */
async function fetchComandasVercel() {
  const q = new URLSearchParams({ business_id: String(cfg.businessId) });
  if (ONCE) q.set("wait_ms", "0");
  if (DRY) q.set("beat", "0");
  const res = await fetch(`${base}/api/print-agent?${q}`, {
    headers: { ...authHeaders, "x-agent-version": AGENT_VERSION },
  });
  if (!res.ok) throw new Error(`GET ${res.status} ${res.statusText}`);
  const data = await res.json();
  return {
    comandas: data.comandas ?? [],
    // La cadencia la decide el server (spec 183 · D2). Si no viene —server
    // viejo, rollback— se usa el `pollMs` del config.
    nextPollMs: sanearPollMs(data.next_poll_ms),
  };
}

/** Pull contra la Edge Function (spec 206). Sin retención: contesta al toque. */
async function fetchComandasFuncion() {
  const data = await llamarFuncion("pull", {
    business_id: cfg.businessId,
    beat: !DRY,
  });
  return { comandas: data.comandas ?? [], nextPollMs: null };
}

/**
 * Acota lo que manda el server antes de dormirlo. No es desconfianza del
 * server: es que este `.exe` se actualiza a mano y va a seguir corriendo
 * contra deploys que todavía no existen.
 */
function sanearPollMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(Math.trunc(n), 500), 60_000);
}

/**
 * Reporta: `result:"ok"` confirma (→ en_preparacion / impreso) o
 * `result:"failed"` avisa el fallo de impresión (spec 33). Por la función si
 * está disponible; si no, por Vercel.
 */
async function report(comandaId, result, error) {
  const body = {
    comanda_id: comandaId,
    business_id: cfg.businessId,
    result,
    error,
  };
  // Un `failed` va siempre por Vercel: ahí vive el aviso al encargado (y su
  // WhatsApp), que no se portó a la función (spec 206 · D2). Es raro: sólo
  // cuando una impresión falla pasada la gracia.
  if (result === "ok" && funcionDisponible()) {
    try {
      await llamarFuncion("ack", body);
      return true;
    } catch (e) {
      if (e instanceof FuncionNoDisponible) marcarFuncionCaida(e);
      else return false;
    }
  }
  const res = await fetch(`${base}/api/print-agent`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/**
 * Imprime un papel. Devuelve la promesa de su confirmación SIN esperarla
 * (spec 206 · D5): el próximo papel no espera el viaje del acuse. El orden de
 * impresión se respeta igual — se imprime de a uno.
 */
async function printOne(c) {
  // Spec 051: el server pre-renderiza el ticket (`content_escpos_b64` +
  // `content_plain`). El agente es un relay: imprime lo que recibe. Si NO viene
  // contenido (server viejo, rollback o error de render), cae al render local.
  const escpos = c.content_escpos_b64
    ? Buffer.from(c.content_escpos_b64, "base64").toString("latin1")
    : renderEscPos(ticketLines(c));
  const plain = c.content_plain ?? renderPlain(ticketLines(c));

  if (DRY) {
    console.log("\n" + plain);
    return null;
  }
  if (c.printer_enabled === false) {
    console.log(`  ⏭  ${c.station_name}: comandera desactivada`);
    return null;
  }

  // Si falla, NO se confirma → queda `pendiente` y se reintenta; tras el
  // umbral, se avisa al local (spec 33).
  try {
    const destino = String(c.printer_ip ?? "");
    if (destino.toLowerCase().startsWith(LOCAL_PREFIX)) {
      // Spec 181 — la USB de esta compu, por nombre.
      await printWindowsRaw(escpos, destino.slice(LOCAL_PREFIX.length).trim());
    } else if (cfg.transport === "network") {
      if (!c.printer_ip) {
        console.log(`  ⏭  ${c.station_name}: sin printer_ip, se saltea`);
        return null;
      }
      await printNetwork(escpos, c.printer_ip, c.printer_port);
    } else {
      await printWindows(plain, cfg.printerName);
    }
  } catch (e) {
    const st = failState.get(c.comanda_id) ?? {
      intentos: 0,
      desde: Date.now(),
      avisado: false,
    };
    st.intentos += 1;
    failState.set(c.comanda_id, st);
    const seg = Math.round((Date.now() - st.desde) / 1000);
    console.error(
      `  ✗ no imprimió #${String(c.comanda_id).slice(0, 8)} (${c.station_name}): ${e.message} [intento ${st.intentos}, ${seg}s]`,
    );
    if (
      !st.avisado &&
      st.intentos >= FAIL_MIN_INTENTOS &&
      Date.now() - st.desde >= FAIL_GRACE_MS
    ) {
      st.avisado = true;
      const ok = await report(c.comanda_id, "failed", e.message);
      console.error(
        `     ${ok ? "⚠ avisado al local (notificación de fallo)" : "✗ no se pudo avisar"}`,
      );
    }
    return null;
  }

  failState.delete(c.comanda_id);
  console.log(
    `  🖨  impresa #${String(c.comanda_id).slice(0, 8)} · ${c.station_name} · ${c.table_label}`,
  );
  if (NO_CONFIRM) return null;
  return report(c.comanda_id, "ok")
    .then((ok) => {
      if (!ok) console.log(`     ✗ no se pudo confirmar #${String(c.comanda_id).slice(0, 8)}`);
    })
    .catch((e) => console.error(`     ✗ confirmación: ${e.message}`));
}

/** Imprime un lote en orden; las confirmaciones corren detrás (D5). */
async function imprimirLote(comandas) {
  const pend = comandas.length;
  if (pend === 0) return;
  const toPrint = comandas.slice(0, LIMIT);
  console.log(
    `· ${pend} pendiente(s)${LIMIT < Infinity ? `, imprimo ${toPrint.length}` : ""}`,
  );
  const acuses = [];
  for (const c of toPrint) {
    try {
      const a = await printOne(c);
      if (a) acuses.push(a);
    } catch (e) {
      console.error(
        `  ✗ error imprimiendo ${String(c.comanda_id).slice(0, 8)}: ${e.message}`,
      );
    }
  }
  // Antes del próximo pull: si no, el mismo papel volvería a venir pendiente.
  await Promise.allSettled(acuses);
}

/**
 * Una vuelta. Por la función si está disponible; si no, por Vercel. Devuelve
 * el sleep que pidió Vercel (`next_poll_ms`) o `null`.
 */
async function tick() {
  if (funcionDisponible()) {
    try {
      const { comandas } = await fetchComandasFuncion();
      if (comandas.length === 0) console.log("· sin comandas pendientes");
      await imprimirLote(comandas);
      return null;
    } catch (e) {
      if (!(e instanceof FuncionNoDisponible)) throw e;
      marcarFuncionCaida(e);
    }
  }
  const { comandas, nextPollMs } = await fetchComandasVercel();
  if (comandas.length === 0) console.log("· sin comandas pendientes (Vercel)");
  await imprimirLote(comandas);
  return nextPollMs;
}

// ── Realtime: cliente mínimo sobre el WebSocket nativo de Node 22 ─────────
// Protocolo Phoenix (vsn 1.0.0) de Supabase Realtime: phx_join al canal
// privado con el access_token, heartbeat cada 25 s y `access_token` cuando se
// refresca. Sin dependencias: el .exe sigue siendo un solo archivo.

let despertar = () => {};
let sucio = false;
function avisoDeTrabajo() {
  sucio = true;
  despertar();
}

const canal = {
  ws: null,
  vivo: false,
  intento: 0,
  sesion: null, // { access_token, refresh_token, expires_at, topic, realtime_url }
  hb: null,
  refresco: null,
  reconexion: null,
  ref: 0,

  disponible() {
    return typeof globalThis.WebSocket === "function";
  },

  async abrir() {
    if (this.ws || this.reconexion || !this.disponible() || !funcionDisponible()) return;
    try {
      if (!this.sesion) this.sesion = await llamarFuncion("session", { business_id: cfg.businessId });
    } catch (e) {
      if (e instanceof FuncionNoDisponible && e.status !== 401) marcarFuncionCaida(e);
      else console.error(`⚠ sin sesión de Realtime: ${e.message}`);
      this.programarReconexion();
      return;
    }
    const s = this.sesion;
    // La URL sale de NUESTRA `supabaseUrl`, no de la que diga la función: adentro
    // de Supabase la función se ve a sí misma por una red interna.
    const url = `${supabaseUrl.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(publishableKey ?? "")}&vsn=1.0.0`;
    const topic = `realtime:${s.topic}`;
    let ws;
    try {
      ws = new globalThis.WebSocket(url);
    } catch (e) {
      console.error(`⚠ websocket: ${e.message}`);
      this.programarReconexion();
      return;
    }
    this.ws = ws;
    const send = (m) => {
      try {
        ws.send(JSON.stringify(m));
      } catch {
        /* se va a cerrar y reconectar */
      }
    };
    this.enviar = send;
    ws.onopen = () => {
      const ref = String(++this.ref);
      send({
        topic,
        event: "phx_join",
        payload: {
          config: { broadcast: { ack: false, self: false }, presence: { key: "" }, private: true },
          access_token: s.access_token,
        },
        ref,
        join_ref: ref,
      });
      this.hb = setInterval(
        () => send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++this.ref) }),
        25_000,
      );
    };
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (m.topic !== topic) return;
      if (m.event === "phx_reply" && m.payload?.status === "ok" && !this.vivo) {
        this.vivo = true;
        this.intento = 0;
        console.log("⚡ escuchando avisos (Realtime)");
        this.programarRefresco();
        avisoDeTrabajo(); // al (re)conectar: lo que se emitió mientras tanto
      } else if (m.event === "phx_reply" && m.payload?.status === "error") {
        console.error(`⚠ Realtime rechazó el canal: ${JSON.stringify(m.payload?.response ?? {})}`);
        this.sesion = null; // token vencido o revocado: pedir otra sesión
        ws.close();
      } else if (m.event === "broadcast") {
        avisoDeTrabajo();
      } else if (m.event === "phx_error" || m.event === "phx_close") {
        ws.close();
      }
    };
    ws.onclose = () => this.alCerrar();
    ws.onerror = () => {
      /* onclose viene detrás */
    };
  },

  alCerrar() {
    const estabaVivo = this.vivo;
    clearInterval(this.hb);
    clearTimeout(this.refresco);
    this.ws = null;
    this.vivo = false;
    if (estabaVivo) console.error("⚠ se cortó Realtime → pull cada 5 s mientras reconecto");
    else if (this.intento % 5 === 0)
      console.error(`⚠ no pude conectar a Realtime (intento ${this.intento + 1}) → pull cada 5 s`);
    this.programarReconexion();
    despertar();
  },

  programarReconexion() {
    if (this.reconexion) return;
    const ms = backoffMs(this.intento++);
    this.reconexion = setTimeout(() => {
      this.reconexion = null;
      this.abrir();
    }, ms);
  },

  programarRefresco() {
    clearTimeout(this.refresco);
    const s = this.sesion;
    if (!s?.expires_at) return;
    this.refresco = setTimeout(() => this.refrescar(), refrescarEnMs(s.expires_at, Date.now()));
  },

  async refrescar() {
    const s = this.sesion;
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: publishableKey ?? "", "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      const t = await res.json();
      s.access_token = t.access_token;
      s.refresh_token = t.refresh_token;
      s.expires_at = t.expires_at ?? Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600);
      this.enviar?.({
        topic: `realtime:${s.topic}`,
        event: "access_token",
        payload: { access_token: s.access_token },
        ref: String(++this.ref),
      });
      this.programarRefresco();
    } catch (e) {
      console.error(`⚠ no pude refrescar la sesión (${e.message}) → pido otra`);
      this.sesion = null;
      this.ws?.close();
    }
  },

  cerrar() {
    clearTimeout(this.reconexion);
    this.reconexion = null;
    this.ws?.close();
  },
};

function dormirODespertar(ms) {
  return new Promise((r) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      despertar = () => {};
      r();
    }
    despertar = done;
  });
}

console.log(
  `print-agent ${AGENT_VERSION} → ${fnBase ? `Supabase (${supabaseUrl}), ` : ""}Vercel (${base}) · negocio ${String(cfg.businessId).slice(0, 8)} · transporte ${cfg.transport}` +
    (cfg.transport === "windows" ? ` (${cfg.printerName})` : ""),
);
if (DRY) console.log("modo DRY-RUN: no imprime ni confirma\n");

if (ONCE) {
  try {
    await tick();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
  // Salida natural: NO usar process.exit(). Forzar el exit con los sockets del
  // fetch todavía cerrándose crashea libuv en Windows (Assertion async.c:94).
} else {
  console.log("loop — Ctrl+C para cortar\n");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let dormir;
    sucio = false;
    try {
      const pidioVercel = await tick();
      if (funcionDisponible()) {
        canal.abrir();
        // Un aviso que llegó con el pull en vuelo: otra vuelta ya.
        dormir = sucio ? 0 : canal.vivo ? LATIDO_CON_CANAL_MS : POLL_SIN_CANAL_MS;
      } else {
        dormir = pidioVercel ?? cfg.pollMs;
      }
    } catch (e) {
      console.error(`✗ ${e.message}`);
      dormir = cfg.pollMs;
    }
    if (dormir > 0) await dormirODespertar(dormir);
  }
}
