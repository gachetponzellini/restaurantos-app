"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CreditCard,
  History,
  Link2,
  FileText,
  Ban,
  Lock,
  MoreHorizontal,
  QrCode,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  anularLineaDeCobro,
  corregirCobro,
  corregirMovimiento,
  verCorrecciones,
  type CorreccionLogConNombres,
} from "@/lib/caja/correccion-actions";
import type { LibroEntry, LibroTotales, PaymentMethod } from "@/lib/caja/types";
import { formatInvoiceNumber, tipoLabel } from "@/lib/afip/format";
import type { TipoComprobante } from "@/lib/afip/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
  cuenta_corriente: "Cuenta corriente",
};

const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card_manual", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "other", label: "Otro" },
];

const SIN_MOZO = "__sin_mozo__";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function inputToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

const CAMPO_LABEL: Record<string, string> = {
  method: "Método",
  amount_cents: "Monto",
  tip_cents: "Propina",
  attributed_mozo_id: "Mozo",
  caja_id: "Caja",
  last_four: "Últimos 4",
  card_brand: "Tarjeta",
  notes: "Nota",
  cancelled: "Estado",
};

function iconoDe(entry: LibroEntry) {
  if (entry.tipo === "sangria") return ArrowDownToLine;
  // Spec 177 — la propina también sale del cajón: misma flecha que la sangría,
  // color distinto (es del personal, no del dueño).
  if (entry.tipo === "propina") return ArrowDownToLine;
  if (entry.tipo === "ingreso") return ArrowUpFromLine;
  switch (entry.method) {
    case "cash":
      return Banknote;
    case "mp_qr":
      return QrCode;
    case "mp_link":
      return Link2;
    case "card_manual":
      return CreditCard;
    case "transfer":
      return Wallet;
    default:
      return MoreHorizontal;
  }
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Traduce un renglón de auditoría a algo que se lea: los montos vienen en
 * centavos y los mozos/cajas como id (el log guarda el dato exacto).
 */
function valorLegible(
  campo: string,
  raw: string | null,
  label: string | null,
): string {
  if (raw === null) return "—";
  if (campo === "amount_cents" || campo === "tip_cents") {
    return formatCurrency(Number(raw));
  }
  if (campo === "method") return METHOD_LABEL[raw as PaymentMethod] ?? raw;
  if (campo === "attributed_mozo_id" || campo === "caja_id") return label ?? raw;
  return raw;
}

type FiltrosUI = {
  /** El período lo maneja `FiltroFechas` (spec 153); acá sólo viaja para conservarlo. */
  gran: string;
  fecha: string;
  caja: string;
  tipo: string;
  metodo: string;
  mozo: string;
  q: string;
};

type Props = {
  slug: string;
  cajas: { id: string; name: string }[];
  mozos: { id: string; name: string }[];
  entries: LibroEntry[];
  totales: LibroTotales;
  truncado: boolean;
  filtros: FiltrosUI;
  puedeCorregir: boolean;
  esAdmin: boolean;
};

export function LibroClient({
  slug,
  cajas,
  mozos,
  entries,
  totales,
  truncado,
  filtros,
  puedeCorregir,
  esAdmin,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [detalle, setDetalle] = useState<LibroEntry | null>(null);

  function aplicar(patch: Partial<FiltrosUI>) {
    const next = { ...filtros, ...patch };
    const params = new URLSearchParams();
    params.set("gran", next.gran);
    params.set("fecha", next.fecha);
    if (next.caja) params.set("caja", next.caja);
    if (next.tipo) params.set("tipo", next.tipo);
    if (next.metodo) params.set("metodo", next.metodo);
    if (next.mozo) params.set("mozo", next.mozo);
    if (next.q) params.set("q", next.q);
    startTransition(() => {
      router.push(`/${slug}/admin/caja/movimientos?${params.toString()}`);
    });
  }

  const selectClass =
    "h-10 rounded-lg border border-zinc-200 bg-white px-2.5 text-base text-zinc-800";

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Caja</Label>
          <select
            className={selectClass}
            value={filtros.caja}
            onChange={(e) => aplicar({ caja: e.target.value })}
          >
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Tipo</Label>
          <select
            className={selectClass}
            value={filtros.tipo}
            onChange={(e) => aplicar({ tipo: e.target.value })}
          >
            <option value="">Todo</option>
            <option value="cobro">Cobros</option>
            <option value="sangria">Sangrías</option>
            <option value="ingreso">Ingresos</option>
            <option value="propina">Propinas pagadas</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Método</Label>
          <select
            className={selectClass}
            value={filtros.metodo}
            onChange={(e) => aplicar({ metodo: e.target.value })}
          >
            <option value="">Todos</option>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-500">Mozo</Label>
          <select
            className={selectClass}
            value={filtros.mozo}
            onChange={(e) => aplicar({ mozo: e.target.value })}
          >
            <option value="">Todos</option>
            {mozos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid flex-1 gap-1">
          <Label className="text-xs text-zinc-500">Buscar</Label>
          <Input
            defaultValue={filtros.q}
            placeholder="Mesa, cliente o # de orden"
            className="h-10 text-base"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                aplicar({ q: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Totalizador
          label="Cobrado"
          value={formatCurrency(totales.cobrado_cents)}
          hint={`${totales.cobros_count} ${totales.cobros_count === 1 ? "cobro" : "cobros"}`}
        />
        <Totalizador
          label="Propinas"
          value={formatCurrency(totales.propinas_cents)}
          hint="dentro de lo cobrado"
        />
        <Totalizador
          label="Ingresos"
          value={formatCurrency(totales.ingresos_cents)}
          hint="a la caja"
        />
        <Totalizador
          label="Sangrías"
          value={formatCurrency(totales.sangrias_cents)}
          hint="fuera de la caja"
        />
        {/* Spec 177 — sólo si hubo: en un local que todavía no paga propinas
            por el sistema, un totalizador en $0 es una columna vacía. */}
        {totales.propinas_pagadas_cents > 0 && (
          <Totalizador
            label="Propinas pagadas"
            value={formatCurrency(totales.propinas_pagadas_cents)}
            hint="a los mozos"
          />
        )}
      </div>

      {truncado && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          El rango tiene más movimientos de los que entran en una pantalla: se
          muestran los más recientes. Acotá las fechas para verlos todos.
        </p>
      )}

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
        {entries.length === 0 ? (
          <p className="p-10 text-center text-base text-zinc-500">
            No hubo movimientos en este período.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {entries.map((e) => {
              const Icon = iconoDe(e);
              const esSangria = e.tipo === "sangria" || e.tipo === "propina";
              return (
                <li key={`${e.tipo}-${e.id}`}>
                  <button
                    type="button"
                    onClick={() => setDetalle(e)}
                    className="flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-zinc-50"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
                        e.anulado
                          ? "bg-zinc-100 text-zinc-400"
                          : e.tipo === "propina"
                            ? "bg-amber-50 text-amber-700"
                            : esSangria
                              ? "bg-rose-50 text-rose-700"
                              : e.tipo === "ingreso"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-zinc-100 text-zinc-700",
                      )}
                    >
                      <Icon className="size-4.5" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-base font-semibold text-zinc-900",
                            e.anulado && "text-zinc-400 line-through",
                          )}
                        >
                          {e.descripcion}
                          <span className="ml-2 text-xs font-normal tabular-nums text-zinc-400">
                            {fecha(e.created_at)} {hora(e.created_at)}
                          </span>
                        </p>
                        <p
                          className={cn(
                            "shrink-0 text-base font-bold tabular-nums",
                            e.anulado
                              ? "text-zinc-400 line-through"
                              : esSangria
                                ? "text-rose-700"
                                : "text-zinc-900",
                          )}
                        >
                          {esSangria ? "−" : "+"}
                          {formatCurrency(e.amount_cents)}
                        </p>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm text-zinc-500">
                          {e.tipo === "cobro" && e.method
                            ? METHOD_LABEL[e.method]
                            : esSangria
                              ? "Sangría"
                              : "Ingreso"}
                          <span className="mx-1 text-zinc-300">·</span>
                          {e.caja_name}
                          {e.attributed_mozo_name && (
                            <>
                              <span className="mx-1 text-zinc-300">·</span>
                              {e.attributed_mozo_name}
                            </>
                          )}
                        </p>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {e.tip_cents > 0 && !e.anulado && (
                            <span className="text-sm tabular-nums text-emerald-700">
                              +{formatCurrency(e.tip_cents)} propina
                            </span>
                          )}
                          {e.corregido && (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                              corregido
                            </span>
                          )}
                          {e.anulado && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                              anulado
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DetalleSheet
        entry={detalle}
        slug={slug}
        cajas={cajas}
        mozos={mozos}
        puedeCorregir={puedeCorregir}
        esAdmin={esAdmin}
        onClose={() => setDetalle(null)}
        onDone={() => {
          setDetalle(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function Totalizador({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-zinc-900">
        {value}
      </p>
      <p className="mt-0.5 text-sm text-zinc-500">{hint}</p>
    </div>
  );
}

/**
 * El panel de la línea: detalle **y** corrección en el mismo lugar. Antes la
 * corrección abría un modal encima del panel — dos capas para editar cuatro
 * campos. Acá se edita donde se mira, con la misma estética del detalle.
 */
function DetalleSheet({
  entry,
  slug,
  cajas,
  mozos,
  puedeCorregir,
  esAdmin,
  onClose,
  onDone,
}: {
  entry: LibroEntry | null;
  slug: string;
  cajas: { id: string; name: string }[];
  mozos: { id: string; name: string }[];
  puedeCorregir: boolean;
  esAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [logs, setLogs] = useState<CorreccionLogConNombres[]>([]);
  const [cargando, setCargando] = useState(false);

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [tip, setTip] = useState("");
  const [mozoId, setMozoId] = useState(SIN_MOZO);
  const [cajaId, setCajaId] = useState("");
  const [notes, setNotes] = useState("");
  const [motivo, setMotivo] = useState("");
  const [anular, setAnular] = useState(false);
  const [confirmandoAnular, setConfirmandoAnular] = useState(false);
  const [pending, startTransition] = useTransition();

  // Cada línea abre con sus valores actuales cargados: el formulario ES el
  // detalle, así que arranca mostrando lo que hay.
  useEffect(() => {
    if (!entry) return;
    setMethod(entry.method);
    setAmount(centsToInput(entry.amount_cents));
    setTip(centsToInput(entry.tip_cents));
    setMozoId(entry.attributed_mozo_id ?? SIN_MOZO);
    setCajaId(entry.caja_id);
    setNotes("");
    setMotivo("");
    setAnular(false);
    setConfirmandoAnular(false);
  }, [entry]);

  useEffect(() => {
    if (!entry || !entry.corregido) {
      setLogs([]);
      return;
    }
    let vivo = true;
    setCargando(true);
    verCorrecciones(
      slug,
      entry.tipo === "cobro" ? "payment" : "movimiento",
      entry.id,
    ).then((r) => {
      if (!vivo) return;
      setLogs(r.ok ? r.data : []);
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [entry, slug]);

  if (!entry) return null;

  const esCobro = entry.tipo === "cobro";
  const editable = puedeCorregir && !entry.bloqueo;
  const nuevoMonto = inputToCents(amount);
  const nuevaPropina = inputToCents(tip);
  const mozoBloqueado = entry.advertencias.some((a) => a.includes("rindió"));

  const cambios: string[] = [];
  if (esCobro) {
    if (method !== entry.method) cambios.push("método");
    if (nuevoMonto !== entry.amount_cents) cambios.push("monto");
    if (nuevaPropina !== entry.tip_cents) cambios.push("propina");
    if ((mozoId === SIN_MOZO ? null : mozoId) !== entry.attributed_mozo_id) {
      cambios.push("mozo");
    }
    if (cajaId !== entry.caja_id) cambios.push("caja");
    if (notes.trim() !== "") cambios.push("nota");
  } else if (anular) {
    cambios.push("anulación");
  } else if (nuevoMonto !== entry.amount_cents) {
    cambios.push("monto");
  }

  const montoValido =
    nuevoMonto > 0 && nuevaPropina >= 0 && nuevaPropina <= nuevoMonto;
  const puedeConfirmar =
    !pending && motivo.trim() !== "" && cambios.length > 0 && montoValido;

  function confirmar() {
    if (!entry) return;
    const linea = entry;
    startTransition(async () => {
      const r = esCobro
        ? await corregirCobro({
            paymentId: linea.id,
            slug,
            motivo: motivo.trim(),
            ...(method !== linea.method && method ? { method } : {}),
            ...(nuevoMonto !== linea.amount_cents
              ? { amount_cents: nuevoMonto }
              : {}),
            ...(nuevaPropina !== linea.tip_cents
              ? { tip_cents: nuevaPropina }
              : {}),
            ...((mozoId === SIN_MOZO ? null : mozoId) !== linea.attributed_mozo_id
              ? { attributed_mozo_id: mozoId === SIN_MOZO ? null : mozoId }
              : {}),
            ...(cajaId !== linea.caja_id ? { caja_id: cajaId } : {}),
            ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
          })
        : await corregirMovimiento({
            movimientoId: linea.id,
            slug,
            motivo: motivo.trim(),
            ...(anular ? { anular: true } : { amount_cents: nuevoMonto }),
          });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(anular ? "Movimiento anulado" : "Línea corregida");
      onDone();
    });
  }

  function anularLinea() {
    if (!entry) return;
    const linea = entry;
    startTransition(async () => {
      const r = await anularLineaDeCobro({
        paymentId: linea.id,
        slug,
        motivo: motivo.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Cobro anulado");
      onDone();
    });
  }

  return (
    <Sheet open onOpenChange={(o) => (pending ? null : !o && onClose())}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-lg">{entry.descripcion}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
            <p className="text-3xl font-bold tabular-nums text-zinc-900">
              {formatCurrency(entry.amount_cents)}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              {esCobro && entry.method
                ? METHOD_LABEL[entry.method]
                : entry.tipo === "sangria"
                  ? "Sangría"
                  : entry.tipo === "propina"
                    ? "Propina pagada"
                    : "Ingreso"}
              <span className="mx-1 text-zinc-300">·</span>
              {entry.caja_name}
              <span className="mx-1 text-zinc-300">·</span>
              {fecha(entry.created_at)} {hora(entry.created_at)}
            </p>
            {entry.tip_cents > 0 && (
              <p className="mt-1 text-sm text-emerald-700">
                Incluye {formatCurrency(entry.tip_cents)} de propina
              </p>
            )}
            {entry.attributed_mozo_name && (
              <p className="mt-1 text-sm text-zinc-600">
                Atribuido a {entry.attributed_mozo_name}
              </p>
            )}
          </div>

          {/* El comprobante no limita nada de acá: se emite sobre la CUENTA
              (total sin propina), no sobre el pago. Está para poder ir a
              arreglarlo cuando lo que está mal es la factura. */}
          {entry.factura && (
            <div className="rounded-xl bg-white p-3 text-sm ring-1 ring-zinc-200/70">
              <p className="flex items-center gap-2 font-semibold text-zinc-800">
                <FileText className="size-4 text-zinc-400" />
                {tipoLabel(entry.factura.tipo_comprobante as TipoComprobante)}{" "}
                {formatInvoiceNumber(
                  entry.factura.punto_venta,
                  entry.factura.numero,
                )}
              </p>
              <p className="mt-1 text-zinc-600">
                Corregir el cobro <strong>no toca el comprobante</strong>: la
                factura se emite sobre la cuenta, no sobre la plata que entró. Si
                lo que está mal es el importe facturado, hay que anularla —se
                emite la nota de crédito— y volver a facturar.
              </p>
              {esAdmin && entry.factura.numero != null && (
                <Link
                  href={`/${slug}/admin/facturacion?range=all&q=${entry.factura.numero}`}
                  className="mt-2 inline-flex text-sm font-semibold text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
                >
                  Ir al comprobante
                </Link>
              )}
            </div>
          )}

          {entry.anulado && (
            <div className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-700">
              <p className="font-semibold">Anulado</p>
              {entry.anulado_reason && (
                <p className="mt-0.5">{entry.anulado_reason}</p>
              )}
            </div>
          )}

          {/* Por qué no se puede corregir: decirlo es parte del trabajo — un
              formulario escondido no explica nada. */}
          {entry.bloqueo && (
            <p className="flex items-start gap-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600 ring-1 ring-zinc-200">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                No se puede corregir: {entry.bloqueo}{" "}
                {entry.bloqueo.includes("arqueo")
                  ? "Registrá la corrección en el período vigente."
                  : ""}
              </span>
            </p>
          )}

          {editable &&
            entry.advertencias.map((a) => (
              <p
                key={a}
                className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{a}</span>
              </p>
            ))}

          {editable && (
            <div className="space-y-4 rounded-xl bg-white p-4 ring-1 ring-zinc-200/70">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Corregir
              </p>

              {esCobro && (
                <div className="grid gap-1.5">
                  <Label className="text-sm">Método</Label>
                  <Select
                    value={method ?? undefined}
                    onValueChange={(v) => setMethod(v as PaymentMethod)}
                  >
                    <SelectTrigger className="h-11 w-full text-base">
                      {/* `SelectValue` sin render function imprime el VALOR,
                          que acá es un id. */}
                      <SelectValue placeholder="Elegí un método">
                        {(value) =>
                          METODOS.find((m) => m.value === value)?.label ??
                          "Elegí un método"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {METODOS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {!esCobro && (
                <label className="flex items-center gap-3 rounded-xl bg-zinc-50 p-3 text-sm ring-1 ring-zinc-200">
                  <input
                    type="checkbox"
                    checked={anular}
                    onChange={(e) => setAnular(e.target.checked)}
                    className="size-5"
                  />
                  <span>
                    Anular el movimiento — deja de contar para el arqueo, pero
                    sigue visible acá.
                  </span>
                </label>
              )}

              <div className={cn("grid gap-3", esCobro && "grid-cols-2")}>
                <div className="grid gap-1.5">
                  <Label className="text-sm">Monto</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-zinc-400">
                      $
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={amount}
                      disabled={anular}
                      onChange={(e) => setAmount(e.target.value)}
                      className="h-12 pl-8 text-lg font-semibold tabular-nums"
                    />
                  </div>
                </div>
                {esCobro && (
                  <div className="grid gap-1.5">
                    <Label className="text-sm">De propina</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-zinc-400">
                        $
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={tip}
                        onChange={(e) => setTip(e.target.value)}
                        className="h-12 pl-8 text-lg font-semibold tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>

              {esCobro && (
                <p className="-mt-1 text-sm text-zinc-500">
                  La propina viaja dentro del monto:{" "}
                  {formatCurrency(entry.amount_cents)} incluye{" "}
                  {formatCurrency(entry.tip_cents)} de propina.
                </p>
              )}

              {esCobro && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-sm">Mozo atribuido</Label>
                    <Select
                      value={mozoId}
                      onValueChange={(v) => setMozoId(v ?? SIN_MOZO)}
                      disabled={mozoBloqueado}
                    >
                      <SelectTrigger className="h-11 w-full text-base">
                        <SelectValue placeholder="Sin mozo">
                          {(value) =>
                            !value || value === SIN_MOZO
                              ? "Sin mozo"
                              : (mozos.find((m) => m.id === value)?.name ??
                                "Sin mozo")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SIN_MOZO}>Sin mozo</SelectItem>
                        {mozos.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {cajas.length > 1 && (
                    <div className="grid gap-1.5">
                      <Label className="text-sm">Caja</Label>
                      <Select
                        value={cajaId}
                        onValueChange={(v) => setCajaId(v ?? cajaId)}
                      >
                        <SelectTrigger className="h-11 w-full text-base">
                          <SelectValue>
                            {(value) =>
                              cajas.find((c) => c.id === value)?.name ?? "Caja"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {cajas.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {(method === "transfer" || method === "other") && (
                    <div className="grid gap-1.5">
                      <Label className="text-sm">
                        {method === "transfer" ? "Alias / referencia" : "Nota"}
                        <span className="ml-1 text-rose-600">*</span>
                      </Label>
                      <Input
                        className="h-11 text-base"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={
                          method === "transfer" ? "alias.mp" : "Detalle"
                        }
                      />
                    </div>
                  )}
                </>
              )}

              <div className="grid gap-1.5">
                <Label className="text-sm">
                  Motivo<span className="ml-1 text-rose-600">*</span>
                </Label>
                <Textarea
                  className="text-base"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Ej: lo pagó con débito, no en efectivo"
                />
              </div>

              {esCobro && nuevoMonto !== entry.amount_cents && (
                <p className="text-sm text-zinc-600">
                  El recargo o descuento por método registrado en el cobro{" "}
                  <strong>no se recalcula</strong>: se corrige cuánto entró, no
                  cómo se compuso el precio.
                </p>
              )}
              {!montoValido && (
                <p className="text-sm font-medium text-rose-600">
                  El monto tiene que ser mayor a cero y la propina no puede
                  superarlo.
                </p>
              )}

              <Button
                className="h-12 w-full text-base"
                disabled={!puedeConfirmar}
                onClick={confirmar}
              >
                {pending
                  ? "Guardando…"
                  : cambios.length > 0
                    ? `Corregir ${cambios.join(" + ")}`
                    : "Corregir"}
              </Button>

              {/* Anular ≠ borrar: la línea deja de sumar pero sigue acá, con
                  motivo y responsable. Una fila borrada dejaría el arqueo sin
                  explicación. */}
              {esCobro && (
                <div className="border-t border-zinc-100 pt-4">
                  {!confirmandoAnular ? (
                    <button
                      type="button"
                      onClick={() => setConfirmandoAnular(true)}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700 underline-offset-2 hover:underline"
                    >
                      <Ban className="size-4" /> Anular este cobro
                    </button>
                  ) : (
                    <div className="rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
                      <p className="text-sm text-rose-900">
                        La línea deja de contar para el arqueo y para la
                        rendición, pero <strong>sigue visible acá</strong>,
                        tachada, con el motivo y quién la anuló. Si la cuenta
                        queda sin cubrir, pasa a impaga — la mesa no se toca.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          className="h-11 bg-rose-600 px-4 text-base hover:bg-rose-700"
                          disabled={pending || motivo.trim() === ""}
                          onClick={anularLinea}
                        >
                          {pending ? "Anulando…" : "Anular"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11 px-4 text-base"
                          disabled={pending}
                          onClick={() => setConfirmandoAnular(false)}
                        >
                          Cancelar
                        </Button>
                      </div>
                      {motivo.trim() === "" && (
                        <p className="mt-2 text-sm font-medium text-rose-700">
                          Cargá el motivo arriba para poder anular.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {entry.corregido && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                <History className="size-3.5" /> Historial
              </p>
              {cargando ? (
                <p className="mt-2 text-sm text-zinc-500">Cargando…</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {logs.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-xl bg-white p-3 text-sm ring-1 ring-zinc-200/70"
                    >
                      <p className="font-semibold text-zinc-800">
                        {CAMPO_LABEL[l.field] ?? l.field}:{" "}
                        {valorLegible(l.field, l.from_value, l.from_label)} →{" "}
                        {valorLegible(l.field, l.to_value, l.to_label)}
                      </p>
                      <p className="mt-0.5 text-zinc-600">{l.reason}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {l.by_name ?? "—"} · {fecha(l.created_at)}{" "}
                        {hora(l.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
