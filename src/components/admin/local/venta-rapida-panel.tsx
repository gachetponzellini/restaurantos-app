"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Loader2, Minus, Plus, Store, Trash2, X } from "lucide-react";
import { toast } from "sonner";

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
import { useCartZone } from "@/lib/mozo/use-cart-zone";
import { isPrintableKey } from "@/lib/ui/roving";
import { useRovingList } from "@/lib/ui/use-roving-list";
import {
  ProductSearchInput,
  useProductSearch,
} from "@/components/mozo/product-search-box";
import { actionError } from "@/lib/actions";
import { emitInvoice } from "@/lib/afip/emit-invoice";
import { CobroForm, type CobroSubmit } from "@/components/billing/cobro-form";
import {
  ComprobanteFields,
  comprobanteEsValido,
  comprobanteInicial,
  comprobanteToInvoiceInput,
  type ComprobanteState,
} from "@/components/billing/comprobante-fields";
import type { Caja, PaymentMethodConfig } from "@/lib/caja/types";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
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
import { Button } from "@/components/ui/button";
import type { BusinessRole } from "@/lib/admin/context";
import { canCargarItemLibre } from "@/lib/permissions/can";
import {
  iniciarVentaMostrador,
  venderMostrador,
  type VentaMostradorResult,
} from "@/lib/orders/venta-mostrador";

type CartItem = AddToCartItem & { _key: string };

/**
 * La última venta cobrada. Sirve para dos cosas distintas y las dos importan:
 * decir **qué pasó con su comprobante**, y ofrecer el reintento cuando no salió.
 *
 * El comprobante ya no se elige acá: viaja **con el cobro** (spec 156 · D1),
 * como en la mesa y en el pedido. Antes se emitía después, con `factura_b`
 * hardcodeado, y por eso el mostrador no podía facturar una A (spec 157). Con
 * `afip_auto_emit` prendido tampoco alcanzaba con arreglar el botón: la B
 * automática sale al cobrar y la guarda de la spec 100 bloquea la A para
 * siempre. El botón queda entonces para lo único que sigue siendo suyo —
 * reintentar lo que ARCA rechazó, sin frenar la venta siguiente.
 */
type UltimaVenta = {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  comprobante: ComprobanteState;
  emision?: VentaMostradorResult["comprobante"];
};

/**
 * Spec 058 — **Venta rápida** de kiosko / barra: una sola pantalla para elegir
 * productos y cobrar, sin abrir mesa ni pedir datos del cliente.
 *
 * Vive como modo del sidebar del salón porque es ahí donde el encargado ya está
 * parado. Reusa el picker keyboard-first de spec 055 (buscador con foco, ↓/↑ y
 * Enter, `ProductModal` para modificadores) y le pega abajo el bloque de cobro,
 * de manera que la venta entera sea: tipear, Enter, Enter, cobrar.
 *
 * Después de cobrar el panel **no se cierra**: limpia el carrito y devuelve el
 * foco al buscador, porque en una barra las ventas vienen en fila.
 */
export function VentaRapidaPanel({
  slug,
  role,
  onClose,
}: {
  slug: string;
  /** Para el gate del renglón libre (spec 174). */
  role: BusinessRole;
  onClose: () => void;
}) {
  const puedeItemLibre = canCargarItemLibre(role);
  const [libreAbierto, setLibreAbierto] = useState(false);
  const [catalog, setCatalog] = useState<CatalogForMozo | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [cajas, setCajas] = useState<Caja[]>([]);
  const [methodConfigs, setMethodConfigs] = useState<PaymentMethodConfig[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  const [topProductIds, setTopProductIds] = useState<string[]>([]);
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [cajaId, setCajaId] = useCajaPreferida(slug, cajas);
  // spec 156 · D1 — qué comprobante sale se elige ANTES de cobrar, con el
  // cliente delante. Acá se emite después (D4), pero el receptor ya está.
  const [comprobante, setComprobante] =
    useState<ComprobanteState>(comprobanteInicial());
  const [ultima, setUltima] = useState<UltimaVenta | null>(null);

  const [facturando, startFacturar] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Carga inicial: catálogo + cajas, en paralelo. ──
  useEffect(() => {
    let alive = true;
    loadPedirCatalog(slug).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setCatalog(r.data.catalog);
        setTopProductIds(r.data.topProductIds);
      } else {
        setCatalogError(r.error);
      }
      setLoadingCatalog(false);
    });
    iniciarVentaMostrador(slug).then((r) => {
      if (!alive) return;
      if (r.ok) {
        // La caja la resuelve `useCajaPreferida` cuando llega la lista.
        setCajas(r.data.cajas);
        setMethodConfigs(r.data.methodConfigs);
      } else {
        setInitError(r.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Autofocus al buscador al abrir.
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const categoriesWithProducts = useMemo(
    () => (catalog?.categories ?? []).filter((c) => c.products.length > 0),
    [catalog],
  );

  // Spec 068: el buscador (filtrado + teclado + filtro de la web) es el mismo
  // de la mesa y de cargar pedido.
  const allProducts = useMemo(
    () => categoriesWithProducts.flatMap((c) => c.products),
    [categoriesWithProducts],
  );
  // Lo que se ve sin búsqueda: la categoría activa. Va al hook, que decide
  // entre esto y los resultados y le da índice de teclado a los dos (spec 073).
  // Sin búsqueda: los más pedidos, igual que la mesa y los pedidos online
  // (spec 111 fase 5 · 117 · 123). Las tres pantallas de carga abren mostrando
  // lo mismo.
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
  // Negocio sin historial: la carta entera antes que una pantalla en blanco.
  const browseProducts: CatalogProduct[] =
    topProducts.length > 0 ? topProducts : allProducts;
  const searchApi = useProductSearch({
    products: allProducts,
    browse: browseProducts,
    storageKey: `venta_rapida_web_${slug}`,
    // Spec 174 — la fila «no existe» no abre el `ProductModal` (no hay
    // producto ni modificadores que elegir): abre el suyo.
    onPick: (p) =>
      isItemLibreEntry(p) ? setLibreAbierto(true) : setOpenProduct(p),
    // ↓ baja el foco al catálogo (spec 075): mismas zonas que la carga de mesa.
    onEnterResults: () =>
      visibleProducts.length > 0 ? catalogo.focusFirst() : carrito.focusFirst(),
    itemLibre: puedeItemLibre,
  });
  const { isSearching, results: visibleProducts, enterTargetId } = searchApi;

  const subtotal = cart.reduce((a, c) => a + c.line_subtotal_cents, 0);
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);

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

  // ── Zonas del panel (spec 075): buscador → catálogo → carrito → cobrar ──
  const cobrarRef = useRef<HTMLButtonElement>(null);
  const catalogo = useRovingList<HTMLButtonElement>({
    length: visibleProducts.length,
    onExitUp: focusSearch,
    onExitDown: () => carrito.focusFirst(),
  });

  function addToCart(item: AddToCartItem) {
    setCart((prev) => [...prev, { ...item, _key: crypto.randomUUID() }]);
    searchApi.setSearch("");
    focusSearch();
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
          line_subtotal_cents: (c.unit_price_cents + modsTotal) * nextQty,
        };
      }),
    );
  }

  // El carrito, operable con el teclado (spec 075): ←/→ cantidad, dígito la
  // fija, Supr quita.
  const carrito = useCartZone({
    length: cart.length,
    onExitUp: () =>
      visibleProducts.length > 0 ? catalogo.focusLast() : focusSearch(),
    // La cadena termina en la acción primaria, no en una tecla muerta.
    onExitDown: () => cobrarRef.current?.focus({ preventScroll: true }),
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
    onType: escribirEnBuscador,
  });

  /**
   * Cobrar es del `CobroForm` (spec 157 · D1): el método, el ajuste, la guarda
   * de efectivo, el vuelto, la nota, el fiado y la idempotencia viven ahí, una
   * sola vez para las tres pantallas. Acá queda lo que es del mostrador: de
   * dónde salen los ítems y qué hacer cuando la venta ya está cobrada.
   */
  async function cobrar(input: CobroSubmit) {
    if (initError) return actionError(initError);
    if (cart.length === 0) return actionError("Agregá al menos un producto.");
    if (!cajaId) return actionError("Elegí una caja para registrar el cobro.");
    // Tildó Factura A y el CUIT no está completo: se frena ACÁ. Cobrar igual
    // dejaría a la empresa sin su A, y arreglarlo después es una nota de
    // crédito — un comprobante fiscal real, no un undo (spec 053 · 156).
    if (!comprobanteEsValido(comprobante)) {
      return actionError(
        "Para la Factura A falta el CUIT del receptor (11 dígitos).",
      );
    }
    return venderMostrador(
      {
        business_slug: slug,
        method: input.method,
        caja_id: input.cajaId,
        tip_cents: input.tipCents,
        last_four: input.lastFour,
        card_brand: input.cardBrand,
        notes: input.notes,
        items: cart.map((c) =>
          // Spec 174 — el renglón libre viaja con su propia forma: nombre y
          // precio, sin `product_id` (no hay producto detrás).
          isItemLibreCartLine(c)
            ? itemLibrePayload(c)
            : {
                product_id: c.product_id,
                quantity: c.quantity,
                notes: c.notes || undefined,
                modifier_ids: c.modifiers.map((m) => m.id),
              },
        ),
        request_id: input.requestId,
        credit_customer_id: input.creditCustomerId ?? undefined,
      },
      // spec 156 · D1 · 157 — lo elegido viaja CON el cobro, igual que en la mesa
      // y en el pedido. Emitirlo después no alcanza: la automática ya salió.
      comprobanteToInvoiceInput(comprobante),
    );
  }

  function cobrada(data: VentaMostradorResult) {
    if (data.ruteo_error) {
      toast.warning(
        `Venta #${data.daily_number} cobrada, pero la comanda no salió: ${data.ruteo_error}`,
      );
    } else if (data.comandas_creadas > 0) {
      toast.success(
        `Venta #${data.daily_number} cobrada · ${data.comandas_creadas} comanda${data.comandas_creadas === 1 ? "" : "s"} a cocina`,
      );
    } else {
      toast.success(
        `Venta #${data.daily_number} cobrada · ${formatCurrency(data.cobrado_cents)}`,
      );
    }

    // El comprobante lo emite el cobro. Si no salió, el pago igual quedó
    // registrado: la plata nunca depende de ARCA (spec 147).
    if (data.comprobante?.outcome === "rechazada") {
      toast.warning(
        `Venta #${data.daily_number} cobrada, pero el comprobante no se emitió: ${
          data.comprobante.error ?? "error desconocido"
        }.`,
      );
    }

    setUltima({
      orderId: data.order_id,
      orderNumber: data.daily_number,
      totalCents: data.cobrado_cents,
      comprobante,
      emision: data.comprobante,
    });
    // Listo para el próximo cliente: carrito limpio, comprobante en B otra vez
    // —el CUIT del anterior no se le emite al que sigue— y foco en el buscador.
    setCart([]);
    setComprobante(comprobanteInicial());
    searchApi.setSearch("");
    focusSearch();
  }

  /** «Factura A» / «Factura B» — lo que se pidió al cobrar. */
  const comprobanteLabel =
    ultima?.comprobante.tipo === "factura_a" ? "Factura A" : "Factura B";
  /** Salió (o ya estaba): no hay nada que reintentar. */
  const emisionOk =
    ultima?.emision?.outcome === "encolada" ||
    ultima?.emision?.outcome === "ya-tiene";

  function facturarUltima() {
    if (!ultima) return;
    startFacturar(async () => {
      const r = await emitInvoice({
        orderId: ultima.orderId,
        slug,
        // El reintento emite **lo que se pidió al cobrar**. Antes iba
        // `factura_b` hardcodeado: el mostrador —justo donde se factura el
        // evento empresarial y el abono del sanatorio— no podía emitir una A
        // ni cargando el CUIT (spec 157).
        ...comprobanteToInvoiceInput(ultima.comprobante),
      });
      if (!r.ok) {
        toast.error(`No se pudo facturar: ${r.error}`);
        return;
      }
      toast.success(`Venta #${ultima.orderNumber} facturada.`);
      setUltima(null);
    });
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ─── Header ─── */}
      <header className="border-border/60 flex shrink-0 items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Store className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Venta rápida
          </p>
          <h3 className="font-heading text-base leading-tight font-bold text-foreground">
            Kiosko / barra · sin mesa
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          onClick={onClose}
          aria-label="Cerrar venta rápida"
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      {initError && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800">
          {initError}
        </div>
      )}

      {/* Mismo shell que la mesa y los pedidos online (spec 115 · 123): la venta
          a la izquierda, buscar y agregar a la derecha. Cargar un ítem acá es
          el mismo gesto que cargarlo en una mesa. */}
      <PanelDeCarga>
        <ColumnaDeCarga
          className="@min-[600px]:order-2"
          encabezado={
            <ProductSearchInput
              api={searchApi}
              inputRef={searchRef}
              autoFocus
            />
          }
          onKeyDownResultados={(e) => {
            if (catalogo.handleKeyDown(e)) return;
            if (isPrintableKey(e)) {
              e.preventDefault();
              escribirEnBuscador(e.key);
            }
          }}
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
          ) : visibleProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center">
              <p className="text-sm font-semibold text-foreground/80">
                {isSearching ? "Sin resultados" : "Sin productos"}
              </p>
            </div>
          ) : (
            // Buscando o no, la misma lista navegable por ↓/↑. Spec 073.
            <ProductResultsList
              products={visibleProducts}
              onPick={(p) =>
                isItemLibreEntry(p) ? setLibreAbierto(true) : setOpenProduct(p)
              }
              enterTargetId={enterTargetId}
              itemProps={(id) => {
                const i = visibleProducts.findIndex((p) => p.id === id);
                return i < 0 ? {} : catalogo.itemProps(i);
              }}
            />
          )}
        </ColumnaDeCarga>

        {/* La venta y el cobro. `apilada`: con el panel angosto va **debajo**
            del catálogo, como venía — el total y «Cobrar» no pueden depender de
            que te acuerdes de abrir otra vista. */}
        <ColumnaLateral
          abierta
          modoAngosto="apilada"
          className="@min-[600px]:order-1 @min-[600px]:border-r @min-[600px]:border-border"
        >
          <div className="flex min-h-0 flex-col overflow-y-auto border-t border-border bg-card @min-[600px]:border-t-0">
            <div className="flex items-center justify-between px-3 pt-2.5">
              <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                La venta
              </p>
              <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                {cartCount > 0
                  ? `${cartCount} ${cartCount === 1 ? "ítem" : "ítems"}`
                  : "vacía"}
              </span>
            </div>

            {cart.length === 0 ? (
              <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">
                Buscá arriba y agregá con Enter. Se cobra sin abrir mesa.
              </p>
            ) : (
              <ul
                onKeyDown={carrito.handleKeyDown}
                className="max-h-32 space-y-1 overflow-y-auto px-3 py-2 @min-[600px]:max-h-56"
              >
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
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-emerald-700 tabular-nums">
                      {formatCurrency(c.line_subtotal_cents)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
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

            {/* El total del carrito, sin ajuste de método: el mismo encuadre
                que el sheet del pedido (spec 157 · D1). El recargo/descuento y
                lo que se cobra de verdad los canta el botón de Confirmar. */}
            <div className="flex items-baseline justify-between border-t border-border/60 px-3 py-2">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Total
              </span>
              <span className="text-lg font-bold text-foreground tabular-nums">
                {formatCurrency(subtotal)}
              </span>
            </div>

            {/* spec 157 · D3 — el comprobante, el mismo de la mesa y el pedido.
                Colapsado en Factura B, que es el 95 % del mostrador: la A cuesta
                un tap, la B no cuesta ninguno. */}
            <div className="border-t border-border/60 px-3 py-2.5">
              <ComprobanteFields
                slug={slug}
                value={comprobante}
                onChange={setComprobante}
              />
            </div>

            {/* spec 157 · D1 — el mismo formulario de la mesa y del pedido, en
                su modo rápido (D2): método ya elegido, todo en una pantalla y el
                foco intacto en el buscador. La grilla propia, el selector de
                caja y el fiado cableado a mano vivían acá y se fueron: los tres
                ya estaban resueltos adentro. */}
            <div className="border-t border-border/60 px-3 py-2.5">
              <CobroForm<VentaMostradorResult>
                flujo="rapido"
                confirmRef={cobrarRef}
                amountDueCents={subtotal}
                cajas={cajas}
                cajaId={cajaId}
                onCajaChange={setCajaId}
                methodConfigs={methodConfigs}
                // Sin `mp`: link y QR quedan afuera solos. Y sin
                // `allowedMethods` a propósito — un método nuevo tiene que
                // aparecer en las tres pantallas sin tocar tres archivos.
                tip={{ mode: "none" }}
                // spec 141 — el mostrador es justo donde el socio dice «ponelo
                // en mi cuenta». Va sin lista de apertura: acá no hay cliente
                // conocido de antemano, se busca o se da de alta en el momento.
                cuentaCorriente={{ slug, clientes: [] }}
                onSubmit={cobrar}
                onPaid={cobrada}
              />
            </div>

            {/* El desenlace del comprobante de la última venta. Nunca frena a
                la siguiente: para cuando aparece, la venta ya está cobrada y el
                carrito ya está vacío (spec 157 · D4). */}
            {ultima && (
              <div className="flex items-center gap-2 border-t border-border/60 bg-muted/50 px-3 py-2">
                <p className="min-w-0 flex-1 text-[11px] text-foreground/70">
                  Venta #{ultima.orderNumber} cobrada ·{" "}
                  {formatCurrency(ultima.totalCents)}
                  {emisionOk ? (
                    <span className="font-semibold text-emerald-700">
                      {" "}
                      · {comprobanteLabel} ✓
                    </span>
                  ) : ultima.emision?.outcome === "rechazada" ? (
                    <span className="block truncate font-semibold text-rose-600">
                      {comprobanteLabel} rechazada:{" "}
                      {ultima.emision.error ?? "error desconocido"}
                    </span>
                  ) : null}
                </p>
                {!emisionOk && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="shrink-0"
                    onClick={facturarUltima}
                    disabled={facturando}
                  >
                    {facturando ? "Facturando…" : "Reintentar"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={() => setUltima(null)}
                  aria-label="Descartar aviso"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </ColumnaLateral>
      </PanelDeCarga>

      <ProductModal
        product={openProduct}
        open={!!openProduct}
        onClose={() => {
          setOpenProduct(null);
          focusSearch();
        }}
        onAdd={addToCart}
        embedded
        // Kiosko/barra: no hay mesa ni tiempos que ordenar, así que «Como
        // entrada» no aplica (issue #189).
        permiteComoEntrada={false}
      />

      {libreAbierto && (
        <ItemLibreModal
          nombreSugerido={searchApi.nombreLibreSugerido}
          onConfirm={(draft: ItemLibreDraft) => {
            addToCart(itemLibreCartLine(draft));
            setLibreAbierto(false);
          }}
          onClose={() => {
            setLibreAbierto(false);
            focusSearch();
          }}
        />
      )}
    </div>
  );
}
