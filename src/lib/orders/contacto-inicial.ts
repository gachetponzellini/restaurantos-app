/**
 * Nombre, teléfono y email con los que arranca el checkout (H-19 · QA #382).
 *
 * Orden: la ficha del último pedido del cliente → los datos de la cuenta
 * (`user_metadata`, que es donde el alta guarda nombre y teléfono) → vacío.
 *
 * Se descartan los strings vacíos o en blanco, no sólo null/undefined: Supabase
 * devuelve `user.phone === ""` cuando la cuenta no tiene teléfono verificado, y
 * con `??` ese `""` le ganaba al teléfono del metadata y el formulario salía
 * vacío en el primer pedido.
 */
export type ContactoInicial = { name: string; phone: string; email: string };

type Perfil = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

type CuentaMinima = {
  phone?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function primerTexto(...candidatos: unknown[]): string {
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return "";
}

export function contactoInicial(
  perfil: Perfil,
  user: CuentaMinima,
): ContactoInicial {
  const meta = user.user_metadata ?? {};
  return {
    name: primerTexto(perfil.name, meta.full_name, meta.name),
    phone: primerTexto(perfil.phone, user.phone, meta.phone),
    email: primerTexto(perfil.email, user.email),
  };
}
