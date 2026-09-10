"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  Lock,
  User,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { VentasPorMetodo } from "@/components/admin/local/caja-metricas";
import { CobrosPorOrigen } from "@/components/admin/local/cobros-por-origen";
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
import { getCierreCajaTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { cerrarCaja, registrarRendicionMozo } from "@/lib/caja/actions";
import type { CierreCajaData } from "@/lib/caja/queries";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Cerrar la caja: un botón (spec 130).
 *
 * Reemplaza al modal de «Hacer corte», que mostraba sólo el efectivo esperado
 * — y por eso el cierre se decidía mirando una pantalla y se entendía mirando
 * otra: lo cobrado por método, el delivery, las propinas y quién no rindió
 * estaban afuera, en el board.
 *
 * Tres bloques, en el orden en que se cierra el día: **la plata** que entró ·
 * **quién la tiene** (y se rinde desde acá) · **contar y cerrar**, con el
 * retiro como una casilla en vez de una sangría tipeada a mano.
 */
export function CerrarCajaModal({
  open,
  onOpenChange,
  slug,
  cajaId,
  cajaName,
  onCerrada,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  cajaId: string;
  cajaName: string;
  onCerrada: () => void;
}) {
  const [data, setData] = useState<CierreCajaData | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [retirar, setRetirar] = useState(true);
  const [conteoAbierto, setConteoAbierto] = useState(false);
  const [conteo, setConteo] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    const res = await getCierreCajaTabData(slug, cajaId);
    if (res.ok) setData(res.data);
    else setErrorCarga(res.error);
    setCargando(false);
  }, [slug, cajaId]);

  useEffect(() => {
    if (!open) {
      setClosing("");
      setNotes("");
      setRetirar(true);
      setConteo({});
      setConteoAbierto(false);
      setData(null);
      return;
    }
    void cargar();
  }, [open, cargar]);

  // El conteo por billete manda sobre el campo libre mientras esté abierto:
  // `denomination_count` existe desde el día 1 y la UI nunca la escribió (D10).
  const totalConteo = DENOMINACIONES.reduce(
    (acc, d) => acc + d * (Number(conteo[String(d)]) || 0),
    0,
  );
  const usandoConteo = conteoAbierto && totalConteo > 0;
  const cents = usandoConteo
    ? totalConteo * 100
    : closing === ""
      ? null
      : Math.max(0, Math.round(Number(closing) * 100));

  const stats = data?.stats;
  // Spec 177 · Parte C — el cierre retira lo CONTADO menos el fondo, y nunca
  // menos de $0: una noche floja puede cerrar por debajo del fondo, y ahí no se
  // retira nada en vez de inventar una sangría negativa. Es la misma cuenta que
  // hace `cerrar_caja_tx`; acá es para que el encargado vea lo que va a sacar.
  const fondo = data?.fondo_fijo_cents ?? 0;
  const aRetirar = Math.max(0, (cents ?? 0) - fondo);
  const expected = stats?.expected_cash_cents ?? 0;
  const diff = cents === null ? 0 : cents - expected;
  const requiresNotes = cents !== null && diff !== 0;
  const faltanRendir = data?.deben_rendir ?? [];
  // Spec 139 · D1 — cerrar el día dejando a un mozo sin resolver deja plata
  // flotando en una columna que mañana ya no se mira. Resolver puede ser
  // «rindió» o «no entregó», pero no «lo salteo».
  const bloqueado =
    (data?.cuentas_abiertas.length ?? 0) > 0 || faltanRendir.length > 0;
  const puedeCerrar =
    !!data &&
    !bloqueado &&
    cents !== null &&
    !(requiresNotes && notes.trim() === "") &&
    !enviando;

  const denomCount = (): Record<string, number> | null => {
    const entries = DENOMINACIONES.map((d) => [
      String(d),
      Number(conteo[String(d)]) || 0,
    ] as const).filter(([, n]) => n > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  };

  const submit = () => {
    if (cents === null) return;
    startTransition(async () => {
      const r = await cerrarCaja({
        cajaId,
        closing_cash_cents: cents,
        closing_notes: notes.trim() || null,
        denomination_count: denomCount(),
        retirar,
        businessSlug: slug,
      });
      if (!r.ok) {
        toast.error(r.error);
        // Puede haber cambiado el salón mientras el modal estaba abierto: se
        // recarga para que la lista de mesas diga la verdad de ahora.
        void cargar();
        return;
      }
      const partes = [
        r.data.retiro_cents > 0
          ? `retiraste ${formatCurrency(r.data.retiro_cents)}`
          : "sin retiro",
      ];
      if (r.data.mesasLiberadas > 0) {
        partes.push(`${r.data.mesasLiberadas} mesas liberadas`);
      }
      toast.success(`Caja cerrada — ${partes.join(" · ")}.`);
      onOpenChange(false);
      onCerrada();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Cerrar caja
            <span className="ml-2 text-sm font-normal text-zinc-500">
              · {cajaName}
            </span>
          </DialogTitle>
        </DialogHeader>

        {cargando && !data && (
          <div className="space-y-3 py-6">
            <div className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-32 animate-pulse rounded-2xl bg-zinc-100" />
          </div>
        )}

        {errorCarga && (
          <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
            {errorCarga}
          </p>
        )}

        {data && stats && (
          <div className="space-y-5">
            {/* ── 1 · La plata del período ───────────────────────── */}
            <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                La plata del período
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-zinc-900">
                {formatCurrency(stats.total_ventas_cents)}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {stats.cobros_count}{" "}
                {stats.cobros_count === 1 ? "cobro" : "cobros"}
                {/* La propina no está adentro de ese número: es plata del mozo
                    que pasó por la caja, no una venta del local (spec 098). */}
                {stats.total_propinas_cents > 0 &&
                  ` · más ${formatCurrency(stats.total_propinas_cents)} de propina`}
              </p>

              {stats.cobros_count > 0 && (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <VentasPorMetodo porMetodo={stats.ventas_por_metodo} />
                  <div>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Por origen
                    </p>
                    <CobrosPorOrigen
                      porOrigen={stats.ventas_por_origen}
                      porOrigenYMetodo={stats.ventas_por_origen_y_metodo}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* ── 2 · Quién la tiene ─────────────────────────────── */}
            <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Quién tiene el efectivo
                </p>
                <p className="text-sm font-semibold tabular-nums text-zinc-900">
                  {formatCurrency(expected)}
                </p>
              </div>

              <ul className="mt-3 divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-200/70">
                <li className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 text-sm text-zinc-700">
                    <Wallet className="size-3.5 text-zinc-400" />
                    <span className="font-medium">En el cajón</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900">
                    {formatCurrency(data.reparto.en_cajon_cents)}
                  </span>
                </li>
                {/* Spec 139 · D4 — la lista sale de `deben_rendir` y no del
                    reparto: el que cobró toda la noche con tarjeta tiene $0 de
                    efectivo y también tiene que cerrar su período. */}
                {faltanRendir.map((m) => (
                  <MozoPendienteRow
                    key={m.mozo_id}
                    mozoId={m.mozo_id}
                    nombre={m.mozo_name}
                    efectivoCents={m.efectivo_cents}
                    ticketsCents={m.tickets_cents}
                    slug={slug}
                    onRendido={cargar}
                  />
                ))}
              </ul>

              {data.reparto.descuadre_cents > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Hay {formatCurrency(data.reparto.descuadre_cents)} sin rendir
                  que ya no están esperados en la caja — probablemente se
                  sangraron antes de que el mozo entregara.
                </p>
              )}

              <p className="mt-2 text-xs text-zinc-500">
                Rendir no cambia el total: pasa la plata de la columna del mozo
                a la del cajón.
              </p>

              {faltanRendir.length > 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                  <span className="font-semibold">
                    {faltanRendir.length === 1
                      ? "Falta 1 rendición para poder cerrar."
                      : `Faltan ${faltanRendir.length} rendiciones para poder cerrar.`}
                  </span>{" "}
                  Si alguien ya se fue, marcá «No entregó» con el motivo: queda
                  como deuda a la vista, no como un número inventado.
                </p>
              )}

              {data.sin_operadores && (
                <p className="mt-2 text-xs text-zinc-500">
                  Nadie figura como operador de esta caja, así que todos los que
                  cobraron tienen que rendir —{" "}
                  <Link
                    href={`/${slug}/admin/operacion?tab=cajas`}
                    className="font-semibold underline underline-offset-2"
                    onClick={() => onOpenChange(false)}
                  >
                    asigná la caja
                  </Link>{" "}
                  a quien la atiende y deja de aparecer en esta lista.
                </p>
              )}

              {bloqueado && (
                <div className="mt-4 rounded-xl bg-rose-50 p-4 ring-1 ring-rose-200">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-rose-900">
                    <AlertTriangle className="size-4" />
                    {data.cuentas_abiertas.length === 1
                      ? "Hay una mesa con la cuenta abierta"
                      : `Hay ${data.cuentas_abiertas.length} mesas con la cuenta abierta`}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {data.cuentas_abiertas.map((c) => (
                      <li
                        key={c.order_id}
                        className="flex items-baseline justify-between gap-3 text-sm text-rose-900"
                      >
                        <span>
                          Mesa {c.table_label}
                          {c.mozo_name && (
                            <span className="text-rose-700"> · {c.mozo_name}</span>
                          )}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(c.pendiente_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/${slug}/admin/operacion?tab=salon`}
                    className="mt-3 inline-flex text-xs font-semibold text-rose-900 underline underline-offset-2"
                    onClick={() => onOpenChange(false)}
                  >
                    Ir al salón a cobrarlas
                  </Link>
                </div>
              )}

              {data.pedidos_abiertos.length > 0 && (
                <p className="mt-3 text-xs text-zinc-600">
                  {data.pedidos_abiertos.length === 1
                    ? "Queda 1 pedido de delivery / take away abierto"
                    : `Quedan ${data.pedidos_abiertos.length} pedidos de delivery / take away abiertos`}
                  . No frenan el cierre: si se cobran después, entran en el
                  período nuevo.
                </p>
              )}
            </section>

            {/* ── 3 · Contar y cerrar ────────────────────────────── */}
            <section className="rounded-2xl bg-zinc-50 p-5 ring-1 ring-zinc-200/70">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Contar y cerrar
              </p>

              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="cierre-contado" className="text-sm font-medium">
                  Efectivo contado en el cajón
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-zinc-400">
                    $
                  </span>
                  <Input
                    id="cierre-contado"
                    type="number"
                    value={usandoConteo ? String(totalConteo) : closing}
                    onChange={(e) => setClosing(e.target.value)}
                    disabled={usandoConteo}
                    placeholder="0"
                    autoFocus
                    inputMode="decimal"
                    className="pl-7 text-base tabular-nums"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setConteoAbierto((v) => !v)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition",
                    conteoAbierto && "rotate-180",
                  )}
                />
                Contar por billete (opcional)
              </button>

              {conteoAbierto && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {DENOMINACIONES.map((d) => (
                    <label key={d} className="grid gap-1">
                      <span className="text-[0.7rem] font-semibold text-zinc-500">
                        {formatCurrency(d * 100)}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        value={conteo[String(d)] ?? ""}
                        onChange={(e) =>
                          setConteo((c) => ({ ...c, [String(d)]: e.target.value }))
                        }
                        placeholder="0"
                        inputMode="numeric"
                        className="tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              )}

              {cents !== null && diff !== 0 && (
                <div
                  className={cn(
                    "mt-4 flex items-center justify-between rounded-lg p-3 ring-1",
                    diff < 0
                      ? "bg-rose-50 text-rose-900 ring-rose-200"
                      : "bg-amber-50 text-amber-900 ring-amber-200",
                  )}
                >
                  <span className="text-sm font-semibold">
                    {diff < 0 ? "Te falta" : "Te sobra"}
                  </span>
                  <span className="text-lg font-bold tabular-nums">
                    {diff > 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(diff))}
                  </span>
                </div>
              )}

              {cents !== null && diff === 0 && (
                <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200">
                  <span className="text-sm font-semibold">Cuadra perfecto</span>
                  <Banknote className="size-4" />
                </div>
              )}

              {requiresNotes && (
                <div className="mt-3 grid gap-1.5">
                  <Label htmlFor="cierre-motivo" className="text-sm font-medium">
                    ¿Qué pasó?<span className="ml-1 text-rose-600">*</span>
                  </Label>
                  <Textarea
                    id="cierre-motivo"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Vuelto mal dado, billete falso, propina mal cargada…"
                  />
                </div>
              )}

              {/* D2 de la spec 130 decía «se retira todo o nada, sin fondo de
                  cambio configurable: es una decisión menos a la 1 de la
                  mañana». La spec 177 · Parte C lo revierte sin perder ese
                  argumento: el fondo está CONFIGURADO, así que acá no hay nada
                  que decidir — el cierre lo aplica solo y el cartel lo dice. */}
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-zinc-200">
                <input
                  type="checkbox"
                  checked={retirar}
                  onChange={(e) => setRetirar(e.target.checked)}
                  className="mt-0.5 size-4 accent-zinc-900"
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-900">
                    {fondo > 0 ? "Retirar el efectivo" : "Retirar todo el efectivo"}
                    {cents !== null && cents > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        — {formatCurrency(aRetirar)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-600">
                    {!retirar
                      ? "La caja queda con lo contado — es el arqueo de mitad de turno."
                      : fondo > 0
                        ? `Se registra como sangría del cierre y quedan ${formatCurrency(Math.min(fondo, cents ?? 0))} de fondo para el próximo turno.`
                        : "Se registra como sangría del cierre y la caja arranca en $0."}
                  </span>
                </span>
              </label>

              {data.barre_salon &&
                (data.salon.mesas_a_liberar > 0 ||
                  data.salon.mozos_asignados > 0) && (
                  <p className="mt-3 text-xs text-zinc-600">
                    Al cerrar:{" "}
                    {data.salon.mesas_a_liberar > 0 && (
                      <>
                        se{" "}
                        {data.salon.mesas_a_liberar === 1
                          ? "libera 1 mesa"
                          : `liberan ${data.salon.mesas_a_liberar} mesas`}
                      </>
                    )}
                    {data.salon.mesas_a_liberar > 0 &&
                      data.salon.mozos_asignados > 0 &&
                      " y "}
                    {data.salon.mozos_asignados > 0 && (
                      <>
                        se limpia la distribución de{" "}
                        {data.salon.mozos_asignados === 1
                          ? "1 mozo"
                          : `${data.salon.mozos_asignados} mozos`}
                      </>
                    )}
                    .
                  </p>
                )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!puedeCerrar} onClick={submit}>
            <Lock className="mr-2 size-4" />
            {retirar && cents !== null && cents > 0
              ? `Cerrar caja y retirar ${formatCurrency(cents)}`
              : "Cerrar caja sin retirar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Billetes en circulación, del más grande al más chico. En pesos, no centavos. */
const DENOMINACIONES = [20_000, 10_000, 2_000, 1_000, 500, 200, 100, 50];

/**
 * Un mozo que todavía no rindió, con su monto a la vista y dos salidas (spec
 * 139 · D1, D2).
 *
 * Se rinde desde acá para que el cierre sea un solo flujo —rendís, contás,
 * retirás— en vez de mandar al encargado a otra tab y volver. Y ahora **frena**
 * el cierre: hasta que cada uno esté resuelto, el botón de cerrar está apagado.
 *
 * Las dos salidas son «rindió» (con el monto tipeado, D2) y «no entregó» (con
 * el motivo, D1). La segunda existe para que la obligación no termine
 * inventando una rendición que cuadre cuando el mozo ya se fue.
 */
function MozoPendienteRow({
  mozoId,
  nombre,
  efectivoCents,
  ticketsCents,
  slug,
  onRendido,
}: {
  mozoId: string;
  nombre: string;
  efectivoCents: number;
  ticketsCents: number;
  slug: string;
  onRendido: () => void;
}) {
  const [modo, setModo] = useState<null | "rendir" | "no_entrego">(null);
  const [entregado, setEntregado] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, startTransition] = useTransition();

  // D2 · sin precarga. Antes, el campo vacío rendía el esperado exacto: apretar
  // el botón sin tocar nada daba siempre diferencia $0, y una conciliación que
  // se autocompleta no concilia.
  const cents =
    entregado === "" ? null : Math.max(0, Math.round(Number(entregado) * 100));
  const diff = cents === null ? 0 : cents - efectivoCents;
  const faltaMotivo = notas.trim() === "";

  const abrir = (m: "rendir" | "no_entrego") => {
    setModo((actual) => (actual === m ? null : m));
    setEntregado("");
    setNotas("");
  };

  const registrar = (estado: "rendida" | "no_entrego") => {
    const monto = estado === "no_entrego" ? 0 : (cents ?? 0);
    startTransition(async () => {
      const r = await registrarRendicionMozo(
        mozoId,
        monto,
        notas.trim() || null,
        slug,
        estado,
      );
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        estado === "no_entrego"
          ? `${nombre} quedó como «no entregó»`
          : `${nombre} rindió ${formatCurrency(monto)}`,
      );
      setModo(null);
      onRendido();
    });
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-zinc-700">
          <User className="size-3.5 shrink-0 text-zinc-400" />
          <span className="truncate font-medium">{nombre}</span>
          <span className="shrink-0 text-xs text-zinc-500">· sin rendir</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-right">
            <span className="block text-sm font-semibold tabular-nums text-zinc-900">
              {formatCurrency(efectivoCents)}
            </span>
            {/* El que cobró todo con tarjeta rinde $0 de efectivo, pero rinde:
                cierra su período y entrega los tickets (D4). */}
            {efectivoCents === 0 && ticketsCents > 0 && (
              <span className="block text-[0.7rem] text-zinc-500">
                sólo tickets
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => abrir("rendir")}
            className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            {modo === "rendir" ? "Cancelar" : "Rendir"}
          </button>
          <button
            type="button"
            onClick={() => abrir("no_entrego")}
            className="rounded-full px-2 py-1 text-xs font-semibold text-zinc-500 underline underline-offset-2 transition hover:text-rose-700"
          >
            {modo === "no_entrego" ? "Cancelar" : "No entregó"}
          </button>
        </span>
      </div>

      {modo === "rendir" && (
        <div className="mt-2 grid gap-2 rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
          <Label htmlFor={`rendir-${mozoId}`} className="text-xs font-medium">
            Efectivo que entrega
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-400">
              $
            </span>
            <Input
              id={`rendir-${mozoId}`}
              type="number"
              value={entregado}
              onChange={(e) => setEntregado(e.target.value)}
              placeholder="0"
              autoFocus
              inputMode="decimal"
              className="pl-7 tabular-nums"
            />
          </div>
          {cents !== null && diff !== 0 && (
            <>
              <p
                className={cn(
                  "text-xs font-semibold",
                  diff < 0 ? "text-rose-700" : "text-amber-700",
                )}
              >
                {diff < 0 ? "Entrega de menos" : "Entrega de más"}{" "}
                {formatCurrency(Math.abs(diff))} — registrá el motivo.
              </p>
              <Textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                placeholder="Se quedó con la propina, adelanto, vuelto…"
              />
            </>
          )}
          <Button
            size="sm"
            disabled={
              enviando || cents === null || (diff !== 0 && faltaMotivo)
            }
            onClick={() => registrar("rendida")}
          >
            Registrar rendición
          </Button>
        </div>
      )}

      {modo === "no_entrego" && (
        <div className="mt-2 grid gap-2 rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="text-xs text-rose-900">
            Queda como deuda de {nombre} por{" "}
            <span className="font-semibold tabular-nums">
              {formatCurrency(efectivoCents)}
            </span>
            , a la vista en el cierre y avisada al dueño.
          </p>
          <Label htmlFor={`no-entrego-${mozoId}`} className="text-xs font-medium">
            ¿Por qué?<span className="ml-1 text-rose-600">*</span>
          </Label>
          <Textarea
            id={`no-entrego-${mozoId}`}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Se fue temprano, rinde mañana…"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={enviando || faltaMotivo}
            onClick={() => registrar("no_entrego")}
          >
            Marcar como no entregó
          </Button>
        </div>
      )}
    </li>
  );
}
