import { buildAgentConfig } from "./credentials";
import { beforeEach, describe, expect, it, vi } from "vitest";

// listPrintAgentCredentials (spec 046, ampliado en la 124) resuelve las keys de
// print-agent de un negocio. Desde la 124 son N por negocio (golf: una PC por
// caja, en LANs distintas), así que devuelve la LISTA: el `.maybeSingle()` que
// tenía antes rompía con dos filas (PGRST116 + data null → negocio sin agentes,
// o sea los dos agentes autenticando 401).
// Mockeamos el service client (query-builder thenable, como en route.test.ts).

type Fila = {
  id: string;
  api_key: string;
  label: string | null;
  printer_scope: string[] | null;
};

let filas: Fila[] | null;
let errorQuery: { message: string } | null;
let capturado: { tablas: string[]; eqs: [string, unknown][] };

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (tabla: string) => {
      capturado.tablas.push(tabla);
      return {
        select: () => {
          const b = {
            eq: (col: string, val: unknown) => {
              capturado.eqs.push([col, val]);
              return b;
            },
            then: (
              resolve: (v: {
                data: Fila[] | null;
                error: { message: string } | null;
              }) => unknown,
            ) => resolve({ data: filas, error: errorQuery }),
          };
          return b;
        },
      };
    },
  }),
}));

const { listPrintAgentCredentials } = await import("./credentials");

const FILA_SALON: Fila = {
  id: "agente-salon",
  api_key: "pak_live_AAA",
  label: "Caja principal",
  printer_scope: ["192.168.100.0/24"],
};
const FILA_BAR: Fila = {
  id: "agente-bar",
  api_key: "pak_live_BBB",
  label: "Caja bar",
  printer_scope: ["192.168.200.0/24"],
};

beforeEach(() => {
  filas = [];
  errorQuery = null;
  capturado = { tablas: [], eqs: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listPrintAgentCredentials (spec 046 + 124)", () => {
  it("un negocio con UNA credencial devuelve ese agente", async () => {
    // El caso de siempre: un solo print-agent, `printer_scope` null = alcanza
    // todas las impresoras. Tiene que quedar idéntico a antes de la 124.
    filas = [{ ...FILA_SALON, label: null, printer_scope: null }];

    expect(await listPrintAgentCredentials("biz1")).toEqual([
      {
        id: "agente-salon",
        apiKey: "pak_live_AAA",
        label: null,
        printerScope: null,
      },
    ]);
  });

  it("un negocio con DOS credenciales devuelve LAS DOS, con su alcance cada una", async () => {
    // Esto es lo que la 124 habilita y lo que el `.maybeSingle()` viejo rompía:
    // con dos filas devolvía data null, así que el negocio quedaba sin ninguna
    // key válida y los dos agentes se caían a 401 a la vez.
    filas = [FILA_SALON, FILA_BAR];

    expect(await listPrintAgentCredentials("biz1")).toEqual([
      {
        id: "agente-salon",
        apiKey: "pak_live_AAA",
        label: "Caja principal",
        printerScope: ["192.168.100.0/24"],
      },
      {
        id: "agente-bar",
        apiKey: "pak_live_BBB",
        label: "Caja bar",
        printerScope: ["192.168.200.0/24"],
      },
    ]);
  });

  it("negocio sin credenciales → [] (nadie autentica contra él)", async () => {
    filas = [];
    expect(await listPrintAgentCredentials("biz-sin-agentes")).toEqual([]);
  });

  it("un error de query devuelve [] y NO tira", async () => {
    // Corre en el camino de auth del pull, una vez por segundo: una excepción
    // acá tumba la request entera. Un error de query es "no autenticado" (401 y
    // el agente reintenta), no un 500.
    filas = null;
    errorQuery = { message: "connection reset" };

    await expect(listPrintAgentCredentials("biz1")).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("mapea snake_case → camelCase (api_key → apiKey, printer_scope → printerScope)", async () => {
    // El resto del contrato del agente consume `apiKey`/`printerScope`; si el
    // mapeo se cae, `autenticarAgente` compara contra undefined y
    // `alcanzaLaImpresora` recibe undefined (= sin restricción) sin fallar
    // ruidosamente en ningún lado.
    filas = [FILA_SALON];

    const [agente] = await listPrintAgentCredentials("biz1");
    expect(agente.apiKey).toBe("pak_live_AAA");
    expect(agente.printerScope).toEqual(["192.168.100.0/24"]);
    expect(agente).not.toHaveProperty("api_key");
    expect(agente).not.toHaveProperty("printer_scope");
  });

  it("filtra por business_id — una key nunca se resuelve contra otro negocio", async () => {
    filas = [FILA_SALON];

    await listPrintAgentCredentials("biz1");

    expect(capturado.tablas).toEqual(["print_agent_credentials"]);
    expect(capturado.eqs).toEqual([["business_id", "biz1"]]);
  });
});

// ── buildAgentConfig (spec 183 · D3) ──────────────────────────────────────
// El `config.json` que baja el panel es el ÚNICO lugar donde se decide cada
// cuánto pregunta un agente: el `.exe` lo lee al arrancar y no tiene default
// propio. Por eso se testea el valor y no sólo la forma — que alguien lo
// devuelva a 1000 tiene que romper un test, no aparecer en la factura tres
// semanas después.
describe("buildAgentConfig", () => {
  const args = {
    serverUrl: "https://restaurant.mithandir.com",
    apiKey: "pak_test",
    businessId: "b-1",
  };

  it("pollea cada 3s, no cada 1s", () => {
    expect(buildAgentConfig(args).pollMs).toBe(3000);
  });

  it("arma el resto del contrato que espera el .exe", () => {
    expect(buildAgentConfig(args)).toEqual({
      serverUrl: "https://restaurant.mithandir.com",
      printAgentKey: "pak_test",
      businessId: "b-1",
      transport: "network",
      pollMs: 3000,
    });
  });
});
