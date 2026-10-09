/**
 * La franja «Cierre del turno» (spec 211 · R6): cuál es el próximo paso.
 *
 * Mismo orden que valida la base: ninguna caja cierra con mesas abiertas ni con
 * mozos sin resolver en ella (`cerrar_caja_tx`), y el turno cierra con todas
 * las cajas contadas (`cerrar_turno_tx`). La pantalla muestra un solo primario,
 * que siempre es el próximo paso; nunca un botón apagado sin decir qué falta.
 */

export type PasoMesas = { estado: "pendiente"; total: number } | { estado: "listo" };
export type PasoRendiciones = { estado: "pendiente"; pendientes: number } | { estado: "listo" };
export type PasoCajas = { estado: "pendiente"; faltan: string[] } | { estado: "listo" };

export type ProximoPasoTurno =
  | { kind: "cobrar"; label: string; tableId: string }
  | { kind: "rendir"; label: string; mozoId: string; cajaId: string }
  | { kind: "contar"; label: string; cajaId: string }
  | { kind: "turno"; label: string };

export type PasosDelTurno = {
  mesas: PasoMesas;
  rendiciones: PasoRendiciones;
  cajas: PasoCajas;
  proximo: ProximoPasoTurno;
};

/** «la caja Principal», «la caja Bar»; «la Caja Salón» si el nombre ya la dice. */
export function nombreDeCaja(nombre: string): string {
  const n = nombre.trim();
  return /^caja\b/i.test(n) ? `la ${n}` : `la caja ${n}`;
}

export function pasosDelTurno(
  input: {
    cuentas_abiertas: { table_id: string; table_label: string }[];
    saldos: { mozo_id: string; mozo_name: string; caja_id: string; saldo_cents: number; resuelto: boolean }[];
    cajas: { id: string; name: string; sin_contar: boolean }[];
  },
  cajaActivaId?: string,
): PasosDelTurno {
  const mesas = input.cuentas_abiertas;
  const pendientes = input.saldos.filter((s) => !s.resuelto);
  const sinContar = input.cajas.filter((c) => c.sin_contar);

  const pasoMesas: PasoMesas = mesas.length ? { estado: "pendiente", total: mesas.length } : { estado: "listo" };
  const pasoRend: PasoRendiciones = pendientes.length
    ? { estado: "pendiente", pendientes: pendientes.length }
    : { estado: "listo" };
  const pasoCajas: PasoCajas = sinContar.length
    ? { estado: "pendiente", faltan: sinContar.map((c) => c.name) }
    : { estado: "listo" };

  // Primero lo de la caja que se está mirando: cada caja cierra cuando lo
  // suyo está rendido (cerrar_caja_tx mira los mozos de ESA caja), aunque otra
  // caja todavía tenga mozos pendientes.
  const deEsta = (x: { caja_id?: string; id?: string }) => (x.caja_id ?? x.id) === cajaActivaId;
  const pendientesAca = pendientes.filter(deEsta);
  const estaSinContar = sinContar.find((c) => c.id === cajaActivaId);

  const rendir = (lista: typeof pendientes): ProximoPasoTurno => {
    const p = lista[0];
    return {
      kind: "rendir",
      label:
        pendientes.length > 1
          ? `Faltan ${pendientes.length} rendiciones`
          : p.saldo_cents < 0
            ? `Darle la propina a ${p.mozo_name}`
            : `Rendir a ${p.mozo_name}`,
      mozoId: p.mozo_id,
      cajaId: p.caja_id,
    };
  };
  const contar = (c: { id: string; name: string }): ProximoPasoTurno => ({
    kind: "contar",
    label: `Contar ${nombreDeCaja(c.name)}`,
    cajaId: c.id,
  });

  let proximo: ProximoPasoTurno;
  if (mesas.length) {
    proximo = {
      kind: "cobrar",
      label: mesas.length === 1 ? `Cobrar mesa ${mesas[0].table_label}` : `Cobrar ${mesas.length} mesas abiertas`,
      tableId: mesas[0].table_id,
    };
  } else if (pendientesAca.length) {
    proximo = rendir(pendientesAca);
  } else if (estaSinContar) {
    proximo = contar(estaSinContar);
  } else if (pendientes.length) {
    proximo = rendir(pendientes);
  } else if (sinContar.length) {
    proximo = contar(sinContar[0]);
  } else {
    proximo = { kind: "turno", label: "Cerrar el turno" };
  }

  return { mesas: pasoMesas, rendiciones: pasoRend, cajas: pasoCajas, proximo };
}

/**
 * Spec 217 · D1 — el paso que se muestra al entrar: el que falta. Contar y
 * cerrar viven los dos en el paso 3.
 */
export function pasoAbierto(proximo: ProximoPasoTurno): 1 | 2 | 3 {
  if (proximo.kind === "cobrar") return 1;
  if (proximo.kind === "rendir") return 2;
  return 3;
}

/** «Ana», «Ana y Beto», «Ana, Beto y Caro». */
function nombres(lista: string[]): string {
  return lista.length <= 1 ? (lista[0] ?? "") : `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}

/**
 * Spec 217 · D4 — por qué todavía no se puede contar esta caja, o `null`.
 *
 * Las mismas reglas que valida `cerrar_caja_tx`: ninguna caja cierra con mesas
 * abiertas, y cada caja cierra cuando sus mozos están resueltos (los de otra
 * caja no la frenan). El botón apagado tiene que decir esto: nunca un botón
 * apagado sin decir qué falta.
 */
export function porQueNoSeCuenta(
  cajaId: string,
  input: {
    cuentas_abiertas: { table_label: string }[];
    saldos: { mozo_name: string; caja_id: string; resuelto: boolean }[];
  },
): string | null {
  const razones: string[] = [];
  const mesas = input.cuentas_abiertas;
  if (mesas.length === 1) razones.push(`Falta cobrar la mesa ${mesas[0].table_label}`);
  else if (mesas.length > 1) razones.push(`Faltan cobrar ${mesas.length} mesas`);
  const sinRendir = input.saldos.filter((s) => s.caja_id === cajaId && !s.resuelto).map((s) => s.mozo_name);
  if (sinRendir.length) razones.push(`Falta rendir a ${nombres(sinRendir)}`);
  return razones.length ? razones.join(" · ") : null;
}

