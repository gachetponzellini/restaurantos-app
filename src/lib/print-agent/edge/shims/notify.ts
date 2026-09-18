/**
 * El aviso de impresión fallida arrastra el outbox de WhatsApp y no se porta
 * (spec 206 · D2): el agente manda los `failed` por Vercel, que sí notifica.
 * Si igual llega uno acá, el fallo queda marcado en la base y sólo falta la
 * notificación — se loguea para verlo.
 */
export async function notifyPrintFailed(params: { businessId: string }) {
  console.warn("print-agent fn · failed sin notificación", params.businessId);
}
