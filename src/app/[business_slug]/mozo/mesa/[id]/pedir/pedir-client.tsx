"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Beer,
  Cake,
  Check,
  ClipboardList,
  Clock,
  Coffee,
  CookingPot,
  Croissant,
  GalleryVertical,
  IceCream,
  MoreHorizontal,
  Minus,
  Pizza,
  Plus,
  Salad,
  Sandwich,
  Send,
  ShoppingBag,
  Soup,
  Sparkles,
  Star,
  Tag,
  Trash2,
  UserRound,
  Users,
  UtensilsCrossed,
  Wine,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { BusinessRole } from "@/lib/admin/context";
import {
  cancelarItem,
  editarItemComanda,
  enviarComanda,
  marcarComandaEntregada,
  type EnviarComandaItem,
  type EnviarComandaDailyMenuItem,
  type EnviarComandaFreeItem,
} from "@/lib/comandas/actions";
import type { ComandaConItems } from "@/lib/comandas/queries";
import { sePuedeRepreciar, type LoPedido } from "@/lib/mozo/lo-pedido";
import { ObservacionDeLaTanda } from "@/components/mozo/observacion-de-la-tanda";
import {
  MesaColumn,
  type MesaColumnAcciones,
  type MesaColumnCartItem,
} from "@/components/mozo/mesa-column";
import {
  CargarClienteModal,
  PersonasChips,
} from "@/components/mozo/datos-mesa";
import type { ComandaStatus } from "@/lib/comandas/types";
import { useOptimisticAction } from "@/lib/ui/use-optimistic-action";
import { useCartZone } from "@/lib/mozo/use-cart-zone";
import { isPrintableKey } from "@/lib/ui/roving";
import { useRovingList } from "@/lib/ui/use-roving-list";
import { formatCurrency } from "@/lib/currency";
import { mozoPalette } from "@/lib/mozo/colors";
import type {
  CatalogCategory,
  CatalogForMozo,
  CatalogProduct,
  CatalogSuperCategory,
} from "@/lib/mozo/catalog-query";
import type { DailyMenuForMozo } from "@/lib/mozo/daily-menus-query";
import { filterDailyMenus } from "@/lib/mozo/daily-menu-search";
import {
  choicesDeltaCents,
  type DailyMenuSelection,
} from "@/lib/mozo/daily-menu-steps";
import { DailyMenuWizard } from "@/components/mozo/daily-menu-wizard";
import { ComensalesModal } from "@/components/mozo/comensales-modal";
import {
  CartaOnlineSelector,
  ProductSearchInput,
  useProductSearch,
  type ProductSearchApi,
} from "@/components/mozo/product-search-box";
import { Button } from "@/components/ui/button";
import { PriceOverrideModal } from "@/components/shared/price-override-modal";
import { ItemLibreModal } from "@/components/shared/item-libre-modal";
import {
  isItemLibreCartLine,
  isItemLibreEntry,
  itemLibreCartLine,
  itemLibrePayload,
  type ItemLibreDraft,
} from "@/lib/mozo/item-libre-entry";
import {
  canCancelItem,
  canCargarItemLibre,
  canOverrideItemPrice,
} from "@/lib/permissions/can";

import {
  ProductModal,
  type AddToCartItem,
} from "@/components/mozo/product-modal";
import { ProductResultsList } from "@/components/mozo/product-results-list";
import {
  ColumnaDeCarga,
  ColumnaLateral,
  PanelDeCarga,
} from "@/components/mozo/panel-de-carga";

type CartProductItem = AddToCartItem & {
  _key: string;
  seat_number: number | null;
  /**
   * Precio pisado para este pedido (spec 069). `unit_price_cents` sigue siendo
   * el de catálogo — así el modal puede mostrar contra qué se comparó y el
   * «volver al precio de la carta» no necesita re-consultar nada.
   */
  price_override_cents?: number | null;
  price_override_reason?: string | null;
};
type CartDailyMenuItem = {
  _key: string;
  kind: "daily_menu";
  daily_menu_id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  notes: string;
  line_subtotal_cents: number;
  seat_number: number | null;
  /** Opciones elegidas en el asistente del menú del día (specs 29 / 072). */
  selected_choices: DailyMenuSelection[];
};
type CartItem = CartProductItem | CartDailyMenuItem;

function isDailyMenuCart(c: CartItem): c is CartDailyMenuItem {
  return "kind" in c && c.kind === "daily_menu";
}

/**
 * Precio unitario que se va a cobrar: el pisado por el encargado si lo hay,
 * si no el de catálogo (spec 069). Todo recálculo de subtotal pasa por acá —
 * si alguno usara `unit_price_cents` directo, cambiar la cantidad revertiría
 * el precio pisado en silencio.
 */
function effectiveUnitPriceCents(c: CartProductItem): number {
  return c.price_override_cents ?? c.unit_price_cents;
}

type Props = {
  slug: string;
  businessName: string;
  table: {
    id: string;
    label: string;
    operational_status: string;
    opened_at: string | null;
  };
  catalog: CatalogForMozo;
  stationNameById: Record<string, string>;
  existingComandas: ComandaConItems[];
  /** Lo que la mesa ya tiene cargado, para la columna «Lo pedido» del panel
   *  ancho (spec 111). `null` = mesa sin orden abierta todavía. Sólo lo usa el
   *  modo `embedded`: el full-screen del mozo tiene su paso «resumen». */
  loPedido?: LoPedido | null;
  /**
   * El estado de la mesa todavía viaja (spec 115). El panel se pinta igual: la
   * columna de carga sólo necesita el catálogo, que en el sidebar del salón
   * está cacheado, así que esperar el round-trip de la mesa para mostrar el
   * buscador era regalar medio segundo en el gesto más repetido del turno.
   */
  mesaCargando?: boolean;
  /** Acciones de la mesa que vive el salón (cobrar, transferir, trasladar,
   *  anular). Sólo llegan en el sidebar: en el full-screen del mozo la mesa se
   *  maneja desde su propia pantalla. */
  mesaAcciones?: MesaColumnAcciones;
  /**
   * Algo cambió en la mesa **sin** cerrar el panel: se entregó una comanda o
   * se anuló un ítem. El salón lo necesita para repintar el plano (las demoras
   * de la spec 30 salen de sus datos, y desde la spec 102 el panel no re-corre
   * la ruta: se re-sincroniza con su propio fetch). Antes esto lo disparaba el
   * detalle de mesa; ahora esas acciones viven acá.
   */
  onMesaActualizada?: () => void;
  topProductIds: string[];
  dailyMenus: DailyMenuForMozo[];
  role: BusinessRole;
  /**
   * El mozo de la mesa, para la pastilla del header (spec 146 · D-A3). Sólo
   * llegan en el sidebar del salón: en la pantalla del mozo la mesa es suya.
   * `onElegirMozo` viene sólo si el rol puede asignar (`canAssignMozo`); sin
   * él la pastilla es un rótulo, no un botón.
   */
  mozoId?: string | null;
  mozoName?: string | null;
  onElegirMozo?: () => void;
  /**
   * El selector de mozo está abierto **encima** del panel (spec 146,
   * fast-follow). Sólo se usa para devolver el foco al buscador cuando se
   * cierra: el modal se lo llevó, y sin esto el panel queda mudo hasta que
   * alguien toque algo con el mouse.
   */
  mozoPickerAbierto?: boolean;
  /**
   * Esta mesa se está **abriendo**: libre, y no es la barra (spec 146,
   * fast-follow 2). Dispara la otra pregunta de la apertura —cuántos se
   * sientan— encadenada al selector de mozo.
   */
  aperturaDeMesa?: boolean;
  /** Destino del botón "volver" y del post-envío. Default: la vista del mozo.
   *  El admin/encargado lo setea a `/{slug}/admin/operacion` para cargar el
   *  pedido sin salir del panel (misma idea que el cobro admin). */
  homeHref?: string;
  /** Modo embebido: la vista se renderiza dentro de un panel (el sidebar del
   *  salón) en vez de pantalla completa — layout en columna flex y footer
   *  no-fixed. `onClose` cierra el panel; `onSent` corre tras enviar. */
  embedded?: boolean;
  onClose?: () => void;
  onSent?: () => void;
};

type Step = "catalogo" | "resumen";

// ── Tab "top" virtual ────────────────────────────────────────────────────
//
// Las pestañas reales vienen de `super_categories` del business. Sumamos un
// chip virtual al inicio que muestra principales más pedidos + menú del día.
const TOP_TAB_ID = "__top__";
const ORPHAN_TAB_ID = "__orphan__";

type TabId = string; // super_category_id, "__top__" u "__orphan__"

// ── Iconos lucide por slug ──────────────────────────────────────────────
//
// Mapa **explícito** para que tailwind purge no se confunda con `text-${color}`.
// Si el admin elige un ícono que no está en este mapa, fallback a UtensilsCrossed.
const ICON_MAP: Record<string, LucideIcon> = {
  salad: Salad,
  "utensils-crossed": UtensilsCrossed,
  wine: Wine,
  cake: Cake,
  coffee: Coffee,
  beer: Beer,
  pizza: Pizza,
  "ice-cream": IceCream,
  sparkles: Sparkles,
  star: Star,
  sandwich: Sandwich,
  soup: Soup,
  "cooking-pot": CookingPot,
  croissant: Croissant,
  "more-horizontal": MoreHorizontal,
};

function resolveIcon(slug: string | undefined | null): LucideIcon {
  if (!slug) return UtensilsCrossed;
  return ICON_MAP[slug] ?? UtensilsCrossed;
}

// ── Colores ──────────────────────────────────────────────────────────────
//
// Mismo patrón: clases Tailwind explícitas para sobrevivir el purge. Cada
// supercategoría guarda un slug ("lime", "sky"...) y el client lo resuelve
// a {inactive: text-X-600, active: text-X-300} para chips activos/inactivos.
const COLOR_MAP: Record<string, { inactive: string; active: string }> = {
  lime: { inactive: "text-lime-600", active: "text-lime-300" },
  orange: { inactive: "text-orange-600", active: "text-orange-300" },
  sky: { inactive: "text-sky-600", active: "text-sky-300" },
  pink: { inactive: "text-pink-600", active: "text-pink-300" },
  amber: { inactive: "text-amber-500", active: "text-amber-300" },
  red: { inactive: "text-red-600", active: "text-red-300" },
  emerald: { inactive: "text-emerald-600", active: "text-emerald-300" },
  rose: { inactive: "text-rose-600", active: "text-rose-300" },
  violet: { inactive: "text-violet-600", active: "text-violet-300" },
  zinc: { inactive: "text-muted-foreground", active: "text-muted-foreground/50" },
};

function resolveColor(slug: string | undefined | null): {
  inactive: string;
  active: string;
} {
  if (!slug) return COLOR_MAP.zinc;
  return COLOR_MAP[slug] ?? COLOR_MAP.zinc;
}

// ── Tab definition (viene del server o virtual) ─────────────────────────
type Tab = {
  id: TabId;
  label: string;
  icon: LucideIcon;
  iconInactive: string;
  iconActive: string;
};

const STATUS_LABEL: Record<ComandaStatus, string> = {
  pendiente: "Activa",
  en_preparacion: "Activa",
  entregado: "Cerrada",
};

const STATUS_PILL: Record<ComandaStatus, string> = {
  pendiente: "bg-sky-100 text-sky-800",
  en_preparacion: "bg-sky-100 text-sky-800",
  entregado: "bg-emerald-100 text-emerald-800",
};

const STATUS_DOT: Record<ComandaStatus, string> = {
  pendiente: "bg-sky-500",
  en_preparacion: "bg-sky-500",
  entregado: "bg-emerald-500",
};

const TABLE_STATUS_LABEL: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pidio_cuenta: "Pidió la cuenta",
};

function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

/** Cambio optimista sobre las comandas ya enviadas (entregar / cancelar ítem). */
type ComandaOptimistic =
  | { kind: "entregar"; comandaId: string; deliveredAt: string }
  | {
      kind: "cancelarItem";
      orderItemId: string;
      reason: string;
      cancelledAt: string;
    };

export function MozoPedirClient({
  slug,
  businessName,
  table,
  catalog,
  stationNameById,
  existingComandas,
  loPedido,
  mesaCargando = false,
  mesaAcciones,
  onMesaActualizada,
  topProductIds,
  dailyMenus,
  role,
  mozoId = null,
  mozoName = null,
  onElegirMozo,
  mozoPickerAbierto = false,
  aperturaDeMesa = false,
  homeHref,
  embedded = false,
  onClose,
  onSent,
}: Props) {
  const router = useRouter();
  // Default: vista del mozo. El admin pasa `/{slug}/admin/operacion`.
  const backHref = homeHref ?? `/${slug}/mozo`;
  const [pending, startTransition] = useTransition();

  // Overlay optimista de las comandas enviadas (spec 21): entregar y cancelar
  // ítem se ven al instante; el server reconcilia vía revalidatePath y el
  // overlay se descarta al terminar la transición (rollback si falla).
  const { state: comandas, run: runComanda } = useOptimisticAction(
    existingComandas,
    (cs: ComandaConItems[], a: ComandaOptimistic): ComandaConItems[] => {
      if (a.kind === "entregar") {
        return cs.map((c) =>
          c.id === a.comandaId
            ? { ...c, status: "entregado", delivered_at: a.deliveredAt }
            : c,
        );
      }
      const markItem = (it: ComandaConItems["items"][number]) =>
        it.order_item_id === a.orderItemId
          ? { ...it, cancelled_at: a.cancelledAt, cancelled_reason: a.reason }
          : it;
      return cs.map((c) => ({
        ...c,
        items: c.items.map(markItem),
        combina_con: c.combina_con.map(markItem),
      }));
    },
  );

  // ── Indexado de catálogo ──
  const allProducts: CatalogProduct[] = useMemo(
    () => catalog.categories.flatMap((c) => c.products),
    [catalog],
  );
  const productById = useMemo(() => {
    const m = new Map<string, CatalogProduct>();
    for (const p of allProducts) m.set(p.id, p);
    return m;
  }, [allProducts]);
  const categoryById = useMemo(() => {
    const m = new Map<string, CatalogCategory>();
    for (const c of catalog.categories) m.set(c.id, c);
    return m;
  }, [catalog]);

  // Categorías agrupadas por supercategoría (id) o "__orphan__" si null.
  const categoriesBySuper: Record<TabId, CatalogCategory[]> = useMemo(() => {
    const out: Record<TabId, CatalogCategory[]> = {};
    for (const cat of catalog.categories) {
      if (cat.products.length === 0) continue;
      const key = cat.super_category_id ?? ORPHAN_TAB_ID;
      if (!out[key]) out[key] = [];
      out[key].push(cat);
    }
    return out;
  }, [catalog]);

  /**
   * Los más pedidos del negocio, en orden.
   *
   * **Sin filtrar por supercategoría.** Había un filtro «sólo los de la super
   * `principales`», con el argumento de que bebidas y entradas tenían su tab
   * dedicado. Dos cosas: los tabs ya no existen en el panel (spec 111), y esa
   * supercategoría **no existe en ningún negocio** —las supers son bebidas,
   * cafetería, entradas-y-minutas, parrilla, pastas, pescados, picar, platos,
   * postres y vinos—, así que el filtro nunca corrió. Quedaba como trampa: el
   * día que alguien creara una super llamada «principales», la única lista del
   * panel se habría vaciado de bebidas sin que nadie tocara nada.
   */
  const topProducts: CatalogProduct[] = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogProduct[] = [];
    for (const id of topProductIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = productById.get(id);
      if (p) out.push(p);
    }
    return out;
  }, [topProductIds, productById]);

  const topIds = useMemo(
    () => new Set(topProducts.map((p) => p.id)),
    [topProducts],
  );

  const hasTopTab = topProducts.length > 0 || dailyMenus.length > 0;
  const hasOrphanTab = (categoriesBySuper[ORPHAN_TAB_ID] ?? []).length > 0;

  // Construir las tabs visibles en el orden definitivo.
  const tabs: Tab[] = useMemo(() => {
    const out: Tab[] = [];
    if (hasTopTab) {
      const c = resolveColor("amber");
      out.push({
        id: TOP_TAB_ID,
        label: "Más pedidos",
        icon: Star,
        iconInactive: c.inactive,
        iconActive: c.active,
      });
    }
    for (const sc of catalog.superCategories) {
      if (!categoriesBySuper[sc.id] || categoriesBySuper[sc.id].length === 0)
        continue;
      const c = resolveColor(sc.color);
      out.push({
        id: sc.id,
        label: sc.name,
        icon: resolveIcon(sc.icon),
        iconInactive: c.inactive,
        iconActive: c.active,
      });
    }
    if (hasOrphanTab) {
      const c = resolveColor("zinc");
      out.push({
        id: ORPHAN_TAB_ID,
        label: "Otros",
        icon: MoreHorizontal,
        iconInactive: c.inactive,
        iconActive: c.active,
      });
    }
    return out;
  }, [catalog.superCategories, categoriesBySuper, hasTopTab, hasOrphanTab]);

  const tabById: Record<TabId, Tab> = useMemo(
    () => Object.fromEntries(tabs.map((t) => [t.id, t])),
    [tabs],
  );

  // Mapa product_id → tabId, para saber qué tab marcar como "tocado".
  const productTabId = useMemo(() => {
    const m = new Map<string, TabId>();
    for (const p of allProducts) {
      const cat = p.category_id ? categoryById.get(p.category_id) : null;
      const superId = cat?.super_category_id ?? null;
      m.set(p.id, superId ?? ORPHAN_TAB_ID);
    }
    return m;
  }, [allProducts, categoryById]);

  // ── State ──
  const [step, setStep] = useState<Step>("catalogo");
  const [activeTab, setActiveTab] = useState<TabId>(tabs[0]?.id ?? TOP_TAB_ID);
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  // ── El artículo que no existe (spec 174) ──
  // Acá el gate sí mira el rol: esta pantalla la usan los cuatro roles del
  // salón (el mozo full-screen y el encargado en el sidebar), a diferencia de
  // la venta de mostrador y de «Cargar pedido», que ya son de encargado.
  const puedeItemLibre = canCargarItemLibre(role);
  const [libreAbierto, setLibreAbierto] = useState(false);
  /**
   * Elegir una fila del catálogo. La del «no existe» (spec 174) no abre el
   * `ProductModal` —no hay producto ni modificadores que elegir—, abre el suyo.
   * Pasa por acá **toda** la carga: el buscador, la lista de resultados y las
   * secciones del catálogo por tab.
   */
  const pickProducto = (p: CatalogProduct) =>
    isItemLibreEntry(p) ? setLibreAbierto(true) : setOpenProduct(p);
  const [openDailyMenu, setOpenDailyMenu] = useState<DailyMenuForMozo | null>(
    null,
  );
  const [cart, setCart] = useState<CartItem[]>([]);

  const [seatMode, setSeatMode] = useState(false);
  const [activeSeat, setActiveSeat] = useState(1);
  const [seatCount, setSeatCount] = useState(3);

  const [cancelTarget, setCancelTarget] = useState<{
    orderItemId: string;
    productName: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // ── Carga por teclado (spec 055 — solo se activa en el sidebar `embedded`) ──
  const searchRef = useRef<HTMLInputElement>(null);
  // Índice del resultado resaltado para navegar la búsqueda con ↓/↑ y abrirlo
  // con Enter.

  // Si la tab activa desaparece (admin cambió el catálogo entre cargas),
  // saltar a la primera disponible.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabById[activeTab]) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, tabById, activeTab]);

  // Si paso a step 2 sin items y sin comandas existentes, vuelvo automáticamente.
  useEffect(() => {
    if (step === "resumen" && cart.length === 0 && comandas.length === 0) {
      setStep("catalogo");
    }
  }, [step, cart.length, comandas.length]);

  // Tabs "tocadas" — las que ya tienen al menos un item en el carrito.
  const tabTouched: Record<TabId, boolean> = useMemo(() => {
    const out: Record<TabId, boolean> = {};
    for (const item of cart) {
      if (isDailyMenuCart(item)) continue;
      const tabId = productTabId.get(item.product_id);
      if (!tabId) continue;
      out[tabId] = true;
      // Si lo cargado está entre los más pedidos, ese tab también queda tocado.
      if (hasTopTab && topIds.has(item.product_id)) out[TOP_TAB_ID] = true;
    }
    return out;
  }, [cart, productTabId, hasTopTab, topIds]);

  // Secciones de la pestaña activa (una por categoría, o la lista del tab
  // "Más pedidos"). Es lo que se ve sin búsqueda.
  const tabSections: {
    category: CatalogCategory | null;
    products: CatalogProduct[];
  }[] = useMemo(() => {
    // Sidebar del salón (spec 111, fase 5): **no hay navegación por
    // categoría**. Sin búsqueda se ven «Más pedidos», que es a lo que la
    // navegación terminaba volviendo, y para todo lo demás está el buscador —
    // que desde la 110 aguanta acentos, plural y palabras en cualquier orden.
    // Elegir categoría era un rodeo de dos taps para llegar a lo mismo.
    if (embedded) {
      // Sin buscar se ven **sólo los más pedidos** (pedido de Juan): el panel
      // es para cargar rápido lo que sale todo el tiempo, y para el resto está
      // el buscador. Mostrar la carta entera lo volvía un catálogo de 482
      // líneas para scrollear.
      //
      // Único caso en que se muestra todo: cuando **no hay historial** (negocio
      // recién arrancado). Ahí «los más pedidos» está vacío y la alternativa es
      // una pantalla en blanco.
      return topProducts.length > 0
        ? [{ category: null, products: topProducts }]
        : allProducts.length > 0
          ? [{ category: null, products: allProducts }]
          : [];
    }
    if (activeTab === TOP_TAB_ID) {
      return topProducts.length > 0
        ? [{ category: null, products: topProducts }]
        : [];
    }
    const cats = categoriesBySuper[activeTab] ?? [];
    return cats.map((c) => ({ category: c, products: c.products }));
  }, [embedded, activeTab, topProducts, allProducts, categoriesBySuper]);

  // ── Búsqueda (spec 068: el mismo buscador que cargar pedido y venta rápida) ──
  // `browse` es lo visible sin búsqueda, aplanado en el orden en que se ve: el
  // índice de teclado corre sobre eso igual que sobre los resultados (spec 073).
  const browseProducts = useMemo(
    () => tabSections.flatMap((s) => s.products),
    [tabSections],
  );
  const searchApi = useProductSearch({
    products: allProducts,
    browse: browseProducts,
    storageKey: `mesa_web_${slug}`,
    onPick: pickProducto,
    // ↓ en el buscador baja el foco al catálogo (spec 075). Sólo en el sidebar:
    // en la tablet no hay flechas.
    // Con el catálogo vacío (una búsqueda sin resultados) la zona no puede
    // tragarse la flecha: se sigue derecho al carrito.
    onEnterResults: () =>
      catalogoIndex.size > 0 ? catalogo.focusFirst() : carrito.focusFirst(),
    itemLibre: puedeItemLibre,
  });
  const {
    search,
    setSearch,
    isSearching,
    results: searchResults,
    enterTargetId,
  } = searchApi;

  // Foco al buscador al montar, SOLO en el sidebar embebido: en la tablet del
  // mozo (full-screen) abriría el teclado virtual tapando la vista. FR-002.
  //
  // Con el selector de mozo abierto encima, no. Este efecto corre al **montar**,
  // y el panel no siempre monta en el mismo commit en que se abre la mesa: con
  // el catálogo todavía frío (la primera mesa del turno) primero se pinta el
  // esqueleto y el panel monta después — o sea, después de que el modal ya se
  // llevó el foco. Sin esta guarda, lo que se tipea en el modal termina en el
  // buscador de productos que está tapado.
  useEffect(() => {
    if (embedded && !mozoPickerAbierto && !comensalesTableId)
      searchRef.current?.focus();
    // `mozoPickerAbierto` a propósito fuera de las deps: esto es el foco de
    // **montaje**. Devolverlo cuando el modal se cierra es del efecto de abajo,
    // que sabe distinguir el flanco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded]);

  // Tras agregar un ítem o cerrar el modal, devolvemos el foco al buscador para
  // encadenar cargas sin mouse (FR-013), en el próximo tick (modal ya
  // desmontado). No-op fuera del modo embebido.
  const focusSearch = useCallback(() => {
    if (!embedded) return;
    setTimeout(() => {
      // Va en el próximo tick, así que entre el pedido y la ejecución puede
      // haberse abierto un diálogo —el selector de mozo de otra mesa, el de
      // comensales, un producto—. El foco es suyo: robárselo deja al usuario
      // tecleando en un buscador que está tapado. Pasó en vivo cerrando un
      // modal con Esc y tocando otra mesa acto seguido.
      if (document.querySelector("[role='dialog']")) return;
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      // Cursor al final: volver del catálogo con ↑ tiene que dejarte seguir
      // tipeando donde ibas, no seleccionar lo escrito (FR-011).
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 0);
  }, [embedded]);

  /**
   * El selector de mozo se cerró: el foco vuelve al buscador (spec 146,
   * fast-follow).
   *
   * El modal se abre solo sobre la mesa libre sin mozo y se lleva el foco —está
   * bien, es lo primero que hay que contestar—. Pero al cerrarse, el botón que
   * lo tenía se desmonta y el foco cae al `<body>`: desde ahí las zonas del
   * panel no reciben nada (sus handlers viven en los contenedores) y la cadena
   * buscador → catálogo → carrito queda muerta hasta que alguien use el mouse.
   * Elegir el mozo y seguir comandando es una sola maniobra: acá se vuelve a
   * unir.
   */
  const pickerAbiertoAntes = useRef(mozoPickerAbierto);

  /**
   * La otra pregunta de la apertura: cuántos se sientan (fast-follow 2).
   *
   * Va **después** del mozo porque son un solo gesto —abrir la mesa— y se
   * contestan en orden. Se pregunta **una vez por mesa**: el panel no se
   * desmonta al saltar de mesa en mesa (keep-alive, specs 101/114), así que sin
   * este registro volver a una mesa ya contestada la volvería a preguntar.
   */
  /**
   * El modal guarda **de qué mesa** es, no un `true`.
   *
   * Es lo que lo desmonta solo cuando el panel se re-apunta a otra: el plano
   * queda vivo detrás a propósito, así que tocar otra mesa con el modal abierto
   * es un gesto normal. Con un booleano, el modal sobrevivía al cambio —
   * cambiaba el título pero se quedaba con el número de la mesa anterior, y
   * confirmarlo se lo aplicaba a la nueva. Es el gemelo del efecto que cierra
   * el selector de mozo cuando su mesa deja de ser la del panel.
   */
  const [comensalesTableId, setComensalesTableId] = useState<string | null>(
    null,
  );
  /**
   * Lo que ya se contestó, por mesa. Es un mapa y no un set porque también es
   * **la respuesta**: sin orden todavía, el número vive sólo en el estado del
   * panel, y ese estado se resetea al saltar de mesa. Sin guardarlo, contestar
   * «6» en la mesa 12, irse a mirar la 3 y volver dejaba la 12 en 2 otra vez —
   * y como ya estaba preguntada, nadie volvía a preguntar.
   */
  const comensalesPreguntados = useRef<Map<string, number | null>>(new Map());
  const abrirComensales = useCallback(() => {
    if (!aperturaDeMesa) return false;
    // Hasta que no vuelve el estado de la mesa no se pregunta: el `libre` del
    // plano es un snapshot y el número que el modal muestra sale de acá. Sin
    // esta espera, la mesa nueva podía abrir con el número de la anterior.
    if (mesaCargando) return false;
    if (loPedido != null) return false;
    if (comensalesPreguntados.current.has(table.id)) return false;
    // `null` = preguntada y todavía sin respuesta (se cerró con Esc, o está
    // abierta). La respuesta la escribe el `onConfirmar` del modal.
    comensalesPreguntados.current.set(table.id, null);
    setComensalesTableId(table.id);
    return true;
  }, [aperturaDeMesa, mesaCargando, loPedido, table.id]);

  useEffect(() => {
    const seCerroElPicker = pickerAbiertoAntes.current && !mozoPickerAbierto;
    pickerAbiertoAntes.current = mozoPickerAbierto;
    // El mozo va primero: mientras se elige, acá no pasa nada.
    if (mozoPickerAbierto) return;
    const abrio = abrirComensales();
    // Si no había nada más que preguntar, el foco vuelve al buscador — sin
    // esto, al cerrarse el modal el foco cae al `<body>` y la cadena
    // buscador → catálogo → carrito queda muerta hasta que alguien use el mouse.
    // Si SÍ se abrió el de comensales, el foco es suyo y devolverlo acá se lo
    // robaría (`focusSearch` corre en el próximo tick, después del montaje).
    if (!abrio && seCerroElPicker) focusSearch();
  }, [table.id, mozoPickerAbierto, abrirComensales, focusSearch]);

  // ── Zonas del panel (spec 075) ────────────────────────────────────────────
  //
  // buscador → catálogo/resultados → carrito → enviar. ↑/↓ pasan de una a otra
  // en los bordes, así el panel entero se recorre con una sola tecla.
  //
  // Lo que se ve sin búsqueda se filtra por el mismo criterio que `results`
  // (spec 068: el filtro de la carta online): la zona navegable tiene que ser
  // exactamente lo que está en pantalla, o Enter abriría otra cosa.
  const visibleIds = useMemo(
    () => new Set(searchResults.map((p) => p.id)),
    [searchResults],
  );
  const visibleSections = useMemo(
    () =>
      tabSections
        .map((s) => ({
          ...s,
          products: s.products.filter((p) => visibleIds.has(p.id)),
        }))
        .filter((s) => s.products.length > 0),
    [tabSections, visibleIds],
  );

  /**
   * Los menús del día que se ven, y son el primer tramo de la zona de teclado.
   *
   * En el **panel del salón** (spec 146 · B) ya no encabezan el catálogo con
   * una tarjeta: en reposo van compactos —una fila cada uno— y con el buscador
   * escrito aparecen los que matchean. Esto último es la mitad que faltaba: el
   * buscador mira productos, y un menú del día no es un producto, así que sin
   * `filterDailyMenus` sacar las tarjetas lo dejaba sin ninguna puerta.
   *
   * En la pantalla del mozo no cambia nada: la tarjeta grande en «Más
   * pedidos», que es donde sirve para mostrarle el plato al cliente.
   */
  const menusVisibles = useMemo(() => {
    if (dailyMenus.length === 0) return [];
    if (embedded) {
      return isSearching ? filterDailyMenus(dailyMenus, search) : dailyMenus;
    }
    return !isSearching && activeTab === TOP_TAB_ID ? dailyMenus : [];
  }, [isSearching, search, embedded, activeTab, dailyMenus]);
  const catalogoIndex = useMemo(() => {
    const index = new Map<string, number>();
    for (const m of menusVisibles) index.set(`menu:${m.id}`, index.size);
    for (const p of searchResults) index.set(`prod:${p.id}`, index.size);
    return index;
  }, [menusVisibles, searchResults]);

  const enviarRef = useRef<HTMLButtonElement>(null);
  const catalogo = useRovingList<HTMLButtonElement>({
    length: catalogoIndex.size,
    onExitUp: focusSearch,
    onExitDown: () => carrito.focusFirst(),
  });
  const { itemProps: catalogoItemProps } = catalogo;
  const catalogoProps = useCallback(
    (key: string) => {
      const i = catalogoIndex.get(key);
      return i === undefined ? {} : catalogoItemProps(i);
    },
    [catalogoIndex, catalogoItemProps],
  );

  /** Escribir una letra desde el catálogo o el carrito vuelve al buscador. */
  const escribirEnBuscador = useCallback(
    (char: string) => {
      setSearch((s) => s + char);
      focusSearch();
    },
    [setSearch, focusSearch],
  );

  // ── Cache del borrador de pedido por mesa (spec 055 fast-follow, #81) ──
  // Si el encargado sale de la carga (p. ej. a editar el precio de una
  // sugerencia) y vuelve, el pedido en armado se retoma en vez de perderse.
  // Borrador local (localStorage) por mesa+negocio — NO es plata: son ítems sin
  // enviar; se limpia solo cuando el carrito queda vacío (al enviar todo).
  const cartCacheKey = `mozo-cart:${slug}:${table.id}`;
  const skipFirstPersist = useRef(true);

  const guardarBorrador = useCallback(
    (items: CartItem[]) => {
      try {
        if (items.length === 0) window.localStorage.removeItem(cartCacheKey);
        else window.localStorage.setItem(cartCacheKey, JSON.stringify(items));
      } catch {
        // ignorar (modo privado, cuota excedida, etc.)
      }
    },
    [cartCacheKey],
  );

  // Hidratar al montar **y al cambiar de mesa**: desde el keep-alive (specs
  // 101/114) el panel no se desmonta entre mesas, así que esto es lo único que
  // separa un carrito del otro. Si la mesa nueva no tiene borrador el carrito
  // queda vacío — arrastrar el de la anterior era cargarle a la mesa
  // equivocada, y de ahí salía comida de más.
  useEffect(() => {
    let saved: CartItem[] | null = null;
    try {
      const raw = window.localStorage.getItem(cartCacheKey);
      saved = raw ? (JSON.parse(raw) as CartItem[]) : null;
    } catch {
      // localStorage no disponible / JSON corrupto → arrancamos vacío.
    }
    setCart(Array.isArray(saved) && saved.length > 0 ? saved : []);
    // El próximo persist es el de esta hidratación: no tiene que pisar el
    // borrador recién leído con el carrito de la mesa anterior.
    skipFirstPersist.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartCacheKey]);

  // Persistir en cada cambio; limpiar cuando queda vacío.
  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    guardarBorrador(cart);
  }, [cart, guardarBorrador]);

  // ── La observación de la tanda (spec 128) ────────────────────────────────
  // Clave propia y no adentro del borrador: ése es un `CartItem[]` serializado
  // y meterle un objeto rompería los borradores ya guardados en los teléfonos
  // del local.
  //
  // Por mesa, igual que el carrito: desde el keep-alive (specs 101/114) el
  // panel no se desmonta al cambiar de mesa, así que sin esto «la mesa tiene
  // apuro» se iba con el mozo a la mesa siguiente y salía impreso en una tanda
  // que no tenía nada que ver.
  const obsCacheKey = `mozo-obs:${slug}:${table.id}`;
  const [observacion, setObservacion] = useState("");

  const cambiarObservacion = useCallback(
    (v: string) => {
      setObservacion(v);
      try {
        if (v.trim().length === 0) window.localStorage.removeItem(obsCacheKey);
        else window.localStorage.setItem(obsCacheKey, v);
      } catch {
        // ignorar (modo privado, cuota excedida, etc.)
      }
    },
    [obsCacheKey],
  );

  useEffect(() => {
    let guardada: string | null = null;
    try {
      guardada = window.localStorage.getItem(obsCacheKey);
    } catch {
      // localStorage no disponible → arrancamos vacía.
    }
    setObservacion(guardada ?? "");
  }, [obsCacheKey]);

  // Espejo del carrito para leerlo fuera del render — `handleSend` lo necesita
  // después del `await`, cuando el closure ya quedó viejo.
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Tabs vecinas para los botones de navegación.
  const { prevTab, nextTab } = useMemo(() => {
    if (isSearching) return { prevTab: null, nextTab: null };
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (idx < 0) return { prevTab: null, nextTab: null };
    return {
      prevTab: idx > 0 ? tabs[idx - 1] : null,
      nextTab: idx < tabs.length - 1 ? tabs[idx + 1] : null,
    };
  }, [activeTab, tabs, isSearching]);

  // ── Cart ──
  const cartTotal = cart.reduce((a, c) => a + c.line_subtotal_cents, 0);
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);

  const addToCart = (item: AddToCartItem) => {
    setCart((prev) => [
      ...prev,
      {
        ...item,
        _key: crypto.randomUUID(),
        seat_number: seatMode ? activeSeat : null,
      },
    ]);
  };

  const removeFromCart = (key: string) => {
    setCart((prev) => prev.filter((c) => c._key !== key));
  };

  const changeQuantity = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c._key !== key) return c;
          const nextQty = c.quantity + delta;
          if (nextQty < 1) return c;
          if (nextQty > 99) return c;
          if (isDailyMenuCart(c)) {
            const choicesTotal = c.selected_choices.reduce(
              (a, sc) => a + (sc.extra_price_cents ?? 0),
              0,
            );
            return {
              ...c,
              quantity: nextQty,
              line_subtotal_cents:
                (c.unit_price_cents + choicesTotal) * nextQty,
            };
          }
          const modsTotal = c.modifiers.reduce(
            (a, m) => a + m.price_delta_cents,
            0,
          );
          const newLine = (effectiveUnitPriceCents(c) + modsTotal) * nextQty;
          return { ...c, quantity: nextQty, line_subtotal_cents: newLine };
        })
        .filter((c) => c.quantity > 0),
    );
  };

  // ── Precio por ítem (spec 069) ──
  const userCanEditPrice = canOverrideItemPrice(role);
  const [priceTargetKey, setPriceTargetKey] = useState<string | null>(null);

  // ── El carrito, operable con el teclado (spec 075, FR-012) ────────────────
  // Parado en una línea: ←/→ cantidad, un dígito la fija, Supr la quita, Enter
  // abre el editor de precio. Antes esto era mouse obligado en medio de la
  // carga.
  const carrito = useCartZone({
    length: cart.length,
    // Con el catálogo vacío, ↑ vuelve derecho al buscador.
    onExitUp: () =>
      catalogoIndex.size > 0 ? catalogo.focusLast() : focusSearch(),
    // ↓ en la última línea llega a Enviar: la cadena termina en la acción
    // primaria y no en una tecla muerta (FR-010).
    onExitDown: () => enviarRef.current?.focus({ preventScroll: true }),
    onQuantityDelta: (i, delta) => {
      const line = cart[i];
      if (line) changeQuantity(line._key, delta);
    },
    onQuantitySet: (i, quantity) => {
      const line = cart[i];
      if (line) changeQuantity(line._key, quantity - line.quantity);
    },
    onRemove: (i) => {
      const line = cart[i];
      if (line) removeFromCart(line._key);
    },
    onActivate: (i) => {
      const line = cart[i];
      if (line && userCanEditPrice && !isDailyMenuCart(line)) {
        setPriceTargetKey(line._key);
      }
    },
    onType: escribirEnBuscador,
  });
  const priceTarget = cart.find(
    (c): c is CartProductItem =>
      c._key === priceTargetKey &&
      !isDailyMenuCart(c) &&
      // Spec 174 — el renglón libre no tiene precio de catálogo contra el cual
      // medir un delta: su precio ya es el que se tipeó. El editor de la 069
      // mostraría «Precio de la carta $0» y ofrecería «volver» a él, que es
      // exactamente lo que no hay que hacer. Se cambia borrándolo y cargándolo
      // de nuevo, como cualquier renglón que salió mal.
      !isItemLibreCartLine(c),
  );

  /**
   * Repreciar una línea YA ENVIADA (issue #283).
   *
   * El carrito es local —el precio viaja recién con el envío— pero acá la
   * línea ya está en la base: cada cambio es una escritura. Va contra
   * `editarItemComanda`, la misma action que usa el editor del kanban, que
   * revalida el rol y el motivo y rechaza la orden cerrada o ya pagada.
   *
   * **No optimista**: es plata (spec 21). El modal se queda abierto con el
   * botón en «Guardando…» hasta que el server contesta; si falla, el precio
   * viejo nunca se movió de la pantalla.
   */
  const [priceSentId, setPriceSentId] = useState<string | null>(null);
  const [priceSentPending, setPriceSentPending] = useState(false);
  /**
   * La línea a repreciar, la dibuje quien la dibuje. El panel del salón la
   * saca de la orden (`loPedido`) y la pantalla de teléfono de las comandas
   * —esa ruta no carga la orden (spec 105: manda lo mínimo de la mesa)—, así
   * que el modal la busca en las dos y se queda con lo único que necesita.
   */
  const priceSentTarget:
    | {
        order_item_id: string;
        product_name: string;
        unit_price_cents: number;
        price_original_cents: number | null;
        price_override_reason: string | null;
      }
    | undefined =
    (loPedido?.items ?? []).find((i) => i.order_item_id === priceSentId) ??
    comandas
      .flatMap((c) => c.items)
      .find((i) => i.order_item_id === priceSentId);

  const guardarPrecioEnviado = async (cents: number | null, reason: string) => {
    if (!priceSentTarget || priceSentPending) return;
    setPriceSentPending(true);
    const r = await editarItemComanda(slug, priceSentTarget.order_item_id, {
      priceOverrideCents: cents,
      priceOverrideReason: cents === null ? null : reason,
    });
    setPriceSentPending(false);
    if (!r.ok) {
      toast.error(r.error ?? "No pudimos cambiar el precio.");
      return;
    }
    setPriceSentId(null);
    toast.success(
      cents === null ? "Volvió al precio de la carta" : "Precio actualizado",
    );
    // Repreciar mueve el total de la mesa: el plano y el panel lo tienen que
    // seguir. Sin `onMesaActualizada` (full-screen del mozo) la página es el
    // server component, y lo que la trae de nuevo es el refresh.
    if (onMesaActualizada) onMesaActualizada();
    else router.refresh();
  };

  /** `cents` null = volver al precio de la carta. */
  const setLinePrice = (key: string, cents: number | null, reason: string) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c._key !== key || isDailyMenuCart(c)) return c;
        const next: CartProductItem = {
          ...c,
          price_override_cents: cents,
          price_override_reason: cents === null ? null : reason,
        };
        const modsTotal = next.modifiers.reduce(
          (a, m) => a + m.price_delta_cents,
          0,
        );
        // El precio pisado reemplaza sólo la base: los adicionales siguen
        // cobrándose (misma regla que el server en `lineSubtotalCents`).
        next.line_subtotal_cents =
          (effectiveUnitPriceCents(next) + modsTotal) * next.quantity;
        return next;
      }),
    );
    setPriceTargetKey(null);
  };

  // ── Acciones server ──
  const handleSend = () => {
    if (cart.length === 0) return;
    // Snapshot de los _key que se envían: al terminar quitamos SOLO estos del
    // carrito, preservando ítems agregados durante el envío en curso (FR-009).
    const sentKeys = new Set(cart.map((c) => c._key));
    const items: (
      | EnviarComandaItem
      | EnviarComandaDailyMenuItem
      | EnviarComandaFreeItem
    )[] = cart.map((c) => {
      if (isDailyMenuCart(c)) {
        return {
          kind: "daily_menu" as const,
          daily_menu_id: c.daily_menu_id,
          quantity: c.quantity,
          notes: c.notes || null,
          selected_choices: c.selected_choices.map((sc) => ({
            choice_group_id: sc.choice_group_id,
            product_id: sc.product_id,
            modifier_ids: sc.modifier_ids,
          })),
          // _key estable de la línea → idempotencia server (spec 42).
          client_line_key: c._key,
        };
      }
      if (isItemLibreCartLine(c)) {
        // Spec 174 — el renglón libre: nombre y precio, sin producto detrás.
        // No lleva `seat_number` porque no se sirve en ningún lugar de la
        // mesa: es plata, no un plato. El server revalida el rol.
        return { ...itemLibrePayload(c), client_line_key: c._key };
      }
      return {
        product_id: c.product_id,
        quantity: c.quantity,
        notes: c.notes || null,
        modifier_ids: c.modifiers.map((m) => m.id),
        seat_number: c.seat_number,
        // _key estable de la línea → idempotencia server (spec 42).
        client_line_key: c._key,
        // Precio pisado (spec 069). El server revalida rol + motivo.
        price_override_cents: c.price_override_cents ?? null,
        price_override_reason: c.price_override_reason ?? null,
      };
    });
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof enviarComanda>>;
      try {
        // `partySize` sólo lo usa el server si **este** envío crea la orden
        // (mesa que se abre cargando, spec 111): es la única oportunidad de
        // guardarlo, porque no hubo walk-in. Si la orden ya existe, lo ignora.
        r = await enviarComanda({
          tableId: table.id,
          items,
          slug,
          partySize: personas,
          // La observación es de ESTA tanda (spec 128): sale en las comandas de
          // todos los sectores de este envío y después se limpia.
          notes: observacion,
        });
      } catch (e) {
        // Fallo de red / respuesta perdida: no sabemos si el server procesó el
        // envío. El server ahora es idempotente por `client_line_key` (spec 42),
        // así que un reenvío de las mismas líneas no duplica; aun así mantenemos
        // la UX conservadora (avisar al mozo que verifique) en vez de reenviar
        // solo. FR-008.
        console.error("enviarComanda", e);
        toast.error(
          "No pudimos confirmar el envío. Revisá la comanda de la mesa antes de reenviar.",
        );
        return;
      }
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Enviado · ${r.data.comanda_ids.length} ${r.data.comanda_ids.length === 1 ? "comanda" : "comandas"}`,
      );
      // La observación se va con la tanda que acaba de salir (spec 128 · D1):
      // el próximo envío arranca en blanco. Se limpia entera —y no sólo si no
      // cambió durante el vuelo— porque el envío tarda menos de lo que se tarda
      // en escribir, y dejarla puesta es peor: se repite en la tanda siguiente.
      cambiarObservacion("");
      // Quitamos solo los ítems enviados (no vaciamos el carrito) — FR-009.
      // `cartRef` y no el `cart` del closure: durante el envío se pueden haber
      // agregado líneas nuevas, y ésas se quedan.
      const quedan = cartRef.current.filter((c) => !sentKeys.has(c._key));
      setCart(quedan);
      // El borrador se escribe acá, sincrónico, y no en el efecto de persistir:
      // el panel se puede desmontar en este mismo commit (el salón cierra la
      // carga en `onSent`), y entonces ni el efecto ni el updater de `setCart`
      // llegan a correr. Así quedaba guardado lo que **ya salió a cocina**, y
      // la próxima vez que abrías la mesa estaba de nuevo ahí, listo para
      // mandarlo por segunda vez.
      guardarBorrador(quedan);
      // Embebido (panel del salón): cerramos el panel y refrescamos vía onSent,
      // sin navegar. Si no, volvemos al origen: el mozo a /mozo con el drawer de
      // la mesa abierto; el admin (ruta) a la vista de operación (homeHref).
      if (onSent) {
        onSent();
      } else {
        router.push(homeHref ?? `/${slug}/mozo?openTable=${table.id}`);
      }
    });
  };

  // ── Ctrl/⌘+Enter = enviar la comanda (spec 075, FR-016) ──
  //
  // Escucha en el DOCUMENTO, no en el div del panel. Un `onKeyDown` de React
  // sólo se entera si el foco está adentro del árbol, y en el salón el foco se
  // va del panel todo el tiempo: un click al plano, un click al aire, un tap
  // en un botón que se desmonta. Ahí el atajo quedaba muerto sin ninguna
  // señal. Ahora anda desde donde estés, que es lo que promete la ayuda de
  // atajos.
  //
  // `sendRef` para no re-suscribir en cada tecla tipeada: `handleSend` se
  // recrea en cada render y el listener tiene que ver siempre el carrito de
  // ahora, no el del render en que se colgó.
  const sendRef = useRef(handleSend);
  useEffect(() => {
    sendRef.current = handleSend;
  });
  // Con un modal propio abierto (alta de producto, menú del día, cancelar
  // ítem) las teclas son suyas; y con un envío en vuelo, el atajo no puede
  // hacer lo que el botón tiene prohibido.
  // El selector de mozo entra acá y no en el chequeo de `[role='dialog']` de
  // abajo: ése mira de dónde SALE la tecla, y con el foco perdido detrás del
  // modal la tecla sale del panel. ⌘Enter es la única que sigue viva con el
  // foco en el `body` —escucha en `document`—, así que sin esto un atajo de
  // inercia mandaba la comanda con el modal abierto.
  const envioBloqueado =
    pending ||
    !!openProduct ||
    !!openDailyMenu ||
    !!cancelTarget ||
    mozoPickerAbierto ||
    comensalesTableId != null;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      if (envioBloqueado) return;
      // Un diálogo de AFUERA abierto encima (los atajos del salón, transferir
      // mesa) se queda con la tecla: el panel sigue montado detrás.
      const dialog = (e.target as HTMLElement | null)?.closest?.(
        "[role='dialog']",
      );
      if (dialog && rootRef.current && !rootRef.current.contains(dialog))
        return;
      e.preventDefault();
      sendRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [envioBloqueado]);

  const handleCancelConfirm = () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) {
      toast.error("Indicá el motivo.");
      return;
    }
    const target = cancelTarget;
    setCancelTarget(null);
    setCancelReason("");
    // Optimista: el ítem se tacha al instante. revalidatePath de la action
    // refresca el server; el overlay se descarta y revierte si falla.
    runComanda(
      {
        kind: "cancelarItem",
        orderItemId: target.orderItemId,
        reason,
        cancelledAt: new Date().toISOString(),
      },
      async () => {
        const r = await cancelarItem(target.orderItemId, reason, slug);
        if (r.ok) {
          toast.success("Item cancelado");
          // Anular mueve plata: el total de la mesa en el plano tiene que
          // seguirlo (ver `onMesaActualizada`).
          onMesaActualizada?.();
        }
        return r;
      },
    );
  };

  const handleAdvance = (comandaId: string) => {
    // Optimista: la comanda se marca entregada al instante.
    runComanda(
      {
        kind: "entregar",
        comandaId,
        deliveredAt: new Date().toISOString(),
      },
      async () => {
        const r = await marcarComandaEntregada(comandaId, slug);
        if (r.ok) {
          toast.success("Comanda entregada");
          onMesaActualizada?.();
        }
        return r;
      },
    );
  };

  const userCanCancel = canCancelItem(role);
  const tableMinutes = minutesSince(table.opened_at);

  // Personas (FR-013/014) y cliente (FR-015). Con la mesa ya abierta el chip
  // persiste solo; sin orden todavía, viaja con el primer envío —que es el que
  // la crea— así que vive acá hasta entonces.
  const [personas, setPersonas] = useState(loPedido?.party_size ?? 2);
  /**
   * El número se resuelve **una vez por mesa**, cuando ya se sabe cómo está.
   *
   * `loPedido` puede llegar DESPUÉS del primer render (spec 115): sin esperarlo,
   * el contador se quedaba en 2 con una mesa de 5 y el encargado "corregía" un
   * número que ya estaba bien. Y como el panel no se desmonta al saltar de mesa
   * (keep-alive, specs 101/114), el seed de una sola vez para toda la vida del
   * panel dejaba **el número de la mesa anterior** pegado en la siguiente: la
   * mesa de 4 abría la de al lado en 4. Ahora cada mesa parte de lo suyo — su
   * `party_size` si tiene orden, el default si no— y a partir de ahí manda lo
   * que el encargado elija.
   */
  const mesaDePersonas = useRef<string | null>(null);
  const seedeadaConOrden = useRef<string | null>(null);
  useEffect(() => {
    if (mesaDePersonas.current !== table.id) {
      // Mesa nueva: parte de lo suyo, nunca de lo que quedó de la anterior. Lo
      // suyo es su orden si la tiene, lo que ya se contestó para esa mesa si
      // se contestó, y recién ahí el default.
      mesaDePersonas.current = table.id;
      seedeadaConOrden.current = loPedido?.party_size != null ? table.id : null;
      setPersonas(
        loPedido?.party_size ??
          comensalesPreguntados.current.get(table.id) ??
          2,
      );
      return;
    }
    // Misma mesa, y recién ahora llegó su orden: se toma el número real. Una
    // sola vez — después manda lo que el encargado haya elegido.
    if (seedeadaConOrden.current === table.id) return;
    if (loPedido?.party_size == null) return;
    seedeadaConOrden.current = table.id;
    setPersonas(loPedido.party_size);
  }, [table.id, loPedido]);

  // El carrito, aplanado para la columna de la mesa (spec 111, fase 5): ahí se
  // muestra pegado a lo enviado, en verde, en vez de en la otra columna bajo
  // el título «Tu pedido».
  const cartParaColumna: MesaColumnCartItem[] = cart.map((c) => ({
    _key: c._key,
    product_name: c.product_name,
    quantity: c.quantity,
    notes: c.notes || null,
    line_subtotal_cents: c.line_subtotal_cents,
    modifiers: isDailyMenuCart(c)
      ? c.selected_choices.map((s) => s.product_name)
      : c.modifiers.map((m) => m.name),
    esMenuDelDia: isDailyMenuCart(c),
    price_override_cents: isDailyMenuCart(c)
      ? null
      : (c.price_override_cents ?? null),
    price_override_reason: isDailyMenuCart(c)
      ? null
      : (c.price_override_reason ?? null),
    unit_price_cents: c.unit_price_cents,
  }));
  const [clienteOpen, setClienteOpen] = useState(false);

  // Mostramos la nav de tabs (anterior/siguiente) en el footer sticky solo si
  // estamos en catálogo, no estamos buscando, y al menos hay un vecino al
  // que saltar.
  const showTabNavInFooter =
    step === "catalogo" &&
    !isSearching &&
    (prevTab !== null || nextTab !== null);

  // Layout: pantalla completa (mozo) vs embebido en un panel (sidebar admin).
  // Embebido = columna flex con scroll interno y footer no-fixed.
  const rootRef = useRef<HTMLDivElement>(null);
  const rootClass = embedded
    ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-muted/50"
    : `min-h-dvh bg-muted/50 ${showTabNavInFooter ? "pb-48" : "pb-36"}`;
  // Overlay de modales: scopeado al panel en embebido (`absolute`), full-screen
  // en la app del mozo (`fixed`).
  const overlayPos = embedded ? "absolute" : "fixed";
  const mainClass = embedded
    ? "mx-auto w-full max-w-md min-h-0 flex-1 overflow-y-auto px-3 pt-3"
    : "mx-auto max-w-md px-3 pt-3";
  const footerClass = embedded
    ? "z-20 shrink-0 border-t border-border bg-white/95 backdrop-blur"
    : "fixed inset-x-0 bottom-0 z-20 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur";

  // ── Modales, compartidos por ambos layouts (full-screen y embebido) ──
  // Al cerrar/agregar devolvemos el foco al buscador (solo embebido) para
  // encadenar cargas sin mouse (spec 055 FR-013).
  // Los que nacen de **la columna de carga** (tocar un producto o un menú del
  // día). En el sidebar se renderizan adentro de esa columna, así el overlay
  // tapa lo que estás cargando y **no** la mesa: mientras elegís el punto de
  // cocción se sigue viendo qué pidió, qué falta y cuánto va.
  const modalsCargaEl = (
    <>
      {/* ─── Modal: agregar producto ─── */}
      <ProductModal
        product={openProduct}
        open={!!openProduct}
        onClose={() => {
          setOpenProduct(null);
          focusSearch();
        }}
        onAdd={(item) => {
          addToCart(item);
          if (embedded) setSearch("");
          focusSearch();
        }}
        embedded={embedded}
      />

      {/* ─── Asistente: agregar menú del día paso a paso (spec 072) ─── */}
      <DailyMenuWizard
        menu={openDailyMenu}
        embedded={embedded}
        onClose={() => {
          setOpenDailyMenu(null);
          focusSearch();
        }}
        onAdd={(menu, lineas) => {
          // Un ítem por menú, cada uno con SUS opciones (spec 155 · D6).
          // `enviarComanda` ya acepta N entradas `daily_menu` en la misma
          // tanda: un solo ítem con `quantity: 4` y un único set de opciones
          // era justamente lo que no alcanzaba para una mesa de cuatro.
          setCart((prev) => [
            ...prev,
            ...lineas.map((selectedChoices) => ({
              _key: crypto.randomUUID(),
              kind: "daily_menu" as const,
              daily_menu_id: menu.id,
              product_name: menu.name,
              unit_price_cents: menu.price_cents,
              quantity: 1,
              notes: "",
              // Por `choicesDeltaCents` y no sumando `extra_price_cents` a
              // mano: los modificadores del producto también suman (spec 083)
              // y el total que muestra el asistente los cuenta. Si acá se
              // sumara distinto, el carrito diría otro número que el paso
              // final.
              line_subtotal_cents:
                menu.price_cents +
                choicesDeltaCents(
                  new Map(
                    selectedChoices.map((sc) => [sc.choice_group_id, sc]),
                  ),
                ),
              seat_number: seatMode ? activeSeat : null,
              selected_choices: selectedChoices,
            })),
          ]);
          setOpenDailyMenu(null);
          if (embedded) setSearch("");
          focusSearch();
        }}
      />
    </>
  );

  // Los que nacen de **la mesa** (pisar un precio del carrito, anular algo ya
  // enviado). Siguen a nivel del panel: son diálogos de confirmación y en una
  // columna de 46% quedarían apretados.
  const modalsMesaEl = (
    <>
      {/* ─── Modal: cancelar item ─── */}
      {libreAbierto && (
        <ItemLibreModal
          nombreSugerido={searchApi.nombreLibreSugerido}
          onConfirm={(draft: ItemLibreDraft) => {
            addToCart(itemLibreCartLine(draft));
            setLibreAbierto(false);
            setSearch("");
            focusSearch();
          }}
          onClose={() => {
            setLibreAbierto(false);
            focusSearch();
          }}
        />
      )}

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

      {priceSentTarget && (
        <PriceOverrideModal
          productName={priceSentTarget.product_name}
          // `unit_price_cents` es lo COBRADO; el de carta vive en
          // `price_original_cents` cuando la línea ya está pisada.
          catalogPriceCents={
            priceSentTarget.price_original_cents ??
            priceSentTarget.unit_price_cents
          }
          currentOverrideCents={
            priceSentTarget.price_original_cents == null
              ? null
              : priceSentTarget.unit_price_cents
          }
          currentReason={priceSentTarget.price_override_reason}
          pending={priceSentPending}
          onConfirm={(cents, reason) =>
            void guardarPrecioEnviado(cents, reason)
          }
          onClear={() => void guardarPrecioEnviado(null, "")}
          onClose={() => setPriceSentId(null)}
        />
      )}

      {cancelTarget && (
        <div
          onClick={() => {
            setCancelTarget(null);
            setCancelReason("");
          }}
          className={`${overlayPos} inset-0 z-50 flex items-end justify-center bg-black/40`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                Cancelar &ldquo;{cancelTarget.productName}&rdquo;
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason("");
                }}
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Indicá un motivo. Queda registrado.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value.slice(0, 200))}
              placeholder="ej: rotura, cliente cambió de opinión..."
              className="mt-3 block w-full rounded-2xl border border-border px-3 py-2 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-100 focus:outline-none"
              rows={3}
              autoFocus
            />
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="xl"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason("");
                }}
                className="flex-1"
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive-solid"
                size="xl"
                onClick={handleCancelConfirm}
                disabled={pending || !cancelReason.trim()}
                className="flex-1"
              >
                Cancelar item
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const modalsEl = (
    <>
      {modalsCargaEl}
      {modalsMesaEl}
    </>
  );

  // ── Sidebar del salón (`embedded`): layout keyboard-first (spec 055) ──
  // Vista única: header compacto → buscador fijo (+ categorías secundarias) →
  // resultados/catálogo con scroll → panel de pedido siempre visible. El
  // full-screen del mozo (abajo) conserva su flujo de 2 pasos intacto.
  if (embedded) {
    return (
      <div className={rootClass} ref={rootRef}>
        {/* Header compacto */}
        <header className="shrink-0 border-b border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onClose?.()}
              className="-ml-1"
              aria-label="Volver al salón"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {businessName}
              </p>
              <h1 className="font-heading text-base leading-tight font-bold text-foreground">
                Mesa {table.label}
              </h1>
              {/* El estado de la mesa vive acá y no en la columna: repetir
                  «Mesa CUAD» arriba y «CUAD» abajo gastaba una franja del
                  panel en decir dos veces lo mismo. */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      table.operational_status === "libre"
                        ? "bg-muted-foreground/30"
                        : table.operational_status === "pidio_cuenta"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                  />
                  {table.operational_status === "libre"
                    ? "Libre"
                    : table.operational_status === "pidio_cuenta"
                      ? "Pidió la cuenta"
                      : "Ocupada"}
                </span>
                {tableMinutes != null && <span>{tableMinutes} min</span>}
                {loPedido && <span>Orden #{loPedido.daily_number}</span>}
                {loPedido?.party_size != null && (
                  <span>
                    {loPedido.party_size}{" "}
                    {loPedido.party_size === 1 ? "persona" : "personas"}
                  </span>
                )}
                <MozoDeLaMesa
                  mozoId={mozoId}
                  mozoName={mozoName}
                  onElegir={onElegirMozo}
                />
              </div>
            </div>
            {/* El filtro de la carta online: a la derecha de la fila del
                negocio, alineado con el selector de salones de la barra de
                arriba (spec 111, fase 5). Es contexto de la PC —se elige una
                vez por turno— no un control del buscador. */}
            <CartaOnlineSelector api={searchApi} />
          </div>
        </header>

        {/* Cuerpo en dos columnas (spec 111; shell compartido con los pedidos
            online desde la 115): lo ya pedido a la izquierda, la carga a la
            derecha. El corte es por ancho **del panel** (container query), no
            del viewport: el panel es la mitad de la pantalla. */}
        <PanelDeCarga>
          {/* La carga primero **en el DOM** y segunda en pantalla
              (`order-2`): en esta pantalla se entra a tipear, así que con el
              panel angosto el buscador tiene que quedar arriba y la mesa
              debajo. De paso el orden de tabulación coincide con la cadena de
              teclado —buscador → catálogo → carrito—, que hasta acá iban al
              revés. */}
          <ColumnaDeCarga
            className="@min-[600px]:order-2"
            encabezado={
              <>
                {/* Personas primero (spec 111, FR-013): es el dato de la mesa y
                    se resuelve con un tap, sin sacarle el foco al buscador. */}
                <PersonasChips
                  slug={slug}
                  tableId={table.id}
                  value={personas}
                  onChange={setPersonas}
                  persistir={loPedido != null}
                />
                {/* Sólo el buscador (spec 111, fase 5). El selector de categoría
                    se fue: con el buscador tolerante a acentos y orden de
                    palabras, elegir categoría es un rodeo — y sin búsqueda lo
                    que se ve son «Más pedidos», que es a lo que se volvía. El
                    filtro de la carta online subió al header del panel. */}
                <ProductSearchInput
                  api={searchApi}
                  inputRef={searchRef}
                  conFiltroDeCarta={false}
                />
              </>
            }
            // Zona de teclado: ↓ desde el buscador entra acá, ↓ pasado el
            // último ítem sigue al carrito.
            onKeyDownResultados={(e) => {
              if (catalogo.handleKeyDown(e)) return;
              if (isPrintableKey(e)) {
                e.preventDefault();
                escribirEnBuscador(e.key);
              }
            }}
            // Elegir modificadores tapa la carga, no la mesa.
            pie={modalsCargaEl}
          >
            {/* El menú del día va **afuera** del if: en el panel también aparece
                buscando (spec 146 · D-B2), y los resultados de productos son
                otra lista. Arriba porque encabeza la zona de teclado
                (`catalogoIndex`), buscando o no. */}
            {menusVisibles.length > 0 && (
              <div className="mb-3">
                <MenusDelDia
                  menus={menusVisibles}
                  compacto
                  onPick={setOpenDailyMenu}
                  itemProps={catalogoProps}
                />
              </div>
            )}
            {isSearching ? (
              // «Sin resultados» con un menú del día matcheado arriba sería
              // mentira: el cartel sale sólo si no quedó nada de nada.
              searchResults.length > 0 || menusVisibles.length === 0 ? (
                <SearchResults
                  results={searchResults}
                  onPick={pickProducto}
                  enterTargetId={enterTargetId}
                  itemProps={catalogoProps}
                />
              ) : null
            ) : tabs.length === 0 ? (
              <EmptyCatalog />
            ) : (
              <TabView
                tabSections={visibleSections}
                activeTabLabel="el catálogo"
                isTopTab={topProducts.length > 0}
                // Ya se renderizaron arriba: acá sólo quedan los productos.
                dailyMenus={[]}
                compacto
                onPick={pickProducto}
                onPickDailyMenu={setOpenDailyMenu}
                enterTargetId={enterTargetId}
                itemProps={catalogoProps}
              />
            )}
          </ColumnaDeCarga>

          {/* La mesa: lo que ya tiene cargado. Al lado de la carga cuando el
              panel llega a 600 (ancha de verdad: el detalle por ítem no entra
              en una columna angosta, pero nunca más que la de carga), y
              **apilada abajo** cuando no llega (spec 146 · D-C2). Lo que no
              hace nunca más es esconderse detrás de una pastilla: acá viven lo
              enviado, lo que falta mandar, el total y «Cobrar». */}
          <ColumnaLateral
            abierta
            modoAngosto="apilada"
            className="max-h-[45%] border-t border-border @min-[600px]:order-1 @min-[600px]:max-h-none @min-[600px]:border-t-0"
          >
            <MesaColumn
              tableLabel={table.label}
              loPedido={loPedido ?? null}
              cargando={mesaCargando}
              comandas={comandas}
              stationNameById={stationNameById}
              cart={cartParaColumna}
              cartTotalCents={cartTotal}
              userCanCancel={userCanCancel}
              userCanEditPrice={userCanEditPrice}
              enviando={pending}
              onCancelItem={(id, name) =>
                setCancelTarget({ orderItemId: id, productName: name })
              }
              onEditPriceEnviado={setPriceSentId}
              onAdvance={handleAdvance}
              onChangeQty={changeQuantity}
              onRemoveCartItem={removeFromCart}
              onEditPrice={setPriceTargetKey}
              onEnviar={handleSend}
              cartZone={carrito}
              observacion={observacion}
              onObservacionChange={cambiarObservacion}
              acciones={{
                ...mesaAcciones,
                onCargarCliente: () => setClienteOpen(true),
              }}
              className="min-h-0 flex-1"
            />
          </ColumnaLateral>
        </PanelDeCarga>

        {comensalesTableId === table.id && (
          <ComensalesModal
            tableLabel={table.label}
            valorInicial={personas}
            onConfirmar={(n) => {
              comensalesPreguntados.current.set(table.id, n);
              // Sólo estado: la mesa está libre —lo garantiza `aperturaDeMesa`—
              // así que todavía no hay orden que actualizar y el número viaja
              // con el primer envío, que es el que la crea (spec 111, FR-014).
              // Corregirlo después es «Personas» en el header, que sí persiste.
              setPersonas(n);
            }}
            onCerrar={() => {
              setComensalesTableId(null);
              // Contestado o no, lo que sigue es cargar: el foco al buscador.
              focusSearch();
            }}
          />
        )}
        {clienteOpen && (
          <CargarClienteModal
            slug={slug}
            tableId={table.id}
            tableLabel={`Mesa ${table.label}`}
            overlay="absolute"
            onClose={() => {
              setClienteOpen(false);
              searchRef.current?.focus();
            }}
          />
        )}

        {modalsMesaEl}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={rootClass} ref={rootRef}>
      {/* ─── Header sticky ─── */}
      <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-3">
          {step === "catalogo" ? (
            embedded ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onClose?.()}
                className="-ml-1"
                aria-label="Volver al salón"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            ) : (
              <Link
                href={backHref}
                className="-ml-1 rounded-full p-2 text-foreground/80 active:bg-muted"
                aria-label="Volver al salón"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
            )
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setStep("catalogo")}
              className="-ml-1"
              aria-label="Volver al catálogo"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {step === "catalogo" ? businessName : "Tu pedido"}
            </p>
            <h1 className="font-heading text-base leading-tight font-bold tracking-tight text-foreground">
              {step === "catalogo"
                ? `Mesa ${table.label}`
                : `Mesa ${table.label} · revisar`}
            </h1>
          </div>
          {tableMinutes !== null && tableMinutes >= 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {tableMinutes}m
            </span>
          )}
        </div>
        {step === "catalogo" && (
          <div className="mx-auto flex max-w-md items-center gap-2 px-3 pb-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-foreground/80">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {TABLE_STATUS_LABEL[table.operational_status] ??
                table.operational_status}
            </span>
            {comandas.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                · {comandas.length}{" "}
                {comandas.length === 1
                  ? "comanda enviada"
                  : "comandas enviadas"}
              </span>
            )}
          </div>
        )}
        {/* Seat selector */}
        {step === "catalogo" && seatMode && (
          <div className="border-t border-border/60 bg-violet-50/50">
            <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-2">
              <span className="text-[11px] font-semibold text-violet-700">
                Comensal:
              </span>
              <div className="flex gap-1">
                {Array.from({ length: seatCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setActiveSeat(n)}
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition active:scale-95 ${
                      activeSeat === n
                        ? "bg-violet-600 text-white"
                        : "bg-card text-violet-700 ring-1 ring-violet-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const next = seatCount + 1;
                    setSeatCount(next);
                    setActiveSeat(next);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-violet-700 ring-1 ring-violet-200 active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Tabs */}
        {step === "catalogo" && !isSearching && tabs.length > 0 && (
          <div className="border-t border-border/60">
            <div className="mx-auto max-w-md overflow-x-auto px-3">
              <div className="flex gap-1.5 py-2">
                {tabs.map((t) => {
                  const isActive = t.id === activeTab;
                  const touched = tabTouched[t.id];
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.96] ${
                        isActive
                          ? "bg-primary text-white"
                          : "bg-card text-foreground/80 ring-1 ring-border"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${
                          isActive ? t.iconActive : t.iconInactive
                        }`}
                      />
                      <span>{t.label}</span>
                      {touched && (
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full ${
                            isActive
                              ? "bg-emerald-400 text-foreground"
                              : "bg-emerald-500 text-white"
                          }`}
                        >
                          <Check className="h-2.5 w-2.5" strokeWidth={4} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ─── Body por step ─── */}
      <main className={mainClass}>
        {step === "catalogo" ? (
          <CatalogoStep
            itemProps={catalogoProps}
            onCatalogoKeyDown={(e) => {
              catalogo.handleKeyDown(e);
            }}
            searchApi={searchApi}
            isSearching={isSearching}
            searchResults={searchResults}
            tabSections={tabSections}
            activeTabLabel={tabById[activeTab]?.label ?? ""}
            dailyMenus={dailyMenus}
            isTopTab={activeTab === TOP_TAB_ID}
            onPick={pickProducto}
            onPickDailyMenu={setOpenDailyMenu}
            tabsCount={tabs.length}
          />
        ) : (
          <ResumenStep
            cart={cart}
            existingComandas={comandas}
            stationNameById={stationNameById}
            userCanCancel={userCanCancel}
            // Sólo el envío. Antes iba `pending || comandaPending`, así que
            // entregar UNA comanda apagaba los «Entregar» de las otras —y con
            // una comanda por sector, entregar varias seguidas es lo normal.
            pending={pending}
            seatMode={seatMode}
            seatCount={seatCount}
            onToggleSeatMode={() => setSeatMode((v) => !v)}
            onItemSeatChange={(key, seat) =>
              setCart((prev) =>
                prev.map((c) =>
                  c._key === key ? { ...c, seat_number: seat } : c,
                ),
              )
            }
            onChangeQty={changeQuantity}
            onRemove={removeFromCart}
            userCanEditPrice={userCanEditPrice}
            onEditPrice={setPriceTargetKey}
            onCancelItem={(id, name) =>
              setCancelTarget({ orderItemId: id, productName: name })
            }
            onEditPriceEnviado={setPriceSentId}
            onAdvance={handleAdvance}
            onAddMore={() => setStep("catalogo")}
          />
        )}
      </main>

      {/* ─── Bottom: TabNav (anterior/siguiente) arriba + CTA debajo ─── */}
      <div className={footerClass}>
        <div className="mx-auto max-w-md">
          {showTabNavInFooter && (
            <div className="border-t border-border px-3 py-2">
              <TabNav
                prevTab={prevTab}
                nextTab={nextTab}
                onJumpToTab={setActiveTab}
              />
            </div>
          )}
          <div className="border-t border-border px-3 pt-3 pb-3">
            {step === "catalogo" ? (
              <BottomCTACatalogo
                cartCount={cartCount}
                cartTotal={cartTotal}
                hasExisting={comandas.length > 0}
                onClick={() => setStep("resumen")}
              />
            ) : (
              <BottomCTAResumen
                cartTotal={cartTotal}
                cartCount={cartCount}
                pending={pending}
                onSend={handleSend}
                observacion={observacion}
                onObservacionChange={cambiarObservacion}
              />
            )}
          </div>
        </div>
      </div>

      {modalsEl}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1: Catálogo
// ─────────────────────────────────────────────────────────────────────────

function CatalogoStep({
  itemProps,
  onCatalogoKeyDown,
  searchApi,
  isSearching,
  searchResults,
  tabSections,
  activeTabLabel,
  dailyMenus,
  isTopTab,
  onPick,
  onPickDailyMenu,
  tabsCount,
}: {
  /** Foco de teclado del catálogo. En la tablet nadie usa flechas, pero el
   *  mismo componente lo monta el admin en desktop: dejarlo sin zona era la
   *  regresión de que ↓ dejara de hacer nada. */
  itemProps?: CatalogoItemProps;
  onCatalogoKeyDown?: (e: React.KeyboardEvent) => void;
  searchApi: ProductSearchApi;
  isSearching: boolean;
  searchResults: CatalogProduct[];
  tabSections: {
    category: CatalogCategory | null;
    products: CatalogProduct[];
  }[];
  activeTabLabel: string;
  dailyMenus: DailyMenuForMozo[];
  isTopTab: boolean;
  onPick: (p: CatalogProduct) => void;
  onPickDailyMenu: (m: DailyMenuForMozo) => void;
  tabsCount: number;
}) {
  return (
    <div className="space-y-3" onKeyDown={onCatalogoKeyDown}>
      <ProductSearchInput api={searchApi} />

      {isSearching ? (
        <SearchResults
          results={searchResults}
          onPick={onPick}
          enterTargetId={searchApi.enterTargetId}
          itemProps={itemProps}
        />
      ) : tabsCount === 0 ? (
        <EmptyCatalog />
      ) : (
        <TabView
          tabSections={tabSections}
          activeTabLabel={activeTabLabel}
          isTopTab={isTopTab}
          dailyMenus={dailyMenus}
          onPick={onPick}
          onPickDailyMenu={onPickDailyMenu}
          enterTargetId={searchApi.enterTargetId}
          itemProps={itemProps}
        />
      )}
    </div>
  );
}

/** Props de teclado del catálogo, por clave (`menu:<id>` / `prod:<id>`). */
type CatalogoItemProps = (
  key: string,
) => Partial<React.ComponentProps<"button">>;

function SearchResults({
  results,
  onPick,
  enterTargetId,
  itemProps,
}: {
  results: CatalogProduct[];
  onPick: (p: CatalogProduct) => void;
  /** El que abre Enter desde el buscador (el primero). Spec 055/075. */
  enterTargetId?: string;
  itemProps?: CatalogoItemProps;
}) {
  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center">
        <p className="text-sm font-semibold text-foreground/80">Sin resultados</p>
        <p className="mt-1 text-xs text-muted-foreground">Probá con otro nombre.</p>
      </div>
    );
  }
  // Lista de una columna (no grilla): así ↓ baja de verdad. Spec 066, FR-001.
  return (
    <ProductResultsList
      products={results}
      onPick={onPick}
      enterTargetId={enterTargetId}
      itemProps={(id) => itemProps?.(`prod:${id}`) ?? {}}
    />
  );
}

/**
 * El mozo de la mesa, en el header del panel — spec 146 · D-A3.
 *
 * Es la puerta que faltaba. Había dos: «Distribuir mozos», que es para repartir
 * el salón entero, y «Transferir mozo» en el ⋯, que es sacarle la mesa a
 * alguien. Con **un solo mozo** en el salón —el caso de la encargada de Golf—
 * ninguna de las dos es lo que uno quiere hacer: quiere asignar, la primera
 * vez, sin salir de la mesa que ya tiene abierta.
 *
 * Sin `onElegir` (rol que no puede asignar) es un rótulo: mostrar un botón que
 * el server va a rechazar es peor que no tenerlo (spec 140).
 */
function MozoDeLaMesa({
  mozoId,
  mozoName,
  onElegir,
}: {
  mozoId: string | null;
  mozoName: string | null;
  onElegir?: () => void;
}) {
  const p = mozoId ? mozoPalette(mozoId) : null;
  const texto = mozoName ?? (mozoId ? "Mozo" : "Sin mozo");

  if (!onElegir) {
    // Sin mozo y sin permiso no hay nada que decir: la fila no gasta lugar en
    // un hueco.
    if (!mozoId) return null;
    return (
      <span
        className={`inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5 ring-1 ${
          p ? `${p.bg} ${p.text} ${p.ring}` : ""
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${p?.dot ?? ""}`}
        />
        <span className="truncate">{texto}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onElegir}
      aria-label={mozoId ? `Mozo: ${texto}` : "Sin mozo asignado"}
      className={`inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5 ring-1 transition active:scale-95 ${
        p
          ? `${p.bg} ${p.text} ${p.ring} hover:brightness-95`
          : "ring-dashed bg-card text-muted-foreground ring-foreground/20 hover:bg-muted/50"
      }`}
    >
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="truncate">{texto}</span>
    </button>
  );
}

function TabView({
  tabSections,
  activeTabLabel,
  isTopTab,
  dailyMenus,
  compacto = false,
  onPick,
  onPickDailyMenu,
  enterTargetId,
  itemProps,
}: {
  tabSections: {
    category: CatalogCategory | null;
    products: CatalogProduct[];
  }[];
  activeTabLabel: string;
  isTopTab: boolean;
  dailyMenus: DailyMenuForMozo[];
  /** Panel del salón: el menú del día va en fila y el cartel de los más
   *  pedidos es un rótulo (spec 146 · B). */
  compacto?: boolean;
  onPick: (p: CatalogProduct) => void;
  onPickDailyMenu: (m: DailyMenuForMozo) => void;
  /** El que abre Enter desde el buscador (spec 073/075): el primero de lo que
   *  está a la vista, caiga en la sección que caiga. */
  enterTargetId?: string;
  /** Foco de teclado, por clave (`menu:<id>` / `prod:<id>`). La zona arranca en
   *  los menús del día y sigue por las secciones de categoría: un solo ↓ las
   *  recorre todas. */
  itemProps?: CatalogoItemProps;
}) {
  const showDailyMenus = isTopTab && dailyMenus.length > 0;
  const isEmpty = tabSections.length === 0 && !showDailyMenus;

  if (isEmpty) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center">
        <p className="text-sm font-semibold text-foreground/80">
          Sin productos en {activeTabLabel.toLowerCase()}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Probá otra pestaña o el buscador.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {showDailyMenus && (
        <MenusDelDia
          menus={dailyMenus}
          compacto={compacto}
          onPick={onPickDailyMenu}
          itemProps={itemProps}
        />
      )}

      {isTopTab &&
        tabSections.length > 0 &&
        (compacto ? (
          /* En el panel del salón el cartel es un rótulo (spec 146 · D-B3): en
             la pantalla donde se carga a las apuradas, tres líneas que explican
             de dónde sale la lista se leen una vez en la vida y ocupan lugar
             todos los días. */
          <h3 className="px-1 text-xs font-bold tracking-wide text-amber-700 uppercase">
            Más pedidos
          </h3>
        ) : (
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
        ))}

      {tabSections.map((section, idx) => (
        <div key={section.category?.id ?? `top-${idx}`} className="space-y-2">
          {section.category && tabSections.length > 1 && (
            <h3 className="px-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {section.category.name}
            </h3>
          )}
          {/* Misma lista que los resultados de búsqueda: sin tipear nada ya se
              navega con ↓/↑ y se agrega con Enter. Spec 073. */}
          <ProductResultsList
            products={section.products}
            onPick={onPick}
            enterTargetId={enterTargetId}
            itemProps={(id) => itemProps?.(`prod:${id}`) ?? {}}
          />
        </div>
      ))}
    </div>
  );
}

function TabNav({
  prevTab,
  nextTab,
  onJumpToTab,
}: {
  prevTab: Tab | null;
  nextTab: Tab | null;
  onJumpToTab: (id: TabId) => void;
}) {
  if (!prevTab && !nextTab) return null;
  return (
    <div className="flex gap-2">
      {prevTab && (
        <button
          onClick={() => onJumpToTab(prevTab.id)}
          className="flex flex-1 items-center gap-2.5 rounded-2xl bg-card p-3 text-left ring-1 ring-border active:scale-[0.98] active:bg-muted/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <ArrowLeft className="h-4 w-4 text-foreground/80" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              Anterior
            </p>
            <p className="flex items-center gap-1 text-sm font-bold text-foreground">
              <prevTab.icon className={`h-3.5 w-3.5 ${prevTab.iconInactive}`} />
              <span className="truncate">{prevTab.label}</span>
            </p>
          </div>
        </button>
      )}
      {nextTab && (
        <button
          onClick={() => onJumpToTab(nextTab.id)}
          className="flex flex-1 items-center justify-end gap-2.5 rounded-2xl bg-card p-3 text-right ring-1 ring-border active:scale-[0.98] active:bg-muted/50"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              Siguiente
            </p>
            <p className="flex items-center justify-end gap-1 text-sm font-bold text-foreground">
              <nextTab.icon className={`h-3.5 w-3.5 ${nextTab.iconInactive}`} />
              <span className="truncate">{nextTab.label}</span>
            </p>
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary">
            <ArrowRight className="h-4 w-4 text-white" />
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Los menús del día del catálogo — spec 146 · B.
 *
 * Dos caras de lo mismo:
 *
 * - **Tarjeta** (pantalla del mozo): la de siempre, con foto, descripción y
 *   pasos. Ahí sirve para mostrarle el plato al cliente.
 * - **Fila** (`compacto`, panel del salón): nombre y precio, la misma altura
 *   que un producto. La encargada de Golf pidió sacarlas —*"prefiero tener
 *   solamente el buscador"*— y con dos menús las tarjetas eran ~270px antes
 *   del primer producto. Sacarlas del todo no: es por donde se carga el menú
 *   ejecutivo todos los mediodías.
 */
function MenusDelDia({
  menus,
  compacto,
  onPick,
  itemProps,
}: {
  menus: DailyMenuForMozo[];
  compacto: boolean;
  onPick: (m: DailyMenuForMozo) => void;
  itemProps?: CatalogoItemProps;
}) {
  return (
    <section className={compacto ? "space-y-1.5" : "space-y-2"}>
      <h3 className="px-1 text-xs font-bold tracking-wide text-emerald-700 uppercase">
        {compacto ? "Menú del día" : "Hoy en el menú del día"}
      </h3>
      <div className={compacto ? "space-y-1.5" : "space-y-2"}>
        {menus.map((m) =>
          compacto ? (
            <DailyMenuRow
              key={m.id}
              menu={m}
              onClick={() => onPick(m)}
              itemProps={itemProps?.(`menu:${m.id}`)}
            />
          ) : (
            <DailyMenuCard
              key={m.id}
              menu={m}
              onClick={() => onPick(m)}
              itemProps={itemProps?.(`menu:${m.id}`)}
            />
          ),
        )}
      </div>
    </section>
  );
}

/**
 * El menú del día como una fila más de la lista (spec 146 · D-B1). Misma altura
 * y misma forma que un producto —el teclado no distingue— con el verde y el
 * cubierto como única señal de que abre un asistente y no agrega directo.
 */
function DailyMenuRow({
  menu,
  onClick,
  itemProps,
}: {
  menu: DailyMenuForMozo;
  onClick: () => void;
  itemProps?: Partial<React.ComponentProps<"button">>;
}) {
  return (
    <button
      onClick={onClick}
      {...itemProps}
      className="flex w-full items-center gap-2.5 rounded-xl bg-emerald-50/70 px-3 py-2.5 text-left ring-1 ring-emerald-200 transition outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:scale-[0.99]"
    >
      <UtensilsCrossed className="h-4 w-4 shrink-0 text-emerald-600" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {menu.name}
      </span>
      <span className="shrink-0 text-sm font-bold text-emerald-700 tabular-nums">
        {formatCurrency(menu.price_cents)}
      </span>
    </button>
  );
}

function DailyMenuCard({
  menu,
  onClick,
  itemProps,
}: {
  menu: DailyMenuForMozo;
  onClick: () => void;
  /** Foco de teclado: los menús del día encabezan la zona del catálogo. */
  itemProps?: Partial<React.ComponentProps<"button">>;
}) {
  return (
    <button
      onClick={onClick}
      {...itemProps}
      className="flex w-full gap-3 overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-3 text-left shadow-sm ring-1 ring-emerald-200 transition outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-[0.99]"
    >
      {menu.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={menu.image_url}
          alt=""
          className="h-24 w-24 shrink-0 rounded-2xl object-cover"
        />
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-emerald-100">
          <UtensilsCrossed className="h-9 w-9 text-emerald-600" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div>
          <p className="text-[10px] font-bold tracking-[0.15em] text-emerald-700 uppercase">
            Menú del día
          </p>
          <h3 className="mt-0.5 truncate text-base font-extrabold text-foreground">
            {menu.name}
          </h3>
          {menu.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-foreground/70">
              {menu.description}
            </p>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-base font-extrabold text-emerald-700 tabular-nums">
            {formatCurrency(menu.price_cents)}
          </span>
          {menu.components.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground/70 ring-1 ring-border">
              <GalleryVertical className="h-3 w-3" />
              {menu.components.length}{" "}
              {menu.components.length === 1 ? "paso" : "pasos"}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function EmptyCatalog() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center">
      <p className="text-sm font-semibold text-foreground/80">Sin productos</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Pedile a admin que cargue el catálogo.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2: Resumen (sin cambios respecto a v2.1)
// ─────────────────────────────────────────────────────────────────────────

function ResumenStep({
  cart,
  existingComandas,
  stationNameById,
  userCanCancel,
  pending,
  seatMode,
  seatCount,
  onToggleSeatMode,
  onItemSeatChange,
  onChangeQty,
  onRemove,
  userCanEditPrice,
  onEditPrice,
  onCancelItem,
  onEditPriceEnviado,
  onAdvance,
  onAddMore,
}: {
  cart: CartItem[];
  existingComandas: ComandaConItems[];
  stationNameById: Record<string, string>;
  userCanCancel: boolean;
  pending: boolean;
  seatMode: boolean;
  seatCount: number;
  onToggleSeatMode: () => void;
  onItemSeatChange: (key: string, seat: number | null) => void;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  userCanEditPrice: boolean;
  onEditPrice: (key: string) => void;
  onCancelItem: (orderItemId: string, productName: string) => void;
  onEditPriceEnviado: (orderItemId: string) => void;
  onAdvance: (comandaId: string) => void;
  onAddMore: () => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <header className="mb-2 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                Para enviar
              </p>
              <h2 className="font-heading text-base font-bold text-foreground">
                {cart.length === 0
                  ? "Sin items nuevos"
                  : `${cart.length} ${cart.length === 1 ? "item" : "items"} · sin enviar`}
              </h2>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onAddMore}>
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </Button>
          </div>
          {cart.length > 0 && (
            <button
              onClick={onToggleSeatMode}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                seatMode
                  ? "bg-violet-600 text-white ring-violet-600"
                  : "bg-card text-violet-700 ring-violet-200"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              {seatMode ? "Comensales activados" : "Asignar comensales"}
            </button>
          )}
        </header>

        {cart.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-center">
            <ShoppingBag className="mx-auto h-6 w-6 text-muted-foreground/70" />
            <p className="mt-2 text-sm font-semibold text-foreground/80">
              Carrito vacío
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Volvé al catálogo para agregar productos.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cart.map((c) => (
              <li
                key={c._key}
                className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
              >
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {isDailyMenuCart(c) && (
                        <span className="mr-1.5 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide text-emerald-700 uppercase">
                          Menú
                        </span>
                      )}
                      {c.product_name}
                      {c.seat_number != null && (
                        <button
                          onClick={() => {
                            const next =
                              c.seat_number === seatCount
                                ? null
                                : (c.seat_number ?? 0) + 1;
                            onItemSeatChange(c._key, next);
                          }}
                          className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 active:bg-violet-200"
                        >
                          C{c.seat_number}
                        </button>
                      )}
                    </p>
                    {!isDailyMenuCart(c) && c.modifiers.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.modifiers.map((m) => m.name).join(" · ")}
                      </p>
                    )}
                    {isDailyMenuCart(c) && c.selected_choices.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.selected_choices
                          .map((sc) => sc.product_name)
                          .join(" · ")}
                      </p>
                    )}
                    {c.notes && (
                      <p className="mt-0.5 text-xs text-muted-foreground italic">
                        &quot;{c.notes}&quot;
                      </p>
                    )}
                    <p className="mt-1 text-xs font-semibold text-emerald-700 tabular-nums">
                      {formatCurrency(c.line_subtotal_cents)}
                    </p>
                    {!isDailyMenuCart(c) && c.price_override_cents != null && (
                      <p className="mt-0.5 text-xs font-medium text-amber-700">
                        <span className="line-through opacity-60">
                          {formatCurrency(c.unit_price_cents)}
                        </span>{" "}
                        → {formatCurrency(c.price_override_cents)} ·{" "}
                        {c.price_override_reason}
                      </p>
                    )}
                  </div>
                  {userCanEditPrice && !isDailyMenuCart(c) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditPrice(c._key)}
                      className={
                        c.price_override_cents != null
                          ? "bg-amber-100 text-amber-700"
                          : ""
                      }
                      aria-label={`Cambiar el precio de ${c.product_name}`}
                    >
                      <Tag className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(c._key)}
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-3 py-2">
                  <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Cantidad
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onChangeQty(c._key, -1)}
                      disabled={c.quantity <= 1}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-sm ring-1 ring-border active:scale-[0.95] disabled:opacity-40"
                      aria-label="Restar"
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <span className="w-9 text-center text-lg font-bold tabular-nums">
                      {c.quantity}
                    </span>
                    <button
                      onClick={() => onChangeQty(c._key, +1)}
                      disabled={c.quantity >= 99}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-sm ring-1 ring-border active:scale-[0.95] disabled:opacity-40"
                      aria-label="Sumar"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {existingComandas.length > 0 && (
        <section>
          <header className="mb-2">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Ya en cocina
            </p>
            <h2 className="font-heading text-base font-bold text-foreground">
              {existingComandas.length}{" "}
              {existingComandas.length === 1
                ? "comanda enviada"
                : "comandas enviadas"}
            </h2>
          </header>

          <ul className="space-y-2">
            {existingComandas.map((c) => {
              const sectorName = stationNameById[c.station_id] ?? "Sector";
              const liveItems = c.items.filter((it) => !it.cancelled_at);
              const cancelledItems = c.items.filter((it) => it.cancelled_at);
              return (
                <li
                  key={c.id}
                  className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
                >
                  <header className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`}
                      />
                      <span className="font-semibold text-foreground">
                        {sectorName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        · tanda {c.batch}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_PILL[c.status]}`}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </header>
                  <ul className="divide-y divide-border/60">
                    {liveItems.map((it) => {
                      // La misma regla que la columna del salón (issue #283).
                      const puedeRepreciar =
                        userCanEditPrice && sePuedeRepreciar(it);
                      return (
                        <li
                          key={it.order_item_id}
                          className="flex items-start gap-2 p-3"
                        >
                          <span className="mt-0.5 text-sm font-bold text-foreground/80 tabular-nums">
                            {it.quantity}×
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">
                              {it.product_name}
                            </p>
                            {it.modifiers.length > 0 && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {it.modifiers
                                  .map((m) => m.modifier_name)
                                  .join(" · ")}
                              </p>
                            )}
                            {it.notes && (
                              <p className="mt-0.5 text-xs text-muted-foreground italic">
                                &ldquo;{it.notes}&rdquo;
                              </p>
                            )}
                            {it.price_original_cents != null && (
                              <p className="mt-0.5 text-xs font-medium text-amber-700">
                                <span className="line-through opacity-60">
                                  {formatCurrency(it.price_original_cents)}
                                </span>{" "}
                                → {formatCurrency(it.unit_price_cents)}
                                {it.price_override_reason
                                  ? ` · ${it.price_override_reason}`
                                  : ""}
                              </p>
                            )}
                          </div>
                          {puedeRepreciar && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                onEditPriceEnviado(it.order_item_id)
                              }
                              className={
                                it.price_original_cents != null
                                  ? "bg-amber-100 text-amber-700"
                                  : ""
                              }
                              aria-label={`Cambiar el precio de ${it.product_name}, ya enviado`}
                            >
                              <Tag className="h-4 w-4" />
                            </Button>
                          )}
                          {userCanCancel && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                onCancelItem(it.order_item_id, it.product_name)
                              }
                              aria-label="Cancelar item"
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                    {cancelledItems.map((it) => (
                      <li
                        key={it.order_item_id}
                        className="flex items-start gap-2 bg-muted/50 px-3 py-2 text-muted-foreground/70"
                      >
                        <span className="mt-0.5 text-xs font-semibold tabular-nums line-through">
                          {it.quantity}×
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold line-through">
                            {it.product_name}
                          </p>
                          {it.cancelled_reason && (
                            <p className="mt-0.5 text-[11px] text-red-500">
                              Cancelado: {it.cancelled_reason}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {c.status !== "entregado" && (
                    <div className="border-t border-border/60 p-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        onClick={() => onAdvance(c.id)}
                        className="w-full"
                      >
                        <Check className="h-4 w-4" />
                        Entregar
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bottom CTAs
// ─────────────────────────────────────────────────────────────────────────

function BottomCTACatalogo({
  cartCount,
  cartTotal,
  hasExisting,
  onClick,
}: {
  cartCount: number;
  cartTotal: number;
  hasExisting: boolean;
  onClick: () => void;
}) {
  if (cartCount === 0 && !hasExisting) {
    return (
      <div className="flex h-14 items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">
        Tocá un producto para empezar
      </div>
    );
  }
  if (cartCount === 0) {
    return (
      <Button type="button" size="xl" onClick={onClick} className="w-full">
        <ClipboardList className="h-5 w-5" />
        Ver enviados
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="xl"
      onClick={onClick}
      className="w-full justify-between"
    >
      <span className="flex items-center gap-2">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white/20 px-2 text-sm font-bold tabular-nums">
          {cartCount}
        </span>
        <span className="text-base font-semibold">Ver pedido</span>
      </span>
      <span className="text-base font-bold tabular-nums">
        {formatCurrency(cartTotal)}
      </span>
    </Button>
  );
}

function BottomCTAResumen({
  cartTotal,
  cartCount,
  pending,
  onSend,
  observacion,
  onObservacionChange,
}: {
  cartTotal: number;
  cartCount: number;
  pending: boolean;
  onSend: () => void;
  observacion: string;
  onObservacionChange: (v: string) => void;
}) {
  if (cartCount === 0) {
    return (
      <div className="flex h-14 items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">
        Sin items nuevos para enviar
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 text-sm">
        <span className="text-foreground/70">Total a enviar</span>
        <span className="text-lg font-bold text-foreground tabular-nums">
          {formatCurrency(cartTotal)}
        </span>
      </div>
      {/* Misma observación que en el panel del salón (spec 128): el mozo carga
          desde los dos lados y una que existe en uno solo es una que no se usa. */}
      <ObservacionDeLaTanda
        value={observacion}
        onChange={onObservacionChange}
      />
      <Button
        type="button"
        size="xl"
        onClick={onSend}
        disabled={pending}
        className="w-full"
      >
        <Send className="h-5 w-5" />
        {pending ? "Enviando..." : "Enviar a sectores"}
      </Button>
    </div>
  );
}
