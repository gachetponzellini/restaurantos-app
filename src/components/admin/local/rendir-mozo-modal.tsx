"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Lock, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { METHOD_LABEL } from "@/components/admin/local/caja-metricas";
import type { CajaPayment } from "@/lib/caja/queries";
import type { SaldoMozo } from "@/lib/caja/turno-queries";
import { reconocerDeuda, rendirMozo } from "@/lib/caja/turno-actions";
import { formatCurrency } from "@/lib/currency";
import { TXT } from "@/lib/caja/textos";
import { TZ_AR } from "@/lib/timezone";
import { cn } from "@/lib/utils";

/**
 * La rendición de un mozo (spec 211 · R2), estilo MaxiRest: la cuenta de lo
 * que tiene que entregar, sus cobros, y una acción de un toque para el caso
 * común. Lo que se registra lo valida la base (`rendir_mozo_tx`).
 *
 * La cuenta cierra siempre:
 *   anterior + cobró en efectivo − su propina de tarjeta − entregó + le pagó la caja = tiene que entregar
 */
export function RendirMozoModal({
  open,
  onOpenChange,
  slug,
  saldo,
  cobros,
  onRendido,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  saldo: SaldoMozo;
  /** Sus cobros del período en esta caja (opcional: desde la franja no están). */
  cobros?: CajaPayment[];
  onRendido: () => void;
}) {
  const [modo, setModo] = useState<"inicio" | "otro" | "no">("inicio");
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setModo("inicio");
      setMonto("");
      setNota("");
    }
  }, [open]);

  const debe = saldo.saldo_cents;
  const leDebeLaCaja = debe < 0;
  const conMesas = saldo.mesas_sin_cobrar.length > 0;
  const montoCents = monto === "" ? null : Math.max(0, Math.round(Number(monto.replace(/\D/g, "")) * 100));
  const dif = montoCents === null ? 0 : montoCents - debe;

  const ejecutar = (entregado: number, notas?: string) =>
    startTransition(async () => {
      const r = await rendirMozo({ slug, mozoId: saldo.mozo_id, cajaId: saldo.caja_id, entregadoCents: entregado, notas, esperadoCents: debe });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const d = r.data;
      if (d.propina_pagada_cents > 0) {
        toast.success(`Le diste ${formatCurrency(d.propina_pagada_cents)} de propina a ${saldo.mozo_name}.`);
      } else if (d.saldo_restante_cents > 0) {
        toast.success(`${saldo.mozo_name} entregó ${formatCurrency(d.entregado_cents)}. Le falta ${formatCurrency(d.saldo_restante_cents)}.`);
      } else {
        toast.success(
          `${saldo.mozo_name} rindió ${formatCurrency(d.entregado_cents)}.` +
            (saldo.propina_tarjeta_cents > 0
              ? ` Ya se quedó con su propina de ${formatCurrency(saldo.propina_tarjeta_cents)}.`
              : ""),
        );
      }
      onOpenChange(false);
      onRendido();
    });

  const noEntrego = () =>
    startTransition(async () => {
      const r = await reconocerDeuda({ slug, mozoId: saldo.mozo_id, cajaId: saldo.caja_id, motivo: nota });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${saldo.mozo_name} quedó debiendo ${formatCurrency(r.data.deuda_cents)}.`);
      onOpenChange(false);
      onRendido();
    });

  const filas: { label: string; sub?: string; cents: number; tono?: string }[] = [];
  if (saldo.anterior_cents !== 0) {
    filas.push({ label: "Saldo anterior", sub: "Lo que traía de antes", cents: saldo.anterior_cents });
  }
  filas.push({ label: "Cobró en efectivo", sub: "Lo de las cuentas, sin propinas", cents: saldo.efectivo_cents });
  if (saldo.propina_tarjeta_cents > 0) {
    filas.push({
      label: "Su propina de tarjeta y QR",
      sub: "Se la queda de lo que trae",
      cents: -saldo.propina_tarjeta_cents,
      tono: "text-violet-800",
    });
  }
  if (saldo.entregado_cents > 0) {
    filas.push({ label: "Ya entregó", cents: -saldo.entregado_cents });
  }
  if (saldo.pagado_cents > 0) {
    filas.push({ label: "Le pagó la caja de propina", cents: saldo.pagado_cents });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader title={`Rendición de ${saldo.mozo_name}`} eyebrow={saldo.caja_name} icon={<UserRound />} />
        <ModalBody>
          <div className="space-y-4">
            <dl className="overflow-hidden rounded-xl ring-1 ring-border">
              {filas.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-sm">
                  <dt className={cn("text-foreground/85", f.tono)}>
                    {f.label}
                    {f.sub && <span className="block text-xs text-muted-foreground">{f.sub}</span>}
                  </dt>
                  <dd className={cn("font-semibold tabular-nums", f.tono)}>
                    {f.cents < 0 ? `− ${formatCurrency(-f.cents)}` : formatCurrency(f.cents)}
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 bg-muted/50 px-4 py-3">
                <dt className="text-base font-semibold">
                  {leDebeLaCaja ? "La caja le debe de propina" : TXT.tieneQueEntregar}
                </dt>
                <dd className="text-xl font-bold tabular-nums">{formatCurrency(Math.abs(debe))}</dd>
              </div>
            </dl>

            {saldo.propina_efectivo_cents > 0 && (
              <p className="text-xs text-muted-foreground">
                La propina que le dejaron en efectivo ({formatCurrency(saldo.propina_efectivo_cents)}) ya la tiene y no entra en ninguna cuenta.
              </p>
            )}

            {saldo.deuda && (
              <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
                Quedó registrado que no entregó. Si ahora trae la plata, registrala abajo.
              </p>
            )}

            {conMesas && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <span>
                  Tiene {saldo.mesas_sin_cobrar.map((m) => `mesa ${m.tableLabel ?? "?"}`).join(", ")} sin cobrar. Cobrala antes de rendir.{" "}
                  <Link href={`/${slug}/admin/operacion?tab=salon`} className="font-semibold underline underline-offset-2">
                    Ir al salón
                  </Link>
                </span>
              </p>
            )}

            {cobros && cobros.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm text-muted-foreground">Sus cobros del turno</p>
                <ul className="divide-y divide-border/60 rounded-xl ring-1 ring-border/70">
                  {cobros.map((c) => {
                    const ef = c.method === "cash";
                    return (
                      <li key={c.id} className={cn("flex justify-between gap-3 px-3 py-2 text-sm", !ef && "text-muted-foreground")}>
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{c.table_label ? `Mesa ${c.table_label}` : c.customer_name || `#${c.order_number}`}</span>{" "}
                          <span className="text-xs">
                            ·{" "}
                            {new Date(c.created_at).toLocaleTimeString("es-AR", { timeZone: TZ_AR, hour: "2-digit", minute: "2-digit" })}{" "}
                            · {METHOD_LABEL[c.method]}
                            {c.tip_cents > 0 && ` · propina ${formatCurrency(c.tip_cents)}`}
                          </span>
                        </span>
                        <span className={cn("shrink-0 tabular-nums", ef && "font-semibold")}>{formatCurrency(c.amount_cents)}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1.5 text-xs text-muted-foreground">Tarjeta y QR ya entraron por el posnet: no se rinden.</p>
              </div>
            )}

            {modo === "otro" && (
              <form
                id="rendir-otro"
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (montoCents !== null && montoCents > 0 && !(dif > 0 && nota.trim() === "")) ejecutar(montoCents, nota);
                }}
              >
                <Label htmlFor="rendir-monto">¿Cuánto entregó?</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-semibold text-muted-foreground">$</span>
                  <Input
                    id="rendir-monto"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    value={monto}
                    onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                    className="pl-7 text-base tabular-nums"
                  />
                </div>
                {montoCents !== null && dif < 0 && (
                  <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-950 ring-1 ring-amber-200">
                    Falta {formatCurrency(-dif)}. Queda en su saldo: lo puede traer después o marcarlo como «no entregó».
                  </p>
                )}
                {montoCents !== null && dif > 0 && (
                  <>
                    <p className="rounded-lg bg-sky-50 p-2.5 text-sm text-sky-950 ring-1 ring-sky-200">
                      Sobran {formatCurrency(dif)}. Entran al cajón y quedan anotados: escribí por qué.
                    </p>
                    <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Trajo de más el cambio…" />
                  </>
                )}
              </form>
            )}

            {modo === "no" && (
              <div className="space-y-2">
                <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
                  Queda como deuda de {saldo.mozo_name} por <strong className="tabular-nums">{formatCurrency(debe)}</strong>. Se ve en el cierre, le avisa al dueño y se arrastra hasta que la entregue.
                </p>
                <Label htmlFor="rendir-motivo">¿Por qué no entregó?</Label>
                <Textarea id="rendir-motivo" value={nota} onChange={(e) => setNota(e.target.value)} rows={2} autoFocus placeholder="Se fue temprano, rinde mañana…" />
              </div>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          {leDebeLaCaja ? (
            <Button size="xl" className="w-full" disabled={enviando} onClick={() => ejecutar(0)}>
              Darle {formatCurrency(-debe)} de propina del cajón
            </Button>
          ) : debe === 0 ? (
            <Button size="xl" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              No tiene nada pendiente
            </Button>
          ) : modo === "inicio" ? (
            <div className="flex w-full flex-col gap-2">
              <Button size="xl" disabled={enviando || conMesas} onClick={() => ejecutar(debe)}>
                {conMesas ? "Cobrá sus mesas antes de rendir" : `Entregó ${formatCurrency(debe)} justo`}
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" disabled={conMesas} onClick={() => setModo("otro")}>
                  Entregó otro monto
                </Button>
                {!saldo.deuda && (
                  <Button variant="link" className="text-muted-foreground hover:text-rose-700" onClick={() => setModo("no")}>
                    No entregó
                  </Button>
                )}
              </div>
            </div>
          ) : modo === "otro" ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button
                size="xl"
                type="submit"
                form="rendir-otro"
                className="flex-1"
                disabled={enviando || montoCents === null || montoCents <= 0 || (dif > 0 && nota.trim() === "")}
              >
                {montoCents === null || montoCents <= 0
                  ? "Cargá cuánto entregó"
                  : dif > 0 && nota.trim() === ""
                    ? "Escribí por qué sobra"
                    : `Registrar entrega de ${formatCurrency(montoCents)}`}
              </Button>
              <Button variant="link" onClick={() => setModo("inicio")}>Volver</Button>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button size="xl" variant="destructive" className="flex-1" disabled={enviando || nota.trim() === ""} onClick={noEntrego}>
                {nota.trim() === "" ? "Escribí el motivo" : "Dejar como deuda"}
              </Button>
              <Button variant="link" onClick={() => setModo("inicio")}>Volver</Button>
            </div>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
