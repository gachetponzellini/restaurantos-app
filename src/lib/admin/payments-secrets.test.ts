// Issue #113 · 1 — los secretos de Mercado Pago son de sólo escritura.
//
// El `mp_access_token` (y el `mp_webhook_secret`) viajaban al browser como
// valor inicial del form de Ajustes → Cobros. Ahora el server manda sólo si
// están cargados, el input arranca vacío y **guardar con el campo vacío deja el
// secreto como estaba** (mismo patrón que la API key del gateway ARCA).
import { describe, expect, it } from "vitest";

import { planPaymentsUpdate } from "./payments-secrets";

const base = {
  mp_access_token: null,
  mp_public_key: "APP_USR-public",
  mp_webhook_secret: null,
  mp_accepts_payments: true,
};

describe("planPaymentsUpdate", () => {
  it("campo vacío con token ya cargado: no lo pisa", () => {
    const r = planPaymentsUpdate(base, { hasAccessToken: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.update).not.toHaveProperty("mp_access_token");
    expect(r.update).not.toHaveProperty("mp_webhook_secret");
    expect(r.update).toMatchObject({
      mp_public_key: "APP_USR-public",
      mp_accepts_payments: true,
    });
  });

  it("un token nuevo sí se guarda", () => {
    const r = planPaymentsUpdate(
      { ...base, mp_access_token: "APP_USR-nuevo", mp_webhook_secret: "whsec" },
      { hasAccessToken: true },
    );
    expect(r.ok && r.update).toMatchObject({
      mp_access_token: "APP_USR-nuevo",
      mp_webhook_secret: "whsec",
    });
  });

  it("activar MP sin token cargado ni nuevo: error", () => {
    const r = planPaymentsUpdate(base, { hasAccessToken: false });
    expect(r.ok).toBe(false);
  });

  it("activar MP sin public key: error, aunque el token esté cargado", () => {
    const r = planPaymentsUpdate(
      { ...base, mp_public_key: null },
      { hasAccessToken: true },
    );
    expect(r.ok).toBe(false);
  });

  it("MP apagado se guarda aunque falten claves", () => {
    const r = planPaymentsUpdate(
      { ...base, mp_public_key: null, mp_accepts_payments: false },
      { hasAccessToken: false },
    );
    expect(r.ok).toBe(true);
  });
});
