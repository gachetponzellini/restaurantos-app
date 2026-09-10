import Link from "next/link";
import { ChevronLeft, ScrollText, TriangleAlert } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

import { VentasPorMetodo } from "@/components/admin/local/caja-metricas";
import { CobrosPorOrigen } from "@/components/admin/local/cobros-por-origen";
import { Diferencia } from "@/components/admin/local/cierres-client";
import { ReimprimirCierreBoton } from "@/components/admin/local/reimprimir-cierre-boton";
import { MovimientoRow } from "@/components/admin/local/movimiento-row";
import { duracionDelTurno } from "@/lib/caja/formato-cierre";
import { diaOperativoDe } from "@/lib/caja/rango-fechas";
import type { ResumenDeCorte } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * El resumen archivado de un cierre (spec 149).
 *
 * Se lee en el mismo orden en que se cerró el día: **el veredicto** (esperado,
 * contado, diferencia) · **de dónde salía ese número** · **lo que entró** ·
 * **cómo se contó y qué se retiró** · **quién rindió**.
 */
export function ResumenDeCierre({
  slug,
  timezone,
  resumen,
}: {
  slug: string;
  timezone: string;
  resumen: ResumenDeCorte;
}) {
  const { corte, stats } = resumen;
  const d = stats.desglose_esperado;

  const cerradoEl = formatInTimeZone(
    new Date(corte.created_at),
    timezone,
    "EEEE d/M, HH:mm",
    { locale: es },
  );
  const desdeEl = formatInTimeZone(
    new Date(resumen.periodo_desde),
    timezone,
    "EEEE d/M HH:mm",
    { locale: es },
  );

  // Lo que entró por medios que no tocan el cajón. Es la explicación de por qué
  // el arqueo es mucho más chico que la venta del turno.
  const noEfectivo = stats.total_ventas_cents - d.efectivo_cents;

  const conteo = corte.denomination_count ?? null;
  const denominaciones = conteo
    ? Object.entries(conteo)
        .map(([valor, cantidad]) => ({ valor: Number(valor), cantidad }))
        .filter((d) => d.cantidad > 0)
        .sort((a, b) => b.valor - a.valor)
    : [];

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <Link
          href={`/${slug}/admin/caja/cierres`}
          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} />
          Cierres de caja
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Cierre de caja · {resumen.caja_name}
              {corte.numero != null && (
                <>
                  {" · "}
                  {/* El número es cómo el local nombra este papel por teléfono
                      (spec 139 · D14), así que va donde se lee primero. */}
                  <span className="tabular-nums">Nº {corte.numero}</span>
                </>
              )}
            </p>
            <h1 className="mt-1 text-2xl font-semibold capitalize tracking-tight text-zinc-900 tabular-nums sm:text-3xl">
              {cerradoEl}
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              {resumen.es_primer_corte ? (
                <>
                  {/* Sin corte anterior la ventana arranca en el alta de la
                      caja: son cobros de verdad, pero llamar «turno» a dos
                      meses sería mentir sobre lo que pasó esa noche. */}
                  Primer cierre de esta caja — toma todo lo cobrado desde que se
                  creó, el{" "}
                  <span className="tabular-nums">{desdeEl}</span>
                </>
              ) : (
                <>
                  Turno desde el{" "}
                  <span className="tabular-nums">{desdeEl}</span>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  <span className="tabular-nums">
                    {duracionDelTurno(resumen.periodo_desde, corte.created_at)}
                  </span>
                </>
              )}
              <span className="mx-1.5 text-zinc-300">·</span>
              cerró{" "}
              <span className="font-medium text-zinc-700">
                {resumen.encargado_name ?? "—"}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ReimprimirCierreBoton
              slug={slug}
              corteId={corte.id}
              disponible={corte.resumen != null}
            />
            <Link
              // El libro se abre en el día operativo del cierre (spec 153): es
              // el mismo turno, no la fecha de calendario del corte.
              href={`/${slug}/admin/caja/movimientos?gran=dia&fecha=${diaOperativoDe(new Date(resumen.periodo_desde), timezone)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200/70 transition hover:bg-zinc-50"
            >
              <ScrollText className="size-3.5" />
              Ver en el libro
            </Link>
          </div>
        </div>
      </header>

      {/* ── El veredicto ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-zinc-800 ring-1 ring-zinc-900 sm:grid-cols-3">
        <Veredicto
          label="Efectivo que debía haber"
          value={formatCurrency(corte.expected_cash_cents)}
          hint="Calculado por el sistema"
        />
        <Veredicto
          label="Efectivo contado"
          value={formatCurrency(corte.closing_cash_cents)}
          hint={conteo ? "Conteo por billete" : "Monto declarado"}
        />
        <Veredicto
          label="Diferencia"
          value={`${corte.difference_cents > 0 ? "+" : ""}${formatCurrency(corte.difference_cents)}`}
          hint={
            corte.difference_cents === 0
              ? "Cerró justo"
              : corte.difference_cents < 0
                ? "Faltó plata en el cajón"
                : "Sobró plata en el cajón"
          }
          tono={
            corte.difference_cents === 0
              ? "text-zinc-50"
              : corte.difference_cents < 0
                ? "text-red-300"
                : "text-amber-300"
          }
        />
      </section>

      {/* Sólo cuando hay brecha: el número grande se lee como si faltara plata
          en un turno que vendió cuatro veces más, porque el resto se cobró con
          tarjeta y nunca entró al cajón. Sin brecha no hay nada que explicar —
          y decirlo igual confunde en un turno donde el esperado SUPERA a la
          venta por un ingreso, que es el otro caso real que hay en la base. */}
      {noEfectivo > 0 && (
        <p className="-mt-4 text-sm leading-relaxed text-zinc-600">
          El turno vendió{" "}
          <span className="font-semibold tabular-nums text-zinc-900">
            {formatCurrency(stats.total_ventas_cents)}
          </span>
          , pero al cajón sólo entraron los{" "}
          <span className="font-semibold tabular-nums text-zinc-900">
            {formatCurrency(d.efectivo_cents)}
          </span>{" "}
          cobrados en efectivo: los otros{" "}
          <span className="tabular-nums">{formatCurrency(noEfectivo)}</span> se
          cobraron con tarjeta, QR o transferencia.
        </p>
      )}

      {/* ── De dónde salía ese número ────────────────────────── */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          De dónde salían los {formatCurrency(corte.expected_cash_cents)}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          La cuenta del efectivo esperado
        </h2>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto_minmax(0,1fr)]">
          <Sumando
            label="Apertura"
            cents={d.apertura_cents}
            hint={
              d.retiro_cierre_cents > 0
                ? "El cierre anterior retiró todo"
                : "Quedó del turno anterior"
            }
          />
          <Sumando
            label="+ Efectivo cobrado"
            cents={d.efectivo_cents}
            hint="Con propinas"
          />
          <Sumando label="+ Ingresos" cents={d.ingresos_cents} />
          <Sumando label="− Sangrías" cents={d.sangrias_cents} />
          {/* Spec 177 — sólo aparece si hubo: en un local que todavía no paga
              propinas por el sistema, un renglón en $0 es ruido. */}
          {d.propinas_pagadas_cents > 0 && (
            <Sumando
              label="− Propinas pagadas"
              cents={d.propinas_pagadas_cents}
              hint="A los mozos, en la rendición"
            />
          )}
          <span className="hidden items-center justify-center text-xl font-semibold text-zinc-400 lg:flex">
            =
          </span>
          <Sumando
            label="Esperado"
            cents={corte.expected_cash_cents}
            hint="Lo que debía estar en el cajón"
            destacado
          />
        </div>
      </section>

      {/* ── Lo que entró ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Lo que entró en el turno
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            Cobros por origen
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Mini label="Ventas" value={formatCurrency(stats.total_ventas_cents)} />
            <Mini
              label="Propinas"
              value={formatCurrency(stats.total_propinas_cents)}
              tono="text-emerald-700"
            />
            <Mini label="Cobros" value={String(stats.cobros_count)} />
          </div>
          <CobrosPorOrigen
            porOrigen={stats.ventas_por_origen}
            porOrigenYMetodo={stats.ventas_por_origen_y_metodo}
          />
        </div>

        <div className="space-y-4">
          <VentasPorMetodo porMetodo={stats.ventas_por_metodo} />

          <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Movimientos del período
            </p>
            {resumen.movimientos.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">
                No hubo sangrías ni ingresos en este turno.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100">
                {resumen.movimientos.map((m) => (
                  <MovimientoRow key={m.id} movimiento={m} timezone={timezone} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Cómo se contó y qué se retiró ────────────────────── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Cómo se contó
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            {denominaciones.length > 0 ? "Conteo por billete" : "Monto declarado"}
          </h2>
          {denominaciones.length > 0 ? (
            <>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {denominaciones.map(({ valor, cantidad }) => (
                  <div
                    key={valor}
                    className="flex items-baseline justify-between gap-2 rounded-xl bg-zinc-50 px-3.5 py-2.5 ring-1 ring-zinc-200/70"
                  >
                    <span className="text-sm font-medium tabular-nums text-zinc-700">
                      {formatCurrency(valor * 100)}
                    </span>
                    <span className="text-xs tabular-nums text-zinc-400">
                      × {cantidad}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(valor * cantidad * 100)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-zinc-100 pt-3">
                <span className="text-sm font-medium text-zinc-600">
                  Total contado
                </span>
                <span className="text-xl font-bold tracking-tight text-zinc-900 tabular-nums">
                  {formatCurrency(corte.closing_cash_cents)}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              Este cierre se registró con el monto total, sin desglosar por
              billete.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              El retiro
            </p>
            {resumen.retiro_cents === null ? (
              <>
                <p className="mt-2 text-lg font-semibold tracking-tight text-zinc-500">
                  No se pudo determinar
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                  Este cierre no dejó atado su retiro. Puede haberse retirado o
                  no: la línea está en el libro, pero sin el rótulo que la une a
                  este corte.
                </p>
              </>
            ) : resumen.retiro_cents === 0 ? (
              <>
                <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
                  {formatCurrency(0)}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                  Se hizo el arqueo sin vaciar el cajón: la plata siguió adentro
                  para el turno siguiente.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
                  {formatCurrency(resumen.retiro_cents)}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                  Se sacó del cajón lo contado. La caja arrancó el turno
                  siguiente en{" "}
                  <span className="font-semibold tabular-nums text-zinc-900">
                    {formatCurrency(
                      corte.closing_cash_cents - resumen.retiro_cents,
                    )}
                  </span>
                  .
                </p>
              </>
            )}
          </div>

          {corte.closing_notes ? (
            <div className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200">
              <p className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-800">
                <TriangleAlert className="size-3.5" />
                Nota del cierre
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-amber-900">
                {corte.closing_notes}
              </p>
              {corte.difference_cents !== 0 && (
                <p className="mt-3 border-t border-amber-200 pt-2.5 text-xs text-amber-700">
                  Obligatoria porque hubo diferencia
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Rendiciones ──────────────────────────────────────── */}
      {resumen.barre_salon && (
        <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Antes de cerrar
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
                Rendiciones del turno
              </h2>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-600">
                Al mozo se le pide{" "}
                <span className="font-semibold text-zinc-900">
                  sólo el efectivo
                </span>
                . Lo que cobró con tarjeta, QR o transferencia entró por otro
                lado y no se le rinde.
              </p>
            </div>
            {resumen.rendiciones.length > 0 && (
              <p className="text-sm tabular-nums text-zinc-600">
                {resumen.rendiciones.length} mozo
                {resumen.rendiciones.length === 1 ? "" : "s"} ·{" "}
                {formatCurrency(
                  resumen.rendiciones.reduce(
                    (acc, r) => acc + r.expected_cash_cents,
                    0,
                  ),
                )}{" "}
                en efectivo
              </p>
            )}
          </div>

          {resumen.rendiciones.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No se registraron rendiciones en este turno.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl ring-1 ring-zinc-200/70">
              {resumen.rendiciones.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-2 items-center gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]"
                >
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {r.mozo_name}
                  </p>
                  <Celda label="Efectivo esperado" cents={r.expected_cash_cents} tenue />
                  <Celda label="Entregó" cents={r.delivered_cash_cents} />
                  <div className="hidden justify-end sm:flex">
                    <Diferencia cents={r.difference_cents} />
                  </div>
                  <div className="flex justify-end">
                    {r.estado === "no_entrego" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                        <span className="size-1.5 rounded-full bg-red-500" />
                        No entregó
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Rindió
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {resumen.rendiciones.some((r) => r.estado === "no_entrego") && (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              «No entregó» es una deuda declarada, no una rendición en $0: queda
              anotada contra el mozo.
            </p>
          )}
        </section>
      )}

      <p className="text-xs leading-relaxed text-zinc-500">
        El arqueo —esperado, contado, diferencia y conteo— quedó congelado al
        cerrar. El resto de los números se reconstruye de los cobros y
        movimientos del turno, así que una corrección posterior en el libro
        también se ve acá.
      </p>
    </div>
  );
}

function Veredicto({
  label,
  value,
  hint,
  tono = "text-zinc-50",
}: {
  label: string;
  value: string;
  hint: string;
  tono?: string;
}) {
  return (
    <div className="bg-zinc-900 p-6">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </p>
      <p className={`mt-1.5 text-3xl font-bold tracking-tight tabular-nums ${tono}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}

function Sumando({
  label,
  cents,
  hint,
  destacado = false,
}: {
  label: string;
  cents: number;
  hint?: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3.5 ring-1",
        destacado ? "ring-zinc-300" : "bg-zinc-50 ring-zinc-200/70",
      )}
      // El total lleva el color del negocio, como la tarjeta de caja viva.
      style={destacado ? { background: "var(--brand-soft, #F4F4F5)" } : undefined}
    >
      <p className="text-xs font-medium text-zinc-600">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight text-zinc-900 tabular-nums">
        {formatCurrency(cents)}
      </p>
      {hint ? <p className="mt-0.5 text-[0.7rem] text-zinc-400">{hint}</p> : null}
    </div>
  );
}

function Mini({
  label,
  value,
  tono = "text-zinc-900",
}: {
  label: string;
  value: string;
  tono?: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-50 p-3.5 ring-1 ring-zinc-200/70">
      <p className="text-xs font-medium text-zinc-600">{label}</p>
      <p className={`mt-1 text-xl font-bold tracking-tight tabular-nums ${tono}`}>
        {value}
      </p>
    </div>
  );
}

function Celda({
  label,
  cents,
  tenue = false,
}: {
  label: string;
  cents: number;
  tenue?: boolean;
}) {
  return (
    <p
      className={`hidden text-right text-sm tabular-nums sm:block ${
        tenue ? "text-zinc-600" : "font-semibold text-zinc-900"
      }`}
    >
      <span className="sr-only">{label}: </span>
      {formatCurrency(cents)}
    </p>
  );
}
