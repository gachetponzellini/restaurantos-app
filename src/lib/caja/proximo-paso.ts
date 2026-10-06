/**
 * El cierre del día como checklist (spec 209 · R1/R2).
 *
 * «Cerrar caja» era el botón más visible del board, pero en la caja principal es
 * el último paso de una secuencia —cobrar las mesas, rendir a los mozos, contar—
 * cuyos prerequisitos se descubrían adentro del modal, con el botón final gris y
 * mudo. Esto decide cuál es el próximo paso: la UI muestra **un** botón
 * primario, y siempre dice qué hay que hacer.
 *
 * Mismas listas que bloquean en `cerrarCaja` y en `cerrar_caja_tx`
 * (`cuentas_abiertas` y `deben_rendir` de `getCierreCajaData`): si la franja
 * está en verde, la base no tiene por qué rechazar.
 */

export type EstadoPaso =
  | { estado: "pendiente"; total: number }
  | { estado: "listo" }
  | { estado: "no_aplica" };

export type EstadoRendiciones =
  | { estado: "pendiente"; pendientes: number }
  | { estado: "listo" }
  | { estado: "no_aplica" };

export type ProximoPaso =
  | { kind: "cobrar"; label: string; tableId: string }
  | { kind: "rendir"; label: string; mozoId: string }
  | { kind: "contar"; label: string };

export type PasosDelCierre = {
  mesas: EstadoPaso;
  rendiciones: EstadoRendiciones;
  proximo: ProximoPaso;
};

export function pasosDelCierre(input: {
  barre_salon: boolean;
  cuentas_abiertas: { table_id: string; table_label: string }[];
  deben_rendir: { mozo_id: string; mozo_name: string }[];
}): PasosDelCierre {
  const contar: ProximoPaso = { kind: "contar", label: "Contar y cerrar" };

  // El cierre del bar no barre el salón ni pide rendiciones (spec 130 · D9).
  if (!input.barre_salon) {
    return {
      mesas: { estado: "no_aplica" },
      rendiciones: { estado: "no_aplica" },
      proximo: contar,
    };
  }

  const mesas = input.cuentas_abiertas;
  const mozos = input.deben_rendir;

  const pasoMesas: EstadoPaso =
    mesas.length > 0 ? { estado: "pendiente", total: mesas.length } : { estado: "listo" };
  const pasoRendiciones: EstadoRendiciones =
    mozos.length > 0
      ? { estado: "pendiente", pendientes: mozos.length }
      : { estado: "listo" };

  let proximo: ProximoPaso = contar;
  if (mesas.length > 0) {
    proximo = {
      kind: "cobrar",
      label:
        mesas.length === 1
          ? `Cobrar mesa ${mesas[0].table_label}`
          : `Cobrar ${mesas.length} mesas abiertas`,
      tableId: mesas[0].table_id,
    };
  } else if (mozos.length > 0) {
    proximo = {
      kind: "rendir",
      label:
        mozos.length === 1
          ? `Rendir a ${mozos[0].mozo_name}`
          : `Faltan ${mozos.length} rendiciones`,
      mozoId: mozos[0].mozo_id,
    };
  }

  return { mesas: pasoMesas, rendiciones: pasoRendiciones, proximo };
}
