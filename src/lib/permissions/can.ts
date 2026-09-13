import type { BusinessRole } from "@/lib/admin/context";
import type { OperationalStatus } from "@/lib/mozo/state-machine";

// ============================================
// Helpers de permisos por rol — Bloque 1 MVP.
//
// Espejo en código de la matriz de permisos en
// `wiki/casos-de-uso/CU-11-matriz-permisos.md`.
//
// Los thresholds (descuento bajo/medio, diferencia de caja) son los defaults
// que pre-llenamos nosotros. **Pendiente validación cliente**: cuando vuelva
// la matriz firmada, se ajustan acá una sola vez.
//
// Spec 140 — el rol `terminal`: el puesto compartido del salón (una PC que usan
// todos los mozos cuando no tienen móvil). Regla general: **se comporta como el
// mozo, salvo que opera el salón entero en vez de "sus" mesas**, porque no tiene
// mesas propias. Lo que es de supervisión (cortes, sangrías, correcciones,
// anulaciones) sigue afuera: los helpers `admin || encargado` la dejan en false
// por default, que es lo correcto, y por eso la mayoría no se toca.
//
// Si en el futuro hace falta soportar thresholds por business (ej: un local
// quiere autorizar al encargado hasta $10.000 de diferencia), se mueve a
// `business_settings.permissions JSONB` y los helpers cargan los límites en
// runtime. Por ahora, valores fijos.
// ============================================

/** Tope superior (incluyente) del descuento que un mozo puede aplicar solo. */
export const DESCUENTO_BAJO_PCT = 10;

/** Tope superior (incluyente) del descuento que un encargado de caja puede
 *  aplicar solo. Por encima → admin. */
export const DESCUENTO_MEDIO_PCT = 25;

/** Diferencia absoluta máxima de caja (en centavos) que el encargado puede
 *  aceptar en un corte sin escalar a admin. $5.000 ARS por defecto. */
export const DIFERENCIA_CAJA_OK_CENTS = 500_000;

// ── Operación de salón ──────────────────────────────────────────

export function canModifyPostEnvio(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

export function canCancelItem(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Confirmar un pedido entrante (delivery / take-away / web / chatbot) para
 * que pase del estado "pendiente de confirmación" a "preparing" y se ruteen
 * sus items a las comandas de cada sector. Mozo no — está en salón, no
 * tiene visibilidad de la cola de pedidos online.
 */
export function canConfirmOrder(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

export function canMarkRotura(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Cobrar una línea a un precio distinto al de catálogo, sólo para ese pedido
 * (spec 069): plato fuera de carta, cortesía a $0, media porción, error de la
 * carta impresa, precio pactado. Exige motivo, como anular mesa o cancelar
 * item.
 *
 * Encargado/admin. El mozo ve el precio efectivo pero no lo puede tocar: es
 * plata, y el registro (quién / cuándo / por qué) sólo sirve como control si
 * la superficie es chica.
 *
 * A diferencia de `canApplyDiscount`, acá NO hay tope por porcentaje —
 * decisión de Juan 2026-07-30. El override puede ser $0 o quedar por encima
 * del precio de lista (plato fuera de carta más caro). El control es el rol
 * más el reporte de precios modificados, no un límite duro.
 */
export function canOverrideItemPrice(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Cargar un renglón con nombre y precio tipeados en el momento — el «no
 * existe» de MaxiRest (spec 174). La torta que trajo el cliente, el pescado
 * del día que nadie cargó, el menú que se le factura al sanatorio a fin de
 * mes.
 *
 * Mismo rol que `canOverrideItemPrice` y por la misma razón: el que escribe el
 * importe a mano está fijando plata. La diferencia con el override es que acá
 * también escribe **el nombre**, o sea el renglón entero que va a leer el
 * cliente en el ticket. Si algo, es más sensible, no menos.
 *
 * El mozo lo ve en la cuenta y lo cobra; no lo puede crear. La `terminal`
 * tampoco: es la compu del salón, sin nadie identificado detrás (spec 140).
 */
export function canCargarItemLibre(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Reimprimir / reintentar la impresión de una comanda desde operación (spec
 * 35). Gestión del local: encargado/admin. El mozo ya recibe la notificación
 * de fallo (spec 33) pero no dispara la reimpresión en Fase 1.
 */
export function canReimprimirComanda(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

// ── Cuenta / cobros ─────────────────────────────────────────────

/**
 * `percent` se espera como porcentaje (0–100), no fracción.
 * Ej: 15 = 15%. Valores negativos siempre false (no es responsabilidad de
 * estos helpers validar dominio numérico — eso lo hace la action).
 */
export function canApplyDiscount(role: BusinessRole, percent: number): boolean {
  if (percent < 0) return false;
  if (role === "admin") return true;
  if (role === "encargado") return percent <= DESCUENTO_MEDIO_PCT;
  // La terminal cobra igual que el mozo: mismo tope, misma cortesía de mesa.
  if (role === "mozo" || role === "terminal") {
    return percent <= DESCUENTO_BAJO_PCT;
  }
  return false;
}

// ── Caja / cortes ───────────────────────────────────────────────

export function canManageCajas(role: BusinessRole): boolean {
  return role === "admin";
}

export function canHacerCorte(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Fiar: cerrar un ticket con «Cuenta corriente» y dejarlo como saldo del cliente
 * (spec 141 · D6).
 *
 * Entra `terminal` —decidido con Juan— porque es el puesto compartido del salón,
 * y es **el que está parado en el mostrador cuando el socio dice «ponelo en mi
 * cuenta»**. El mozo queda afuera: cobra, no decide a quién se le fía.
 *
 * Va acá y no sólo en el `allowedMethods` de `CobroForm`: ese array es UX, y
 * esto es plata que queda sin cobrar.
 */
export function canFiar(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado" || role === "terminal";
}

/**
 * Cobrar el saldo de una cuenta corriente (spec 141 · D7).
 *
 * `terminal` fía pero NO cobra: registrar una cobranza mete un `ingreso` en una
 * caja que ese rol no puede ni mirar (`TABS_POR_ROL.terminal` no tiene «caja»),
 * y sería plata entrando a un cajón ciego. Lo que sí ve es el saldo del cliente
 * en el buscador del cobro, que es lo único que necesita para fiar bien.
 */
export function canCobrarCuentaCorriente(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Diferencia en centavos. Se evalúa en valor absoluto: una diferencia negativa
 * (faltante) y una positiva (sobrante) se tratan igual para el threshold.
 */
export function canAcceptCajaDifference(
  role: BusinessRole,
  diffCents: number,
): boolean {
  if (role === "admin") return true;
  if (role === "encargado") {
    return Math.abs(diffCents) <= DIFERENCIA_CAJA_OK_CENTS;
  }
  return false;
}

export function canMakeSangria(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Corregir una línea ya registrada en la caja — método, monto, propina, mozo
 * atribuido o caja de un cobro; monto o anulación de una sangría/ingreso
 * (spec 070). Mismo círculo que anular un cobro: encargado/admin.
 *
 * El mozo cobra pero no corrige: la corrección mueve el arqueo y la rendición
 * de otro, así que es acto de supervisión, no de servicio.
 */
export function canCorregirCobro(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

export function canRendirMozo(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Corregir, agregar o anular una fichada (spec 179). Es sueldo: el mismo
 * círculo que corrige la caja. La `terminal` no — es una cuenta compartida por
 * todo el salón, y el rastro diría «terminal», no quién.
 */
export function canEditarAsistencia(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

// ── Estados de mesa (CU-07 + CU-11) ─────────────────────────────

/**
 * Permisos sobre transiciones de mesa. Asume que `canTransition(from, to)` ya
 * fue validado por la state machine — esto solo decide si el rol puede
 * disparar esa transición concreta.
 *
 * Regla CU-11: anulación de mesa (ocupada/pidio_cuenta → libre sin cobro) es
 * solo encargado/admin. El cierre normal post-cobro (pidio_cuenta → libre)
 * lo dispara `closeOrderIfFullyPaid` con `byUserId=null` y service client,
 * por lo que no pasa por este check.
 */
export function canTransitionMesa(
  role: BusinessRole,
  from: OperationalStatus,
  to: OperationalStatus,
): boolean {
  // Anulación = liberar una mesa con order activa/cuenta pedida SIN cobro
  // (ocupada/pidio_cuenta → libre). Antes solo cubría `ocupada`, así que un mozo
  // podía liberar una mesa en `pidio_cuenta` (siempre con items cargados) y
  // cancelar una cuenta con plata (spec 36 · R-E3). `limpiar → libre` (mesa ya
  // cobrada, se limpió) no es anulación y sigue libre para cualquiera.
  const isAnulacion =
    to === "libre" && (from === "ocupada" || from === "pidio_cuenta");
  if (isAnulacion) return role === "admin" || role === "encargado";
  return true;
}

// ── Asignación / transferencia de mesa (CU-09) ──────────────────

/**
 * Quién puede transferir una mesa.
 * - admin/encargado: siempre.
 * - terminal: siempre (spec 140). `isOrigen`/`isSelfClaim` se comparan contra el
 *   usuario de la sesión, y la sesión de la terminal no es el `mozo_id` de
 *   ninguna mesa —están asignadas a personas— ni nadie transfiere una mesa
 *   *hacia* la terminal. Con la regla del mozo no podría mover ni una: la
 *   restricción dejaría de proteger y pasaría a bloquear todo.
 * - mozo: si es el origen (su mesa) O si reclama la mesa para sí mismo
 *   (auto-transfer). Ambos casos generan notificaciones y audit log.
 */
export function canTransferTable(
  role: BusinessRole,
  isOrigen: boolean,
  isSelfClaim: boolean = false,
): boolean {
  if (role === "admin" || role === "encargado" || role === "terminal") {
    return true;
  }
  if (role === "mozo") return isOrigen || isSelfClaim;
  return false;
}

/**
 * Asignar/cambiar/limpiar el `mozo_id` de una mesa fuera del flujo de
 * transferencia (ej: encargado pre-asigna mesas antes del servicio). Mozo no
 * puede asignar mesas a otros — solo se auto-asigna por walk-in (CU-09 R2).
 *
 * La terminal sí (spec 140 · D7): es el puesto de coordinación del salón, y es
 * la asignación la que decide de quién es la plata de cada mesa. Sin esto, cada
 * walk-in que se sienta necesitaría al encargado en la otra máquina — fricción
 * justo en hora pico. El costo es que el audit log dice "terminal" y no qué
 * persona lo hizo: se acepta mientras la cuenta sea compartida.
 */
export function canAssignMozo(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado" || role === "terminal";
}

/**
 * Trasladar una mesa completa (la orden abierta con su cuenta) a otra mesa
 * física libre (spec 048). Es una operación de mostrador que mueve estado y es
 * plata-adyacente: solo encargado/admin, igual criterio que la anulación de
 * mesa en `canTransitionMesa`. El mozo no traslada.
 */
export function canMoveTable(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

// ── Proveedores ────────────────────────────────────────────────

export function canManageProveedores(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

// ── Campañas ──────────────────────────────────────────────────────

export function canManageCampaigns(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

// ── Facturación (spec 09) ───────────────────────────────────────

/**
 * Anular un comprobante AFIP autorizado (emitiendo la nota de crédito) con
 * motivo obligatorio. Es del mostrador: encargado/admin. El mozo cobra pero
 * NO anula comprobantes — coherente con "anular es del mostrador" (§6).
 */
export function canAnularFactura(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Gestionar las **entidades fiscales** — a quién se le emite un comprobante
 * (spec 150): darlas de alta desde el cobro, buscarlas y corregirlas en su
 * pantalla de Facturación.
 *
 * Encargado/admin, el mismo círculo que ya factura y anula. El mozo cobra pero
 * no toca el padrón de receptores: un CUIT o una razón social mal cargados no
 * se corrigen con un undo, salen impresos en el próximo comprobante de ese
 * cliente y se arrastran a todos los siguientes.
 *
 * Crear y editar comparten techo: la corrección es la que repara el error de
 * tipeo del apuro, y dejarla más arriba que el alta obligaría al encargado a
 * buscar un admin para arreglar una letra de lo que él mismo cargó.
 */
export function canGestionarEntidadesFiscales(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Crear un "pedido flash" — orden de un único renglón por monto y concepto
 * libre, para facturar un evento sin desglose (ej: "Lunch torneo Banco Macro").
 * Operación de mostrador: encargado/admin. El mozo no genera facturación por
 * monto.
 */
export function canCrearPedidoFlash(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Cargar a mano un pedido para llevar / delivery SIN mesa desde operación
 * (spec 054) — el pedido de mostrador o telefónico, que hoy sólo entra
 * automático por la carta pública. Y la «venta rápida» del plano, que es lo
 * mismo: kiosko / barra, sin mesa.
 *
 * La `terminal` entra (decisión de Juan, 2026-09-02): es la compu del salón, y
 * el que pide una gaseosa parado en la barra no tiene mesa donde cargársela.
 * En la spec 140 había quedado afuera por prolijidad —«la terminal opera
 * mesas»— pero en el mostrador de un local eso no se sostiene.
 *
 * El mozo sigue afuera: su superficie es el teléfono, en el salón.
 *
 * Ojo: esto NO es cargarle el pedido a una mesa. Para eso está
 * `canCargarPedidoMesa`, que es otra cosa y otro círculo de gente.
 */
export function canCargarPedido(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado" || role === "terminal";
}

/**
 * Cargarle el pedido a una **mesa** — el acto central del servicio de salón.
 *
 * Spec 140 · D4: hasta acá esto compartía helper con el pedido de mostrador de
 * arriba, y el plano lo usaba para decidir si tocar una mesa abre la carga
 * (`salon-desktop.tsx`). Con un solo helper, abrirle Operación a la terminal la
 * dejaba entrar a una pantalla de sólo lectura: veía el salón y no podía cargar
 * nada. Son dos permisos distintos y ahora son dos funciones.
 */
export function canCargarPedidoMesa(role: BusinessRole): boolean {
  return (
    role === "admin" ||
    role === "encargado" ||
    role === "mozo" ||
    role === "terminal"
  );
}

// ── Reservas (spec 22) ──────────────────────────────────────────

/**
 * Modificar reservas: crear walk-in, sentar, cambiar estado y editar
 * mesa/comensales. Operación de salón/mostrador: admin, encargado **y mozo**
 * (decisión 2026-06-15 — el mozo opera la agenda del salón). `personal` no
 * opera el sistema. El platform admin se gatea aparte en cada action.
 *
 * Acepta `null` (sin membership) → false, para que los call sites no tengan
 * que guardar el caso por separado.
 */
export function canManageReservations(role: BusinessRole | null): boolean {
  return (
    role === "admin" ||
    role === "encargado" ||
    role === "mozo" ||
    role === "terminal"
  );
}

/** Sentar una reserva confirmada = parte de gestionarla. Alias semántico. */
export const canSeatReservation = canManageReservations;

/**
 * Spec 131 — decidir una solicitud de reserva (confirmarla o rechazarla). Es
 * más que gestionarla: compromete el cupo del servicio y le dice que sí o que
 * no a un cliente. Por eso NO alcanza con ser mozo, a diferencia de
 * `canManageReservations`.
 */
export function canDecideReservation(role: BusinessRole | null): boolean {
  return role === "admin" || role === "encargado";
}

/**
 * Configurar el motor de reservas (horarios, buffer, lead time, party size,
 * gracia de no-show). Es config del negocio: admin/encargado. El mozo gestiona
 * reservas pero no cambia las reglas.
 */
export function canConfigureReservations(role: BusinessRole | null): boolean {
  return role === "admin" || role === "encargado";
}

// ── Notificaciones / chatbot (spec 15) ──────────────────────────

/**
 * Configurar preferencias de notificación (quién recibe qué y por qué canal) y
 * las plantillas de mensajes de delivery. Es config del negocio: admin/encargado.
 * El mozo no toca la config de notificaciones del local.
 */
export function canManageNotificationPrefs(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}

// ── Bandeja de conversaciones / handoff (spec 32) ───────────────

/**
 * Ver la bandeja de conversaciones de WhatsApp, tomar una conversación
 * (apagar/prender el agente) y escribirle al cliente como humano. Es atención
 * al cliente del mostrador: admin/encargado. El mozo está en salón, no opera
 * la bandeja. El platform admin entra con rol funcional 'admin'.
 */
export function canManageConversations(role: BusinessRole): boolean {
  return role === "admin" || role === "encargado";
}
