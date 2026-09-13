import { describe, expect, it } from "vitest";

import { alcanzaLaImpresora, normalizarScope } from "./agent-scope";

// Spec 124 — el alcance de un print-agent es la lista de IPs/rangos que puede
// tocar. Un negocio con dos agentes en LANs distintas los separa acá: el filtro
// corre sobre el `printer_ip` que cada trabajo ya trae resuelto, así que cubre
// comandas, control, cuenta y factura con la misma regla.
//
// Los dos defaults son deliberados y van en la misma dirección: **ante la duda,
// se sirve el trabajo**. Un agente que imprime de más hace ruido; uno que
// imprime de menos deja al local sin papel en medio del servicio.

describe("alcanzaLaImpresora", () => {
  it("sin scope, alcanza todo (es el negocio de un solo agente)", () => {
    expect(alcanzaLaImpresora(null, "192.168.100.213")).toBe(true);
    expect(alcanzaLaImpresora(undefined, "10.0.0.5")).toBe(true);
  });

  it("scope vacío también alcanza todo, no nada", () => {
    // Un `[]` sólo puede llegar acá por un bug de la UI o una config a medio
    // hacer. Leerlo como "este agente no alcanza ninguna impresora" apagaría el
    // local en silencio; leerlo como "sin restricción" lo deja como estaba.
    expect(alcanzaLaImpresora([], "192.168.100.213")).toBe(true);
  });

  it("una IP suelta matchea exacto y nada más", () => {
    const scope = ["192.168.100.213"];
    expect(alcanzaLaImpresora(scope, "192.168.100.213")).toBe(true);
    expect(alcanzaLaImpresora(scope, "192.168.100.214")).toBe(false);
    expect(alcanzaLaImpresora(scope, "192.168.1.213")).toBe(false);
  });

  it("un /24 matchea su subred (el caso real de golf)", () => {
    // Golf tiene las cinco comanderas en 192.168.100.210-214; la segunda caja
    // vive en otra LAN.
    const golf = ["192.168.100.0/24"];
    expect(alcanzaLaImpresora(golf, "192.168.100.210")).toBe(true);
    expect(alcanzaLaImpresora(golf, "192.168.100.214")).toBe(true);
    expect(alcanzaLaImpresora(golf, "192.168.1.50")).toBe(false);
    expect(alcanzaLaImpresora(golf, "10.0.0.5")).toBe(false);
  });

  it("varias entradas: alcanza si matchea alguna", () => {
    const scope = ["192.168.100.0/24", "10.20.0.7"];
    expect(alcanzaLaImpresora(scope, "192.168.100.211")).toBe(true);
    expect(alcanzaLaImpresora(scope, "10.20.0.7")).toBe(true);
    expect(alcanzaLaImpresora(scope, "10.20.0.8")).toBe(false);
  });

  it("/32 es una IP sola y /0 es todo", () => {
    expect(alcanzaLaImpresora(["192.168.100.213/32"], "192.168.100.213")).toBe(
      true,
    );
    expect(alcanzaLaImpresora(["192.168.100.213/32"], "192.168.100.214")).toBe(
      false,
    );
    expect(alcanzaLaImpresora(["0.0.0.0/0"], "8.8.8.8")).toBe(true);
  });

  it("prefijos que no caen en el byte: /20 y /28", () => {
    // 10.1.16.0/20 → 10.1.16.0 – 10.1.31.255
    expect(alcanzaLaImpresora(["10.1.16.0/20"], "10.1.16.1")).toBe(true);
    expect(alcanzaLaImpresora(["10.1.16.0/20"], "10.1.31.255")).toBe(true);
    expect(alcanzaLaImpresora(["10.1.16.0/20"], "10.1.32.0")).toBe(false);
    // 192.168.5.16/28 → .16 – .31
    expect(alcanzaLaImpresora(["192.168.5.16/28"], "192.168.5.31")).toBe(true);
    expect(alcanzaLaImpresora(["192.168.5.16/28"], "192.168.5.32")).toBe(false);
  });

  it("el rango se normaliza: da igual si la base no es la de red", () => {
    // 192.168.100.213/24 es, en los hechos, 192.168.100.0/24. Escribirlo así es
    // lo que va a hacer cualquiera que copie la IP de una comandera y le agregue
    // el prefijo.
    expect(alcanzaLaImpresora(["192.168.100.213/24"], "192.168.100.7")).toBe(
      true,
    );
  });

  it("un trabajo sin impresora resoluble se le sirve a todos", () => {
    // Hoy esos trabajos se sirven igual y el agente los saltea («sin printer_ip,
    // se saltea»). Filtrarlos acá los haría desaparecer del pull sin que nadie
    // los vea, que es peor: quedarían pendientes y mudos.
    expect(alcanzaLaImpresora(["192.168.100.0/24"], null)).toBe(true);
    expect(alcanzaLaImpresora(["192.168.100.0/24"], undefined)).toBe(true);
    expect(alcanzaLaImpresora(["192.168.100.0/24"], "   ")).toBe(true);
  });

  it("tolera espacios alrededor", () => {
    expect(
      alcanzaLaImpresora([" 192.168.100.0/24 "], " 192.168.100.210 "),
    ).toBe(true);
  });

  it("una entrada basura no matchea, pero no rompe ni contamina al resto", () => {
    // El filtro corre en el camino caliente del pull: una config mal cargada
    // tiene que degradar, nunca tirar una excepción que deje al local sin papel.
    expect(alcanzaLaImpresora(["no-es-una-ip"], "192.168.100.210")).toBe(false);
    expect(alcanzaLaImpresora(["999.1.1.1"], "192.168.100.1")).toBe(false);
    expect(alcanzaLaImpresora(["192.168.100.0/33"], "192.168.100.1")).toBe(
      false,
    );
    expect(alcanzaLaImpresora(["192.168.100.0/-1"], "192.168.100.1")).toBe(
      false,
    );
    expect(alcanzaLaImpresora(["192.168.1"], "192.168.1.1")).toBe(false);
    expect(
      alcanzaLaImpresora(["basura", "192.168.100.0/24"], "192.168.100.210"),
    ).toBe(true);
  });

  it("un destino que no es IPv4 se le sirve a todos", () => {
    // `isValidPrinterHost` (src/lib/catalog/schemas.ts) acepta hostnames, y una
    // comandera cargada como "comandera-cocina.local" no se puede ubicar en una
    // subred desde acá: sólo el agente, que resuelve el nombre en su LAN, sabe
    // dónde está. Descartarla la dejaría huérfana sin una sola traza, que es el
    // modo de fallar más caro que tiene este filtro.
    expect(
      alcanzaLaImpresora(["192.168.100.0/24"], "comandera-cocina.local"),
    ).toBe(true);
    expect(alcanzaLaImpresora(["192.168.100.0/24"], "192.168.100")).toBe(true);
    expect(alcanzaLaImpresora(["0.0.0.0/0"], "no-es-una-ip")).toBe(true);
  });

  it("IPv6 tampoco se descarta, y no rompe", () => {
    expect(alcanzaLaImpresora(["0.0.0.0/0"], "::1")).toBe(true);
    expect(alcanzaLaImpresora(["::1"], "::1")).toBe(true);
  });
});

describe("normalizarScope", () => {
  it("parte por coma o salto de línea y limpia", () => {
    expect(normalizarScope("192.168.100.0/24, 10.0.0.7\n\n 10.0.0.8 ")).toEqual([
      "192.168.100.0/24",
      "10.0.0.7",
      "10.0.0.8",
    ]);
  });

  it("vacío es null (sin restricción), no lista vacía", () => {
    expect(normalizarScope("")).toBeNull();
    expect(normalizarScope("   \n , , ")).toBeNull();
    expect(normalizarScope(null)).toBeNull();
  });

  it("deduplica sin reordenar", () => {
    expect(normalizarScope("10.0.0.7, 192.168.1.0/24, 10.0.0.7")).toEqual([
      "10.0.0.7",
      "192.168.1.0/24",
    ]);
  });

  it("acepta una lista ya armada", () => {
    expect(normalizarScope([" 10.0.0.7 ", ""])).toEqual(["10.0.0.7"]);
  });

  it("rechaza lo que no es IP ni rango", () => {
    expect(() => normalizarScope("192.168.100.0/24, no-es-una-ip")).toThrow(
      /no-es-una-ip/,
    );
    expect(() => normalizarScope("999.1.1.1")).toThrow();
    expect(() => normalizarScope("192.168.100.0/33")).toThrow();
  });
});

// ── Spec 181 · D3 — destinos locales ─────────────────────────────────────
//
// Una impresora USB es un nombre para el spooler de UNA compu. Un `local:`
// sólo lo alcanza el agente que lo lista textual: servirlo «a todos» (la regla
// para hostnames) mandaría el control de la Terminal 2 al agente de cocina,
// que reportaría `failed` y marcaría fallido un papel que la terminal sacó
// perfecto — el bug que la 124 vino a cerrar.
describe("alcanzaLaImpresora · destinos locales (spec 181)", () => {
  it("un `local:` lo alcanza sólo el agente que lo lista", () => {
    expect(alcanzaLaImpresora(["local:CONTROL-T1"], "local:CONTROL-T1")).toBe(true);
    expect(alcanzaLaImpresora(["local:CONTROL-T2"], "local:CONTROL-T1")).toBe(false);
  });

  it("el agente de cocina, con alcance por IP, NO recibe un `local:`", () => {
    expect(alcanzaLaImpresora(["192.168.10.0/24"], "local:CONTROL-T1")).toBe(false);
  });

  it("un agente sin alcance tampoco: «sin restricción» es «todas las IPs», no «todas las USB del mundo»", () => {
    expect(alcanzaLaImpresora(null, "local:CONTROL-T1")).toBe(false);
    expect(alcanzaLaImpresora([], "local:CONTROL-T1")).toBe(false);
  });

  it("el agente de la terminal, con alcance `local:`, NO recibe las comandas de la LAN", () => {
    expect(alcanzaLaImpresora(["local:CONTROL-T1"], "192.168.10.212")).toBe(false);
  });

  it("el nombre se compara sin distinguir mayúsculas: Windows tampoco", () => {
    expect(alcanzaLaImpresora(["local:control-t1"], "local:CONTROL-T1")).toBe(true);
  });

  it("normalizarScope acepta `local:` junto con IPs y rangos", () => {
    expect(normalizarScope("local:CONTROL-T1, 192.168.10.0/24")).toEqual([
      "local:CONTROL-T1",
      "192.168.10.0/24",
    ]);
    expect(() => normalizarScope("local:")).toThrow();
  });
});
