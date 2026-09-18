import {
  Wallet,
  BookUser,
  LayoutGrid,
  Receipt,
  ChefHat,
  Truck,
  CalendarDays,
  HandCoins,
  Clock,
  Package,
  UtensilsCrossed,
  Boxes,
  TrendingUp,
  Table2,
  Building2,
  FileText,
  Users,
  Tag,
  MessagesSquare,
  TriangleAlert,
  Monitor,
  Lock,
  type LucideIcon,
} from "lucide-react";

import {
  DESCUENTO_BAJO_PCT,
  DESCUENTO_MEDIO_PCT,
  DIFERENCIA_CAJA_OK_CENTS,
} from "@/lib/permissions/can";
import type { BusinessRole } from "@/lib/admin/context";
import type { ReservationMode } from "@/lib/reservations/types";

// ============================================
// Contenido de la guía del encargado — spec 134 (RestaurantOS-Brain#35).
//
// Es un DATO TIPADO, no MDX: el repo no tiene MDX y no se agrega una
// dependencia para esto (D8). El renderer vive en
// `app/[business_slug]/admin/(authed)/ayuda/`.
//
// TRES REGLAS AL EDITAR ESTE ARCHIVO:
//
// 1. Las frases entre comillas son LITERALES de la pantalla (D4). El encargado
//    tiene que poder buscar acá lo que está leyendo allá. Si cambiás un cartel
//    en el panel, cambialo también acá — si no, la guía miente, y miente justo
//    en el momento en que alguien la abrió porque no entendía algo.
// 2. Nada de vocabulario nuestro (D5). No existen "kanban", "estado",
//    "payload", "tab", "server action", "RLS" ni "spec". Existen la comanda, la
//    comandera, el arqueo, la rendición, fichar, la cuenta y la mesa.
// 3. Los números que salen de `can.ts` (el 25 % de descuento, los $5.000 de
//    diferencia de caja) se escriben UNA vez, acá abajo, importados de ahí. No
//    se tipean a mano en el texto de un paso: el día que el cliente devuelva la
//    matriz firmada con otros topes, tiene que haber un solo lugar que tocar.
// ============================================

/** 'ojo' = tenelo en cuenta · 'peligro' = si lo hacés mal, se cobra dos veces,
 *  se acepta una caja que no cierra, o se anula algo sin registro.
 *  Dos tonos a propósito: con tres ya no se distinguen, y si todo es urgente
 *  nada lo es. */
export type Aviso = { tono: "ojo" | "peligro"; texto: string };

// ─── Los números que decide `can.ts` ────────────────────────────────────────
//
// Se IMPORTAN, no se tipean. Son los topes que el sistema aplica de verdad, y
// el propio `can.ts` avisa que son defaults nuestros pendientes de que el
// cliente los confirme (ver `wiki/negocio/cuestionario-topes-y-recargos.md`).
// El día que vuelvan otros números, se cambian en `can.ts` y la guía queda
// bien sola — que es exactamente lo que no pasaba cuando estaban escritos a
// mano en siete lugares distintos.

/** «$5.000» — lo máximo de diferencia de caja que el encargado cierra solo. */
export const TOPE_DIFERENCIA_CAJA = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
}).format(DIFERENCIA_CAJA_OK_CENTS / 100);

/** «25%» — lo máximo de descuento que el encargado aplica solo. */
export const TOPE_DESCUENTO = `${DESCUENTO_MEDIO_PCT}%`;

/** El tope de la terminal y del mozo (spec 170). Sale de `can.ts` igual que el
 *  otro: son dos números distintos y ninguno se tipea a mano en un paso. */
export const TOPE_DESCUENTO_TERMINAL = `${DESCUENTO_BAJO_PCT}%`;

/**
 * Un círculo numerado sobre un punto de la captura. `x`/`y` son PORCENTAJES
 * del ancho y del alto de la imagen, no píxeles: así el número sigue cayendo
 * donde tiene que caer cuando la captura se escala en un celular de 375 px.
 *
 * La anotación va como DATO y no quemada adentro del PNG. Dos razones: la
 * explicación tiene que vivir en el texto del paso —adentro de la imagen no se
 * lee a 375 px— y volver a sacar una captura cuando cambie la pantalla no
 * puede obligar a rehacerla en un editor de imágenes.
 */
export type Marca = { n: number; x: number; y: number };

/** Adónde seguir cuando un paso se apoya en otro tema. Es un link y no prosa
 *  ("está explicado en el tema Cobrar"): mandar a alguien de vuelta al índice a
 *  buscarlo a mano es la fricción que hace que se abandone la guía y no la duda. */
export type VerTambien = { tema: string; texto: string };

export type Paso = {
  titulo: string;
  texto: string;
  verTambien?: VerTambien;
  /** Ruta bajo /public, ej. '/ayuda/caja-cierre.png'. */
  imagen?: string;
  /** Obligatorio si hay imagen. */
  alt?: string;
  marcas?: Marca[];
  aviso?: Aviso;
  /**
   * Sólo se muestra si el negocio está en ese modo de reservas.
   *
   * Lo usan un par de entradas de `carteles`, que es un catálogo plano y por lo
   * tanto no puede tener `pasosPorModo`: el cartel del cupo lleno existe en los
   * dos modos pero dice cosas distintas, y a un local en `estricto` no le sirve
   * leer que puede sobrevender — no puede.
   */
  soloModo?: ReservationMode;
};

/**
 * 'pasos'    → una secuencia: primero esto, después aquello. Va numerada.
 * 'catalogo' → una lista para BUSCAR en ella. NO se numera: el encargado que
 *              tiene un cartel en la pantalla no lee del 1 al 12, escanea los
 *              títulos hasta encontrar el suyo, y los números le dirían que hay
 *              un orden que en realidad no existe.
 */
export type TipoTema = "pasos" | "catalogo";

/**
 * Los cuatro bloques del índice. Con seis temas alcanzaba una lista; con
 * dieciséis, no: una tira de tarjetas todas iguales obliga a leerlas todas para
 * encontrar una. El orden es el de la distancia al turno — primero lo que se
 * hace hoy, último lo que se abre cuando algo se rompió.
 */
export type Grupo = "operacion" | "catalogo" | "resto" | "problemas";

/**
 * Los dos primeros grupos son **el centro de la guía**: Operación es el turno y
 * Catálogo es lo que se vende. Ahí es donde el encargado usa el sistema de
 * verdad, y por eso son los que van ilustrados pantalla por pantalla.
 *
 * «Lo demás del panel» existe para que la guía no mienta por omisión, pero se
 * escribe más corto: son pantallas que se abren de vez en cuando y casi siempre
 * con tiempo.
 */
export const GRUPOS: { id: Grupo; titulo: string; bajada: string }[] = [
  {
    id: "operacion",
    titulo: "Operación",
    bajada:
      "El turno completo, tema por tema: la pantalla donde pasás el día.",
  },
  {
    id: "catalogo",
    titulo: "Catálogo",
    bajada: "Lo que vendés y lo que tenés: la carta, el menú del día, el stock y los costos.",
  },
  {
    id: "resto",
    titulo: "Lo demás del panel",
    bajada: "Salones, clientes, promos, proveedores y comprobantes. Se abren cada tanto.",
  },
  {
    id: "problemas",
    titulo: "Si algo falla",
    bajada: "Los carteles del sistema, uno por uno, con la frase exacta que ves en pantalla.",
  },
];

/**
 * Un video de Loom arriba del tema (spec 134 D21).
 *
 * `url` es el link de compartir de Loom (`https://www.loom.com/share/<id>`); el
 * embed se arma solo. Dos reglas que no son de estilo:
 *
 *  - **El video NO reemplaza los pasos.** Van abajo, completos, siempre. Un
 *    video no se puede buscar con Cmd+F, no se puede consultar con el salón
 *    lleno sin auriculares, y el asistente no lo lee.
 *  - **Un video es más caro de mantener que un párrafo.** Cuando cambia una
 *    pantalla, el texto se corrige en un minuto y el video hay que regrabarlo.
 *    Por eso hay video sólo donde la secuencia importa más que el detalle.
 */
export type Video = {
  url: string;
  /** Qué se ve, para el que decide si lo mira. */
  titulo: string;
  /** Ej. "2 min". Que se sepa antes de tocar play. */
  duracion?: string;
};

export type Tema = {
  slug: string;
  titulo: string;
  resumen: string;
  icono: LucideIcon;
  grupo: Grupo;
  /**
   * Lo que hay que llevarse aunque no se lea el resto: dos o tres líneas, arriba
   * de todo y destacadas.
   *
   * No es un resumen de los pasos. Es la respuesta a «si esta persona sólo lee
   * cinco segundos, ¿qué le tiene que quedar?» — casi siempre el límite de lo
   * que puede hacer sola, o la cosa que si se hace mal cuesta plata.
   */
  claves: string[];
  /**
   * A quién le habla este tema — spec 169 · D8. Default: `["admin",
   * "encargado"]`, que es lo que son los veinte temas de la spec 134.
   *
   * Es el seam de las guías por rol: el índice, el recorrido de primer ingreso
   * y el contexto que se le pasa al asistente filtran por acá. Cuando se
   * escriba la guía del salón, sus temas van a llevar `["mozo", "terminal"]` y
   * ninguno de éstos hay que tocarlo.
   */
  roles?: BusinessRole[];
  /**
   * Qué tema de OTRO rol documenta esta misma pantalla — spec 170 · D5.
   *
   * El chip `?` de cada pantalla lleva un slug fijo (`TEMA_POR_TAB`: la tab
   * «salon» pide `mesas`), y con contenido por rol la misma pantalla tiene dos
   * temas. Declarando `equivaleA: "mesas"`, la terminal que toca ese chip cae
   * en el suyo sin que haya que tocar los diez sitios donde está el chip.
   */
  equivaleA?: string;
  /** Default 'pasos'. */
  tipo?: TipoTema;
  /** Loom del tema. Opcional: se van grabando de a poco. */
  video?: Video;
  pasos: Paso[];
  /**
   * D12 — sólo lo usa `reservas`. El modo es por negocio (`estricto` /
   * `flexible`) y cambia tanto lo que el encargado ve que un texto común no
   * serviría: en estricto elige un horario de una grilla fija, en flexible
   * escribe la hora en un libro. Se muestra SÓLO el modo del negocio en el que
   * está parado — nunca los dos con un "si tu local usa…", que obliga a
   * alguien apurado a decidir cuál de las dos mitades le toca.
   */
  pasosPorModo?: Record<ReservationMode, Paso[]>;
};

/** Los pasos que le tocan a este negocio: la variante de su modo, y sin las
 *  entradas sueltas marcadas para el otro. */
export function pasosDe(tema: Tema, modo: ReservationMode): Paso[] {
  const base = tema.pasosPorModo?.[modo] ?? tema.pasos;
  return base.filter((paso) => !paso.soloModo || paso.soloModo === modo);
}

// ─── Los temas ──────────────────────────────────────────────────────────────
//
// Seis, en el orden del TURNO y no en el de la barra del operativo: se abre la
// caja, se trabaja el salón, se cobra, y en el medio entran los pedidos de la
// web y las reservas. `carteles` va último porque no se lee de corrido: se
// busca cuando ya apareció uno.
//
// Los pasos se escriben en la task 2 (issue #35). Un tema sin pasos se muestra
// en el índice como "En preparación" y no se abre: la estructura se puede
// mergear vacía sin prometer nada que no esté (RNF-2).

export const TEMAS: Tema[] = [
  // ══ Tu turno ═════════════════════════════════════════════════════════════
  {
    slug: "caja",
    titulo: "La caja: movimientos y cierre",
    resumen: "Lo que entra y sale del cajón, y cómo se cierra el turno cuando el conteo no da.",
    icono: Wallet,
    grupo: "operacion",
    claves: [
      "Cerrar la caja principal libera todas las mesas y borra la distribución de mozos. No se puede evitar.",
      "Sin todas las rendiciones resueltas, la caja principal no cierra.",
      `Podés cerrar con una diferencia de hasta ${TOPE_DIFERENCIA_CAJA}. Más que eso lo cierra el dueño.`,
    ],
    pasos: [
      {
        titulo: "Elegí tu caja y mirá los dos números",
        texto:
          'Arriba están las cajas del local; tocá la que tenés adelante y el sistema se la acuerda. «En la caja deberías tener» es la plata que tendría que haber en el cajón ahora. «Cobrado en el período» es la venta del turno con todos los métodos juntos: es otra cosa y casi nunca coincide. Lo fiado no está en ninguno de los dos — es venta, pero no entró al cajón.',
        verTambien: {
          tema: "cuentas-corrientes",
          texto: "Por qué el fiado no cuenta acá",
        },
        imagen: "/ayuda/op-caja.png",
        alt: "La pantalla de Caja, con «En la caja deberías tener» a la izquierda y «Cobrado en el período» a la derecha.",
        // % del ancho y del alto de la captura (1160 × 860): van sobre el
        // rótulo y no sobre el número, que el círculo tapaba los dígitos.
        marcas: [
          { n: 1, x: 9.5, y: 27.5 },
          { n: 2, x: 56, y: 27.5 },
        ],
      },
      {
        titulo: "Esta pestaña es la caja de HOY. Lo demás está en «Caja»",
        texto:
          "La pestaña de Operación es la caja abierta: lo que está pasando ahora, para cobrar y para cerrar. Todo el resto —las cajas del local, los cierres viejos y el libro de movimientos— vive en «Caja», en el menú de la izquierda. Desde ahí, el botón «Ver ahora» de cualquier caja te trae de vuelta acá, parado en esa.",
      },
      {
        titulo: "Sacar y meter plata",
        texto:
          '«Sangría» saca efectivo —un depósito en el banco, el cambio que se lleva alguien— y el motivo tiene asterisco rojo: es obligatorio, y sin él no te deja registrar. «Ingreso» es el mismo formulario al revés, para el cambio que se repone. Escribí motivos que se entiendan dentro de un mes: «depósito banco viernes», no «varios». Ojo: el pago a un proveedor no es una sangría — sale de la Caja Mayor, desde Proveedores, y por eso no descuadra el arqueo del turno.',
        imagen: "/ayuda/det-caja-sangria.png",
        alt: "El formulario de sangría: monto, y motivo marcado como obligatorio con un asterisco rojo.",
      },
      {
        titulo: "Primero las rendiciones: sin eso no cierra",
        texto:
          "Un mozo que cobró tiene esa plata encima hasta que la entrega, y desde hace poco el cierre de la caja principal NO avanza hasta resolver a todos. Resolver son dos caminos: «Rindió», con el monto que te dio, o «No entregó», con motivo — que deja la deuda escrita y le avisa al dueño. El botón de cerrar queda apagado hasta que no quede ninguno.",
        aviso: {
          tono: "ojo",
          texto:
            "El bar es la excepción: una caja que no es la principal cierra sin pedir rendiciones, porque puede tener que cortar en plena cena. Y la Caja Mayor no se cierra nunca: no es una caja de turno, es de donde salen los pagos a proveedor.",
        },
        verTambien: { tema: "rendicion", texto: "Cómo se toma una rendición" },
      },
      {
        titulo: "Las mesas abiertas también frenan",
        texto:
          'No se puede cerrar la caja principal con consumo sin cobrar. Si queda alguna, el sistema te las nombra: "No podés cerrar: hay 2 mesas con la cuenta abierta — Mesa 14 ($18.500), Mesa 7 ($6.200).". Andá, cobralas o anulalas, y volvé.',
        verTambien: { tema: "mesas", texto: "Cerrar o anular una mesa" },
      },
      {
        titulo: "Los deliverys NO frenan el cierre",
        texto:
          'Un pedido de la web todavía abierto se te lista como aviso —"Quedan 3 pedidos de delivery / take away abiertos. No frenan el cierre: si se cobran después, entran en el período nuevo."— pero te deja cerrar igual. Es a propósito: el repartidor puede volver más tarde. Lo que tenés que saber es que esa plata va a caer en el turno siguiente, no en el que estás cerrando.',
        aviso: {
          tono: "ojo",
          texto:
            "Si querés que todo el día quede en un solo turno, resolvé los deliverys antes de cerrar. El sistema no te lo va a exigir.",
        },
      },
      {
        titulo: "Contá, explicá la diferencia y decidí si retirás",
        texto:
          'En «Cerrar caja» escribís lo contado —hay un contador por billete si te sirve— y aparece «Te falta» o «Te sobra». Con diferencia, el sistema pide el motivo en las notas. Después, la casilla «Retirar todo el efectivo»: tildada la caja arranca en $0; sin tildar "La caja queda con lo contado — es el arqueo de mitad de turno.".',
        aviso: {
          tono: "peligro",
          texto:
            `Arriba de ${TOPE_DIFERENCIA_CAJA} de diferencia el sistema te frena: "La diferencia excede tu autorización. Pedile al admin que cierre la caja.". No cambies el conteo para que entre — convertís un faltante explicable en uno escondido.`,
        },
      },
      {
        titulo: "Un cierre se puede volver a mirar",
        texto:
          "El resumen que ves al cerrar no se pierde: queda guardado y se abre de nuevo desde «Caja» → «Cierres». Ahí está todo lo del turno —lo esperado, lo contado, la diferencia con su nota, cómo se contó, si se retiró la plata y las rendiciones que se tomaron—. Es dónde mirar al día siguiente cuando alguien pregunta cuánto faltó o si un mozo rindió.",
        aviso: {
          tono: "ojo",
          texto:
            "El arqueo —esperado, contado y diferencia— queda congelado, pero el resto se vuelve a calcular. Si después se corrige un cobro de ese turno, el resumen del cierre viejo cambia. Es a propósito: sirve para auditar, no como foto.",
        },
      },
      {
        titulo: "Qué pasa con el salón cuando confirmás",
        texto:
          "Cerrar la caja principal no cierra sólo la plata: además libera TODAS las mesas ocupadas del local y borra la asignación de mozos de todas ellas. El salón te queda limpio para el turno siguiente. Es automático y no hay casilla para evitarlo.",
        aviso: {
          tono: "peligro",
          texto:
            "Alcanza a todos los salones del negocio, no sólo al que te toca. Y borra la distribución de mozos entera: si mañana usás las mismas secciones, las vas a tener que repartir de nuevo.",
        },
        verTambien: { tema: "mesas", texto: "Repartir el salón entre los mozos" },
      },
    ],
  },
  {
    slug: "mesas",
    titulo: "El salón",
    resumen: "Abrir, cobrar, anular y mover mesas, incluido lo que el mozo no puede hacer solo.",
    icono: LayoutGrid,
    grupo: "operacion",
    claves: [
      "Anular una mesa y anular un cobro son cosas distintas: si ya se cobró, se anula el cobro.",
      "Anular, trasladar y repartir el salón son tuyos o del dueño. El mozo no puede.",
      "Toda anulación pide motivo. Es lo que explica por qué esa venta no está.",
    ],
    pasos: [
      {
        titulo: "El plano es el salón",
        texto:
          "Cada figura es una mesa y el color dice cómo está. Abajo está la referencia con cuántas hay de cada una; el número chico adentro es hace cuánto está abierta, que sirve para ver cuál se demora. A la derecha, lo mismo en lista.",
        imagen: "/ayuda/op-salon.png",
        alt: "El plano del salón con las mesas, la referencia de colores abajo y el panel de ocupadas a la derecha.",
        marcas: [
          { n: 1, x: 37, y: 23 },
          { n: 2, x: 8, y: 97 },
          { n: 3, x: 72, y: 58 },
        ],
      },
      {
        titulo: "Abrir, cargar y pasar a cobro",
        texto:
          "Tocás una mesa libre, le cargás el pedido y queda abierta; se puede seguir agregando todas las veces que haga falta. Cuando piden la cuenta la mesa se marca en el plano y «Pasar a cobro» abre el cobro con todo lo consumido.",
        verTambien: { tema: "cobrar", texto: "Cómo se cobra una cuenta" },
      },
      {
        titulo: "Si la mesa tenía una reserva",
        texto:
          "Al abrir una mesa reservada el sistema te avisa antes y podés «Abrir igual» o buscar otra. Para sentar a alguien de una reserva, primero hay que confirmarla.",
        verTambien: { tema: "reservas", texto: "Confirmar una reserva" },
      },
      {
        titulo: "Ponerle el mozo a UNA mesa",
        texto:
          'El header de la mesa dice quién la atiende, y cuando no tiene a nadie dice «Sin mozo». Esa pastilla es el botón: la tocás y elegís. Si la mesa no tenía mozo, el modal dice «Asignar mozo» y lo pone en un paso; si ya tenía, dice «Transferir mozo» y le saca la mesa al anterior, con motivo. Se puede desde que la mesa está libre: no hace falta esperar a que tenga pedido.',
        aviso: {
          tono: "ojo",
          texto:
            "Para uno solo NO uses «Distribuir mozos» ni «Transferir»: la primera es para repartir el salón entero antes del servicio, y la segunda es para sacarle una mesa a alguien.",
        },
      },
      {
        titulo: "Mover: repartir el salón, o cambiar de mesa",
        texto:
          '«Distribuir mozos» reparte varias mesas de una antes del servicio: es el modo para armar las secciones, no para poner un mozo suelto. «Trasladar mesa» mueve el consumo a otra mesa, que tiene que estar libre — si no, "La mesa está ocupada. Cobrala o liberala antes de mover.".',
      },
      {
        titulo: "Anular una mesa",
        texto:
          'Cancela la orden activa y libera la mesa: es para el cliente que se fue sin consumir o el error de carga. Pide motivo obligatorio, con ejemplos como «cliente se fue, error de carga».',
        aviso: {
          tono: "peligro",
          texto:
            "Anular borra esa venta del turno y sólo lo podés hacer vos o el dueño. Si la mesa YA se cobró, esto no es lo que buscás: se anula el cobro, que deja el rastro del reembolso.",
        },
      },
    ],
  },
  {
    slug: "cobrar",
    titulo: "Cobrar una cuenta",
    resumen: "Propina, descuento, hasta dónde llegás vos, y cómo se deshace un cobro mal hecho.",
    icono: Receipt,
    grupo: "operacion",
    claves: [
      `Tu tope de descuento es ${TOPE_DESCUENTO}. Partirlo en dos cobros no lo saltea.`,
      "Mirá en qué caja va a quedar el cobro antes de confirmar. Es el error más fácil de evitar.",
      "Si la factura es A, pedí el CUIT ANTES de cobrar. Después ya no se cambia sin nota de crédito.",
    ],
    pasos: [
      {
        titulo: "Abrí el cobro y mirá la caja",
        texto:
          "Desde la mesa, «Cobrar mesa» o «Pasar a cobro». A la izquierda, «Falta cobrar» con lo que queda; abajo, «Caja para registrar el cobro» — si estás en el bar, que diga la del bar, porque ahí es donde va a aparecer al cierre. Es la misma pantalla cobrando una mesa, un pedido de la web o una venta de mostrador: lo que aprendés en una sirve en las tres.",
        imagen: "/ayuda/op-cobrar.png",
        alt: "La pantalla de cobro: falta cobrar, la caja donde se registra, el control de Factura A y los siete métodos de pago numerados.",
        // % del ancho y del alto de la captura (1160 × 860).
        marcas: [
          { n: 1, x: 13, y: 24.8 },
          { n: 2, x: 19, y: 42.7 },
          { n: 3, x: 87, y: 45 },
        ],
      },
      {
        titulo: "El método, y el recargo que trae",
        texto:
          "Los métodos están numerados para elegirlos con el teclado: Efectivo, Tarjeta, Link de Mercado Pago, QR de Mercado Pago, Transferencia, Otro y «Cuenta corriente», que es fiar. Los que tienen recargo lo muestran ahí mismo y ya calculado — «Tarjeta +10% · $26.400» sobre una cuenta de $24.000. Decile al cliente el número final antes de confirmar, no después.",
        aviso: {
          tono: "ojo",
          texto:
            "El recargo lo configura el dueño por método. Si un cliente discute el total, el número de la pantalla es el que se cobra: no lo redondees a mano.",
        },
      },
      {
        titulo: "Toda la mesa o dividida",
        texto:
          "Por defecto se cobra «Mesa completa». Si se divide, aparecen las sub-cuentas: se cobra una por una y lo que queda se ve en «Falta cobrar».",
      },
      {
        titulo: "Fiar es un método más",
        texto:
          "«Cuenta corriente» cierra la cuenta igual que cualquier otro método —la mesa se libera y la factura sale— pero no entra plata: queda como saldo del cliente. Te pide elegir a quién y te muestra lo que ya debe antes de confirmar.",
        verTambien: {
          tema: "cuentas-corrientes",
          texto: "Cómo se fía y cómo se cobra el saldo",
        },
      },
      {
        titulo: "La factura se elige ANTES de cobrar",
        texto:
          'Arriba del cobro está «Factura A (empresa con CUIT)». Sin tocarlo dice "Por defecto: Factura B (consumidor final)." y no tenés que hacer nada — es el 95% de las veces. Tildado, se despliegan los datos del receptor. Se elige acá y no después porque el comprobante sale junto con el cobro: pedir la A cuando la mesa ya se cobró llega tarde.',
        aviso: {
          tono: "peligro",
          texto:
            'Sin el CUIT el sistema te frena antes de cobrar: "Para la Factura A falta el CUIT del receptor (11 dígitos).". Está bien que frene — cobrada la mesa, cambiarle la letra a la factura obliga a anularla con nota de crédito.',
        },
      },
      {
        titulo: "La empresa se busca por nombre, no se tipea",
        texto:
          'En «Buscar receptor guardado» escribís la razón social o el CUIT —«Razón social o CUIT…»— y elegís de la lista: el CUIT, el nombre y la condición de IVA se completan solos. Están cargados los clientes que ya facturaban en el sistema viejo, así que al de siempre lo encontrás escribiendo tres letras. Si es uno nuevo, cargás el CUIT a mano una vez y queda guardado para la próxima.',
        verTambien: {
          tema: "facturacion",
          texto: "La lista de entidades fiscales",
        },
      },
      {
        titulo: "Propina y descuento",
        texto:
          `La propina se elige por porcentaje o monto, y «Sin propina» es una opción válida. En el descuento el sistema te dice «Tu rol permite hasta ${TOPE_DESCUENTO}»; si te pasás se pone en rojo con «Excede tu autorización · pedile al dueño» y no te deja cobrar. El descuento siempre pide motivo, con «Cortesía de la casa» entre las opciones.`,
      },
      {
        titulo: "Cobrar",
        texto:
          'Elegís método, confirmás, y el pago queda asentado en la caja. Cuando no falta nada dice «Mesa cobrada». Si el local tiene prendida la emisión automática, la Factura B a consumidor final sale sola al saldarse la cuenta, sin que nadie apriete nada; si no, se emite después desde el mismo cobro. Que salga sola es una configuración del dueño: si en tu local no sale, no está roto, está apagada — casi siempre porque el punto de venta todavía no está habilitado en ARCA. En los dos casos el cobro se cierra igual aunque ARCA no conteste: la plata no espera al papel.',
        aviso: {
          tono: "peligro",
          texto:
            'Si tocaste «Cobrar» y no pasó nada, no insistas: te va a decir "El pago ya se estaba registrando. Refrescá para ver el estado.". Refrescá y fijate ANTES de volver a cobrar, o la mesa queda cobrada dos veces.',
        },
      },
      {
        titulo: "Anular un cobro",
        texto:
          'Pide motivo obligatorio y lo que hace es "Los pagos cobrados se marcan como reembolsados (auditoría) y la mesa vuelve al plano como estaba, con todos sus ítems.". No borra nada: deja rastro y te devuelve la mesa. No sirve para corregir un monto — se anula y se cobra bien.',
        verTambien: { tema: "facturacion", texto: "Y si ya se había facturado" },
      },
    ],
  },
  {
    slug: "comandas",
    titulo: "La cocina y las comanderas",
    resumen: "Qué está saliendo, qué se demora, y qué hacer cuando una comanda no se imprime.",
    icono: ChefHat,
    grupo: "operacion",
    claves: [
      '"1 comanda no se imprimió" quiere decir que la cocina NO se enteró de ese plato.',
      '"sin conexión" es la PC de las impresoras caída: no sale ni un ticket hasta que vuelva.',
      "Editar una comanda reimprime el ticket corregido. Avisale a la cocina igual.",
    ],
    pasos: [
      {
        titulo: "Las tres columnas",
        texto:
          "«Pendientes» son las que la cocina todavía no tomó, «En cocina» las que está haciendo, «Entregadas» las que salieron. Arriba, «Saturación por sector» te dice qué estación está tapada — parrilla, fritera, la que sea.",
        imagen: "/ayuda/op-comandas.png",
        alt: "La pantalla de Comandas con la saturación por sector arriba y las columnas Pendientes, En cocina y Entregadas.",
        marcas: [
          { n: 1, x: 17, y: 17 },
          { n: 2, x: 11, y: 31.5 },
          { n: 3, x: 20, y: 46 },
        ],
      },
      {
        titulo: "Los platos de un menú del día vienen marcados",
        texto:
          "Cuando un plato sale de un menú del día, la comanda lo dice arriba del nombre —«MENÚ EJECUTIVO» y abajo la milanesa—, y las tarjetas de esta pantalla también. Importa cuando el mismo plato se sirve distinto según de dónde venga: sin la marca, la cocina lee un plato suelto. Si el menú se parte en dos sectores, los dos papeles la llevan, y en el «COMBINA CON» del otro sector el acompañamiento sale con el nombre del menú entre paréntesis.",
        verTambien: { tema: "menu-del-dia", texto: "Armar un menú del día" },
      },
      {
        titulo: "La que no se imprimió",
        texto:
          'Cuando una comanda falla aparece el aviso "1 comanda no se imprimió" y con «Ver solo las fallidas» las ves todas juntas para reimprimirlas. Mientras no se resuelva, para la cocina ese plato no existe.',
        aviso: {
          tono: "peligro",
          texto:
            "Antes de reimprimir, chequeá si el papel ya salió. Reimprimir a ciegas hace que se cocine dos veces.",
        },
      },
      {
        titulo: 'El cartel "Agente de impresión sin conexión (sin señal)"',
        texto:
          "Aparece arriba de todo, en rojo. Es la PC del local que conecta el sistema con las impresoras: apagada, dormida o sin red. Todo lo que cargues sigue funcionando pero no imprime nada. Es lo primero que hay que mirar cuando «no salen las comandas»: prendé esa máquina y las pendientes salen solas.",
      },
      {
        titulo: "Editar o anular una comanda",
        texto:
          'Desde las opciones de la comanda se corrige lo que salió mal y con «Guardar y reimprimir» sale el ticket corregido — "Comanda actualizada · se reimprime el ticket corregido.". Si la corrección es urgente, decíselo a la cocina de palabra: el papel nuevo puede llegar después de que empezaron.',
      },
    ],
  },
  {
    slug: "pedidos",
    titulo: "Los pedidos de la web",
    resumen: "Delivery y take away: qué clase de pedido es cada uno, cómo se aceptan y cómo se cobran.",
    icono: Truck,
    grupo: "operacion",
    claves: [
      "Acá viven SÓLO delivery y take away. Lo del salón no aparece: eso es Mesas.",
      "«No marchó» en rojo = alguien espera comida que nunca se empezó. Es lo más urgente de la pantalla.",
      "El motivo de cancelación lo lee el cliente en el seguimiento de su pedido.",
    ],
    pasos: [
      {
        titulo: "Qué clase de pedidos hay",
        texto:
          "Para el sistema hay tres destinos: a domicilio, para retirar, y para consumir en el local. Los dos primeros son los que ves acá. El tercero —la mesa, la venta de mostrador— no entra a esta pantalla: se maneja en el salón, y por eso el contador de arriba nunca cuenta una mesa.",
        verTambien: { tema: "mesas", texto: "Lo del salón se maneja acá" },
      },
      {
        titulo: "De dónde salen",
        texto:
          "Un pedido llega por dos caminos: lo carga el cliente desde la carta web, o lo cargás vos con «Cargar pedido» cuando llaman por teléfono. Los dos entran al mismo circuito y se cobran igual. El que carga el staff nace anotado como efectivo, pero lo que vale es el método que registrás al cobrar.",
      },
      {
        titulo: "Las tres columnas",
        texto:
          "Un pedido recorre «Pendientes» → «En cocina» → «Entregados», y se mueve con el botón de su tarjeta: confirmar lo manda a cocina, entregar lo cierra. El número al lado de «Pedidos online» es cuántos hay sin atender.",
        imagen: "/ayuda/op-pedidos.png",
        alt: "Las tres columnas de pedidos online: Pendientes, En cocina y Entregados.",
        marcas: [
          { n: 1, x: 7, y: 47 },
          { n: 2, x: 43.5, y: 9 },
        ],
      },
      {
        titulo: "Confirmar, y los que son para más tarde",
        texto:
          "«Confirmar pedido» lo acepta y manda la comanda a cocina — confirmá cuando estés seguro de que se puede hacer. Los encargados para otro momento quedan en la primera columna con el chip «Programado» y no salen a cocina hasta que corresponde. Aceptar un programado lo avala sin marcharlo. Ojo: un pedido para comer en el local no se puede programar.",
      },
      {
        titulo: "El que tenía que salir y sigue ahí",
        texto:
          'Si un programado se pasó de hora, la tarjeta se pone en rojo con «No marchó»: "Tenía que marchar y sigue acá — revisá que salga la comanda". «Marchar ya» lo manda a cocina en el momento.',
        aviso: {
          tono: "peligro",
          texto:
            "Casi siempre es que la comanda no llegó. Fijate en Comandas si la impresión falló antes de marcharlo de nuevo, o la cocina recibe dos.",
        },
        verTambien: { tema: "comandas", texto: "Las comandas que no se imprimieron" },
      },
      {
        titulo: "Corregir, cobrar, cancelar",
        texto:
          'Tocando la tarjeta se abre el detalle: ahí se saca lo que no hay, se cambian cantidades y se deja «Nota para cocina (sale en la comanda)». Un pedido de la web nace impago; los que pagan al recibir dicen «Efectivo · A cobrar» y se cobran desde ahí. Cancelar pide un motivo con ejemplos como «Sin stock, zona fuera de cobertura».',
      },
      {
        titulo: "Lo que escribís para la cocina no lo lee el cliente",
        texto:
          "«Nota para cocina» sale en la comanda y sólo ahí: el control que se le manda con el pedido ya no las lleva, igual que la cuenta que se le da en la mesa. Escribilas como lo que son —notas internas— sin cuidar cómo suenan afuera. Lo que sí sigue saliendo es lo que escribió el cliente al pedir, del tipo «tocar timbre»: eso es de él.",
        aviso: {
          tono: "ojo",
          texto:
            "El control también se achicó: entra en menos papel, con las mismas líneas. Si te acordás de uno más largo, no falta nada — está más compacto.",
        },
      },
    ],
  },
  {
    slug: "reservas",
    titulo: "Reservas",
    resumen: "El libro del día, las que pide el cliente por la web, y qué hacer cuando no hay lugar.",
    icono: CalendarDays,
    grupo: "operacion",
    claves: [
      "Una solicitud sin responder vence sola y el cliente recibe que no se pudo. Miralas al empezar el turno.",
      "El motivo del rechazo se lo mandamos al cliente: escribilo pensando en que lo lee él.",
      "Editar no confirma. Ajustá primero y decidí después, así el cliente recibe un solo aviso.",
    ],
    pasos: [],
    pasosPorModo: {
      estricto: [
        {
          titulo: "El día, hora por hora",
          texto:
            "La pantalla abre en hoy y lista las reservas por hora con su estado. Arriba se cambia de fecha y se busca por nombre o teléfono.",
          imagen: "/ayuda/op-reservas.png",
          alt: "La pestaña Reservas con el listado del día.",
        },
        {
          titulo: "Tomar una por teléfono",
          texto:
            'Pide nombre, teléfono, cuántos son y el horario, que sale de una grilla fija: elegís uno de los habilitados, no escribís la hora a mano. Si el que te piden no está, no hay turno ahí — y forzarlo desde acá no se puede. Está bien que no se pueda: en este modo el cupo es el cupo.',
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            'Quedan esperando tu respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar»; al rechazar podés escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Hasta que decidas, el cliente sabe que la pidió, no que la tiene.',
        },
        {
          titulo: "Cuando llega, y el que no vino",
          texto:
            "«Sentar la reserva» la pasa a «En mesa» — si no tiene mesa, la elegís en el plano. «No vino» la marca como ausente. Marcalo de verdad: es lo único que después deja ver quién falta seguido.",
          verTambien: { tema: "mesas", texto: "Qué pasa con la mesa cuando la sentás" },
        },
      ],
      flexible: [
        {
          titulo: "El libro del día, por servicio",
          texto:
            "La pantalla abre en hoy, con las reservas por hora dentro de cada servicio — mediodía, cena, el que tenga el local. Arriba se cambia de fecha y se busca por nombre o teléfono.",
          imagen: "/ayuda/op-reservas.png",
          alt: "La pestaña Reservas con el listado del día.",
        },
        {
          titulo: "Tomar una por teléfono",
          texto:
            "Pide nombre, teléfono, cuántos son, el servicio y la hora. Acá la hora se escribe: no hay grilla de turnos. La mesa es opcional — se puede tomar ahora y asignarla después, cuando armes el salón.",
        },
        {
          titulo: "El cupo es blando para vos y duro para el cliente",
          texto:
            'Con el servicio lleno, al que reserva por la web el sistema lo frena. A vos no: te dice "No quedan mesas libres en ese servicio. Confirmá para reservar igual." y te deja pasar. La diferencia es a propósito — vos sabés que a las 22:30 se libera la que entró a las 20:00, y la web no.',
          aviso: {
            tono: "ojo",
            texto: "Que puedas sobrevender no quiere decir que convenga. El cartel es para el caso que conocés, no para llenar el libro y ver qué pasa.",
          },
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            'Quedan esperando tu respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar»; al rechazar podés escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Hasta que decidas, el cliente sabe que la pidió, no que la tiene.',
        },
        {
          titulo: "Cuando llega, y el que no vino",
          texto:
            "«Sentar la reserva» la pasa a «En mesa»; como en este modo la mesa suele estar sin asignar, la elegís en el plano en ese momento. «No vino» la marca como ausente — marcalo de verdad, es lo único que después deja ver quién falta seguido.",
          verTambien: { tema: "mesas", texto: "Qué pasa con la mesa cuando la sentás" },
        },
      ],
    },
  },
  {
    slug: "cuentas-corrientes",
    titulo: "Cuentas corrientes",
    resumen: "Fiarle a alguien, ver quién debe y cobrarle el saldo cuando viene a pagar.",
    icono: BookUser,
    grupo: "operacion",
    claves: [
      "Fiar CIERRA la mesa: se salda, se libera y la factura sale igual. Lo que queda abierto es el saldo del cliente.",
      "El fiado no es plata cobrada: no entra al arqueo. Al cerrar la caja no lo vas a tener en el cajón.",
      "Cobrar un saldo en efectivo sí entra a la caja. Por transferencia o tarjeta, no.",
    ],
    pasos: [
      {
        titulo: "Quién debe cuánto",
        texto:
          "La pestaña lista a los que deben, del que más debe para abajo, con hace cuánto que no paga, y tiene buscador por nombre o teléfono. A la derecha, «Total fiado», cuántos clientes son, y el corte por antigüedad —«Al día», «+30 días», «+60 días»—: los +60 se marcan en rojo y son la lista de a quién llamar. Si no debe nadie, dice «Nadie debe nada».",
        imagen: "/ayuda/op-cuentas-corrientes.png",
        alt: "La pestaña Cuentas corrientes: la lista de deudores a la izquierda y el total fiado con el corte por antigüedad a la derecha.",
        // % del ancho y del alto de la captura (1160 × 790).
        marcas: [
          { n: 1, x: 8, y: 22 },
          { n: 2, x: 63, y: 23.5 },
          { n: 3, x: 73, y: 27.5 },
        ],
      },
      {
        titulo: "Qué es fiar acá",
        texto:
          "Es una forma de cobro más, al lado de Efectivo y Tarjeta: «Cuenta corriente». Elegirla cierra la cuenta en el momento —la mesa se libera, la comanda ya salió, la factura se emite igual— y lo único que queda vivo es la deuda de ese cliente, que se paga otro día. No es una mesa que se deja abierta: una mesa abierta te frena el cierre de caja, y un fiado no.",
        aviso: {
          tono: "ojo",
          texto:
            "Es el reemplazo del plano «Pedidos de Mostrador», que ya no existe. Si estabas usando esas mesas para anotar a los que pagan después, esto es lo que va en su lugar.",
        },
        verTambien: { tema: "caja", texto: "Qué sí frena el cierre de caja" },
      },
      {
        titulo: "Fiar, desde el cobro",
        texto:
          'En la pantalla de cobro elegís el método «Cuenta corriente» y abajo aparece «¿A quién se le fía?». Buscás por nombre o teléfono y elegís: la ficha te muestra el saldo que ya tiene —«ya debe $12.400»— antes de confirmar. Sin cliente elegido no se puede cobrar. Funciona igual en la mesa, en un pedido de la web y en la venta de mostrador.',
        verTambien: { tema: "cobrar", texto: "La pantalla de cobro, paso a paso" },
      },
      {
        titulo: "El que no está en la lista",
        texto:
          '«Abrir cuenta a alguien más» lo da de alta ahí mismo, con nombre y teléfono, sin salir del cobro. No hace falta habilitarlo antes desde su ficha: fiarle a alguien le abre la cuenta. Y si el teléfono ya estaba cargado, "Si el teléfono ya está cargado, se le abre la cuenta a ese mismo cliente." — no se duplica, se le abre la cuenta al que ya estaba.',
      },
      {
        titulo: "Se fía entero, y no todos pueden",
        texto:
          "El fiado cubre todo lo que falta: no se fía la mitad y se cobra la otra mitad en efectivo, y no lleva propina. Si son dos cosas distintas, se divide la cuenta y se cobra cada parte por su lado. Fían el dueño, vos y la compu del salón —que es la que está en el mostrador cuando el socio pide que se lo anoten—. El mozo no: cobra, pero no decide a quién se le fía.",
        verTambien: { tema: "cobrar", texto: "Dividir una cuenta" },
      },
      {
        titulo: "Ojo con el número de la caja",
        texto:
          'Un fiado es venta, pero NO es plata que entró. Por eso queda afuera de «Cobrado en el período» y no toca «En la caja deberías tener»: si fiaste $30.000, esos $30.000 no están en el cajón y el arqueo no los espera. El cobro igual te pide elegir la caja —es un movimiento y tiene que quedar en algún lado—, pero al arqueo no suma.',
        aviso: {
          tono: "peligro",
          texto:
            "No cuentes el fiado como plata del turno. Es exactamente el error que hace cerrar una caja con una diferencia que después nadie puede explicar.",
        },
        verTambien: { tema: "caja", texto: "Los dos números de la caja" },
      },
      {
        titulo: "Cuando vienen a pagar",
        texto:
          '«Registrar pago» abre el cobro del saldo: «Cuánto paga» viene con la deuda entera puesta y se puede bajar si paga una parte, «Cómo paga» (Efectivo, Transferencia, Tarjeta, Otro) y «Entra en», que es la caja. Al confirmar dice «Pago registrado. Cuenta saldada» si no quedó nada.',
        aviso: {
          tono: "ojo",
          texto:
            "Si paga en efectivo, la plata entra a la caja como un ingreso y el arqueo la espera. Si paga por transferencia o tarjeta, queda sólo en el libro del cliente: al cajón no entró nada.",
        },
      },
      {
        titulo: "Un saldo «a favor»",
        texto:
          "A veces un cliente aparece con saldo a favor y en verde. No es un error: pasa cuando se anula un consumo que ya estaba fiado, o cuando pagó de más. Es plata que el local le debe a él, y por eso se muestra en vez de esconderse.",
      },
      {
        titulo: "Sacarle la cuenta a un moroso",
        texto:
          'Se hace desde la ficha del cliente, en «Cuenta corriente»: el interruptor de la derecha. Apagado dice "Ya no puede fiar. La deuda sigue registrada." — deja de poder llevarse cosas, pero lo que ya debe no se borra ni se esconde. En la misma ficha están el saldo, hace cuánto que no paga y el libro con todos los movimientos.',
        verTambien: { tema: "clientes", texto: "La ficha del cliente" },
      },
    ],
  },
  {
    slug: "rendicion",
    titulo: "La rendición de los mozos",
    resumen: "La plata que los mozos tienen encima y cómo pasa al cajón antes de cerrar.",
    icono: HandCoins,
    grupo: "operacion",
    claves: [
      "Acá se rinde SÓLO efectivo. Lo cobrado con tarjeta, QR o transferencia ya entró a la caja solo.",
      "Sin todas las rendiciones la caja no cierra, y a un mozo con una mesa sin cobrar no se le puede rendir.",
      "El que no entrega queda registrado como deuda, a la vista en el cierre y avisada al dueño.",
    ],
    pasos: [
      {
        titulo: "Quién debe cuánto",
        texto:
          'Se rinde desde la pestaña Caja, abajo de todo: en «Cobrado por empleado · rendición» hay una tarjeta por persona con lo que cobró en esa caja y, al pie, «Efectivo a rendir» con el botón «Rendir». Si ya rindió dice «Rendido». Es sólo el efectivo: lo que cobró con tarjeta, QR o transferencia no aparece acá, porque esa plata ya entró a la caja sola y el mozo no la tiene encima. Si tiene una mesa sin cobrar —abierta, o cerrada con saldo porque se anuló un cobro— el botón queda trabado y la tarjeta dice cuál: cobrala primero, o esa plata termina en una segunda rendición.',
        aviso: {
          tono: "ojo",
          texto:
            "Si querés ver todo lo que cobró un mozo, con tarjetas incluidas, eso está en la caja y en el resumen del cierre. Acá se le pide plata a una persona: sólo puede figurar lo que tiene en el bolsillo.",
        },
        imagen: "/ayuda/op-rendicion.png",
        alt: "Las tarjetas por empleado al pie de la caja, con el efectivo a rendir de cada uno.",
        // % del ancho y del alto de la captura (1160 × 860).
        marcas: [
          { n: 1, x: 13.5, y: 28.4 },
          { n: 2, x: 12.6, y: 50 },
        ],
      },
      {
        titulo: "Tomar la entrega",
        texto:
          "Escribís en «Efectivo que entrega» lo que te dio y confirmás. Si coincide, listo. Esa plata deja de estar a nombre del mozo y pasa al cajón.",
      },
      {
        titulo: "El que cobró todo con tarjeta",
        texto:
          'Un mozo puede aparecer con $0 para entregar. Su rendición dice «No tiene efectivo para entregar» — "Cobró todo con tarjeta, QR o transferencia — esa plata ya entró a la caja. Sólo queda cerrarle el período del turno." — y el botón es «Cerrar período». No tenés que elegir entre «Rindió» y «No entregó»: no hay nada que entregar, y marcarlo como que no entregó le dejaría una deuda de $0 avisada al dueño.',
      },
      {
        titulo: "Las que ya se tomaron",
        texto:
          "Debajo de las tarjetas, al desplegar «Últimas rendiciones», queda la constancia: qué se esperaba, qué entregó cada uno, la diferencia —«OK» cuando cerró— y quién la registró. Es el lugar donde mirar si alguien pregunta.",
      },
      {
        titulo: "Cuando no coincide",
        texto:
          'Si entrega de menos o de más, el sistema pide «¿Qué pasó?» con ejemplos como «Ej: le di cambio de más, billete falso…». Y si se fue sin rendir, está «Marcar como no entregó», que también pide el porqué.',
        aviso: {
          tono: "ojo",
          texto:
            "Lo que escribas queda a la vista en el cierre y se le avisa al dueño. Es información, no castigo: un mozo al que le pasa una vez es un mal día, uno al que le pasa siempre es otra conversación.",
        },
        verTambien: { tema: "caja", texto: "El cierre de caja" },
      },
    ],
  },
  {
    slug: "fichaje",
    titulo: "Fichaje y asistencia",
    resumen: "Quién entró, quién salió y quién no fichó todavía.",
    icono: Clock,
    grupo: "operacion",
    claves: [
      "Cada uno ficha con su PIN: no fiches por otro.",
      '"Sin fichar" a mitad del turno suele ser un olvido, no una ausencia. Preguntá.',
    ],
    pasos: [
      {
        titulo: "La asistencia del día",
        texto:
          '«Asistencia del día» muestra quién está adentro ahora, «Ya salieron» los que terminaron y «Sin fichar» los que todavía no marcaron. Si nadie fichó, dice "No hay nadie fichado todavía.".',
        imagen: "/ayuda/op-fichaje.png",
        alt: "La pestaña Fichaje con la asistencia del día y el teclado para marcar con PIN.",
      },
      {
        titulo: "Cómo se ficha",
        texto:
          "Con el PIN de cada uno en el teclado numérico. Es de la persona: sirve para las horas trabajadas y para saber quién estaba cuando pasó algo.",
      },
    ],
  },

  // ══ El local ═════════════════════════════════════════════════════════════
  // ══ Catálogo ═════════════════════════════════════════════════════════════
  //
  // «Productos e inventario» es UNA pantalla con siete pestañas, pero adentro
  // hay cuatro trabajos que no se parecen en nada: mantener la carta, armar el
  // menú del día, contar lo que hay, y mirar cuánto deja cada plato. Un solo
  // tema con siete pasos obligaba a leer sobre food cost para encontrar cómo se
  // marca un producto agotado.
  {
    slug: "carta",
    titulo: "La carta: productos, categorías y sectores",
    resumen: "Lo que el cliente ve, cómo se ordena y a qué comandera sale cada cosa.",
    icono: Package,
    grupo: "catalogo",
    claves: [
      "Cuando se acaba algo, marcalo «No disponible». No lo borres.",
      "El sector decide a qué comandera sale el producto. Sin sector, no se imprime en ningún lado.",
    ],
    pasos: [
      {
        titulo: "Las siete pestañas",
        texto:
          "Arriba está todo el catálogo con su número al lado: Productos, Categorías, Sectores, Menú del día, Insumos, Costeo y Stock. Los tres primeros son la carta; los últimos tres, lo que hay en el local y cuánto cuesta.",
        imagen: "/ayuda/cat-productos.png",
        alt: "La pantalla Productos e inventario con sus siete pestañas y la lista de productos.",
        marcas: [
          { n: 1, x: 14, y: 22.5 },
          { n: 2, x: 58, y: 30.5 },
          { n: 3, x: 11, y: 36 },
        ],
      },
      {
        titulo: "Cuando se acaba algo",
        texto:
          "Marcar un producto como no disponible lo saca de lo que ve el cliente sin borrarlo: mantiene su precio, su receta y su historial, y cuando vuelve a haber se reactiva en un toque. El filtro de arriba —Todos, Disponibles, No disponibles— te muestra de una qué está caído, que es lo que conviene repasar antes de abrir. Borrar el producto es lo que NO hay que hacer.",
        imagen: "/ayuda/det-carta-nodisponibles.png",
        alt: "El filtro de disponibilidad de la carta, con «No disponibles» seleccionado.",
        marcas: [{ n: 1, x: 68, y: 56 }],
      },
      {
        titulo: "Categorías: el orden de la carta",
        texto:
          "Las categorías son cómo se agrupa la carta para el cliente, y se arrastran para reordenarlas. Cada una lleva un «Sector de cocina default» que heredan sus productos.",
        imagen: "/ayuda/cat-categorias.png",
        alt: "La pestaña Categorías, con las categorías agrupadas por supercategoría.",
      },
      {
        titulo: "Sectores: a qué comandera sale cada cosa",
        texto:
          "Los sectores son las estaciones del local —cocina, parrilla, fritera, postres y café— y son los que deciden en qué impresora sale cada comanda. Un producto hereda el sector de su categoría y puede pisarlo desde su propia ficha.",
        imagen: "/ayuda/cat-sectores.png",
        alt: "La pestaña Sectores, con las estaciones del local.",
        aviso: {
          tono: "peligro",
          texto:
            "Un producto sin sector no se rutea a ninguna comandera: se vende y la cocina nunca se entera. Si algo «no imprime nunca», mirá esto antes que la impresora.",
        },
        verTambien: { tema: "comandas", texto: "Las comandas y las impresoras" },
      },
    ],
  },
  {
    slug: "menu-del-dia",
    titulo: "El menú del día",
    resumen: "Armar el combo, ponerle precio único y elegir qué días corre.",
    icono: UtensilsCrossed,
    grupo: "catalogo",
    claves: [
      "El precio del menú es único: los adicionales de los productos no se suman.",
      "Si no marcás los días, no aparece. El menú sólo se ve los días que elegiste.",
    ],
    pasos: [
      {
        titulo: "Qué lleva adentro",
        texto:
          'Se arma con productos fijos —los que van sí o sí— y grupos para elegir, del tipo «Elegir una de:» con las guarniciones adentro. El cliente arma su plato dentro de lo que vos habilitaste.',
        imagen: "/ayuda/cat-menu-del-dia.png",
        alt: "La pestaña Menú del día con los menús cargados.",
      },
      {
        titulo: "El precio",
        texto:
          'Es uno solo para todo el combo: "Precio único del combo. No se suman adicionales.". Aunque el cliente elija la guarnición más cara, paga lo mismo — eso es lo que lo hace un menú y no una lista de platos.',
      },
      {
        titulo: "Lo que cada producto se trae puesto",
        texto:
          'Debajo de cada producto que elegís, el editor te lista los modificadores que ese producto ya tiene en la carta: "Al elegir esta opción, el asistente va a preguntar además:" y abajo los grupos, con si son obligatorios. Es lo que antes no se veía: elegías «Milanesa» sin manera de saber que arrastraba su propia «Guarnición».',
        verTambien: { tema: "carta", texto: "Los modificadores de un producto" },
      },
      {
        titulo: 'El aviso "se pregunta dos veces"',
        texto:
          'Si el menú ya pregunta algo con ese mismo nombre, el aviso se pone en ámbar: "El combo ya pregunta «Guarnición»; este producto la va a preguntar de nuevo. Se puede guardar igual: revisá si es lo que querés." Se puede guardar —a veces querés las dos— pero el cliente va a elegir guarnición dos veces, y eso se descubre en el salón, en hora pico.',
        aviso: {
          tono: "ojo",
          texto:
            "Un producto puesto como componente FIJO del menú no pregunta nada: sus modificadores se listan igual, aclarando que el asistente no los va a preguntar.",
        },
      },
      {
        titulo: "Los días que corre",
        texto:
          'Marcás los días de la semana y "El menú solo va a aparecer en el catálogo esos días.". Es el olvido más común: se carga el menú un jueves, no se marcan los días, y nadie lo ve nunca.',
      },
    ],
  },
  {
    slug: "stock",
    titulo: "El stock y la merma",
    resumen: "Bebidas, cocina, bar y lo que se tira. Qué contar en cada uno.",
    icono: Boxes,
    grupo: "catalogo",
    claves: [
      "Son tres stocks distintos: Bebidas, Cocina y Bar. No se mezclan.",
      "Todo movimiento de cocina pide motivo. Es lo que después explica el número.",
      "El número en rojo o amarillo es que está por debajo del mínimo que vos fijaste.",
    ],
    pasos: [
      {
        titulo: "Los tres stocks y la merma",
        texto:
          "Adentro de Stock hay cuatro pestañas y conviene no confundirlas. «Bebidas» es lo que se vende cerrado y se cuenta por unidad. «Cocina» va por insumos, en envases. «Bar» son productos puntuales —alfajores, turrón— que se cuentan aparte sin tocar las listas grandes. «Merma» es el reporte de lo que se perdió.",
        imagen: "/ayuda/cat-stock.png",
        alt: "La pestaña Stock con sus cuatro sub-pestañas —Bebidas, Cocina, Bar y Merma— y la tabla de productos con stock y mínimo.",
        marcas: [
          { n: 1, x: 10, y: 31.3 },
          { n: 2, x: 58, y: 49 },
          { n: 3, x: 70, y: 49 },
        ],
      },
      {
        titulo: "El stock, el mínimo y lo que hay que reponer",
        texto:
          "Cada fila tiene lo que hay, el mínimo que vos definiste y una columna Estado. Arriba dice cuántos insumos están activos y cuántos «con alerta», y los filtros Todos / Alertas / Agotados te dejan ver sólo lo que falta: es la lista de compras del día, sin buscarla a mano. El mínimo es tuyo — ponelo en lo que tardás en reponer, no en cero.",
        imagen: "/ayuda/det-stock-cocina.png",
        alt: "El stock de cocina con el contador de insumos con alerta, los filtros Todos, Alertas y Agotados, y la columna Estado.",
        marcas: [
          { n: 1, x: 23, y: 56 },
          { n: 2, x: 68, y: 54 },
          { n: 3, x: 75, y: 72 },
        ],
      },
      {
        titulo: "Cargar movimientos de cocina",
        texto:
          'Se carga «Cantidad de envases» —"Positivo para sumar, negativo para restar."— y "El motivo es obligatorio.", con ejemplos como «Merma por vencimiento, conteo físico». Si un insumo no acepta cantidades es porque no tiene presentaciones cargadas: se le agrega al menos una desde Insumos.',
      },
      {
        titulo: "Insumos: en qué viene cada cosa",
        texto:
          "La pestaña «Insumos» es la lista de materia prima con sus presentaciones: el envase en que se compra y cuánto trae. Es lo que hace posible cargar stock de cocina en envases en vez de en gramos, y lo que alimenta el costo de cada receta.",
        imagen: "/ayuda/cat-insumos.png",
        alt: "La pestaña Insumos, con la materia prima y sus presentaciones.",
        verTambien: { tema: "costeo", texto: "De acá sale el costo de cada plato" },
      },
      {
        titulo: "La merma",
        texto:
          "Muestra el porcentaje de pérdida de cada insumo en el período que elijas. Sirve para ver qué se está tirando y en qué estación; no es un inventario contable ni pretende serlo.",
      },
    ],
  },
  {
    slug: "costeo",
    titulo: "Costos y margen",
    resumen: "Cuánto cuesta cada plato, cuánto deja, y cuáles se están vendiendo a pérdida.",
    icono: TrendingUp,
    grupo: "catalogo",
    claves: [
      "Un margen en rojo es un plato que se vende a pérdida. Es lo primero que hay que mirar acá.",
      "Sólo se puede costear lo que tiene receta cargada. El resto figura «sin receta».",
    ],
    pasos: [
      {
        titulo: "Los tres números de arriba",
        texto:
          '«Margen promedio» es cuánto deja la carta en general; «Con receta» cuántos productos se pueden costear; «Sin receta» los que no —"sin food cost calculable"—. Si el segundo número es chico, el margen promedio dice poco: está mirando una parte de la carta.',
        imagen: "/ayuda/cat-costeo.png",
        alt: "La pestaña Costeo con el margen promedio, los productos con y sin receta, y la tabla de food cost por producto.",
        marcas: [
          { n: 1, x: 17, y: 34 },
          { n: 2, x: 78, y: 55.5 },
        ],
      },
      {
        titulo: "La tabla, ordenada por margen",
        texto:
          "Cada fila tiene el precio de venta, el food cost y el margen en porcentaje y en pesos. Ordenada por margen, arriba de todo quedan los peores. Los negativos van en rojo.",
      },
      {
        titulo: "Un margen negativo",
        texto:
          "Quiere decir que ese plato cuesta más de lo que se cobra: cada vez que se vende, el local pierde plata. Casi siempre es una de dos cosas: subió un insumo y no se tocó el precio, o la receta está cargada con cantidades equivocadas. Las dos se arreglan, pero hay que mirarlo.",
        aviso: {
          tono: "ojo",
          texto:
            "Antes de correr a cambiar precios, revisá la receta: un margen de −90% suele ser un error de carga (gramos donde iban kilos) y no un plato regalado.",
        },
      },
    ],
  },

  {
    slug: "salones",
    titulo: "Salones y mesas",
    resumen: "Armar el plano: crear salones, agregar mesas y moverlas cuando cambia el local.",
    icono: Table2,
    grupo: "resto",
    claves: [
      "Borrar un salón borra sus mesas. Las reservas viejas no se borran, pero quedan sin mesa.",
      "El plano es lo que ve el mozo: si el salón cambió de verdad, cambialo acá el mismo día.",
    ],
    pasos: [
      {
        titulo: "Crear un salón",
        texto:
          'Le ponés nombre y después "podés agregar mesas y subir una foto del plano desde el editor". Tener el salón dibujado parecido a la realidad es lo que hace que el mozo encuentre la mesa sin pensar.',
      },
      {
        titulo: "Las mesas",
        texto:
          "Se agregan, se renombran y se arrastran hasta que el plano se parezca al salón. Los nombres son los que va a leer todo el mundo en la comanda y en la cuenta: usá los que ya usa el local, no los que te parezcan prolijos.",
      },
      {
        titulo: "Borrar un salón",
        texto:
          'El sistema te avisa: "Las mesas del salón se borran. Las reservas históricas que apuntaban a esas mesas quedan sin mesa asignada (pero no se borran)."',
        aviso: {
          tono: "peligro",
          texto: "Si el salón cambia por una temporada o un evento, conviene editarlo en vez de borrarlo y rehacerlo: borrar deja reservas futuras sin mesa.",
        },
      },
    ],
  },
  {
    slug: "proveedores",
    titulo: "Proveedores, compras y pagos",
    resumen:
      "Qué le compraste a cada uno, cuánto le debés, cuándo vence y de dónde sale la plata para pagarle.",
    icono: Building2,
    grupo: "resto",
    claves: [
      "La compra de todos los días no necesita factura: poné el importe y guardá.",
      "El pago a proveedor sale de la Caja Mayor, nunca del cajón del turno.",
      "Para anular un comprobante que ya se pagó, primero se anula el pago.",
    ],
    pasos: [
      {
        titulo: "Cargar una compra",
        texto:
          "Entrá al proveedor y tocá «Cargar compra». Lo único que tenés que escribir es el importe: el concepto de gasto y el vencimiento ya vienen puestos según ese proveedor, y la fecha es hoy. Si la compra no tiene factura —el reparto de la verdulería, el pan— dejalo como está: el comprobante arranca en «Sin comprobante» y ni siquiera te pide número. Recién si elegís Factura A, B o C aparece el campo del número.",
      },
      {
        titulo: "La foto del comprobante",
        texto:
          "Sacale la foto al papel cuando llega, que es cuando está en la mano. Además de quedar guardada con la compra, el sistema la lee: te llena el importe y el número, y si la factura trae renglones te los muestra al lado para que los confirmes. Si no la puede leer, la foto queda igual y cargás el importe a mano — no perdés nada.",
      },
      {
        titulo: "Los conceptos de gasto",
        texto:
          "Cada compra se guarda con un concepto —«Carnes», «Verdulería», «Gas»—, y eso es lo que después responde en qué se te fue la plata. Cada proveedor tiene el suyo por defecto, así que no lo elegís cada vez. Si te falta uno, la solapa «Conceptos» los agrega sin llamar a nadie.",
      },
      {
        titulo: "Detallar los insumos",
        texto:
          "Si querés, la compra se puede abrir en renglones: tres cajones de tomate, cinco kilos de muzzarella. No es obligatorio y no hace falta que sumen justo el total. Lo que gana: el stock de cada insumo sube solo, y el costo de los platos que lo usan se actualiza con lo que pagaste de verdad.\n\nSi subiste la foto, los renglones vienen leídos: al lado de cada uno te muestro qué decía el papel y qué entendí. Los que estoy seguro vienen tildados; los que tengo duda —un precio muy distinto al de la última compra, un envase que no me cierra— vienen destildados y con el motivo escrito. Lo que quede destildado no se carga. Y los que no son insumos —limpieza, bebida, descartables— quedan dentro del importe: está bien que sea así.",
        verTambien: { tema: "stock", texto: "Cómo se descuenta el stock" },
      },
      {
        titulo: "Cuánto le debo",
        texto:
          "La ficha del proveedor muestra el saldo arriba y las compras abajo, cada una con lo que todavía queda debiendo. Tocá una y al costado aparece con qué pagos se canceló. Las fechas de arriba filtran las compras que ves, pero no el saldo: lo que le debés es lo que le debés, mires el mes que mires.",
      },
      {
        titulo: "Pagarle",
        texto:
          "«Pagar» te muestra los comprobantes impagos: tildás los que estás cancelando y el total se llena solo. Si pagás de más, la diferencia queda como pago a cuenta y baja del saldo igual. Si pagás sin tildar nada, es todo a cuenta.",
      },
      {
        titulo: "La Caja Mayor",
        texto:
          "El efectivo con el que se le paga a los proveedores no sale del cajón del turno: sale de la Caja Mayor, que es una caja aparte, administrativa. Por eso pagarle al carnicero no te descuadra el cierre. La ves arriba de todo en Proveedores, con su saldo, y le cargás plata con «Ingresar efectivo».",
        aviso: {
          tono: "ojo",
          texto:
            "Si el saldo está en rojo no es un error: quiere decir que salió más plata de la que le pusiste. Se arregla cargándole efectivo, y mientras tanto no te frena ningún pago.",
        },
        verTambien: { tema: "caja", texto: "Las cajas del local" },
      },
      {
        titulo: "Qué vence y cuándo",
        texto:
          "«Vencimientos» lista lo que debés ordenado por atraso, para saber a quién llamar. «Proyección» es el mismo dato en un calendario: cada día muestra cuánta plata necesitás ese día, y tocándolo ves a quién. Lo que ya venció y no se pagó aparece sumado al día de hoy, en rojo, para que no se te escape del mes pasado.",
      },
      {
        titulo: "Corregir o dar de baja",
        texto:
          "Si te equivocaste en el concepto, la fecha o el número, se edita y listo. Si te equivocaste en el importe de algo que ya pagaste, no: primero anulás el pago, después el comprobante. Nada se borra nunca, se anula con un motivo y queda tachado a la vista, para que dentro de un mes se entienda qué pasó.",
      },
    ],
  },
  {
    slug: "facturacion",
    titulo: "Comprobantes",
    resumen: "Las facturas emitidas, las que fallaron y cómo se anula una mal hecha.",
    icono: FileText,
    grupo: "resto",
    claves: [
      "Una factura no se corrige: se anula con nota de crédito y se emite de nuevo.",
      "Un rechazo de datos de ARCA no se arregla reintentando. Un error de conexión sí.",
      "A quién se le factura se guarda una vez en «Entidades fiscales» y después se busca por nombre.",
    ],
    pasos: [
      {
        titulo: "Dónde aparecen",
        texto:
          'Los comprobantes se emiten desde el cobro y se ven acá — "Los comprobantes aparecen acá al facturar desde el cobro.". Se busca por número o CUIT. Si el negocio todavía no tiene los datos fiscales cargados vas a ver "AFIP no configurado", y eso lo resuelve el dueño.',
        verTambien: { tema: "cobrar", texto: "Elegir la factura al cobrar" },
      },
      {
        titulo: "«Entidades fiscales»: a quién se le factura",
        texto:
          "Es la libreta de los que reciben Factura A: razón social, CUIT y condición de IVA, guardados una sola vez. Se busca con «Buscar por razón social o CUIT…», se entra a cada uno para corregirle un dato y ver sus facturas, y los que ya facturaban en el sistema viejo están cargados. Sirve para eso: para no tipear once dígitos en el mostrador cada vez que viene la misma empresa.",
        aviso: {
          tono: "ojo",
          texto:
            "Un CUIT no se carga dos veces: si ya estaba, el sistema te avisa y deja la ficha como estaba en vez de pisarla con lo que acabás de escribir.",
        },
      },
      {
        titulo: "«Facturar un monto»: una factura sin pedido",
        texto:
          "Es para lo que se factura fuera del salón: un evento, un abono mensual, un acuerdo con una empresa. Le ponés «Concepto» —«Ej: Almuerzos médicos - agosto»— y el «Monto total (ARS)», y sale el comprobante. No es un pedido ni pasa por cocina: es sólo el papel.",
      },
      {
        titulo: "Cuando una falla",
        texto:
          'El detalle te dice de qué tipo es el problema, y son dos muy distintos: "Error temporario de conexión con el provider: podés reintentar tal cual." se resuelve reintentando; "Rechazo de datos de ARCA: revisá CUIT / datos del comprobante antes de reintentar." no — ahí hay un dato mal y reintentar sin corregirlo vuelve a fallar.',
      },
      {
        titulo: "Anular una factura",
        texto:
          '«Anular comprobante» pide motivo —con el ejemplo «factura mal hecha al mozo»— y "Se emite la nota de crédito y la factura queda anulada.". Así se corrige una factura: nunca editándola.',
        aviso: {
          tono: "ojo",
          texto: 'A veces el comprobante queda "en proceso en ARCA" un rato. Eso no es un error: esperá antes de anular o reintentar.',
        },
      },
    ],
  },

  // ══ Los clientes ═════════════════════════════════════════════════════════
  {
    slug: "clientes",
    titulo: "Los clientes",
    resumen: "Quién pide, qué pide y hace cuánto que no viene.",
    icono: Users,
    grupo: "resto",
    claves: [
      "«Días desde el último» es el dato que dice a quién hay que llamar.",
      "Un cliente sin direcciones guardadas puede ser de retiro, no un error.",
      "El interruptor de «Cuenta corriente» sirve para QUITARLE el permiso a un moroso: para dárselo alcanza con fiarle.",
    ],
    pasos: [
      {
        titulo: "La ficha",
        texto:
          "Cada cliente tiene su historial de pedidos, «Lo que más pide» y «Días desde el último». Con eso sabés qué ofrecerle antes de que pregunte y quién dejó de venir sin avisar.",
      },
      {
        titulo: "Su cuenta corriente",
        texto:
          'El bloque «Cuenta corriente» —"Puede llevarse cosas y pagarlas después."— muestra cuánto «Debe», hace cuántos días que no paga, y el libro con todo: los consumos con «+» y las cobranzas con «−», y lo anulado tachado. El interruptor de la derecha es para SACARLE el permiso: apagado dice "Ya no puede fiar. La deuda sigue registrada." No hace falta prenderlo para fiarle a alguien — se le abre la cuenta al fiarle desde el cobro.',
        verTambien: {
          tema: "cuentas-corrientes",
          texto: "Fiar y cobrar el saldo",
        },
      },
      {
        titulo: "Escribirle",
        texto:
          "Desde la ficha se abre WhatsApp Web con ese contacto, sin tener que buscar el número. Para hablarles a muchos a la vez, eso son las campañas.",
        verTambien: { tema: "promociones", texto: "Promos y campañas" },
      },
    ],
  },
  {
    slug: "promociones",
    titulo: "Promos y campañas",
    resumen: "Códigos de descuento y mensajes para traer de vuelta a los que no vienen.",
    icono: Tag,
    grupo: "resto",
    claves: [
      "Una promo activa la puede usar cualquiera en el checkout: revisá el pedido mínimo antes de activarla.",
      "En una campaña, cada cliente recibe un código personal de un solo uso.",
      "Los mensajes de campaña los mandás vos, uno por uno, desde WhatsApp.",
    ],
    pasos: [
      {
        titulo: "Un código de descuento",
        texto:
          'Se crea con el código, el tipo de descuento —porcentaje, monto fijo o anular el envío— y opcionalmente un pedido mínimo y una fecha de vencimiento. Mientras está activa, "Los clientes pueden aplicarla en el checkout."; desactivada, "El código existe pero los clientes no pueden usarlo.".',
        aviso: {
          tono: "ojo",
          texto: "Sin pedido mínimo, un 20% se lo lleva también el que pide un café. Poné el mínimo antes de activarla, no después.",
        },
      },
      {
        titulo: "Una campaña a un grupo",
        texto:
          'Elegís a quiénes —todos, o por comportamiento: «No piden hace 30–90 días», «Pidieron 5 o más veces»—, el descuento y el mensaje. "Cada cliente recibe el mensaje con su nombre y un código personal único, de un solo uso."',
      },
      {
        titulo: "Mandarla",
        texto:
          "La campaña te arma la lista y, cliente por cliente, abre WhatsApp con el mensaje ya escrito. Vos apretás enviar. Después se marca quién recibió y quién usó su código, así sabés si sirvió.",
      },
    ],
  },
  {
    slug: "conversaciones",
    titulo: "WhatsApp y el bot",
    resumen: "Las conversaciones con los clientes y cuándo sacarle el teclado al bot.",
    icono: MessagesSquare,
    grupo: "resto",
    claves: [
      "Mientras el agente está prendido, el bot contesta y vos no podés escribir.",
      "Apagalo para atender vos; prendelo de nuevo cuando termines, o el cliente queda sin respuesta automática.",
    ],
    pasos: [
      {
        titulo: "La bandeja",
        texto:
          "Están todas las conversaciones, marcadas con quién las atiende: «El agente (bot) atiende esta conversación» o «La atiende un humano».",
      },
      {
        titulo: "Tomar una conversación",
        texto:
          'Con el agente prendido, "El bot atiende. Apagalo para escribirle vos al cliente.". Lo apagás y el cuadro de texto se habilita: "Lo estás atendiendo vos. Prendé el agente para devolvérselo al bot.".',
        aviso: {
          tono: "ojo",
          texto: "Acordate de volver a prenderlo al terminar. Una conversación que quedó en manos de nadie es un cliente esperando.",
        },
      },
    ],
  },

  // ══ Si algo falla ════════════════════════════════════════════════════════
  //
  // CATÁLOGO: no se numera (ver TipoTema). Cada entrada arranca con la frase
  // LITERAL que el panel pinta, para poder encontrarla con Cmd+F desde la
  // pantalla. Si cambiás un mensaje en el código, cambialo acá.
  {
    slug: "carteles",
    titulo: "Me apareció un cartel",
    resumen: "Qué significa cada aviso del sistema y qué hay que hacer.",
    icono: TriangleAlert,
    grupo: "problemas",
    claves: [
      "Buscá acá la frase exacta que estás leyendo en la pantalla.",
      "Los carteles en rojo cuestan plata si se ignoran. Los amarillos, tiempo.",
    ],
    tipo: "catalogo",
    pasos: [
      {
        titulo: '"La diferencia excede tu autorización. Pedile al admin que cierre la caja."',
        texto:
          `Contaste el cajón y falta o sobra más de ${TOPE_DIFERENCIA_CAJA}. Es el techo de lo que podés cerrar solo. No cambies el número contado para que entre: llamá al dueño, que él sí puede cerrarla, y dejá escrito en las notas qué pasó.`,
        aviso: {
          tono: "peligro",
          texto: "Cambiar el conteo para esquivar este cartel convierte un faltante explicable en un faltante escondido.",
        },
      },
      {
        titulo: '"Hay diferencia con el efectivo esperado. Tenés que registrar el motivo en las notas."',
        texto:
          "La diferencia está dentro de lo tuyo, pero no cierra sin explicación. Escribí en las notas qué creés que pasó — vuelto mal dado, un cobro cargado en la caja equivocada, un billete falso. Con eso el cierre sigue.",
      },
      {
        titulo: '"Falta 1 rendición para poder cerrar."',
        texto:
          "Un mozo cobró en efectivo y todavía no entregó esa plata. Buscalo y rendí desde «Rendición por empleado». Si se fue sin rendir, el cierre te deja registrarlo igual eligiendo qué pasó — «No entregó», «Entrega de menos», «Entrega de más» — y queda como deuda a la vista.",
        verTambien: { tema: "caja", texto: "El cierre de caja, paso a paso" },
      },
      {
        titulo: '"Hay una mesa con la cuenta abierta"',
        texto:
          "No se puede cerrar la caja con consumo sin cobrar. Andá al salón, cobrá esa mesa o anulala si el cliente se fue, y volvé al cierre.",
      },
      {
        titulo: '"Queda 1 pedido de delivery / take away abierto"',
        texto:
          "Lo mismo que la mesa, pero del lado de los pedidos de la web: hay uno sin cerrar. Entregalo, cobralo o cancelalo, y después cerrá.",
      },
      {
        titulo: '"Se abrió una cuenta mientras cerrabas. Revisá el salón y volvé a intentar."',
        texto:
          "Alguien abrió una mesa justo mientras contabas. El cierre se frena para no dejar esa venta afuera del turno. Mirá el salón, resolvé esa mesa y volvé a cerrar: no perdiste el conteo.",
      },
      {
        titulo: '"Un mozo cobró mientras cerrabas y le quedó plata sin rendir. Actualizá y volvé a intentar."',
        texto:
          "Entró un cobro en efectivo después de que abriste el cierre. Actualizá, rendí esa plata y cerrá de nuevo.",
      },
      {
        titulo: '"La sangría requiere un motivo."',
        texto:
          "Estás sacando plata de la caja sin decir para qué. Escribí el motivo — «depósito banco», «cambio para el bar» — con suficiente detalle como para entenderlo dentro de un mes. Si es un pago a un proveedor, no va por acá: se registra en Proveedores y sale de la Caja Mayor.",
      },
      {
        titulo: `"Tu rol permite hasta ${TOPE_DESCUENTO}" / "Excede tu autorización · pedile al dueño"`,
        texto:
          "El descuento que pusiste se pasa de lo que podés autorizar. Bajalo hasta el tope o pedile al dueño que lo haga él. Partirlo en dos cobros no cuenta como solución.",
        verTambien: { tema: "cobrar", texto: "Descuentos, con el tope explicado" },
      },
      {
        titulo: '"El descuento requiere un motivo."',
        texto:
          "Todo descuento tiene que decir por qué. Elegí uno de la lista —«Cortesía de la casa» y las demás— o escribilo. Sin motivo el cobro no avanza.",
      },
      {
        titulo: '"El pago ya se estaba registrando. Refrescá para ver el estado."',
        texto:
          "Tocaste «Cobrar» dos veces, o la primera tardó y parecía colgada. El sistema frenó el segundo cobro a propósito. Refrescá y fijate cómo quedó la mesa ANTES de volver a cobrar.",
        aviso: {
          tono: "peligro",
          texto: "Es el cartel que evita cobrarle dos veces al cliente. Si aparece, refrescá y mirá — nunca insistas.",
        },
      },
      {
        titulo: '"No pudimos reabrir la cuenta: la mesa ya tiene otra cuenta abierta. Anulá esa primero."',
        texto:
          "Anulaste un cobro, pero mientras tanto se abrió una cuenta nueva en esa misma mesa. Resolvé la nueva —cobrala o anulala— y recién ahí se puede recuperar la vieja.",
      },
      {
        titulo: '"El motivo de anulación es obligatorio."',
        texto:
          "Estás anulando una mesa sin decir por qué. Escribí qué pasó: «cliente se fue», «error de carga». Es lo que después explica por qué esa venta no está.",
      },
      {
        titulo: '"La mesa está ocupada. Cobrala o liberala antes de mover."',
        texto:
          "Querés trasladar una cuenta a una mesa que ya tiene gente. Elegí una libre, o resolvé primero la del destino.",
      },
      {
        titulo: '"La mesa cambió mientras la movías. Refrescá e intentá de nuevo."',
        texto:
          "Alguien tocó esa mesa al mismo tiempo que vos. No se perdió nada: refrescá y volvé a hacer el traslado.",
      },
      {
        titulo: '"Tenía que marchar y sigue acá — revisá que salga la comanda"',
        texto:
          "Un pedido programado se pasó de su hora y nunca salió a cocina. Antes de tocar «Marchar ya», fijate en Comandas si la comanda falló: si la cocina ya la tiene en papel, marcharlo otra vez le manda una copia.",
        verTambien: { tema: "pedidos", texto: "Los pedidos de la web, paso a paso" },
      },
      {
        titulo: '"1 comanda no se imprimió"',
        texto:
          "La comanda no llegó a la impresora del sector. Con «Ver solo las fallidas» las ves todas juntas y desde ahí se reimprimen. Mientras no se resuelva, la cocina no sabe que ese plato existe: avisá a mano si hay apuro.",
      },
      {
        titulo: '"sin conexión"',
        texto:
          "El agente de impresión del local dejó de responder — la PC que conecta el sistema con las impresoras está apagada, dormida o sin red. Ningún ticket va a salir hasta que vuelva. Prendé esa máquina; si vuelve, las comandas pendientes salen solas.",
        aviso: {
          tono: "peligro",
          texto: "Con este cartel prendido, todo lo que se cargue sigue funcionando pero no imprime nada. Es lo primero que hay que mirar cuando «no salen las comandas».",
        },
      },
      {
        titulo: '"No hay sectores configurados. Cargá los sectores desde el catálogo para que las comandas se ruteen a cocina."',
        texto:
          "El sistema no sabe a qué impresora mandar cada cosa porque no hay sectores cargados. Es configuración del dueño, no se arregla desde acá.",
      },
      {
        titulo: '"Ese servicio ya está completo. Probá otro horario, otra fecha u otro salón."',
        soloModo: "flexible",
        texto:
          "Es el cartel que ve el CLIENTE en la web cuando el servicio está lleno. A vos, desde el panel, el sistema te deja pasar igual avisándote que no quedan mesas.",
        verTambien: { tema: "reservas", texto: "El cupo, explicado" },
      },
      {
        titulo: '"No quedan mesas libres en ese servicio. Confirmá para reservar igual."',
        soloModo: "flexible",
        texto:
          "Estás tomando una reserva sobre un servicio lleno. El sistema no te lo prohíbe: te pide que confirmes que sabés lo que hacés. Tomala sólo si tenés el lugar contado de verdad.",
      },
      {
        titulo: '"Confirmá la reserva antes de sentarla."',
        texto:
          "Estás por sentar a alguien cuya reserva todavía está esperando respuesta. Confirmala primero — con eso el cliente recibe el aviso — y después sentala.",
      },
      {
        titulo: '"Sólo el encargado puede confirmar o rechazar reservas."',
        texto:
          "Le apareció a alguien que no tiene el permiso. Confirmar y rechazar son tuyos o del dueño: el mozo no decide reservas.",
      },
      {
        titulo: '"No hay caja configurada. Pedile al admin que cree una."',
        texto:
          "No se puede cobrar porque el negocio no tiene ninguna caja creada. Es configuración del dueño y sin eso no hay cobro posible.",
      },
      {
        titulo: '"Para la Factura A falta el CUIT del receptor (11 dígitos)."',
        texto:
          "Tildaste «Factura A» y no cargaste el CUIT. El sistema te frena ANTES de cobrar, a propósito: pedile el CUIT al cliente o buscalo en «Buscar receptor guardado», que si ya facturó alguna vez está ahí. Si preferís cobrar y facturar después, destildá la A — sale la B de siempre.",
        verTambien: { tema: "cobrar", texto: "Elegir la factura antes de cobrar" },
      },
      {
        titulo: '"Esta orden ya tiene la Factura B 0001-00000007 autorizada. Anulala (se emite la nota de crédito) antes de emitir otro tipo de comprobante."',
        texto:
          "Se cobró con Factura B y ahora se está pidiendo una A sobre la misma venta. Un comprobante autorizado no se cambia de letra: hay que anular el que salió —con su nota de crédito— y recién ahí emitir el otro. Por eso la letra se elige antes de cobrar y no después.",
        aviso: {
          tono: "peligro",
          texto:
            "Una nota de crédito es un comprobante fiscal de verdad, con número y CAE. No es un «deshacer»: preguntá si es Factura A antes de apretar cobrar.",
        },
        verTambien: { tema: "cobrar", texto: "La factura se elige antes de cobrar" },
      },
      {
        titulo: '"Esta orden ya tiene una factura en proceso. Esperá a que ARCA la confirme — la vas a ver en Facturación."',
        texto:
          "La emisión salió y todavía no volvió. No es un error y no hay que hacer nada: esperá y fijate en Facturación. Insistir es lo que termina en dos comprobantes por la misma venta.",
      },
      {
        titulo: '"No tenés permiso para fiar."',
        texto:
          "Le aparece al mozo. Fiar es del dueño, del encargado y de la compu del salón: el mozo cobra, pero no decide a quién se le anota. Si el cliente quiere que se lo pongan en la cuenta, que lo cobre uno de ellos.",
        verTambien: { tema: "cuentas-corrientes", texto: "Cómo se fía" },
      },
      {
        titulo: '"Elegí en qué caja entra el efectivo."',
        texto:
          "Estás registrando el pago de una cuenta corriente en efectivo y no dijiste a qué cajón entra. Elegí la caja que tenés adelante: esa plata es real y el arqueo la va a esperar ahí.",
        verTambien: { tema: "cuentas-corrientes", texto: "Cobrar un saldo" },
      },
      {
        titulo: '"Agente de impresión sin conexión (sin señal)"',
        texto:
          "La PC del local que conecta el sistema con las impresoras está caída. Todo lo que cargues sigue registrándose, pero no sale ni un ticket. Prendé esa máquina: cuando vuelve, las comandas pendientes salen solas.",
        aviso: {
          tono: "peligro",
          texto: "Es lo primero que hay que mirar cuando «no salen las comandas». Mientras esté, avisale a la cocina de palabra.",
        },
        verTambien: { tema: "comandas", texto: "La cocina y las comanderas" },
      },
      {
        titulo: "Un margen en rojo en Costeo",
        texto:
          "Ese plato cuesta más de lo que se cobra: cada vez que se vende, el local pierde. Antes de tocar el precio, revisá la receta — un −90% suele ser gramos cargados donde iban kilos.",
        verTambien: { tema: "costeo", texto: "Costos y margen" },
      },
      {
        titulo: "Un stock en rojo o amarillo",
        texto:
          "Está por debajo del mínimo que vos fijaste para ese producto. No frena nada, pero es el aviso de reponer. El mismo número aparece en el menú lateral, al lado de «Productos e inventario».",
        verTambien: { tema: "stock", texto: "El stock y la merma" },
      },
      {
        titulo: '"El motivo es obligatorio." (stock de cocina)',
        texto:
          "Estás moviendo stock sin decir por qué. Escribí qué pasó — «merma por vencimiento», «conteo físico» —: sin eso, el número de mañana no se puede explicar.",
      },
      {
        titulo: '"Este insumo no tiene presentaciones cargadas."',
        texto:
          "No se le puede cargar stock porque el sistema no sabe en qué viene (bidón, caja, kilo). Se le agrega al menos una presentación desde el catálogo y recién ahí acepta cantidades.",
      },
      {
        titulo: '"AFIP no configurado"',
        texto:
          'No se pueden emitir comprobantes porque faltan los datos fiscales: "Para emitir comprobantes electrónicos, primero configurá CUIT y punto de venta.". Lo carga el dueño; no se resuelve desde el mostrador.',
      },
      {
        titulo: '"Rechazo de datos de ARCA: revisá CUIT / datos del comprobante antes de reintentar."',
        texto:
          "Hay un dato mal en el comprobante y ARCA lo rechazó. Reintentar tal cual vuelve a fallar: primero corregí el dato (casi siempre el CUIT del cliente).",
        verTambien: { tema: "facturacion", texto: "Comprobantes, paso a paso" },
      },
      {
        titulo: '"Error temporario de conexión con el provider: podés reintentar tal cual."',
        texto:
          "Este sí es el que se arregla reintentando: no hay nada mal cargado, se cayó la conexión. Probá de nuevo en un rato.",
      },
      {
        titulo: '"El comprobante sigue en proceso en ARCA."',
        texto:
          "No es un error: la emisión está en curso. Esperá antes de anular o reintentar, o vas a terminar con dos comprobantes por la misma venta.",
      },
      {
        titulo: '"No hay clientes en este segmento todavía. La campaña no se puede lanzar."',
        texto:
          "El filtro que elegiste no matchea a nadie — por ejemplo «no piden hace más de 90 días» en un local que abrió hace dos meses. Ampliá el segmento.",
      },
      {
        titulo: '"El agente está atendiendo esta conversación."',
        texto:
          "No podés escribirle al cliente porque el bot tiene el teclado. Apagá el agente arriba a la derecha y el cuadro de texto se habilita. Acordate de volver a prenderlo al terminar.",
        verTambien: { tema: "conversaciones", texto: "WhatsApp y el bot" },
      },
      {
        titulo: '"Las mesas del salón se borran."',
        texto:
          "Es el aviso antes de borrar un salón. Las reservas históricas no se borran, pero quedan sin mesa asignada. Si el cambio es temporal, editá el salón en vez de borrarlo.",
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LA GUÍA DE LA TERMINAL — spec 170 (#258)
  //
  // La terminal es la compu compartida del salón (spec 140). Ve CUATRO tabs de
  // Operación —salón, reservas, comandas, fichaje— que son las mismas pantallas
  // que documentan los temas de arriba. Por eso las frases entre comillas se
  // copian tal cual: misma pantalla, mismo cartel (D4).
  //
  // LO QUE SE REESCRIBE ES QUÉ PUEDE HACER EL QUE LEE. El tema `mesas` dice
  // «anular sólo lo podés hacer vos o el dueño»; desde la terminal eso es falso
  // (`canTransitionMesa` la incluye). Antes de copiar un párrafo de arriba,
  // chequealo contra `can.ts`.
  //
  // Y OJO CON LOS `verTambien`: sólo pueden apuntar a temas de ESTE bloque. Un
  // link a `caja` desde acá manda a un tema que la terminal no puede abrir.
  // ══════════════════════════════════════════════════════════════════════════
  {
    slug: "terminal-la-compu",
    titulo: "Esta compu es de todos",
    resumen:
      "La sesión es del salón, no tuya. Y la plata de cada mesa es del mozo de esa mesa.",
    icono: Monitor,
    grupo: "operacion",
    roles: ["terminal"],
    claves: [
      "La plata de una mesa es del mozo asignado a esa mesa, no del que la cargó acá.",
      "Repartir el salón al empezar el turno no es prolijidad: es lo que hace que cada mozo tenga su rendición.",
      `Tu tope de descuento es ${TOPE_DESCUENTO_TERMINAL}. Más que eso lo autoriza el encargado.`,
    ],
    pasos: [
      {
        titulo: "La sesión no es de nadie en particular",
        texto:
          "Es la cuenta del salón: la usan todos los mozos del turno. Lo bueno es que no hay que entrar y salir cada vez; lo que hay que saber es que el sistema registra «terminal» y no quién estaba tipeando.",
        aviso: {
          tono: "ojo",
          texto:
            "Por eso lo que anulás o trasladás desde acá conviene decirlo en voz alta. El registro guarda qué pasó y con qué motivo, pero no puede decir quién.",
        },
      },
      {
        titulo: "La plata sigue a la mesa",
        texto:
          "Si la mesa tiene un mozo asignado, la venta y la propina son de ese mozo — aunque el pedido lo hayas cargado vos desde acá. Y si la mesa no tiene a nadie, esa plata no es de nadie: no le va a aparecer en la rendición a ninguno.",
        verTambien: {
          tema: "terminal-salon",
          texto: "Repartir el salón antes del servicio",
        },
      },
      {
        titulo: "La venta de mostrador es la excepción",
        texto:
          "Una venta rápida no tiene mesa, así que no hay a quién atribuirla: queda a nombre de la terminal. Esa plata está en el cajón y la cuenta el encargado al cerrar, no la rinde ningún mozo.",
        aviso: {
          tono: "ojo",
          texto:
            "Si la venta es de una mesa, cargala en la mesa. La venta rápida es para el que compra parado y se va.",
        },
      },
      {
        titulo: "Hasta cuánto podés descontar",
        texto: `Desde acá el tope es ${TOPE_DESCUENTO_TERMINAL} — el mismo que tiene un mozo, no el del encargado. Si hace falta más, lo hace él desde su pantalla.`,
      },
    ],
  },
  {
    slug: "terminal-salon",
    titulo: "El salón",
    resumen: "Repartir, abrir, cargar, cobrar, mover y anular mesas desde el plano.",
    icono: LayoutGrid,
    grupo: "operacion",
    roles: ["terminal"],
    equivaleA: "mesas",
    claves: [
      "Lo primero del turno es repartir el salón: sin mozo, la mesa no es de nadie.",
      "Anular y trasladar sí podés desde acá. Las dos piden motivo.",
      "Anular una mesa y anular un cobro son cosas distintas: si ya se cobró, se anula el cobro.",
    ],
    pasos: [
      {
        titulo: "El plano es el salón",
        texto:
          "Cada figura es una mesa y el color dice cómo está. Abajo está la referencia con cuántas hay de cada una; el número chico adentro es hace cuánto está abierta, que sirve para ver cuál se demora. A la derecha, lo mismo en lista.",
        imagen: "/ayuda/op-salon.png",
        alt: "El plano del salón con las mesas, la referencia de colores abajo y el panel de ocupadas a la derecha.",
        marcas: [
          { n: 1, x: 37, y: 23 },
          { n: 2, x: 8, y: 97 },
          { n: 3, x: 72, y: 58 },
        ],
      },
      {
        titulo: "Primero: repartir el salón",
        texto:
          "«Distribuir mozos» reparte varias mesas de una: se prende el modo, se van tocando las mesas de cada uno y listo. Es para armar las secciones ANTES del servicio, y es lo que después le da a cada mozo su rendición.",
        verTambien: {
          tema: "terminal-la-compu",
          texto: "Por qué la mesa sin mozo no es de nadie",
        },
      },
      {
        titulo: "Ponerle el mozo a UNA mesa",
        texto:
          'El header de la mesa dice quién la atiende, y cuando no tiene a nadie dice «Sin mozo». Esa pastilla es el botón: la tocás y elegís. Si la mesa no tenía mozo, el modal dice «Asignar mozo»; si ya tenía, dice «Transferir mozo» y le saca la mesa al anterior, con motivo. Se puede desde que la mesa está libre.',
        aviso: {
          tono: "ojo",
          texto:
            "Para uno solo NO uses «Distribuir mozos»: esa es para repartir el salón entero de una.",
        },
      },
      {
        titulo: "Abrir, cargar y pasar a cobro",
        texto:
          "Tocás una mesa libre, le cargás el pedido y queda abierta; se puede seguir agregando todas las veces que haga falta. Cuando piden la cuenta la mesa se marca en el plano y «Pasar a cobro» abre el cobro con todo lo consumido.",
      },
      {
        titulo: "Si la mesa tenía una reserva",
        texto:
          "Al abrir una mesa reservada el sistema te avisa antes y podés «Abrir igual» o buscar otra. Para sentar a alguien de una reserva, primero hay que confirmarla.",
        verTambien: { tema: "terminal-reservas", texto: "Confirmar una reserva" },
      },
      {
        titulo: "Trasladar una mesa",
        texto:
          '«Trasladar mesa» mueve el consumo a otra mesa, que tiene que estar libre — si no, "La mesa está ocupada. Cobrala o liberala antes de mover.". Sirve para el grupo que se cambió de lugar, no para juntar dos cuentas.',
      },
      {
        titulo: "Anular una mesa",
        texto:
          'Cancela la orden activa y libera la mesa: es para el cliente que se fue sin consumir o el error de carga. Pide motivo obligatorio, con ejemplos como «cliente se fue, error de carga».',
        aviso: {
          tono: "peligro",
          texto:
            "Anular borra esa venta del turno, y desde la terminal el registro dice «terminal»: no queda quién fue. Avisale al encargado. Y si la mesa YA se cobró, esto no es lo que buscás — eso se anula desde el cobro.",
        },
      },
    ],
  },
  {
    slug: "terminal-comandas",
    titulo: "La cocina y las comanderas",
    resumen: "Qué está saliendo, qué se demora, y qué hacer cuando una comanda no se imprime.",
    icono: ChefHat,
    grupo: "operacion",
    roles: ["terminal"],
    equivaleA: "comandas",
    claves: [
      '"1 comanda no se imprimió" quiere decir que la cocina NO se enteró de ese plato.',
      '"sin conexión" es la PC de las impresoras caída: no sale ni un ticket hasta que vuelva.',
      "Antes de reimprimir, fijate si el papel ya salió. Reimprimir a ciegas hace que se cocine dos veces.",
    ],
    pasos: [
      {
        titulo: "Las tres columnas",
        texto:
          "«Pendientes» son las que la cocina todavía no tomó, «En cocina» las que está haciendo, «Entregadas» las que salieron. Arriba, «Saturación por sector» te dice qué estación está tapada — parrilla, fritera, la que sea. Es lo que mirás antes de prometerle un tiempo a una mesa.",
        imagen: "/ayuda/op-comandas.png",
        alt: "La pantalla de Comandas con la saturación por sector arriba y las columnas Pendientes, En cocina y Entregadas.",
        marcas: [
          { n: 1, x: 17, y: 17 },
          { n: 2, x: 11, y: 31.5 },
          { n: 3, x: 20, y: 46 },
        ],
      },
      {
        titulo: "La que no se imprimió",
        texto:
          'Cuando una comanda falla aparece el aviso "1 comanda no se imprimió" y con «Ver solo las fallidas» las ves todas juntas para reimprimirlas. Mientras no se resuelva, para la cocina ese plato no existe.',
        aviso: {
          tono: "peligro",
          texto:
            "Antes de reimprimir, chequeá si el papel ya salió. Reimprimir a ciegas hace que se cocine dos veces.",
        },
      },
      {
        titulo: 'El cartel "Agente de impresión sin conexión (sin señal)"',
        texto:
          "Es la PC que maneja las impresoras del local, que se cayó o se quedó sin red. No es tu culpa ni se arregla desde acá: avisá al encargado. Hasta que vuelva no sale ningún ticket, así que la cocina se entera cantándole los platos.",
      },
    ],
  },
  {
    slug: "terminal-reservas",
    titulo: "Reservas",
    resumen: "El libro del día, las que pide el cliente por la web, y sentar al que llega.",
    icono: CalendarDays,
    grupo: "operacion",
    roles: ["terminal"],
    equivaleA: "reservas",
    claves: [
      "Una solicitud sin responder vence sola y el cliente recibe que no se pudo. Miralas al empezar el turno.",
      "El motivo del rechazo se lo mandamos al cliente: escribilo pensando en que lo lee él.",
      '"No vino" marcalo de verdad: es lo único que después deja ver quién falta seguido.',
    ],
    pasos: [],
    pasosPorModo: {
      estricto: [
        {
          titulo: "El día, hora por hora",
          texto:
            "La pantalla abre en hoy y lista las reservas por hora con su estado. Arriba se cambia de fecha y se busca por nombre o teléfono.",
          imagen: "/ayuda/op-reservas.png",
          alt: "La pestaña Reservas con el listado del día.",
        },
        {
          titulo: "Tomar una por teléfono",
          texto:
            "Pide nombre, teléfono, cuántos son y el horario, que sale de una grilla fija: elegís uno de los habilitados, no escribís la hora a mano. Si el que te piden no está, no hay turno ahí — y forzarlo desde acá no se puede. Está bien que no se pueda: en este modo el cupo es el cupo.",
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            'Quedan esperando respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar»; al rechazar podés escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Hasta que alguien decida, el cliente sabe que la pidió, no que la tiene.',
        },
        {
          titulo: "Cuando llega, y el que no vino",
          texto:
            "«Sentar la reserva» la pasa a «En mesa» — si no tiene mesa, la elegís en el plano. «No vino» la marca como ausente.",
          verTambien: {
            tema: "terminal-salon",
            texto: "Qué pasa con la mesa cuando la sentás",
          },
        },
      ],
      flexible: [
        {
          titulo: "El libro del día, por servicio",
          texto:
            "La pantalla abre en hoy, con las reservas por hora dentro de cada servicio — mediodía, cena, el que tenga el local. Arriba se cambia de fecha y se busca por nombre o teléfono.",
          imagen: "/ayuda/op-reservas.png",
          alt: "La pestaña Reservas con el listado del día.",
        },
        {
          titulo: "Tomar una por teléfono",
          texto:
            "Pide nombre, teléfono, cuántos son, el servicio y la hora. Acá la hora se escribe: no hay grilla de turnos. La mesa es opcional — se puede tomar ahora y asignarla después, cuando armes el salón.",
        },
        {
          titulo: "El cupo es blando para vos y duro para el cliente",
          texto:
            'Con el servicio lleno, al que reserva por la web el sistema lo frena. A vos no: te dice "No quedan mesas libres en ese servicio. Confirmá para reservar igual." y te deja pasar.',
          aviso: {
            tono: "ojo",
            texto:
              "Que puedas sobrevender no quiere decir que convenga. Si no estás seguro de que esa mesa se libera, preguntale al encargado antes de confirmar.",
          },
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            'Quedan esperando respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar»; al rechazar podés escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Hasta que alguien decida, el cliente sabe que la pidió, no que la tiene.',
        },
        {
          titulo: "Cuando llega, y el que no vino",
          texto:
            "«Sentar la reserva» la pasa a «En mesa» — si no tiene mesa, la elegís en el plano. «No vino» la marca como ausente.",
          verTambien: {
            tema: "terminal-salon",
            texto: "Qué pasa con la mesa cuando la sentás",
          },
        },
      ],
    },
  },
  {
    slug: "terminal-fichaje",
    titulo: "Fichar",
    resumen: "Entrada y salida con tu PIN, desde esta misma compu.",
    icono: Clock,
    grupo: "operacion",
    roles: ["terminal"],
    equivaleA: "fichaje",
    claves: [
      "Cada uno ficha con su PIN: no fiches por otro.",
      "El PIN es tuyo aunque la sesión de la compu sea de todos.",
    ],
    pasos: [
      {
        titulo: "Se ficha desde acá",
        texto:
          "La pestaña Fichaje es el teclado numérico: ponés tu PIN y queda marcada la entrada o la salida. No hace falta salir de la sesión ni entrar con tu usuario — el PIN alcanza, y es lo que te identifica a vos.",
        imagen: "/ayuda/op-fichaje.png",
        alt: "La pestaña Fichaje con la asistencia del día y el teclado para marcar con PIN.",
      },
      {
        titulo: "Quién está adentro",
        texto:
          '«Asistencia del día» muestra quién está ahora, «Ya salieron» los que terminaron y «Sin fichar» los que todavía no marcaron. Si nadie fichó, dice "No hay nadie fichado todavía.". Un «Sin fichar» a mitad del turno suele ser un olvido, no una ausencia: avisale.',
      },
    ],
  },
  {
    slug: "terminal-limites",
    titulo: "Lo que desde acá no se puede",
    resumen: "Los seis techos de esta pantalla, y quién los levanta.",
    icono: Lock,
    grupo: "operacion",
    roles: ["terminal"],
    tipo: "catalogo",
    claves: [
      "Que un botón no esté no es que el sistema falle: es tu rol.",
      "Todo lo de esta lista lo hace el encargado desde su propia pantalla.",
    ],
    pasos: [
      {
        titulo: "La caja",
        texto:
          "No ves el cajón, ni los movimientos, ni podés hacer un corte o una sangría. Las cuatro pestañas que tenés son Salón, Reservas, Comandas y Fichaje: la caja no está y no es que se escondió.",
      },
      {
        titulo: "La rendición de los mozos",
        texto:
          "No la ves ni la cerrás. Con una cuenta compartida por todo el salón, «lo mío» no existe: la plata se atribuye al mozo de cada mesa y la rendición la mira el encargado.",
      },
      {
        titulo: "Los pedidos de la web",
        texto:
          "Delivery y take away no están en tus pestañas. Si entra uno y no hay nadie mirándolo, avisá — no se acepta desde acá.",
      },
      {
        titulo: "Cobrar el saldo de una cuenta corriente",
        texto:
          "Fiar sí podés: cerrás la cuenta con «Cuenta corriente» y queda como saldo del cliente. Cobrarle ese saldo después, no — esa plata entra a una caja que desde acá ni se ve.",
      },
      {
        titulo: `Descuentos de más de ${TOPE_DESCUENTO_TERMINAL}`,
        texto: `Tu tope es ${TOPE_DESCUENTO_TERMINAL}. Por arriba de eso el sistema no te deja, y no es un error: lo autoriza el encargado desde su pantalla.`,
      },
      {
        titulo: "La carta, el stock, los precios y el personal",
        texto:
          "Nada de configuración: productos, precios, menú del día, stock, empleados y ajustes son del dueño y del encargado. Si un precio está mal en la carta, avisá — no se corrige desde acá.",
      },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** El `src` del iframe a partir del link de compartir de Loom. Devuelve null si
 *  el link no tiene la forma esperada, así una URL mal pegada no rompe la
 *  página: simplemente no se pinta el video. */
export function loomEmbedSrc(url: string): string | null {
  const m = url.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
  return m ? `https://www.loom.com/embed/${m[1]}?hide_owner=true&hide_share=true` : null;
}

export function temaPorSlug(slug: string): Tema | undefined {
  return TEMAS.find((t) => t.slug === slug);
}

/** ¿Tiene contenido escrito para este negocio? Ver RNF-2. */
export function estaEscrito(tema: Tema, modo: ReservationMode): boolean {
  return pasosDe(tema, modo).length > 0;
}

/** El próximo tema ESCRITO, para el link del pie. Saltea los que están vacíos:
 *  mandar a alguien a una página que dice "en preparación" es peor que no
 *  ofrecerle nada. */
export function temaSiguiente(
  slug: string,
  modo: ReservationMode,
  /**
   * Entre qué temas se navega. Default: todos — pero desde la spec 170 hay
   * temas de otro rol al final del array, y encadenar hacia ellos mandaría al
   * encargado, al terminar «Me apareció un cartel», a la guía de la terminal.
   * Los llamadores pasan `temasDeRol(rol)`.
   */
  disponibles: Tema[] = TEMAS,
): Tema | undefined {
  const i = disponibles.findIndex((t) => t.slug === slug);
  return i >= 0
    ? disponibles.slice(i + 1).find((t) => estaEscrito(t, modo))
    : undefined;
}
