import { formatCurrency } from "@/lib/currency";

/**
 * Los códigos que levanta la base en la caja v2 (0134–0141), en palabras de la
 * pantalla. Módulo común (no «use server») para que lo usen las acciones de la
 * caja, del cobro y de la anulación. Un código desconocido no se muestra: se
 * loguea y la pantalla dice que se reintente.
 */
export function traducirErrorDeCaja(raw: string): string {
  // El código va antes del primer «:»; el resto (una mesa, un nombre) puede
  // traer sus propios «:».
  const i = raw.indexOf(":");
  const code = i < 0 ? raw : raw.slice(0, i);
  const extra = i < 0 ? undefined : raw.slice(i + 1).trim();
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
    case "MOVIMIENTO_DE_MOZO":
      return "Una entrega de mozo no se corrige acá: anulala desde la rendición del mozo.";
    case "MOZO_WRONG_BUSINESS":
      return "Esa persona no es del equipo de este negocio.";
    case "RENDICION_NOT_FOUND":
      return "No se encontró esa entrega.";
    case "PAYMENT_NOT_FOUND":
      return "No se encontró ese cobro.";
    case "CAJA_INACTIVE":
      return "Esa caja está desactivada.";
    case "CLOSING_CASH_NEGATIVE":
      return "Lo contado no puede ser negativo.";
    case "RENDICION_CONCURRENTE":
      return "Otra persona registró algo de este mozo al mismo tiempo. Mirá el saldo de nuevo y reintentá.";
    default:
      // Un error que no es de la caja (o uno técnico) no va a la pantalla tal cual.
      console.error("[caja] error sin traducir:", raw);
      return "No se pudo completar. Reintentá en un momento.";
  }
}
