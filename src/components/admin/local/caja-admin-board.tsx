"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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

import { IntentLink } from "@/components/ui/intent-link";
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
import { RendicionEnCaja } from "@/components/admin/local/rendicion-en-caja";
import type {
  CajaData,
  RendicionData,
} from "@/app/[business_slug]/admin/(authed)/operacion/data";
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
import type { CuentaConSaldo } from "@/lib/caja/types";
import { TZ_AR } from "@/lib/timezone";

type Props = {
  slug: string;
  cajas: CajaConEstado[];
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
  /** `true` si el panel montó lazy (spec 103): entonces revalida al montar. */
  refetchAlMontar?: boolean;
  /** Spec 103: cada snapshot nuevo del refetch, para el badge de la tab. */
  onServerData?: (d: CajaData) => void;
  /** Issue #339 — mesas con cobro parcial y cuentas cerradas con saldo. */
  cuentasConSaldo?: CuentaConSaldo[];
  /**
   * Spec 153 — el `?caja=` con el que «Ver ahora» abre una caja puntual desde
   * la sección Caja. Viaja como prop desde el server y no por
   * `useSearchParams`: la página ya lee sus searchParams y este panel se monta
   * lazy detrás de un `next/dynamic`, así que el dato explícito es el que
   * llega seguro.
   */
  cajaPedida?: string | null;
  /** #351 — la rendición de mozos se hace acá, en las cards por empleado. */
  rendicion?: RendicionData;
  /** Asignación caja↔usuario: sólo el admin. */
  showAssignments?: boolean;
};

export function CajaAdminBoard({
  slug,
  cajas: initialCajas,
  cuentasConSaldo: initialCuentasConSaldo = [],
  active = true,
  refetchAlMontar = false,
  onServerData,
  cajaPedida,
  rendicion: initialRendicion,
  showAssignments = false,
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
  const [cuentasConSaldo, setCuentasConSaldo] = useState(
    initialCuentasConSaldo,
  );
  // Se reemplaza entero con cada refetch: es plata, y sumar en el cliente es
  // como se duplica una rendición.
  const [rendicion, setRendicion] = useState(initialRendicion);
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
        setCuentasConSaldo(res.data.cuentasConSaldo);
        setRendicion(res.data.rendicion);
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
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Sin cajas configuradas
              </h3>
              <p className="mt-1 text-sm text-foreground/70">
                Creá una caja desde la configuración para empezar a operar.
              </p>
            </div>
            <IntentLink
              href={`/${slug}/admin/caja`}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-95"
              style={{
                background: "var(--brand, #18181B)",
                color: "var(--brand-foreground, white)",
              }}
            >
              <Settings className="size-4" />
              Configurar cajas
            </IntentLink>
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
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Refresco cada 30s
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={resincronizar}
          aria-label="Refrescar"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <CuentasConSaldoAviso slug={slug} cuentas={cuentasConSaldo} />

      <CajaCard
        key={activeCaja.id}
        caja={activeCaja}
        stats={statsByCaja[activeCaja.id] ?? null}
        movimientos={movimientosByCaja[activeCaja.id] ?? []}
        payments={paymentsByCaja[activeCaja.id] ?? []}
        slug={slug}
        onChanged={resincronizar}
        porEmpleado={
          rendicion ? (
            <RendicionEnCaja
              slug={slug}
              payments={paymentsByCaja[activeCaja.id] ?? []}
              pendientes={rendicion.rendicionPendientes}
              historial={rendicion.rendicionHistorial}
              cajas={cajas}
              assignments={rendicion.cajaAssignments}
              members={rendicion.businessMembers}
              showAssignments={showAssignments}
              onChanged={resincronizar}
            />
          ) : null
        }
      />

      <div className="pt-1 text-center">
        <IntentLink
          href={`/${slug}/admin/caja`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <Settings className="size-3" />
          Configurar cajas
        </IntentLink>
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
  porEmpleado,
}: {
  caja: CajaConEstado;
  stats: CajaLiveStats | null;
  movimientos: CajaMovimiento[];
  payments: CajaPayment[];
  slug: string;
  /** Re-sincroniza la tab después de mover plata (spec 103). */
  onChanged: () => void;
  /** #351 — cobrado por empleado + rendición, al pie de la caja. */
  porEmpleado?: React.ReactNode;
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
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              {caja.name}
            </h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-800">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              Activa
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Período activo {periodoLabel}
            {/* Spec 149 · acá decía «· último corte registrado», que anunciaba
                un dato sin mostrarlo ni llevar a ningún lado. Ahora es la
                entrada al cierre archivado. */}
            {caja.ultimo_corte && (
              <>
                <span className="mx-1 text-muted-foreground/50">·</span>
                <IntentLink
                  href={`/${slug}/admin/caja/cierres?caja=${caja.id}`}
                  className="font-medium underline underline-offset-2 transition hover:text-foreground"
                >
                  ver cierres anteriores
                </IntentLink>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => setSangriaOpen(true)}
          >
            <ArrowDownToLine className="size-3.5" /> Sangría
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => setIngresoOpen(true)}
          >
            <ArrowUpFromLine className="size-3.5" /> Ingreso
          </Button>
          <Button type="button" size="lg" onClick={() => setCorteOpen(true)}>
            <Lock className="size-3.5" /> Cerrar caja
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          className="rounded-2xl p-5 ring-1 ring-border/70"
          style={{ background: "var(--brand-soft, #F4F4F5)" }}
        >
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
            En la caja deberías tener
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {cargandoStats ? (
              <span className="inline-block h-8 w-32 animate-pulse rounded-lg bg-primary/10 align-middle" />
            ) : (
              formatCurrency(expected)
            )}
          </p>
          <p className="mt-1 text-xs text-foreground/70">
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
        <div className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Cobrado en el período
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {cargandoStats ? (
              <span className="inline-block h-8 w-32 animate-pulse rounded-lg bg-primary/10 align-middle" />
            ) : (
              formatCurrency(ventas)
            )}
          </p>
          <p className="mt-1 text-xs text-foreground/70">
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
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Cobros por origen
          </p>
          {porOrigen && porOrigenYMetodo && cobros > 0 ? (
            <CobrosPorOrigen
              porOrigen={porOrigen}
              porOrigenYMetodo={porOrigenYMetodo}
            />
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Todavía no hubo cobros.</p>
          )}
        </section>

        <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Movimientos del período
            </p>
            <div className="flex items-baseline gap-2">
              {/* El período es el hot path del turno; el libro (spec 070) es el
                  histórico con filtros, los anulados y la corrección. */}
              <IntentLink
                href={`/${slug}/admin/caja/movimientos?caja=${caja.id}`}
                className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground/90 hover:underline"
              >
                Ver todos
              </IntentLink>
              <p className="text-xs font-semibold tabular-nums text-foreground/80">
                {entries.length}
              </p>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Todavía no hubo movimientos.
            </p>
          ) : (
            <ul className="mt-3 max-h-[28rem] divide-y divide-border/60 overflow-y-auto rounded-lg ring-1 ring-border/70">
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

      {porEmpleado}

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
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li>
      <IntentLink
        href={href}
        className={cn(
          "flex items-start gap-3 px-3 py-2.5 transition hover:bg-muted/50",
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
          <p className="truncate text-sm font-semibold text-foreground">
            {MOVIMIENTO_LABEL[mov.kind]}
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70 tabular-nums">{time}</span>
          </p>
          <p className={cn("shrink-0 text-sm font-bold tabular-nums", sale ? "text-rose-700" : "text-emerald-700")}>
            {sale ? "−" : "+"}
            {formatCurrency(mov.amount_cents)}
          </p>
        </div>
        {mov.reason && <p className="mt-0.5 truncate text-xs text-muted-foreground">{mov.reason}</p>}
      </div>
      </IntentLink>
    </li>
  );
}


function CobroRow({ payment, href }: { payment: CajaPayment; href: string }) {
  const Icon = methodIcon(payment.method);
  const time = new Date(payment.created_at).toLocaleTimeString("es-AR", {
    timeZone: TZ_AR,
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
      <IntentLink
        href={href}
        className="flex items-start gap-3 px-3 py-2.5 transition hover:bg-muted/50"
      >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80">
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {origen}
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70 tabular-nums">{time}</span>
          </p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">
            +{formatCurrency(payment.amount_cents)}
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {METHOD_LABEL[payment.method]}
            {payment.attributed_mozo_name && (
              <><span className="mx-1 text-muted-foreground/50">·</span>{payment.attributed_mozo_name}</>
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
      </IntentLink>
    </li>
  );
}

// ── Modales ──────────────────────────────────────────────────────



// ── Cuentas con saldo pendiente (issue #339) ─────────────────────

/**
 * Lo que la caja todavía no cobró entero. Una mesa con cobro parcial se ve en
 * el salón, pero una cuenta cerrada con saldo —se anularon líneas después de
 * cerrarla— no se ve en ningún lado: la mesa ya está libre. Por eso vive acá,
 * arriba de la caja, que es donde se mira la plata antes de cortar.
 */
export function CuentasConSaldoAviso({
  slug,
  cuentas,
}: {
  slug: string;
  cuentas: CuentaConSaldo[];
}) {
  if (cuentas.length === 0) return null;
  const total = cuentas.reduce((a, c) => a + c.saldoCents, 0);

  return (
    <section
      role="status"
      aria-label="Cuentas con saldo pendiente"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {cuentas.length === 1
            ? "Hay una cuenta con saldo pendiente"
            : `Hay ${cuentas.length} cuentas con saldo pendiente`}
        </h3>
        <span className="text-sm font-bold tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-amber-200">
        {cuentas.map((c) => {
          const nombre = c.tableLabel
            ? `Mesa ${c.tableLabel}`
            : `Pedido #${c.dailyNumber ?? c.orderNumber}`;
          const href =
            !c.cerrada && c.tableId
              ? `/${slug}/admin/mesa/${c.tableId}/cobrar`
              : `/${slug}/admin/pedidos/historial?q=${c.orderNumber}`;
          return (
            <li
              key={c.orderId}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {nombre}
                  {c.cerrada && (
                    <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
                      Cerrada
                    </span>
                  )}
                </p>
                <p className="text-xs text-amber-900/80 tabular-nums">
                  Cobrado {formatCurrency(c.paidCents)} de{" "}
                  {formatCurrency(c.totalCents)} · falta{" "}
                  {formatCurrency(c.saldoCents)}
                </p>
              </div>
              <IntentLink
                href={href}
                className="shrink-0 rounded-full bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-800"
              >
                {c.cerrada ? "Ver pedido" : "Cobrar"}
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
