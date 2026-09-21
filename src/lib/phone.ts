/**
 * Normalización de teléfonos — identidad del cliente.
 *
 * `customers` se identifica por `UNIQUE (business_id, phone)`. El teléfono llega
 * tipeado a mano desde 3 caminos (checkout, walk-in de mozo/encargado y alta por
 * reserva), así que sin normalizar el mismo número en dos formatos crea dos
 * clientes y rompe el vínculo con la cuenta (`customers.user_id`). Issue #114.
 *
 * Es digits-only, no E.164: no inferimos país. Pasar a E.164 (con
 * libphonenumber) es un paso posterior — ver la nota en `admin/customers-query`.
 */

/**
 * Digits-only. Lo que no parece un teléfono colapsa a "" — el chatbot usa ese ""
 * para pedirle el número al usuario en vez de asumir uno.
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  // Mínimo para que strings sueltos con un par de dígitos no pasen por teléfono.
  if (digits.length < 6) return "";
  return digits;
}

/**
 * Clave de identidad para `customers.phone`.
 *
 * Igual que `normalizePhone`, pero nunca descarta contenido: si el valor no
 * tiene dígitos suficientes conserva lo tipeado (la columna es NOT NULL y no
 * queremos que un teléfono raro rompa el alta del cliente).
 */
export function customerPhoneKey(raw: string | null | undefined): string {
  return normalizePhone(raw) || (raw ?? "").trim();
}

/**
 * ¿Son el mismo teléfono? Compara el número nacional argentino: los últimos
 * 10 dígitos (auditoría de reservas · media). El WhatsApp llega con 549
 * (5493511234567) y en la web se tipea «351 1234567» o «0351 …»: comparar
 * todos los dígitos hacía que el bot no encontrara las reservas hechas por la
 * web. Con menos de 10 dígitos se compara exacto; vacío nunca matchea.
 */
export function mismoTelefono(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const da = normalizePhone(a);
  const db = normalizePhone(b);
  if (!da || !db) return false;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da === db;
}
