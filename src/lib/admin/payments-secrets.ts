/**
 * Qué se escribe al guardar Ajustes → Cobros (issue #113 · 1).
 *
 * Los secretos de Mercado Pago (`mp_access_token`, `mp_webhook_secret`) son de
 * **sólo escritura**: el server nunca los manda al browser, el input arranca
 * vacío y un valor vacío significa «no lo toques». Sólo se escriben cuando
 * viene uno nuevo. Mismo patrón que la API key del gateway ARCA.
 *
 * La `mp_public_key` es pública (viaja al checkout) y se guarda siempre.
 */
export type PaymentsValues = {
  mp_access_token: string | null;
  mp_public_key: string | null;
  mp_webhook_secret: string | null;
  mp_accepts_payments: boolean;
};

export type PaymentsUpdate = {
  mp_public_key: string | null;
  mp_accepts_payments: boolean;
  mp_access_token?: string;
  mp_webhook_secret?: string;
};

export function planPaymentsUpdate(
  values: PaymentsValues,
  current: { hasAccessToken: boolean },
): { ok: true; update: PaymentsUpdate } | { ok: false; error: string } {
  const tieneToken = Boolean(values.mp_access_token) || current.hasAccessToken;

  // Sin estas dos no se pueden crear preferencias ni conciliar el pago. El
  // webhook secret es opcional.
  if (values.mp_accepts_payments && (!tieneToken || !values.mp_public_key)) {
    return {
      ok: false,
      error: "Para activar Mercado Pago necesitás cargar Access Token y Public Key.",
    };
  }

  const update: PaymentsUpdate = {
    mp_public_key: values.mp_public_key,
    mp_accepts_payments: values.mp_accepts_payments,
  };
  if (values.mp_access_token) update.mp_access_token = values.mp_access_token;
  if (values.mp_webhook_secret) update.mp_webhook_secret = values.mp_webhook_secret;
  return { ok: true, update };
}
