/**
 * La zona horaria del producto (regla dura: timezone SIEMPRE explícita).
 *
 * Sin esto, `toLocaleTimeString` formatea con la zona de quien renderiza: en el
 * server de Vercel (UTC) sale corrida 3 h y se corrige recién al hidratar, y
 * una tablet mal configurada la muestra mal para siempre (issue #157).
 */
export const TZ_AR = "America/Argentina/Buenos_Aires";
