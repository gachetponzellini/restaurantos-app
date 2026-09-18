"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  ReceiptText,
  RefreshCw,
  Settings,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
import { CerrarCajaModal } from "@/components/admin/local/cerrar-caja-modal";
import {
  METHOD_COLOR,
  METHOD_LABEL,
  VentasPorMetodo,
  methodIcon,
} from "@/components/admin/local/caja-metricas";
import { CobrosPorOrigen } from "@/components/admin/local/cobros-por-origen";
import { SegmentedSelector } from "@/components/admin/local/segmented-selector";
import { MovimientoModal } from "@/components/admin/local/movimiento-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { registrarIngreso, registrarSangria } from "@/lib/caja/actions";
import { agruparCobrosPorMozo } from "@/lib/caja/liquidacion-mozo";
import { MOVIMIENTO_LABEL, saleDelCajon } from "@/lib/caja/movimiento-label";
import type { CajaPayment } from "@/lib/caja/queries";
import type {
  CajaConEstado,
  CajaLiveStats,
  CajaMovimiento,
} from "@/lib/caja/types";
import {
  resolverCajaActiva,
  useCajaPreferida,
} from "@/lib/caja/use-caja-preferida";
import { useOnActivate } from "@/lib/ui/use-tab-param";
import { getCajaTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  cajas: CajaConEstado[];
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
  /** `true` si el panel montó lazy (spec 103): entonces revalida al montar. */
  refetchAlMontar?: boolean;
  /** Spec 103: cada snapshot nuevo del refetch, para el badge de la tab. */
  onServerData?: (d: { cajas: CajaConEstado[] }) => void;
  /**
   * Spec 153 — el `?caja=` con el que «Ver ahora» abre una caja puntual desde
   * la sección Caja. Viaja como prop desde el server y no por
   * `useSearchParams`: la página ya lee sus searchParams y este panel se monta
   * lazy detrás de un `next/dynamic`, así que el dato explícito es el que
   * llega seguro.
   */
  cajaPedida?: string | null;
};

export function CajaAdminBoard({
  slug,
  cajas: initialCajas,
  active = true,
  refetchAlMontar = false,
  onServerData,
  cajaPedida,
}: Props) {
  const [statsByCaja, setStatsByCaja] = useState<
    Record<string, CajaLiveStats | null>
  >({});
  const [movimientosByCaja, setMovimientosByCaja] = useState<
    Record<string, CajaMovimiento[]>
  >({});
  const [paymentsByCaja, setPaymentsByCaja] = useState<
    Record<string, CajaPayment[]>
  >({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Snapshot del server de la tab (las cajas con su último corte y período),
  // seedeado de los props y actualizado sólo por el refetch (spec 103). Antes
  // esto se refrescaba con `router.refresh()`, que re-corría las 7 tabs.
  const [cajas, setCajas] = useState(initialCajas);
  const refetchSeq = useRef(0);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  const refetchCaja = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getCajaTabData(slug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) {
        setCajas(res.data.cajas);
        onServerDataRef.current?.(res.data);
      }
    } catch {
      // swallow: refresh de fondo. La caja NUNCA se vacía por un error de red;
      // los números que decidan un corte salen del poll de stats, que avisa
      // aparte.
    }
  }, [slug]);

  /**
   * Después de mover plata: se re-piden las dos mitades. `refetchCaja` trae el
   * estado de la caja (último corte, período) y el bump del `refreshKey`
   * recomputa los stats **después** del insert — nunca al revés, o el corte
   * mostraría la plata del período que acaba de cerrar.
   */
  const resincronizar = useCallback(() => {
    void refetchCaja();
    setRefreshKey((k) => k + 1);
  }, [refetchCaja]);

  // Volver a la tab (o abrirla por primera vez) revalida el estado de las cajas
  // sin esperar al tick de 30 s: es plata y se decide un corte con esto.
  useOnActivate(active, () => void refetchCaja(), { onMount: refetchAlMontar });

  // ── Selector de caja activa (persiste por máquina) ──
  // Misma preferencia que usa el cobro: el puesto del bar registra en Caja Bar
  // acá y al cobrar. Ver `use-caja-preferida.ts`.
  // Spec 153 — `?caja=` llega desde «Ver ahora» de la sección Caja: abre esa
  // caja y no la que quedó guardada en esta máquina.
  const [cajaPreferida, selectCaja] = useCajaPreferida(slug, cajas);
  // La caja pedida manda para ESTA vista y **no** pisa la preferencia de la
  // máquina: mirar la Caja Bar desde la compu del salón no tiene por qué
  // cambiar dónde cobra esa compu después. Elegirla en el selector sí.
  const activeCajaId = resolverCajaActiva(cajaPedida, cajaPreferida, cajas);


  // Poll de stats por caja. Depende de `active` (spec 101): con el keep-alive el
  // panel queda montado al cambiar de tab, y sin esta guarda seguiría golpeando
  // `/api/caja/stats` × N cajas cada 30 s desde cada tablet del local, para
  // siempre, sin que nadie lo mire. Volver a la tab re-corre el effect → `load()`
  // inmediato: la tab de plata nunca pinta el snapshot viejo mientras espera el
  // primer tick.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        cajas.map(async (c) => {
          try {
            const res = await fetch(`/api/caja/stats?caja=${c.id}`);
            const data = await res.json();
            return [
              c.id,
              data?.stats ?? null,
              data?.movimientos ?? [],
              data?.payments ?? [],
            ] as const;
          } catch {
            return [c.id, null, [], []] as const;
          }
        }),
      );
      if (!cancelled) {
        setStatsByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[1]])),
        );
        setMovimientosByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[2]])),
        );
        setPaymentsByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[3]])),
        );
      }
    };
    if (cajas.length > 0) load();
    const i = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [cajas, refreshKey, active]);

  if (cajas.length === 0) {
    return (
      <div className="space-y-5">
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-6 text-center">
            <div
              className="flex size-14 items-center justify-center rounded-full"
              style={{ background: "var(--brand-soft, #F4F4F5)" }}
            >
              <Wallet
                className="size-7"
                style={{ color: "var(--brand, #18181B)" }}
              />
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
                Sin cajas configuradas
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                Creá una caja desde la configuración para empezar a operar.
              </p>
            </div>
            <Link
              href={`/${slug}/admin/caja`}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-95"
              style={{
                background: "var(--brand, #18181B)",
                color: "var(--brand-foreground, white)",
              }}
            >
              <Settings className="size-4" />
              Configurar cajas
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  const activeCaja = cajas.find((c) => c.id === activeCajaId) ?? cajas[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        {cajas.length > 1 ? (
          <SegmentedSelector
            ariaLabel="Seleccionar caja"
            activeId={activeCajaId}
            onSelect={selectCaja}
            items={cajas.map((c) => ({
              id: c.id,
              label: c.name,
              count: statsByCaja[c.id]?.cobros_count || undefined,
            }))}
          />
        ) : (
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Refresco cada 30s
          </p>
        )}
        <button
          type="button"
          onClick={resincronizar}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Refrescar"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <CajaCard
        key={activeCaja.id}
        caja={activeCaja}
        stats={statsByCaja[activeCaja.id] ?? null}
        movimientos={movimientosByCaja[activeCaja.id] ?? []}
        payments={paymentsByCaja[activeCaja.id] ?? []}
        slug={slug}
        onChanged={resincronizar}
      />

      <div className="pt-1 text-center">
        <Link
          href={`/${slug}/admin/caja`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
        >
          <Settings className="size-3" />
          Configurar cajas
        </Link>
      </div>
    </div>
  );
}

// ── Card de caja (siempre operativa) ─────────────────────────────

function CajaCard({
  caja,
  stats,
  movimientos,
  payments,
  slug,
  onChanged,
}: {
  caja: CajaConEstado;
  stats: CajaLiveStats | null;
  movimientos: CajaMovimiento[];
  payments: CajaPayment[];
  slug: string;
  /** Re-sincroniza la tab después de mover plata (spec 103). */
  onChanged: () => void;
}) {
  const [, startTransition] = useTransition();
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [ingresoOpen, setIngresoOpen] = useState(false);
  const [corteOpen, setCorteOpen] = useState(false);

  // Los stats llegan por poll, no con la page. Hasta que caen, los montos no
  // son cero: **no se saben**. Mostrar «$0» hacía que por medio segundo el
  // encargado leyera «en la caja deberías tener $0» con la caja llena
  // (issue #189).
  const cargandoStats = stats == null;
  const expected = stats?.expected_cash_cents ?? 0;
  // Spec 130 · Lo que quedó del turno anterior **después** del retiro del
  // cierre. Sale de los stats (ya neteado) y no de `ultimo_corte`: el monto
  // contado en el corte es plata que ya se sacó del cajón, y anunciarla como
  // saldo anterior —con la sangría que la vacía tres líneas más abajo— es
  // narrar la misma plata dos veces. Con el retiro hecho, esto es $0.
  const apertura = stats?.desglose_esperado.apertura_cents ?? 0;
  const ventas = stats?.total_ventas_cents ?? 0;
  const propinas = stats?.total_propinas_cents ?? 0;
  const cobros = stats?.cobros_count ?? 0;
  const porMetodo = stats?.ventas_por_metodo;
  const porOrigen = stats?.ventas_por_origen;
  const porOrigenYMetodo = stats?.ventas_por_origen_y_metodo;
  const periodoDesdeFecha = stats?.periodo_desde ?? caja.periodo_desde;

  const periodoLabel = (() => {
    const d = new Date(periodoDesdeFecha);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
    if (diffMin < 1) return "desde ahora";
    if (diffMin < 60) return `desde hace ${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m === 0 ? `desde hace ${h}h` : `desde hace ${h}h ${m}m`;
  })();

  type Entry =
    | { kind: "cobro"; createdAt: string; data: CajaPayment }
    | { kind: "sangria" | "ingreso"; createdAt: string; data: CajaMovimiento };
  const entries: Entry[] = [
    ...payments.map((p) => ({
      kind: "cobro" as const,
      createdAt: p.created_at,
      data: p,
    })),
    ...movimientos.map((m) => ({
      kind: m.kind as "sangria" | "ingreso",
      createdAt: m.created_at,
      data: m,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-semibold tracking-tight text-zinc-900">
              {caja.name}
            </h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-800">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              Activa
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Período activo {periodoLabel}
            {/* Spec 149 · acá decía «· último corte registrado», que anunciaba
                un dato sin mostrarlo ni llevar a ningún lado. Ahora es la
                entrada al cierre archivado. */}
            {caja.ultimo_corte && (
              <>
                <span className="mx-1 text-zinc-300">·</span>
                <Link
                  href={`/${slug}/admin/caja/cierres?caja=${caja.id}`}
                  className="font-medium underline underline-offset-2 transition hover:text-zinc-900"
                >
                  ver cierres anteriores
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSangriaOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ArrowDownToLine className="size-3.5" /> Sangría
          </button>
          <button
            type="button"
            onClick={() => setIngresoOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ArrowUpFromLine className="size-3.5" /> Ingreso
          </button>
          <button
            type="button"
            onClick={() => setCorteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition hover:brightness-95"
            style={{
              background: "var(--brand, #18181B)",
              color: "var(--brand-foreground, white)",
            }}
          >
            <Lock className="size-3.5" /> Cerrar caja
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          className="rounded-2xl p-5 ring-1 ring-zinc-200/70"
          style={{ background: "var(--brand-soft, #F4F4F5)" }}
        >
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            En la caja deberías tener
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {cargandoStats ? (
              <span className="inline-block h-8 w-32 animate-pulse rounded-lg bg-zinc-900/10 align-middle" />
            ) : (
              formatCurrency(expected)
            )}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {/* Mientras los stats no llegaron no se sabe la apertura: un
                «Arranca en $0» prematuro es la misma mentira que el «$0» de
                arriba (issue #189), así que se reserva el alto y no se dice
                nada. */}
            {cargandoStats
              ? "\u00A0"
              : apertura !== 0
                ? `${formatCurrency(apertura)} del corte anterior + movimientos del período`
                : "Arranca en $0 + movimientos del período"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Cobrado en el período
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {cargandoStats ? (
              <span className="inline-block h-8 w-32 animate-pulse rounded-lg bg-zinc-900/10 align-middle" />
            ) : (
              formatCurrency(ventas)
            )}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {cargandoStats ? (
              " "
            ) : (
              <>
                {cobros} {cobros === 1 ? "cobro" : "cobros"}
                {/* Las propinas no están adentro de este número —es venta, no
                    lo que entró— así que se dicen aparte y con esa palabra. */}
                {propinas > 0 && ` · más ${formatCurrency(propinas)} de propina`}
              </>
            )}
          </p>
        </div>
      </div>

      {porMetodo && cobros > 0 && <VentasPorMetodo porMetodo={porMetodo} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Cobros por origen
          </p>
          {porOrigen && porOrigenYMetodo && cobros > 0 ? (
            <CobrosPorOrigen
              porOrigen={porOrigen}
              porOrigenYMetodo={porOrigenYMetodo}
            />
          ) : (
            <p className="mt-3 text-xs text-zinc-500">Todavía no hubo cobros.</p>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Movimientos del período
            </p>
            <div className="flex items-baseline gap-2">
              {/* El período es el hot path del turno; el libro (spec 070) es el
                  histórico con filtros, los anulados y la corrección. */}
              <Link
                href={`/${slug}/admin/caja/movimientos?caja=${caja.id}`}
                className="text-xs font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
              >
                Ver todos
              </Link>
              <p className="text-xs font-semibold tabular-nums text-zinc-700">
                {entries.length}
              </p>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="mt-3 text-xs text-zinc-500">
              Todavía no hubo movimientos.
            </p>
          ) : (
            <ul className="mt-3 max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200/70">
              {entries.map((e) => {
                const dia = e.createdAt.slice(0, 10);
                const href = `/${slug}/admin/caja/movimientos?caja=${caja.id}&gran=dia&fecha=${dia}`;
                return e.kind === "cobro" ? (
                  <CobroRow key={`p-${e.data.id}`} payment={e.data} href={href} />
                ) : (
                  <MovimientoRow key={`m-${e.data.id}`} mov={e.data} href={href} />
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {payments.length > 0 && <CobradoPorEmpleado payments={payments} />}

      <MovimientoModal
        open={sangriaOpen}
        onOpenChange={setSangriaOpen}
        title="Registrar sangría"
        icon={<ArrowDownToLine />}
        description="Sacar efectivo de la caja (depósito en banco, cambio que se lleva alguien, etc.). Los pagos a proveedor no van acá: salen de la Caja Mayor, desde Proveedores."
        requiereMotivo
        ctaLabel="Registrar sangría"
        disponibleCents={expected}
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarSangria(caja.id, amount, reason ?? "", slug);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Sangría registrada");
              setSangriaOpen(false);
              onChanged();
            }
          })
        }
      />
      <MovimientoModal
        open={ingresoOpen}
        onOpenChange={setIngresoOpen}
        title="Registrar ingreso"
        icon={<ArrowUpFromLine />}
        description="Sumar efectivo extra a la caja."
        requiereMotivo={false}
        ctaLabel="Registrar ingreso"
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarIngreso(caja.id, amount, reason ?? null, slug);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Ingreso registrado");
              setIngresoOpen(false);
              onChanged();
            }
          })
        }
      />
      <CerrarCajaModal
        open={corteOpen}
        onOpenChange={setCorteOpen}
        slug={slug}
        cajaId={caja.id}
        cajaName={caja.name}
        onCerrada={onChanged}
      />
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────



function MovimientoRow({ mov, href }: { mov: CajaMovimiento; href: string }) {
  // issue #299 — esto era `mov.kind === "sangria"`, así que el pago de propina
  // (spec 177 · D6) caía en el `else` y se dibujaba como «Ingreso», verde y con
  // `+`: plata que salió del cajón figurando como que entró.
  const sale = saleDelCajon(mov.kind);
  const time = new Date(mov.created_at).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-start gap-3 px-3 py-2.5 transition hover:bg-zinc-50",
          mov.cancelled_at && "opacity-50",
        )}
      >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          sale ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
        )}
      >
        {sale ? (
          <ArrowDownToLine className="size-3.5" strokeWidth={2.25} />
        ) : (
          <ArrowUpFromLine className="size-3.5" strokeWidth={2.25} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {MOVIMIENTO_LABEL[mov.kind]}
            <span className="ml-1.5 text-[10px] font-normal text-zinc-400 tabular-nums">{time}</span>
          </p>
          <p className={cn("shrink-0 text-sm font-bold tabular-nums", sale ? "text-rose-700" : "text-emerald-700")}>
            {sale ? "−" : "+"}
            {formatCurrency(mov.amount_cents)}
          </p>
        </div>
        {mov.reason && <p className="mt-0.5 truncate text-xs text-zinc-500">{mov.reason}</p>}
      </div>
      </Link>
    </li>
  );
}


function CobroRow({ payment, href }: { payment: CajaPayment; href: string }) {
  const Icon = methodIcon(payment.method);
  const time = new Date(payment.created_at).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const origen =
    payment.delivery_type === "dine_in" && payment.table_label
      ? `Mesa ${payment.table_label}`
      : payment.customer_name?.trim() ||
        (payment.order_number > 0 ? `#${payment.order_number}` : "Orden");

  return (
    <li>
      {/* La línea es accionable: lleva al libro, que es donde se corrige. */}
      <Link
        href={href}
        className="flex items-start gap-3 px-3 py-2.5 transition hover:bg-zinc-50"
      >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {origen}
            <span className="ml-1.5 text-[10px] font-normal text-zinc-400 tabular-nums">{time}</span>
          </p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-900">
            +{formatCurrency(payment.amount_cents)}
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs text-zinc-500">
            {METHOD_LABEL[payment.method]}
            {payment.attributed_mozo_name && (
              <><span className="mx-1 text-zinc-300">·</span>{payment.attributed_mozo_name}</>
            )}
            {/* spec 147 — el cobro está bien; lo que falta es el papel de ARCA.
                Mismo lenguaje visual que la comanda que no imprimió (spec 33). */}
            {payment.comprobante_fallido && (
              <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 align-middle">
                <ReceiptText className="size-3" strokeWidth={2.25} />
                Sin comprobante
              </span>
            )}
          </p>
          {payment.tip_cents > 0 && (
            <p className="shrink-0 text-[11px] text-emerald-700 tabular-nums">
              +{formatCurrency(payment.tip_cents)} propina
            </p>
          )}
        </div>
      </div>
      </Link>
    </li>
  );
}

// ── Modales ──────────────────────────────────────────────────────



// ── Cobrado por empleado ─────────────────────────────────────────

/** Iniciales para el avatar. «Sin mozo» no lleva. */
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Qué cobró cada empleado en el período (pedido de Juan, 2026-09-03: *"la
 * rendición por empleado podría ser más estético ese componente"*).
 *
 * Era una tabla de cuatro columnas con el nombre repetido en blanco y el total
 * del mozo metido entre paréntesis pegado al último monto — dos números en una
 * celda, sin rótulo. Ahora es una tarjeta por persona: el nombre y su total
 * arriba, los métodos abajo con el **mismo punto de color** que las barras de
 * más arriba, y el efectivo señalado como lo que va a tener que entregar.
 *
 * Se llamaba «Rendición por empleado» y listaba tarjeta, que es justo lo que la
 * spec 151 sacó de la rendición. Acá **sí** se muestra —es la caja, y ver lo que
 * cobró cada uno es el punto— pero el bloque pasa a llamarse por lo que es, y la
 * línea «a rendir» dice cuál de esos números es el que se le va a pedir.
 */
function CobradoPorEmpleado({ payments }: { payments: CajaPayment[] }) {
  const mozos = agruparCobrosPorMozo(payments);

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Cobrado por empleado
      </p>

      {mozos.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Todavía no hubo cobros.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {mozos.map((m) => {
            const sinMozo = m.mozo_name === "Sin mozo";
            return (
              <li
                key={m.mozo_name}
                className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold",
                        sinMozo
                          ? "bg-white text-zinc-400 ring-1 ring-zinc-200"
                          : "bg-zinc-200 text-zinc-700",
                      )}
                    >
                      {sinMozo ? "—" : iniciales(m.mozo_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {m.mozo_name}
                      </p>
                      <p className="text-xs text-zinc-500 tabular-nums">
                        {m.cobros_count} cobro{m.cobros_count === 1 ? "" : "s"}
                        {m.propinas_cents > 0 && (
                          <>
                            <span className="mx-1 text-zinc-300">·</span>
                            <span className="text-emerald-700">
                              {formatCurrency(m.propinas_cents)} de propina
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-base font-bold tracking-tight text-zinc-900 tabular-nums">
                    {formatCurrency(m.total_cents)}
                  </p>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {m.por_metodo.map((f) => (
                    <li
                      key={f.method}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="inline-flex items-baseline gap-1.5 text-zinc-600">
                        <span
                          className="inline-block size-2 shrink-0 translate-y-px rounded-full"
                          style={{ background: METHOD_COLOR[f.method] }}
                        />
                        {METHOD_LABEL[f.method]}
                        <span className="text-zinc-400 tabular-nums">
                          ×{f.count}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums text-zinc-800">
                        {formatCurrency(f.total_cents)}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Sólo el efectivo se rinde (spec 151). Sin mozo no hay a
                    quién pedírselo: esa plata la cobró la caja. */}
                {!sinMozo && m.a_rendir_cents > 0 && (
                  <p className="mt-3 flex items-baseline justify-between gap-2 border-t border-zinc-200/70 pt-2.5 text-xs">
                    <span className="font-medium text-zinc-600">
                      Efectivo a rendir
                    </span>
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(m.a_rendir_cents)}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
