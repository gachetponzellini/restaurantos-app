/**
 * Glosario único de la caja (spec 209 · R8).
 *
 * Antes el mismo concepto tenía cinco nombres según la pantalla —«En la caja
 * deberías tener», «Efectivo que debía haber», «Esperado», «Te falta», «Entrega
 * de menos», «Dif.»—. Las pantallas de caja y de rendición sacan sus rótulos de
 * acá para que no vuelvan a divergir. «Corte» y «arqueo» siguen en el código,
 * pero no en la UI.
 */
export const TXT = {
  deberiaHaber: "Debería haber",
  contado: "Contado",
  cerrarCaja: "Cerrar caja",
  contarSinCerrar: "Contar sin cerrar",
  contarYCerrar: "Contar y cerrar",
  diferencia: "Diferencia",
  // Spec 211 · R3 — la rendición del mozo.
  tieneQueEntregar: "Tiene que entregar",
  entrego: "Entregó",
  saldo: "Saldo",
  suPropina: "Su propina",
  rendido: "Rendido",
  rindio: "Rindió",
} as const;

export type Veredicto = {
  label: "Falta" | "Sobra" | "Cuadra";
  tono: "falta" | "sobra" | "cuadra";
  /** La diferencia en valor absoluto. */
  montoCents: number;
};

/** `diff = contado − debería haber`. */
export function veredictoDiferencia(diffCents: number): Veredicto {
  if (diffCents < 0) return { label: "Falta", tono: "falta", montoCents: -diffCents };
  if (diffCents > 0) return { label: "Sobra", tono: "sobra", montoCents: diffCents };
  return { label: "Cuadra", tono: "cuadra", montoCents: 0 };
}
