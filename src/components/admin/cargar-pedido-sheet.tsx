"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { fromZonedTime } from "date-fns-tz";
import {
  ArrowLeft,
  Bike,
  Clock,
  Loader2,
  Minus,
  Plus,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getClienteDirecciones,
  type ClienteDireccion,
  type ClienteMatch,
} from "@/lib/admin/customers-actions";
import { TimeField24 } from "@/components/ui/time-field-24";
import { SectionLabel } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";
import { enviarComanda } from "@/lib/comandas/actions";
import { formatCurrency } from "@/lib/currency";
import type { CatalogForMozo, CatalogProduct } from "@/lib/mozo/catalog-query";
import { loadPedirCatalog } from "@/lib/mozo/pedir-panel-data";
import {
  isItemLibreCartLine,
  isItemLibreEntry,
  itemLibreCartLine,
  itemLibrePayload,
  type ItemLibreDraft,
} from "@/lib/mozo/item-libre-entry";
import { ItemLibreModal } from "@/components/shared/item-libre-modal";
import { confirmarPedido } from "@/lib/orders/confirm-order";
import { horaLocal } from "@/lib/orders/entrega";
import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";
import {
  DEFAULT_MARCH_LEAD_KITCHEN_MIN,
  localYmd,
} from "@/lib/orders/scheduled";
import { cargarPedidoStaff } from "@/lib/orders/staff-order";
import {
  ProductModal,
  type AddToCartItem,
} from "@/components/mozo/product-modal";
import { CustomerFields } from "@/components/shared/customer-fields";
import { PriceOverrideModal } from "@/components/shared/price-override-modal";
import { ProductResultsList } from "@/components/mozo/product-results-list";
import {
  ColumnaDeCarga,
  ColumnaLateral,
  PanelDeCarga,
  useAnchoDePanel,
} from "@/components/mozo/panel-de-carga";
import { useCartZone } from "@/lib/mozo/use-cart-zone";
import { isPrintableKey } from "@/lib/ui/roving";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";
import { useRovingList } from "@/lib/ui/use-roving-list";
import {
  ProductSearchInput,
  useProductSearch,
} from "@/components/mozo/product-search-box";

type CartItem = AddToCartItem & {
  _key: string;
  /** Precio pisado para este pedido (spec 069). */
  price_override_cents?: number | null;
  price_override_reason?: string | null;
};

/** Precio que se va a cobrar: el pisado si lo hay, si no el de catálogo. */
function effectiveUnitPriceCents(c: CartItem): number {
  return c.price_override_cents ?? c.unit_price_cents;
}
/**
 * Spec 127 — la hoja tiene dos modos, y el default es el 95% de los encargues.
 *
 * - **Para hoy**: la comanda sale ahora (es lo que ya funcionaba) y las dos
 *   horas, si se cargan, sólo dicen cuándo el pedido entra a «En cocina».
 * - **Programado**: por definición es para OTRO día. El papel no sale hoy; sale
 *   ese día, 40 min antes de la hora de cocina.
 *
 * Un pedido para hoy nunca es «programado», aunque sea para dentro de cinco
 * horas: eso saca de la cabeza del encargado la pregunta «¿esto va como
 * programado?», que antes no tenía una respuesta obvia.
 */
type Cuando = "hoy" | "programado";

type DeliveryType = "pickup" | "delivery";
type View = "carga" | "datos";
/** Compone una dirección guardada en una línea editable. */
function formatDireccion(a: ClienteDireccion): string {
  const base = [a.street, a.number].filter(Boolean).join(" ");
  return a.apartment ? `${base}, ${a.apartment}` : base;
}

/**
 * Spec 054 (fase 2) — «Cargar pedido» para llevar/delivery SIN mesa desde el
 * board. Alineado con el sidebar keyboard-first del salón (spec 055): buscador
 * fijo con foco, resultados navegables por ↓/↑/Enter, pedido siempre visible,
 * reusando `ProductModal` (ya operable por teclado) y la lógica de índice de
 * `product-search.ts`. Desde la spec 115 comparte el shell de dos columnas con
 * el panel del salón (`panel-de-carga.tsx`) y, desde la 116, también lo que
 * muestra sin buscar: los más pedidos. Suma un paso de datos
 * con selector de **cliente existente** (`buscarClientes`) + entrega, que el
 * pedido de mesa no necesita. Arma el pedido con `cargarPedidoStaff` →
 * `persistOrder` (sin `table_id`).
 */
export function CargarPedidoSheet({
  slug,
  open,
  onClose,
  onCreated,
  timezone,
  marchLeadKitchenMin = DEFAULT_MARCH_LEAD_KITCHEN_MIN,
  agregarA,
  deliveryFeeCents = 0,
}: {
  /**
   * Envío del negocio (issue #260).
   *
   * `persistOrder` se lo suma al total cuando el destino es delivery, y la hoja
   * no lo mostraba en ningún lado: la encargada leía «Total $10.000», se lo
   * decía al cliente por teléfono, y el pedido nacía en $10.800. La diferencia
   * recién aparecía al cobrar, con la hoja ya cerrada y sin forma de saber de
   * dónde salió. El checkout público sí lo muestra como línea aparte.
   */
  deliveryFeeCents?: number;
  slug: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /**
   * Modo **agregar** (spec 125): en vez de crear un pedido, le suma líneas a
   * uno que ya existe — el encargue telefónico al que el cliente le agrega una
   * empanada. La misma hoja, sin la mitad que no aplica: el cliente, la entrega
   * y el «para cuándo» ya están decididos.
   *
   * Las líneas nuevas salen por `enviarComanda`, el mismo camino que usa el
   * mozo cuando manda los postres de una mesa: comanda nueva en el sector que
   * corresponde, con `batch` incremental.
   */
  agregarA?: { orderId: string; dailyNumber: number };
  /** TZ del negocio: «21:15» es hora del local, no del navegador. */
  timezone: string;
  /**
   * Spec 127 — minutos entre la marcha y la hora de cocina. Sólo sirve para
   * decirle al encargado a qué hora va a salir el papel; el server calcula lo
   * mismo con la columna del negocio. Opcional para no obligar a cada caller a
   * traerla: sin ella, el default de la migración.
   */
  marchLeadKitchenMin?: number;
}) {
  const [catalog, setCatalog] = useState<CatalogForMozo | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [view, setView] = useState<View>("carga");
  const hojaRef = useRef<HTMLDivElement>(null);
  const sheetAncho = useAnchoDePanel(hojaRef);
  const [topProductIds, setTopProductIds] = useState<string[]>([]);
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  // ── Precio por ítem (spec 069) ──
  // Sin gate de rol acá: llegar a este sheet ya exige `canCargarPedido`
  // (admin/encargado), que es exactamente el mismo conjunto que
  // `canOverrideItemPrice`. El server revalida igual en `cargarPedidoStaff`.
  const [priceTargetKey, setPriceTargetKey] = useState<string | null>(null);
  // ── El artículo que no existe (spec 174) ──
  // Mismo razonamiento que el precio por ítem de arriba: `canCargarPedido` y
  // `canCargarItemLibre` son el mismo conjunto (admin/encargado), y llegar acá
  // ya exige el primero. El server revalida el rol igual —`persistOrder` con
  // `options.role`, `enviarComanda` con el del contexto—, así que este flag
  // decide sólo si la fila se ve.
  const [libreAbierto, setLibreAbierto] = useState(false);

  const [deliveryType, setDeliveryType] = useState<DeliveryType>("pickup");
  // ── Las dos horas del pedido (spec 127) ──
  // La de cocina es para cuándo tiene que estar LISTO —es la que se imprime
  // arriba de la comanda— y la del pedido es cuándo el cliente lo retira o lo
  // recibe. Las dos a mano: el sistema no calcula ninguna. Vacías = para ahora.
  const [cuando, setCuando] = useState<Cuando>("hoy");
  const [dia, setDia] = useState<string>("");
  const [horaCocina, setHoraCocina] = useState("");
  const [horaPedido, setHoraPedido] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  // Spec 194 — el telefonista pide lo mismo que la web: en kcc, el lote.
  const entrega = copyDeEntrega(slug);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  // Indicación para cocina: sale como «ENTREGAR x» arriba de la comanda. Es
  // otra cosa que las notas de arriba, que son del cliente y van al control.
  const [kitchenNotes, setKitchenNotes] = useState("");

  const [clienteDirecciones, setClienteDirecciones] = useState<
    ClienteDireccion[]
  >([]);
  /** Cambiar de cliente rápido: sólo manda el último pick, no el que llega. */
  const pickSeqRef = useRef(0);

  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Cargar el catálogo al abrir (lazy). ──
  useEffect(() => {
    if (!open || catalog || loadingCatalog) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    loadPedirCatalog(slug).then((r) => {
      if (r.ok) {
        setCatalog(r.data.catalog);
        setTopProductIds(r.data.topProductIds);
      } else {
        setCatalogError(r.error);
      }
      setLoadingCatalog(false);
    });
  }, [open, slug, catalog, loadingCatalog]);

  // Spec 068: mismo buscador que la mesa y que venta rápida — filtrado,
  // teclado y filtro de la carta online viven en `useProductSearch`.
  const allProducts: CatalogProduct[] = useMemo(
    () => catalog?.categories.flatMap((c) => c.products) ?? [],
    [catalog],
  );
  // Lo que se ve sin búsqueda: los más pedidos, igual que el panel de la mesa
  // (spec 111, fase 5 · spec 116). El selector de categorías se fue: con el
  // buscador tolerante a acentos, elegir categoría era un rodeo, y lo que se
  // quiere ver al abrir es lo que más sale. Va al hook, que decide entre esto y
  // los resultados y le da índice de teclado a los dos (spec 073).
  const topProducts: CatalogProduct[] = useMemo(() => {
    const porId = new Map(allProducts.map((p) => [p.id, p]));
    const vistos = new Set<string>();
    const out: CatalogProduct[] = [];
    for (const id of topProductIds) {
      if (vistos.has(id)) continue;
      vistos.add(id);
      const p = porId.get(id);
      if (p) out.push(p);
    }
    return out;
  }, [topProductIds, allProducts]);
  // Negocio sin historial: mostrar todo antes que una pantalla en blanco.
  const browseProducts: CatalogProduct[] =
    topProducts.length > 0 ? topProducts : allProducts;
  const searchApi = useProductSearch({
    products: allProducts,
    browse: browseProducts,
    storageKey: `cargar_pedido_web_${slug}`,
    onPick: (p) =>
      isItemLibreEntry(p) ? setLibreAbierto(true) : setOpenProduct(p),
    // ↓ baja el foco al catálogo (spec 075): mismas zonas que la carga de mesa.
    onEnterResults: () =>
      catalogProducts.length > 0 ? catalogo.focusFirst() : carrito.focusFirst(),
    itemLibre: true,
  });
  const { isSearching, results: catalogProducts, enterTargetId } = searchApi;

  // Autofocus al buscador al abrir o al volver a la vista de carga.
  useEffect(() => {
    if (open && view === "carga") {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, view]);

  const focusSearch = useCallback(() => {
    setTimeout(() => {
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      // Cursor al final: volver del catálogo con ↑ deja seguir tipeando.
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 0);
  }, []);

  /** Escribir desde el catálogo o el carrito vuelve al buscador (FR-014). */
  const escribirEnBuscador = useCallback(
    (char: string) => {
      searchApi.setSearch((s) => s + char);
      focusSearch();
    },
    [searchApi, focusSearch],
  );

  // ── Zonas (spec 075): buscador → catálogo → carrito ──
  const catalogo = useRovingList<HTMLButtonElement>({
    length: catalogProducts.length,
    onExitUp: focusSearch,
    onExitDown: () => carrito.focusFirst(),
  });
  const carrito = useCartZone({
    length: cart.length,
    onExitUp: () =>
      catalogProducts.length > 0 ? catalogo.focusLast() : focusSearch(),
    onQuantityDelta: (i, delta) => {
      const line = cart[i];
      if (line) changeQty(line._key, delta);
    },
    onQuantitySet: (i, quantity) => {
      const line = cart[i];
      if (line) changeQty(line._key, quantity - line.quantity);
    },
    onRemove: (i) => {
      const line = cart[i];
      if (line) removeFromCart(line._key);
    },
    onActivate: (i) => {
      const line = cart[i];
      if (line) setPriceTargetKey(line._key);
    },
    onType: escribirEnBuscador,
  });

  const esProgramado = cuando === "programado";
  /** El día que se está cargando: hoy, salvo que sea un encargue programado. */
  const diaDelPedido = esProgramado ? dia : localYmd(new Date(), timezone);
  const hayHoras = Boolean(horaCocina && horaPedido);
  /**
   * A qué hora se pone en marcha. Es lo que la hoja le promete al encargado
   * abajo de los campos, y sale de la misma cuenta que hace el server
   * (`marchAtForOrder`): hora de cocina menos el lead de cocina.
   */
  const marchaLabel = useMemo(() => {
    if (!diaDelPedido || !horaCocina) return null;
    const cocina = fromZonedTime(`${diaDelPedido}T${horaCocina}:00`, timezone);
    if (Number.isNaN(cocina.getTime())) return null;
    return horaLocal(
      new Date(cocina.getTime() - marchLeadKitchenMin * 60_000).toISOString(),
      timezone,
    );
  }, [diaDelPedido, horaCocina, timezone, marchLeadKitchenMin]);
  /** Mañana, en el TZ del local: el primer día que un programado puede tomar. */
  const manana = useMemo(
    () => localYmd(new Date(Date.now() + 24 * 60 * 60_000), timezone),
    [timezone],
  );

  // Segunda salida de la hoja (issue #219). La X, que era la única, terminó
  // abajo de la campana del layout —el porqué está en el bloque de acá abajo— y
  // el encargado quedó encerrado. Aunque eso ya esté arreglado, un modal sin
  // Esc es media salida: en pantalla angosta la hoja ocupa todo y no queda ni
  // franja de overlay para clickear afuera. Se apaga cuando hay un modal
  // encima: ahí Esc es de ellos, y `ProductModal` engancha el mismo hook.
  useEscapeToClose(onClose, open && !openProduct && !priceTargetKey);

  /**
   * Dónde se cuelga la hoja (issue #219).
   *
   * Antes se renderizaba donde está escrita, y donde está escrita es **adentro
   * del shell del local** (`fixed … z-30`), que por ser `fixed` + `z-index`
   * abre un stacking context propio. Todo lo de adentro queda encerrado abajo
   * de 30, así que la campana del layout (`fixed right-4 top-3 z-50`, hermana
   * del shell) le ganaba a la hoja **cualquiera fuese su z** y le tapaba el 84%
   * de la X: el encargado apretaba cerrar y se le abría el drawer de
   * notificaciones. Subir el z no arregla nada desde adentro de una caja.
   *
   * El portal la saca de la caja, que es lo que hacen los `Sheet` de base-ui
   * —por eso ellos nunca tuvieron el problema—. Va al root del admin y no a
   * `body` para no perder el `[data-admin-brand]` que scopea las variables de
   * marca; ese nodo no crea stacking context, así que el `z-[60]` de abajo se
   * mide contra la campana de igual a igual.
   */
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  useEffect(() => {
    setPortalHost(
      document.querySelector("[data-admin-brand]") ?? document.body,
    );
  }, []);

  function reset() {
    setView("carga");
    searchApi.setSearch("");
    setCart([]);
    setDeliveryType("pickup");
    setCuando("hoy");
    setDia("");
    setHoraCocina("");
    setHoraPedido("");
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setDeliveryNotes("");
    setKitchenNotes("");
    setClienteDirecciones([]);
    pickSeqRef.current += 1;
  }

  if (!open || !portalHost) return null;

  const cartTotal = cart.reduce((a, c) => a + c.line_subtotal_cents, 0);
  // issue #260 — el envío que el server suma, mostrado acá. `agregarA` no lo
  // lleva: sumarle líneas a un pedido existente no vuelve a cobrar el envío.
  const envioCents =
    deliveryType === "delivery" && !agregarA ? deliveryFeeCents : 0;
  const totalConEnvio = cartTotal + envioCents;
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);

  function addToCart(item: AddToCartItem) {
    setCart((prev) => [...prev, { ...item, _key: crypto.randomUUID() }]);
  }
  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((c) => c._key !== key));
  }
  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev.map((c) => {
        if (c._key !== key) return c;
        const nextQty = c.quantity + delta;
        if (nextQty < 1 || nextQty > 99) return c;
        const modsTotal = c.modifiers.reduce(
          (a, m) => a + m.price_delta_cents,
          0,
        );
        return {
          ...c,
          quantity: nextQty,
          line_subtotal_cents:
            (effectiveUnitPriceCents(c) + modsTotal) * nextQty,
        };
      }),
    );
  }

  const priceTarget = cart.find((c) => c._key === priceTargetKey);

  /** `cents` null = volver al precio de la carta. */
  function setLinePrice(key: string, cents: number | null, reason: string) {
    setCart((prev) =>
      prev.map((c) => {
        if (c._key !== key) return c;
        const next: CartItem = {
          ...c,
          price_override_cents: cents,
          price_override_reason: cents === null ? null : reason,
        };
        const modsTotal = next.modifiers.reduce(
          (a, m) => a + m.price_delta_cents,
          0,
        );
        next.line_subtotal_cents =
          (effectiveUnitPriceCents(next) + modsTotal) * next.quantity;
        return next;
      }),
    );
    setPriceTargetKey(null);
  }

  /**
   * La dirección prellenada era del cliente que se está soltando: no es de
   * este pedido, es de esa persona. Se borra **sólo si sigue siendo una de sus
   * guardadas**; la que el encargado tipeó a mano es del pedido y se queda.
   */
  function soltarDireccionDelCliente() {
    const guardadas = new Set(clienteDirecciones.map(formatDireccion));
    setClienteDirecciones([]);
    setDeliveryAddress((dir) => (guardadas.has(dir) ? "" : dir));
  }

  /**
   * Soltar el cliente del CRM (spec 067): se limpia el teléfono —su identidad—
   * y las direcciones guardadas, que ya no le corresponden a nadie. El nombre
   * queda como texto libre.
   */
  function quitarCliente() {
    pickSeqRef.current += 1; // el fetch en vuelo, si hay, ya no manda
    setCustomerPhone("");
    soltarDireccionDelCliente();
  }

  function pickCliente(c: ClienteMatch) {
    setCustomerName(c.name ?? "");
    setCustomerPhone(c.phone);
    // Lo del cliente anterior se va ANTES de traer lo del nuevo: si este no
    // tiene direcciones guardadas —o el fetch falla— la de la persona anterior
    // se quedaba pegada y el delivery salía a la casa equivocada.
    soltarDireccionDelCliente();
    // Traemos las direcciones guardadas para prellenar la de delivery (editable).
    const seq = (pickSeqRef.current += 1);
    getClienteDirecciones(slug, c.id).then((r) => {
      // Cambió de cliente mientras viajaba: esta respuesta ya no es de nadie.
      if (seq !== pickSeqRef.current) return;
      if (!r.ok) return;
      setClienteDirecciones(r.data);
      if (deliveryType === "delivery" && r.data.length > 0) {
        setDeliveryAddress(formatDireccion(r.data[0]));
      }
    });
  }

  /**
   * Qué falta para poder enviar, dicho con palabras (issue #219).
   *
   * Antes esto era un booleano y nada más: si faltaba la dirección de un
   * delivery —o el teléfono, o una de las dos horas— los dos botones del pie
   * quedaban grises y **la pantalla no decía por qué**. El encargado apretaba,
   * no pasaba nada, y lo que llegó al Discord fue «no envía el pedido». Ahora
   * el motivo es el dato y `canSubmit` se deriva de él: una sola regla, sin
   * chance de que el texto y el `disabled` se cuenten historias distintas.
   */
  const faltaParaEnviar: string | null = (() => {
    if (cart.length === 0) return "Agregá al menos un producto.";
    // Un programado sin día ni horas no es un pedido, es una intención. Y las
    // dos horas van juntas siempre: media hora cargada es un pedido del que no
    // se sabe si es para ahora (spec 127).
    if (esProgramado && !dia) return "Elegí el día del encargue.";
    if (Boolean(horaCocina) !== Boolean(horaPedido))
      return horaCocina
        ? "Falta la hora del pedido: van las dos o ninguna."
        : "Falta la hora de cocina: van las dos o ninguna.";
    if (esProgramado && !hayHoras)
      return "Un encargue programado necesita las dos horas.";
    if (deliveryType === "delivery" && deliveryAddress.trim().length === 0)
      return entrega.porLote
        ? "El delivery necesita el número de lote."
        : "El delivery necesita la dirección de entrega.";
    if (deliveryType === "delivery" && customerPhone.trim().length < 6)
      return "El delivery necesita el teléfono del cliente.";
    return null;
  })();

  const canSubmit = faltaParaEnviar === null && !pending;

  /**
   * La transición de enviar, con red abajo (issue #219).
   *
   * Las server actions de acá pueden **tirar** en vez de devolver
   * `{ ok: false }`: el local trabaja contra la nube y un corte de red a mitad
   * de camino rechaza la promesa. Sin catch, la transición moría en silencio —
   * ni toast, ni cierre, ni pedido— y la hoja quedaba exactamente igual que
   * antes de apretar. Desde afuera eso es «no envía el pedido».
   */
  function enviar(accion: () => Promise<void>) {
    startTransition(async () => {
      try {
        await accion();
      } catch (err) {
        console.error("cargar-pedido-sheet · enviar", err);
        toast.error(
          "No se pudo enviar. Revisá la conexión y fijate en el board si el pedido entró antes de volver a cargarlo.",
        );
      }
    });
  }

  function submit(marchar: boolean) {
    if (cart.length === 0) {
      toast.error("Agregá al menos un producto.");
      return;
    }

    // Modo agregar (spec 125): no hay pedido que crear ni datos que validar.
    // Las líneas van por `enviarComanda`, que las inserta en la orden y crea la
    // comanda del sector con la tanda siguiente.
    if (agregarA) {
      enviar(async () => {
        const r = await enviarComanda({
          orderId: agregarA.orderId,
          slug,
          items: cart.map((c) =>
            // Spec 174 — el renglón libre viaja con su propia forma. La clave
            // del carrito va igual: la idempotencia de la spec 42 lo cubre
            // como a cualquier otra línea.
            isItemLibreCartLine(c)
              ? { ...itemLibrePayload(c), client_line_key: c._key }
              : {
                  product_id: c.product_id,
                  quantity: c.quantity,
                  notes: c.notes || undefined,
                  modifier_ids: c.modifiers.map((m) => m.id),
                  price_override_cents: c.price_override_cents ?? null,
                  price_override_reason: c.price_override_reason ?? null,
                  // Idempotencia (spec 42): la clave del carrito viaja para que
                  // un doble-tap no duplique la línea.
                  client_line_key: c._key,
                },
          ),
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        const n = cart.reduce((acc, c) => acc + c.quantity, 0);
        const cuantos = `${n} ${n === 1 ? "ítem agregado" : "ítems agregados"}`;
        toast.success(
          r.data.comanda_ids.length > 0
            ? `${cuantos} al pedido #${agregarA.dailyNumber} · salió la comanda`
            : // Sin comanda: o el pedido todavía no marchó (sale con el
              // «Confirmar», junto al resto), o lo agregado no lleva sector.
              `${cuantos} al pedido #${agregarA.dailyNumber}`,
        );
        setCart([]);
        onCreated?.();
        onClose();
      });
      return;
    }

    // Las dos horas (spec 127). Son horas del LOCAL, así que el instante se arma
    // en su TZ. El server revalida todo en `persistOrder`; acá cortamos antes
    // para que el error salga al lado del campo y no como un toast del server.
    let scheduledAtIso: string | undefined;
    let kitchenAtIso: string | undefined;
    if (esProgramado && !dia) {
      toast.error("Elegí el día del encargue.");
      return;
    }
    if (Boolean(horaCocina) !== Boolean(horaPedido)) {
      toast.error("Cargá las dos horas: la de cocina y la del pedido.");
      return;
    }
    if (esProgramado && !hayHoras) {
      toast.error("Un encargue programado necesita las dos horas.");
      return;
    }
    if (hayHoras) {
      const cocina = fromZonedTime(
        `${diaDelPedido}T${horaCocina}:00`,
        timezone,
      );
      const pedido = fromZonedTime(
        `${diaDelPedido}T${horaPedido}:00`,
        timezone,
      );
      if (Number.isNaN(cocina.getTime()) || Number.isNaN(pedido.getTime())) {
        toast.error("Revisá las horas.");
        return;
      }
      if (cocina.getTime() > pedido.getTime()) {
        toast.error(
          "La hora de cocina no puede ser posterior a la del pedido.",
        );
        return;
      }
      if (pedido.getTime() <= Date.now()) {
        toast.error("Esa hora ya pasó.");
        return;
      }
      scheduledAtIso = pedido.toISOString();
      kitchenAtIso = cocina.toISOString();
    }

    enviar(async () => {
      const r = await cargarPedidoStaff({
        business_slug: slug,
        delivery_type: deliveryType,
        scheduled_at: scheduledAtIso,
        kitchen_at: kitchenAtIso,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        delivery_address:
          deliveryType === "delivery"
            ? deliveryAddress.trim() || undefined
            : undefined,
        // Igual que la dirección: en retiro el campo ya no existe en la
        // hoja (spec 196), así que una nota tipeada en delivery y después
        // cambiada a retiro no puede viajar invisible al ticket.
        delivery_notes:
          deliveryType === "delivery"
            ? deliveryNotes.trim() || undefined
            : undefined,
        kitchen_notes: kitchenNotes.trim() || undefined,
        items: cart.map((c) =>
          isItemLibreCartLine(c)
            ? itemLibrePayload(c)
            : {
                product_id: c.product_id,
                quantity: c.quantity,
                notes: c.notes || undefined,
                modifier_ids: c.modifiers.map((m) => m.id),
                // Precio pisado (spec 069). El server revalida rol + motivo.
                price_override_cents: c.price_override_cents ?? null,
                price_override_reason: c.price_override_reason ?? null,
              },
        ),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (esProgramado) {
        // El encargue programado no imprime hoy: la comanda sale ese día, a la
        // hora de marcha. Si el aval falló, avisamos que hay que aceptarlo.
        if (r.data.needs_accept) {
          toast.warning(
            `Pedido #${r.data.daily_number} para el ${diaDelPedido}, pero quedó sin aceptar — aceptalo desde «Próximos» para que salga solo`,
          );
        } else {
          toast.success(
            `Pedido #${r.data.daily_number} para las ${horaPedido} · la comanda sale sola a las ${marchaLabel}`,
          );
        }
      } else if (marchar) {
        const c = await confirmarPedido(r.data.order_id, slug);
        if (!c.ok) {
          toast.warning(
            `Pedido #${r.data.daily_number} cargado, pero no marchó: ${c.error}`,
          );
        } else {
          toast.success(
            // Spec 127 — con horas, el papel sale igual pero el pedido todavía
            // no entra al kanban: decirlo evita que el encargado lo busque en
            // «En cocina» y crea que no marchó.
            hayHoras
              ? `Pedido #${r.data.daily_number} enviado a cocina · entra a «En cocina» a las ${marchaLabel}`
              : `Pedido #${r.data.daily_number} cargado y enviado a cocina`,
          );
        }
      } else {
        toast.success(`Pedido #${r.data.daily_number} cargado`);
      }
      reset();
      onCreated?.();
      onClose();
    });
  }

  return createPortal(
    // `z-[60]` y no `z-50`: ya fuera de la caja, el empate con la campana lo
    // resolvería el orden del DOM, y el orden del DOM acá no es estable.
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter: en carga → ir a datos; en datos → cargar y marchar
          // (o programar, que nunca marcha al toque).
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !openProduct) {
            e.preventDefault();
            // Ancho: las dos columnas están a la vista, así que ⌘Enter
            // confirma. Angosto: el primer ⌘Enter pasa a «datos» y el
            // segundo confirma, como venía siendo.
            if (sheetAncho) {
              if (canSubmit) submit(!esProgramado);
            } else if (view === "carga" && cart.length > 0) setView("datos");
            else if (view === "datos" && canSubmit) submit(!esProgramado);
          }
        }}
        ref={hojaRef}
        // `@container`: el layout de adentro se adapta al ancho **de la hoja**
        // (spec 115), igual que el panel del salón. El `xl:` de acá es otra
        // cosa: cuánto se le permite ensancharse a la hoja en pantalla grande.
        className="@container relative flex h-full w-full max-w-md flex-col overflow-hidden bg-popover shadow-2xl xl:max-w-[900px]"
      >
        {/* ─── Header ─── */}
        <header className="shrink-0 border-b border-border bg-card px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            {view === "datos" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setView("carga")}
                className="-ml-1 @min-[600px]:hidden"
                aria-label="Volver a la carga"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                <ShoppingBag className="size-[18px]" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <SectionLabel>
                {agregarA ? `Pedido #${agregarA.dailyNumber}` : "Cargar pedido"}
              </SectionLabel>
              <h2 className="font-heading text-lg leading-tight font-semibold tracking-tight text-foreground">
                {agregarA
                  ? "Agregá los productos"
                  : view === "carga"
                    ? "Elegí los productos"
                    : "Cliente y entrega"}
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="-mt-1 -mr-2"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className={`mt-2.5 flex gap-2 ${agregarA ? "hidden" : ""}`}>
            <button
              onClick={() => setDeliveryType("pickup")}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition ${
                deliveryType === "pickup"
                  ? "bg-primary text-white"
                  : "bg-card text-foreground/80 ring-1 ring-border"
              }`}
            >
              <ShoppingBag className="h-4 w-4" /> Para llevar
            </button>
            <button
              onClick={() => setDeliveryType("delivery")}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition ${
                deliveryType === "delivery"
                  ? "bg-primary text-white"
                  : "bg-card text-foreground/80 ring-1 ring-border"
              }`}
            >
              <Bike className="h-4 w-4" /> Delivery
            </button>
          </div>
        </header>

        {/* ── Cuerpo ── (shell compartido con el panel del salón, spec 115)
            Angosto: una vista por vez (carga → «Continuar» → datos), como
            siempre — «datos» se abre encima de la carga. Ancho: las dos a la
            vez, sin ese paso. Es el mismo click de menos que en el salón, en la
            otra superficie. El corte lo decide el ancho **de la hoja**. */}
        <PanelDeCarga>
          <ColumnaDeCarga
            className="@min-[600px]:order-2"
            encabezado={
              <>
                <ProductSearchInput api={searchApi} inputRef={searchRef} />
              </>
            }
            onKeyDownResultados={(e) => {
              if (catalogo.handleKeyDown(e)) return;
              if (isPrintableKey(e)) {
                e.preventDefault();
                escribirEnBuscador(e.key);
              }
            }}
            // Sólo angosto: ancho, el pedido y el total están a la izquierda y
            // no hay a dónde «continuar» — igual que la carga del salón, que no
            // tiene pie. Angosto es el único lugar donde el carrito no se ve.
            pie={
              <div className="shrink-0 border-t border-border bg-card @min-[600px]:hidden">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-muted-foreground">
                      Total ·{" "}
                      {cartCount > 0
                        ? `${cartCount} ${cartCount === 1 ? "ítem" : "ítems"}`
                        : "vacío"}
                    </p>
                    <p className="text-lg font-bold text-foreground tabular-nums">
                      {formatCurrency(totalConEnvio)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xl"
                    onClick={() => setView("datos")}
                    disabled={cart.length === 0}
                  >
                    Continuar
                    <span className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] sm:inline">
                      ⌘↵
                    </span>
                  </Button>
                </div>
              </div>
            }
          >
            {loadingCatalog ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground/70">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : catalogError ? (
              <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 py-10 text-center">
                <p className="text-sm font-semibold text-red-700">
                  {catalogError}
                </p>
              </div>
            ) : catalogProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center">
                <p className="text-sm font-semibold text-foreground/80">
                  {isSearching ? "Sin resultados" : "Sin productos"}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Mismo encabezado que el panel de la mesa: sin búsqueda, lo
                    que se ve son los más pedidos y hay que decirlo. */}
                {!isSearching && topProducts.length > 0 && (
                  <div className="flex items-center gap-2 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-100">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                      <Star className="h-4 w-4 text-amber-600" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-amber-900">
                        Principales más pedidos
                      </p>
                      <p className="text-xs text-amber-800/80">
                        Lo que más sale en los últimos 30 días.
                      </p>
                    </div>
                  </div>
                )}
                {/* Buscando o no, la misma lista navegable por ↓/↑. Spec 073. */}
                <ProductResultsList
                  products={catalogProducts}
                  onPick={(p) =>
                    isItemLibreEntry(p)
                      ? setLibreAbierto(true)
                      : setOpenProduct(p)
                  }
                  enterTargetId={enterTargetId}
                  itemProps={(id) => {
                    const i = catalogProducts.findIndex((p) => p.id === id);
                    return i < 0 ? {} : catalogo.itemProps(i);
                  }}
                />
              </div>
            )}
          </ColumnaDeCarga>

          {/* ─── Izquierda: cliente, entrega y el pedido en armado ─── */}
          <ColumnaLateral
            abierta={view === "datos"}
            className="@min-[600px]:order-1 @min-[600px]:border-r @min-[600px]:border-border"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
              {/* Modo agregar (spec 125): el cliente, la entrega y el «para
                  cuándo» ya se decidieron cuando entró el pedido. Lo único que
                  se elige acá son los productos que se suman. */}
              {!agregarA && (
                <>
                  {/* Spec 068: mismo bloque de cliente que abrir mesa y nueva
                  reserva — un solo buscador, y la regla del teléfono bloqueado
                  con un cliente elegido (spec 067) vive en `CustomerFields`. */}
                  <section className="space-y-2.5 rounded-2xl bg-card p-3 ring-1 ring-border">
                    <CustomerFields
                      slug={slug}
                      idPrefix="cargar"
                      name={customerName}
                      phone={customerPhone}
                      onNameChange={setCustomerName}
                      onPhoneChange={setCustomerPhone}
                      onPick={pickCliente}
                      onClear={quitarCliente}
                      nameLabel={
                        deliveryType === "pickup"
                          ? "Cliente (opcional)"
                          : "Cliente"
                      }
                      phoneLabel={
                        deliveryType === "delivery"
                          ? "Teléfono (requerido)"
                          : "Teléfono (opcional)"
                      }
                      labelClassName="text-xs font-semibold text-foreground/70"
                      inputClassName="block h-10 w-full rounded-xl border border-border px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                    {deliveryType === "delivery" && (
                      <div>
                        <label className="text-xs font-semibold text-foreground/70">
                          {entrega.porLote
                            ? "Nro de lote (requerido)"
                            : "Dirección de entrega (requerida)"}
                        </label>
                        {clienteDirecciones.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {clienteDirecciones.map((a) => {
                              const linea = formatDireccion(a);
                              const activa = deliveryAddress === linea;
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => setDeliveryAddress(linea)}
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                    activa
                                      ? "bg-primary text-white"
                                      : "bg-muted text-foreground/80 ring-1 ring-border active:bg-border"
                                  }`}
                                >
                                  {a.label ? `${a.label}: ` : ""}
                                  {linea}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <input
                          type="text"
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder={entrega.placeholder}
                          className="mt-1 block h-10 w-full rounded-xl border border-border px-3 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
                        />
                        {clienteDirecciones.length > 0 && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Elegí una dirección guardada o editá el campo.
                          </p>
                        )}
                      </div>
                    )}
                    {/* Spec 196: la indicación de la entrega vive pegada a
                        la dirección, que es lo que describe, y sólo existe en
                        delivery — en retiro no hay timbre que tocar. La nota
                        para cocina se fue con el pedido en armado. */}
                    {deliveryType === "delivery" && (
                      <div>
                        <label
                          htmlFor="cargar-nota-entrega"
                          className="text-xs font-semibold text-foreground/70"
                        >
                          Indicaciones para la entrega (opcional)
                        </label>
                        <input
                          id="cargar-nota-entrega"
                          type="text"
                          value={deliveryNotes}
                          onChange={(e) => setDeliveryNotes(e.target.value)}
                          placeholder="ej: tocar timbre, portón negro…"
                          className="mt-1 block h-10 w-full rounded-xl border border-border px-3 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Para el que reparte. Sale en el ticket de control,
                          junto con la dirección: cocina no la ve.
                        </p>
                      </div>
                    )}
                  </section>

                  {/* ─── ¿Para cuándo? (spec 127) ───
                  Dos modos, y el default es el 95% de los encargues. «Para
                  hoy» es lo de siempre: la comanda sale ahora. «Programado»
                  es, por definición, para OTRO día — el papel sale ese día,
                  solo, antes de la hora de cocina.

                  Las dos horas son a mano: el sistema no calcula ninguna ni
                  pre-llena la segunda con la primera. Vacías = para ahora.

                  Spec 196: los cuatro campos estaban agrupados por TIPO DE
                  DATO — las dos notas juntas, las dos horas juntas— y se leían
                  como el mismo dato pedido dos veces. Ahora se agrupan por
                  PAPEL: todo lo que sale en la comanda en un lugar, todo lo
                  que sale en el ticket del cliente en otro. La hora sigue
                  siendo campo propio y no texto libre — es la que dispara la
                  ventana de marcha (spec 127)—, pero la hora y la nota de
                  cocina se leen como una sola cosa. La indicación de entrega
                  vive con la dirección, que es su papel y su contexto. */}
                  <section className="space-y-2.5 rounded-2xl bg-card p-3 ring-1 ring-border">
                    <h3 className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                      ¿Para cuándo?
                    </h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCuando("hoy");
                          setDia("");
                        }}
                        className={`h-9 flex-1 rounded-xl text-sm font-semibold transition ${
                          !esProgramado
                            ? "bg-primary text-white"
                            : "bg-card text-foreground/80 ring-1 ring-border active:bg-muted"
                        }`}
                      >
                        Para hoy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCuando("programado");
                          // Arranca en mañana: un pedido de hoy no es un
                          // programado, aunque sea para dentro de cinco horas.
                          if (!dia) setDia(manana);
                        }}
                        className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
                          esProgramado
                            ? "bg-primary text-white"
                            : "bg-card text-foreground/80 ring-1 ring-border active:bg-muted"
                        }`}
                      >
                        <Clock className="h-4 w-4" /> Programado
                      </button>
                    </div>

                    {esProgramado && (
                      <div>
                        <label
                          htmlFor="cargar-dia"
                          className="text-xs font-semibold text-foreground/70"
                        >
                          Día
                        </label>
                        <input
                          id="cargar-dia"
                          type="date"
                          value={dia}
                          min={manana}
                          onChange={(e) => setDia(e.target.value)}
                          className="mt-1 block h-10 w-full rounded-xl border border-border px-3 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                          Un pedido programado es para otro día. Para hoy,
                          cargalo como «Para hoy».
                        </p>
                      </div>
                    )}

                    {/* Un recuadro por papel. El encabezado dice qué papel es
                        y quién lo lee, así la pregunta «¿cuál de los dos sale
                        en la comanda?» se contesta sin leer el gris. */}
                    <div className="space-y-2 rounded-xl bg-muted/50 p-2.5 ring-1 ring-border">
                      <p className="text-[11px] font-bold text-foreground/80">
                        Para cocina{" "}
                        <span className="font-medium text-muted-foreground">
                          · sale en la comanda
                        </span>
                      </p>
                      <div className="flex gap-2">
                        <div className="w-24 shrink-0">
                          <label
                            htmlFor="cargar-hora-cocina"
                            className="text-xs font-semibold text-foreground/70"
                          >
                            Hora
                          </label>
                          <TimeField24
                            id="cargar-hora-cocina"
                            value={horaCocina}
                            onChange={setHoraCocina}
                            className="mt-1 block h-10 w-full rounded-xl border border-border bg-card px-3 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <label
                            htmlFor="cargar-nota-cocina"
                            className="text-xs font-semibold text-foreground/70"
                          >
                            Nota (opcional)
                          </label>
                          <input
                            id="cargar-nota-cocina"
                            type="text"
                            value={kitchenNotes}
                            onChange={(e) => setKitchenNotes(e.target.value)}
                            maxLength={120}
                            placeholder="ej: junto con la mesa 5…"
                            className="mt-1 block h-10 w-full rounded-xl border border-border bg-card px-3 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        La hora es para cuándo el plato tiene que estar listo.
                        Para «sin cebolla», usá la nota del producto.
                      </p>
                    </div>

                    <div className="space-y-2 rounded-xl bg-muted/50 p-2.5 ring-1 ring-border">
                      <p className="text-[11px] font-bold text-foreground/80">
                        Para el cliente{" "}
                        <span className="font-medium text-muted-foreground">
                          · sale en el ticket de control
                        </span>
                      </p>
                      <div className="w-24">
                        <label
                          htmlFor="cargar-hora-pedido"
                          className="text-xs font-semibold text-foreground/70"
                        >
                          Hora
                        </label>
                        <TimeField24
                          id="cargar-hora-pedido"
                          value={horaPedido}
                          onChange={setHoraPedido}
                          className="mt-1 block h-10 w-full rounded-xl border border-border bg-card px-3 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
                        />
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Cuándo lo retira o lo recibe.
                        {deliveryType === "delivery"
                          ? " Las indicaciones de la entrega van arriba, con la dirección."
                          : ""}
                      </p>
                    </div>

                    {/* Lo que va a pasar, dicho antes de que pase. Cambia con el
                        modo: para hoy el papel sale ya y lo único que espera es
                        el kanban; programado, espera todo. */}
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {!hayHoras
                        ? esProgramado
                          ? "Cargá las dos horas del encargue."
                          : "Sin horas, el pedido es para ahora."
                        : esProgramado
                          ? `La comanda sale sola a las ${marchaLabel}, y ahí pasa a «En cocina».`
                          : `La comanda sale ahora. El pedido pasa a «En cocina» a las ${marchaLabel}.`}
                    </p>
                  </section>
                </>
              )}

              {/* El pedido en armado. Vive acá, con el cliente y la entrega:
                  la izquierda es «el pedido y a quién va», que es el espejo de
                  la columna de la mesa en el salón (spec 115). */}
              <section className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Tu pedido
                  </p>
                  <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {cartCount > 0
                      ? `${cartCount} ${cartCount === 1 ? "ítem" : "ítems"}`
                      : "vacío"}
                  </span>
                </div>
                {cart.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Todavía no cargaste nada. Buscá en la carta y agregá con
                    Enter.
                  </p>
                ) : (
                  <ul onKeyDown={carrito.handleKeyDown} className="space-y-1">
                    {cart.map((c, i) => (
                      <li
                        key={c._key}
                        {...carrito.itemProps(i)}
                        aria-label={`${c.product_name}, cantidad ${c.quantity}. ← y → cambian la cantidad, Supr la quita.`}
                        className="flex items-center gap-2 rounded-xl bg-muted/50 px-2.5 py-1.5 ring-1 ring-border/60 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {c.product_name}
                          </p>
                          {c.notes && (
                            <p className="truncate text-[11px] text-muted-foreground italic">
                              &quot;{c.notes}&quot;
                            </p>
                          )}
                          {c.price_override_cents != null && (
                            <p className="truncate text-[11px] font-medium text-amber-700">
                              <span className="line-through opacity-60">
                                {formatCurrency(c.unit_price_cents)}
                              </span>{" "}
                              → {formatCurrency(c.price_override_cents)} ·{" "}
                              {c.price_override_reason}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-emerald-700 tabular-nums">
                          {formatCurrency(c.line_subtotal_cents)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setPriceTargetKey(c._key)}
                            className={
                              c.price_override_cents != null
                                ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300"
                                : ""
                            }
                            aria-label={`Cambiar el precio de ${c.product_name}`}
                          >
                            <Tag className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => changeQty(c._key, -1)}
                            disabled={c.quantity <= 1}
                            aria-label="Menos"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <span className="w-5 text-center text-sm font-bold tabular-nums">
                            {c.quantity}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => changeQty(c._key, 1)}
                            disabled={c.quantity >= 99}
                            aria-label="Más"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeFromCart(c._key)}
                            aria-label={`Quitar ${c.product_name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {envioCents > 0 && (
                  <div className="flex items-center justify-between pt-2.5 text-sm">
                    <span className="text-foreground/70">Envío</span>
                    <span className="tabular-nums text-foreground/80">
                      {formatCurrency(envioCents)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                  <span className="text-sm font-medium text-foreground/70">
                    Total
                  </span>
                  <span className="text-lg font-bold text-foreground tabular-nums">
                    {formatCurrency(totalConEnvio)}
                  </span>
                </div>
              </section>
            </div>

            {/* Footer datos — programado: una sola acción, porque "enviar a
                cocina" contradice el diferido (spec 085). */}
            <footer className="shrink-0 space-y-2 border-t border-border bg-card px-3 py-3">
              {/* Por qué el botón está gris (issue #219). Con el carrito vacío
                  no se dice: «Tu pedido · vacío» está tres centímetros arriba y
                  repetirlo es ruido. El caso que importa es el otro — hay
                  productos cargados, el encargado apunta al botón y está
                  muerto. */}
              {!agregarA && faltaParaEnviar && cart.length > 0 && (
                <p
                  role="status"
                  className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-snug font-medium text-amber-900 ring-1 ring-amber-100"
                >
                  {faltaParaEnviar}
                </p>
              )}
              {agregarA ? (
                // Una sola acción: lo que se agrega a un pedido vivo va a
                // cocina ahora. «Cargar sin marchar» era para el pedido que
                // todavía no existe — acá el pedido ya está andando.
                <Button
                  type="button"
                  size="xl"
                  onClick={() => submit(true)}
                  disabled={cart.length === 0 || pending}
                  className="w-full"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Agregar al pedido #{agregarA.dailyNumber}
                </Button>
              ) : esProgramado ? (
                <Button
                  type="button"
                  size="xl"
                  onClick={() => submit(false)}
                  disabled={!canSubmit}
                  className="w-full"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {/* «Enviar a cocina» no aplica: no hay nada que enviar
                      todavía. El papel sale ese día, solo. */}
                  {hayHoras ? "Cargar el encargue" : "Cargá las dos horas"}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="xl"
                    onClick={() => submit(true)}
                    disabled={!canSubmit}
                    className="w-full"
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Cargar y enviar a cocina
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => submit(false)}
                    disabled={!canSubmit}
                    className="w-full"
                  >
                    Sólo cargar (marchar después)
                  </Button>
                </>
              )}
            </footer>
          </ColumnaLateral>
        </PanelDeCarga>

        {priceTarget && (
          <PriceOverrideModal
            productName={priceTarget.product_name}
            catalogPriceCents={priceTarget.unit_price_cents}
            currentOverrideCents={priceTarget.price_override_cents}
            currentReason={priceTarget.price_override_reason}
            onConfirm={(cents, reason) =>
              setLinePrice(priceTarget._key, cents, reason)
            }
            onClear={() => setLinePrice(priceTarget._key, null, "")}
            onClose={() => setPriceTargetKey(null)}
          />
        )}

        {libreAbierto && (
          <ItemLibreModal
            nombreSugerido={searchApi.nombreLibreSugerido}
            onConfirm={(draft: ItemLibreDraft) => {
              addToCart(itemLibreCartLine(draft));
              setLibreAbierto(false);
              searchApi.setSearch("");
              focusSearch();
            }}
            onClose={() => {
              setLibreAbierto(false);
              focusSearch();
            }}
          />
        )}

        {/* Modal de producto — scopeado al panel (embedded → overlay absolute). */}
        <ProductModal
          product={openProduct}
          open={!!openProduct}
          // Delivery y para llevar tampoco tienen tiempos que ordenar: va todo
          // en la misma bolsa (issue #190, misma razón que la venta rápida).
          permiteComoEntrada={false}
          onClose={() => {
            setOpenProduct(null);
            focusSearch();
          }}
          onAdd={(item) => {
            addToCart(item);
            setOpenProduct(null);
            searchApi.setSearch("");
            focusSearch();
          }}
          embedded
        />
      </div>
    </div>,
    portalHost,
  );
}
