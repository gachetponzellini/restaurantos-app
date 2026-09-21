import { afterEach, describe, expect, it, vi } from "vitest";

// Controla el resultado de `.limit()` por prefijo de limitador.
const successByPrefix: Record<string, boolean> = {};

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(_opts: unknown) {}
  },
}));

vi.mock("@upstash/ratelimit", () => {
  class FakeRatelimit {
    prefix: string;
    constructor(opts: { prefix: string }) {
      this.prefix = opts.prefix;
    }
    static slidingWindow() {
      return { kind: "sliding" };
    }
    async limit(_key: string) {
      return { success: successByPrefix[this.prefix] ?? true };
    }
  }
  return { Ratelimit: FakeRatelimit };
});

// Carga fresca del módulo con/sin Upstash configurado (los limitadores son
// singletons de módulo; reseteamos para controlar el env por test).
async function load(opts: { upstash: boolean }) {
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", opts.upstash ? "http://redis" : "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", opts.upstash ? "tok" : "");
  return import("./rate-limit");
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of Object.keys(successByPrefix)) delete successByPrefix[k];
});

describe("limitChatbotTurn", () => {
  it("sin Upstash configurado → degradación elegante (deja pasar)", async () => {
    const { limitChatbotTurn } = await load({ upstash: false });
    expect(await limitChatbotTurn("b1", "5491100000000")).toEqual({
      success: true,
    });
  });

  it("contacto excede su límite por minuto → rechaza el turno", async () => {
    successByPrefix["pedidos:chatbot:contact"] = false;
    successByPrefix["pedidos:chatbot:business"] = true;
    const { limitChatbotTurn } = await load({ upstash: true });
    expect((await limitChatbotTurn("b1", "5491100000000")).success).toBe(false);
  });

  it("negocio excede el techo horario → rechaza aunque el contacto esté ok", async () => {
    successByPrefix["pedidos:chatbot:contact"] = true;
    successByPrefix["pedidos:chatbot:business"] = false;
    const { limitChatbotTurn } = await load({ upstash: true });
    expect((await limitChatbotTurn("b1", "5491100000000")).success).toBe(false);
  });

  it("ambos niveles ok → permite el turno", async () => {
    successByPrefix["pedidos:chatbot:contact"] = true;
    successByPrefix["pedidos:chatbot:business"] = true;
    const { limitChatbotTurn } = await load({ upstash: true });
    expect((await limitChatbotTurn("b1", "5491100000000")).success).toBe(true);
  });
});

// SPEC 25 (PENDING) — tests del limitador de verificación por WhatsApp,
// desactivados junto con `limitPhoneVerificationSend`. Reactivar al rehabilitar
// la feature.
//
// describe("limitPhoneVerificationSend", () => {
//   it("sin Upstash configurado → degradación elegante (deja pasar)", async () => {
//     const { limitPhoneVerificationSend } = await load({ upstash: false });
//     expect(await limitPhoneVerificationSend("user-1")).toEqual({
//       success: true,
//     });
//   });
//
//   it("cooldown excedido → no envía aunque el techo horario esté ok", async () => {
//     successByPrefix["pedidos:phoneverify:cooldown"] = false;
//     successByPrefix["pedidos:phoneverify:hour"] = true;
//     const { limitPhoneVerificationSend } = await load({ upstash: true });
//     expect((await limitPhoneVerificationSend("user-1")).success).toBe(false);
//   });
//
//   it("techo horario excedido → no envía aunque pase el cooldown", async () => {
//     successByPrefix["pedidos:phoneverify:cooldown"] = true;
//     successByPrefix["pedidos:phoneverify:hour"] = false;
//     const { limitPhoneVerificationSend } = await load({ upstash: true });
//     expect((await limitPhoneVerificationSend("user-1")).success).toBe(false);
//   });
//
//   it("ambos niveles ok → permite el envío", async () => {
//     successByPrefix["pedidos:phoneverify:cooldown"] = true;
//     successByPrefix["pedidos:phoneverify:hour"] = true;
//     const { limitPhoneVerificationSend } = await load({ upstash: true });
//     expect((await limitPhoneVerificationSend("user-1")).success).toBe(true);
//   });
// });

// Issue #79 — sin Upstash, en producción no hay techo en pedidos, chatbot,
// login por PIN ni fichaje. Sigue dejando pasar (cerrarlo bloquearía la
// operación), pero no en silencio: un error visible en los logs, una sola vez.
describe("sin Upstash en producción (#79)", () => {
  it("avisa una sola vez en los logs y sigue dejando pasar", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "production");
    const { limitLogin, limitCreateOrder } = await load({ upstash: false });

    expect(await limitLogin("1.2.3.4")).toEqual({ success: true });
    expect(await limitCreateOrder("1.2.3.4")).toEqual({ success: true });

    const avisos = error.mock.calls.filter((c) => String(c[0]).includes("RATE LIMIT DESACTIVADO"));
    expect(avisos).toHaveLength(1);
    error.mockRestore();
  });

  it("fuera de producción no hace ruido", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "");
    const { limitLogin } = await load({ upstash: false });
    await limitLogin("1.2.3.4");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("limitCreateReservation (auditoría de reservas)", () => {
  it("sin Upstash deja pasar", async () => {
    const { limitCreateReservation } = await load({ upstash: false });
    expect(await limitCreateReservation("1.2.3.4")).toEqual({ success: true });
  });

  it("con el techo alcanzado, rechaza", async () => {
    successByPrefix["pedidos:reservas:create"] = false;
    const { limitCreateReservation } = await load({ upstash: true });
    expect(await limitCreateReservation("1.2.3.4")).toEqual({ success: false });
  });
});
