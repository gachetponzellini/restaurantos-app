import type { PaymentCondition } from "../schema";
import { SUPPLIER_PAYMENT_METHODS } from "../schema";

/**
 * De lo que dice el pie del papel a la condición de pago — spec 187.
 *
 * El modelo copia el texto verbatim (172·D1) y la interpretación es de acá:
 * pura, testeable y sin una llamada de más. «CONTADO EFECTIVO» no significa
 * «sacá $180.000 de la Caja Mayor» hasta que alguien de este lado lo decide.
 *
 * **Ante la duda, cuenta corriente.** No es simetría: los dos errores no cuestan
 * lo mismo. Leer mal un «CTA CTE» como contado precarga un egreso de caja que no
 * pasó —y si la persona guarda sin mirar, la Caja Mayor queda con una sangría
 * inventada y el proveedor con una deuda cancelada que sigue debiendo—. Al
 * revés, el costo es un click: es lo que hay que hacer hoy en todas las compras.
 */
export type CondicionLeida = {
  condicion: PaymentCondition;
  /** Sólo tiene sentido con `contado`. */
  metodo: (typeof SUPPLIER_PAYMENT_METHODS)[number];
};

/**
 * Cuenta corriente gana sobre contado cuando aparecen los dos.
 *
 * Pasa de verdad: el recuadro preimpreso de la factura lista las cuatro formas
 * de pago y la real está tildada, así que el texto llega con todas adentro. Un
 * papel que nombra la cuenta corriente y encima dice un plazo está hablando de
 * crédito; el «EFECTIVO» de al lado es la casilla que no se tildó.
 */
const CTA_CTE = [
  "cta cte",
  "cta. cte",
  "ctacte",
  "cuenta corriente",
  "cte",
  "credito",
  "crédito",
  "a plazo",
  "dias",
  "días",
];

const CONTADO = ["contado", "efectivo", "cash", "pagado", "pago"];

const TRANSFERENCIA = ["transferencia", "transf", "deposito", "depósito", "cbu", "banco"];
const TARJETA = ["tarjeta", "debito", "débito", "posnet", "visa", "mastercard"];

/** Sin acentos, sin puntuación, en minúscula: como lo compara una persona. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function condicionDePagoLeida(texto: string | null | undefined): CondicionLeida | null {
  if (!texto || !texto.trim()) return null;
  const t = normalizar(texto);
  const tiene = (palabras: string[]) => palabras.some((p) => t.includes(normalizar(p)));

  if (tiene(CTA_CTE)) return { condicion: "cuenta_corriente", metodo: "cash" };

  if (tiene(CONTADO) || tiene(TRANSFERENCIA) || tiene(TARJETA)) {
    // El medio se decide sobre el mismo texto: «CONTADO TRANSFERENCIA» es un
    // pago que no toca el cajón, y precargarlo en efectivo pondría una sangría
    // donde no hubo plata.
    const metodo = tiene(TRANSFERENCIA) ? "transfer" : tiene(TARJETA) ? "card_manual" : "cash";
    return { condicion: "contado", metodo };
  }

  // Un texto que no entendemos NO es una condición: devolver cuenta corriente
  // acá haría que la pantalla dijera «lo llenó la foto» sobre algo que la foto
  // no dijo. Que quede el default del formulario, sin chip.
  return null;
}
