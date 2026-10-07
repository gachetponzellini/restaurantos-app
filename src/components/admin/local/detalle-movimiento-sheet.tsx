"use client";

import { useEffect, useState, useTransition } from "react";
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
  Smartphone,
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
  Modal,
  ModalBody,
  ModalHeader,
  PanelContent,
} from "@/components/ui/modal";
import { SectionLabel } from "@/components/ui/section-label";
import { AmountCard } from "@/components/ui/amount-card";
import { Textarea } from "@/components/ui/textarea";
import {
  anularLineaDeCobro,
  corregirCobro,
  corregirMovimiento,
  verCorrecciones,
  type CorreccionLogConNombres,
} from "@/lib/caja/correccion-actions";
import type {
  LibroEntry,
  PaymentMethod,
} from "@/lib/caja/types";
import { formatInvoiceNumber, tipoLabel } from "@/lib/afip/format";
import type { TipoComprobante } from "@/lib/afip/types";
import { formatCurrency } from "@/lib/currency";
import { efectoDeCorreccion } from "@/lib/caja/turno-actions";
import { cn } from "@/lib/utils";
import { TZ_AR } from "@/lib/timezone";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  mp_manual: "Mercado Pago",
  other: "Otro",
  cuenta_corriente: "Cuenta corriente",
};

export const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card_manual", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "mp_manual", label: "Mercado Pago" },
  { value: "other", label: "Otro" },
];

export const SIN_MOZO = "__sin_mozo__";

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function inputToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

export const CAMPO_LABEL: Record<string, string> = {
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

export function iconoDe(entry: LibroEntry) {
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
      case "mp_manual":
      return Smartphone;
    default:
      return MoreHorizontal;
  }
}

export function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Traduce un renglón de auditoría a algo que se lea: los montos vienen en
 * centavos y los mozos/cajas como id (el log guarda el dato exacto).
 */
export function valorLegible(
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


export function DetalleSheet({
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
  // Spec 210 · R6 — qué va a pasar con el cajón y con el saldo de cada mozo.
  const [efecto, setEfecto] = useState<string[] | null>(null);

  useEffect(() => {
    setEfecto(null);
    if (!entry || entry.tipo !== "cobro" || !puedeCorregir || entry.bloqueo) return;
    const patch: Parameters<typeof efectoDeCorreccion>[0]["patch"] = {};
    if (method && method !== entry.method) patch.method = method;
    const monto = inputToCents(amount);
    const propina = inputToCents(tip);
    if (amount !== "" && monto !== entry.amount_cents) patch.amount_cents = monto;
    if (tip !== "" && propina !== entry.tip_cents) patch.tip_cents = propina;
    const mozo = mozoId === SIN_MOZO ? null : mozoId;
    if (mozo !== entry.attributed_mozo_id) patch.attributed_mozo_id = mozo;
    if (cajaId && cajaId !== entry.caja_id) patch.caja_id = cajaId;
    if (Object.keys(patch).length === 0) return;
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await efectoDeCorreccion({ slug, paymentId: entry.id, patch });
      if (!vivo || !r.ok) return;
      const lineas = [
        ...r.data.cajas.map(
          (c) => `El cajón de ${c.caja} pasa de ${formatCurrency(c.antes)} a ${formatCurrency(c.despues)}.`,
        ),
        ...r.data.mozos.map(
          (m) =>
            `Lo que ${m.mozo ?? "el mozo"} tiene que entregar${r.data.mozos.some((x) => x.mozo_id === m.mozo_id && x.caja_id !== m.caja_id) ? ` a ${m.caja}` : ""} pasa de ${formatCurrency(m.antes)} a ${formatCurrency(m.despues)}.`,
        ),
      ];
      setEfecto(lineas.length ? lineas : ["No cambia el cajón ni lo que entrega ningún mozo."]);
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [entry, slug, puedeCorregir, method, amount, tip, mozoId, cajaId]);

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
      // El comprobante quedó desfasado de lo cobrado: se avisa, no se esconde.
      const aviso = (r.data as { advertencia?: string } | undefined)?.advertencia;
      if (aviso) toast.warning(aviso, { duration: 12_000 });
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
    <Modal open onOpenChange={(o) => (pending ? null : !o && onClose())}>
      <PanelContent size="md">
        <ModalHeader title={entry.descripcion} />

        <ModalBody className="space-y-4">
          <AmountCard
            label={
              esCobro && entry.method
                ? METHOD_LABEL[entry.method]
                : entry.tipo === "sangria"
                  ? "Sangría"
                  : entry.tipo === "propina"
                    ? "Propina pagada"
                    : "Ingreso"
            }
            value={formatCurrency(entry.amount_cents)}
            size="lg"
          >
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.caja_name}
              <span className="mx-1 text-muted-foreground/50">·</span>
              {fecha(entry.created_at)} {hora(entry.created_at)}
            </p>
            {entry.tip_cents > 0 && (
              <p className="mt-1 text-sm text-emerald-700">
                Incluye {formatCurrency(entry.tip_cents)} de propina
              </p>
            )}
            {entry.attributed_mozo_name && (
              <p className="mt-1 text-sm text-muted-foreground">
                Atribuido a {entry.attributed_mozo_name}
              </p>
            )}
          </AmountCard>

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
              <SectionLabel>Corregir</SectionLabel>

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
                  {/* #356 — el ajuste sigue al método: lo recalcula el server. */}
                  {method !== entry.method &&
                    nuevoMonto === entry.amount_cents && (
                      <p className="text-xs text-zinc-500">
                        Si el método nuevo tiene recargo o descuento, el monto se
                        recalcula solo al confirmar.
                      </p>
                    )}
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
                      id="corregir-monto"
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
                  id="corregir-motivo"
                  aria-label="Motivo"
                  className="text-base"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Ej: lo pagó con débito, no en efectivo"
                />
              </div>

              {/* #356 — el ajuste sigue al método: cambiarlo lo recalcula (lo
                  avisa el cartel de arriba). Corregir sólo el monto, en cambio,
                  no cambia cómo se compuso el precio. */}
              {esCobro && nuevoMonto !== entry.amount_cents && method === entry.method && (
                <p className="text-sm text-zinc-600">
                  Corregir el monto <strong>no recalcula</strong> el recargo o
                  descuento del método: se corrige cuánto entró, no cómo se
                  compuso el precio.
                </p>
              )}
              {!montoValido && (
                <p className="text-sm font-medium text-rose-600">
                  El monto tiene que ser mayor a cero y la propina no puede
                  superarlo.
                </p>
              )}

              {efecto && montoValido && (
                <p
                  role="status"
                  className="rounded-lg bg-sky-50 p-3 text-sm font-medium text-sky-900 ring-1 ring-sky-200"
                >
                  {efecto.join(" ")}
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
              <SectionLabel icon={<History />}>Historial</SectionLabel>
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
        </ModalBody>
      </PanelContent>
    </Modal>
  );
}
