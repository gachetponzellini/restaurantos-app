import { formatCurrency } from "@/lib/currency";

/**
 * Los códigos que levanta la base en la caja v2 (0134–0141), en palabras de la
 * pantalla. Módulo común (no «use server») para que lo usen las acciones de la
 * caja, del cobro y de la anulación. Un código desconocido vuelve tal cual.
 */
export function traducirErrorDeCaja(raw: string): string {
  const [code, extra] = raw.split(":");
  const c = code.trim();
  switch (c) {
    case "MOZO_HAS_OPEN_TABLES":
      return `Tiene mesa ${extra ?? ""} sin cobrar. Cobrala antes de rendir.`.replace("  ", " ");
    case "NOTES_REQUIRED":
      return "Escribí qué pasó: hace falta el motivo.";
    case "AMOUNT_NOT_POSITIVE":
      return "Cargá cuánto entregó. Si no trajo nada, marcá «No entregó».";
    case "AMOUNT_NEGATIVE":
      return "El monto no puede ser negativo.";
    case "NADA_QUE_RENDIR":
      return "No tiene nada para entregar.";
    case "NADA_QUE_RECONOCER":
      return "No debe nada en esta caja.";
    case "SALDO_A_FAVOR_DEL_MOZO":
      return `La caja le debe ${formatCurrency(Number(extra ?? 0))} de propina: no tiene que entregar nada.`;
    case "CAJA_INVALID":
      return "Esa caja no se puede usar para rendir.";
    case "ARQUEO_CERRADO":
      return "Esa entrega ya entró en un cierre de caja: no se puede anular.";
    case "YA_ANULADA":
      return "Esa entrega ya estaba anulada.";
    case "OPEN_TABLE_ORDERS":
      return "Hay mesas con la cuenta abierta. Cobralas antes de cerrar.";
    case "UNRENDERED_MOZOS":
      return "Hay mozos que no rindieron lo de esta caja. Resolvé las rendiciones antes de cerrar.";
    case "CAJA_SIN_CONTAR":
      return `Falta contar: ${extra ?? "una caja"}.`;
    case "MOZO_YA_RINDIO":
      return "Ese cobro ya entró en la rendición del mozo. Para corregirlo, primero anulá su entrega.";
    case "MODELO_VIEJO":
      return "El negocio todavía no pasó a la caja nueva.";
    case "MODELO_NUEVO":
      return "Eso es de la caja vieja: el negocio ya usa la caja nueva.";
    case "CAJA_WRONG_BUSINESS":
      return "Esa caja no es de este negocio.";
    default:
      return raw;
  }
}
