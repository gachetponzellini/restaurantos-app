/**
 * Qué hacer con la cuenta impresa cuando se toca «Cobrar» (issue #340).
 *
 * En MaxiRest el ticket de control era parte del cobro; acá era un botón
 * aparte y la encargada lo apretaba siempre antes de cobrar. Así que Cobrar lo
 * encola solo — pero **sólo la primera vez**: si la mesa ya tiene una cuenta
 * impresa, otro papel saldría marcado «reimpresión» y la mesa terminaría con
 * dos. Para reimprimir sigue estando el botón.
 *
 * Nada de esto puede frenar el cobro: sin comandera se avisa y se sigue.
 */
export type CuentaAlCobrar = "imprimir" | "ya_impresa" | "sin_comandera";

export function decidirCuentaAlCobrar({
  previos,
  hayComandera,
}: {
  /** Cuentas (`print_jobs kind='cuenta'`) ya encoladas para la orden. `null` si
   *  la query no vino: cuenta como ya impresa, del lado de no duplicar. */
  previos: number | null;
  hayComandera: boolean;
}): CuentaAlCobrar {
  if (previos == null || previos > 0) return "ya_impresa";
  if (!hayComandera) return "sin_comandera";
  return "imprimir";
}
