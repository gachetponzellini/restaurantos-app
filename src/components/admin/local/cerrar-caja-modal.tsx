"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { IntentLink } from "@/components/ui/intent-link";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCierreCajaTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import { cerrarCaja } from "@/lib/caja/actions";
import type { CierreCajaData } from "@/lib/caja/queries";
import { TXT, veredictoDiferencia } from "@/lib/caja/textos";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Cerrar la caja: sólo contar (spec 209).
 *
 * Antes (spec 130) el modal tenía tres bloques —la plata del período, quién
 * tiene el efectivo con un formulario de rendición propio, y contar— y el
 * botón final se apagaba sin decir por qué cuando faltaba cobrar una mesa o
 * rendir a un mozo. Ahora esos pasos viven en la franja «Cierre del turno» del
 * board, que siempre dice cuál es el próximo; acá se llega con todo resuelto.
 *
 * **Conteo ciego** (spec 209 · R4): primero se cuenta sin ver cuánto debería
 * haber ni la diferencia —la franja en vivo empujaba a contar hacia el
 * número—; recién con «Listo, conté» aparece la comparación. Si no cuadra se
 * puede volver a contar desde cero, y el conteo descartado queda en el resumen.
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
  const router = useRouter();
  const [data, setData] = useState<CierreCajaData | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  const [fase, setFase] = useState<"contar" | "resultado">("contar");
  // D3 · el conteo por billete va primero: es el que deja rastro.
  const [forma, setForma] = useState<"billete" | "total">("billete");
  const [total, setTotal] = useState("");
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [recuentos, setRecuentos] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  // R6 · el «debería haber» cambió mientras se contaba.
  const [cambio, setCambio] = useState<{ esperado: number; delta: number } | null>(
    null,
  );

  const seq = useRef(0);
  const cargar = useCallback(async () => {
    const mio = ++seq.current;
    setCargando(true);
    setErrorCarga(null);
    try {
      const res = await getCierreCajaTabData(slug, cajaId, { sinReparto: true });
      // Una respuesta vieja (o que llega con el modal cerrado) no pisa nada.
      if (mio !== seq.current) return null;
      if (res.ok) {
        setData(res.data);
        // El número recién leído reemplaza al del aviso de «cambió».
        setCambio(null);
      }
      else setErrorCarga(res.error);
      return res.ok ? res.data : null;
    } catch {
      if (mio !== seq.current) return null;
      // Sin red (o el server reiniciando): que se diga y se pueda reintentar,
      // no un botón que queda «cargando» para siempre.
      setErrorCarga("No hay conexión con el sistema. Probá de nuevo en un momento.");
      return null;
    } finally {
      setCargando(false);
    }
  }, [slug, cajaId]);

  const reiniciarConteo = () => {
    setTotal("");
    setConteo({});
    setNotes("");
  };

  useEffect(() => {
    if (!open) {
      seq.current++;
      reiniciarConteo();
      setFase("contar");
      setForma("billete");
      setRecuentos([]);
      setCambio(null);
      setData(null);
      return;
    }
    void cargar();
  }, [open, cargar]);

  const totalBilletes = DENOMINACIONES.reduce(
    (acc, d) => acc + d * cantidadBilletes(conteo[String(d)]),
    0,
  );
  // Un campo tocado cuenta, aunque sea «0»: un día sin efectivo se declara en
  // $0, no se queda sin poder seguir.
  const tocoBilletes = DENOMINACIONES.some((d) => (conteo[String(d)] ?? "") !== "");
  const cents =
    forma === "billete"
      ? tocoBilletes
        ? totalBilletes * 100
        : null
      : total === "" || !Number.isFinite(Number(total))
        ? null
        : Math.max(0, Math.round(Number(total) * 100));

  const fondo = data?.fondo_fijo_cents ?? 0;
  const aRetirar = Math.max(0, (cents ?? 0) - fondo);
  const deberiaHaber = cambio?.esperado ?? data?.stats.expected_cash_cents ?? 0;
  const diff = cents === null ? 0 : cents - deberiaHaber;
  const veredicto = veredictoDiferencia(diff);

  // Lo mismo que bloquea en la action y en `cerrar_caja_tx`. Normalmente la
  // franja ya lo resolvió; esto cubre la carrera (alguien abrió una mesa o
  // cobró mientras el modal estaba abierto).
  const bloqueantes = data
    ? {
        mesas: data.cuentas_abiertas,
        mozos: data.deben_rendir,
      }
    : { mesas: [], mozos: [] };
  const bloqueado = bloqueantes.mesas.length > 0 || bloqueantes.mozos.length > 0;

  const denomCount = (): Record<string, number> | null => {
    if (forma !== "billete") return null;
    const entries = DENOMINACIONES.map((d) => [
      String(d),
      cantidadBilletes(conteo[String(d)]),
    ] as const).filter(([, n]) => n > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  };

  const listoConte = async () => {
    if (cents === null) return;
    // Se re-lee al terminar de contar: el «debería haber» que se muestra es el
    // de ahora, no el de cuando se abrió el modal.
    setCambio(null);
    if (await cargar()) setFase("resultado");
  };

  const volverAContar = () => {
    // La action acepta hasta 20: se guardan los últimos, que son los que
    // explican el cierre.
    if (cents !== null) setRecuentos((r) => [...r, cents].slice(-20));
    reiniciarConteo();
    setCambio(null);
    setFase("contar");
  };

  const cerrar = () => {
    if (cents === null || !data) return;
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof cerrarCaja>>;
      try {
        r = await cerrarCaja({
        cajaId,
        closing_cash_cents: cents,
        closing_notes: notes.trim() || null,
        denomination_count: denomCount(),
        retirar: true,
        businessSlug: slug,
        expected_visto_cents: deberiaHaber,
        recuentos_cents: recuentos,
        });
      } catch {
        toast.error("No hay conexión con el sistema: la caja no se cerró. Probá de nuevo.");
        return;
      }
      if (!r.ok) {
        if ("esperado_actual_cents" in r) {
          setCambio({ esperado: r.esperado_actual_cents, delta: r.delta_cents });
          return;
        }
        toast.error(r.error);
        void cargar();
        return;
      }
      onOpenChange(false);
      onCerrada();
      router.push(`/${slug}/admin/caja/cierres/${r.data.corte.id}?recien=1`);
    });
  };

  const faltaMotivo = diff !== 0 && notes.trim() === "";

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader title={TXT.cerrarCaja} eyebrow={cajaName} icon={<Lock />} />
        <ModalBody>
          {cargando && !data && (
            <div className="space-y-3 py-6">
              <div className="bg-muted h-24 animate-pulse rounded-2xl" />
            </div>
          )}

          {errorCarga && (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
              {errorCarga}
            </p>
          )}

          {data && bloqueado && (
            <Bloqueantes
              slug={slug}
              mesas={bloqueantes.mesas}
              mozos={bloqueantes.mozos}
              onVolver={() => onOpenChange(false)}
            />
          )}

          {data && !bloqueado && fase === "contar" && (
            <form
              id="cierre-contar"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void listoConte();
              }}
            >
              <div>
                <p className="text-foreground text-base font-semibold">
                  Contá la plata del cajón
                </p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  Contá sin mirar el sistema: cuánto debería haber te lo
                  mostramos cuando termines.
                </p>
                {recuentos.length > 0 && (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    Recuento {recuentos.length + 1}: empezá de cero.
                  </p>
                )}
              </div>

              <div
                role="group"
                aria-label="Cómo contás"
                className="bg-muted inline-flex rounded-full p-1 text-sm"
              >
                {(
                  [
                    ["billete", "Por billete"],
                    ["total", "El total"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={forma === k}
                    onClick={() => setForma(k)}
                    className={cn(
                      "rounded-full px-4 py-1.5 font-medium transition",
                      forma === k
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {forma === "billete" ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {DENOMINACIONES.map((d, i) => (
                    <label key={d} className="grid gap-1">
                      <span className="text-muted-foreground text-[0.7rem] font-semibold">
                        Billetes de {formatCurrency(d * 100)}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={conteo[String(d)] ?? ""}
                        onChange={(e) =>
                          setConteo((c) => ({ ...c, [String(d)]: e.target.value }))
                        }
                        placeholder="0"
                        inputMode="numeric"
                        autoFocus={i === 0}
                        className="tabular-nums"
                      />
                    </label>
                  ))}
                  <p className="text-foreground col-span-full mt-1 flex items-center justify-between gap-3 text-sm">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                      onClick={() => {
                        setForma("total");
                        setTotal("0");
                      }}
                    >
                      No hay efectivo en el cajón
                    </button>
                    <span>
                    Total contado:{" "}
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(totalBilletes * 100)}
                    </span>
                    </span>
                  </p>
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="cierre-contado" className="text-sm font-medium">
                    Efectivo contado
                  </Label>
                  <div className="relative">
                    <span className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base font-semibold">
                      $
                    </span>
                    <Input
                      id="cierre-contado"
                      type="number"
                      value={total}
                      onChange={(e) => setTotal(e.target.value)}
                      placeholder="0"
                      autoFocus
                      inputMode="decimal"
                      className="pl-7 text-base tabular-nums"
                    />
                  </div>
                </div>
              )}
            </form>
          )}

          {data && !bloqueado && fase === "resultado" && cents !== null && (
            <div className="space-y-4">
              {cambio && (
                <p
                  role="status"
                  className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200"
                >
                  {cambio.delta >= 0 ? "Entraron" : "Salieron"}{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(Math.abs(cambio.delta))}
                  </span>{" "}
                  en efectivo mientras contabas. No hace falta recontar: la
                  diferencia ya está recalculada.
                </p>
              )}

              <dl className="ring-border/70 divide-border/60 divide-y rounded-xl ring-1">
                <Fila label={TXT.contado} cents={cents} />
                <Fila label={TXT.deberiaHaber} cents={deberiaHaber} />
                <div
                  className={cn(
                    "flex items-center justify-between rounded-b-xl px-4 py-3",
                    veredicto.tono === "falta" && "bg-rose-50 text-rose-900",
                    veredicto.tono === "sobra" && "bg-amber-50 text-amber-900",
                    veredicto.tono === "cuadra" && "bg-emerald-50 text-emerald-900",
                  )}
                >
                  <dt className="text-base font-semibold">{veredicto.label}</dt>
                  <dd className="text-xl font-bold tabular-nums">
                    {veredicto.tono === "cuadra"
                      ? "✓"
                      : formatCurrency(veredicto.montoCents)}
                  </dd>
                </div>
              </dl>

              {diff !== 0 && (
                <div className="grid gap-1.5">
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
                  <p className="text-muted-foreground text-xs">
                    ¿Te parece que contaste mal? Volvé a contar: el primer
                    conteo queda registrado en el resumen.
                  </p>
                </div>
              )}

              <p className="text-foreground/70 text-xs">
                Al cerrar se retiran{" "}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(aRetirar)}
                </span>
                {fondo > 0
                  ? ` y quedan ${formatCurrency(Math.min(fondo, cents))} de fondo en el cajón`
                  : " y la caja arranca en $0"}
                {data.barre_salon && <AnuncioSalon salon={data.salon} />}. Sale
                el papel del cierre por la comandera.
              </p>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          {data && !bloqueado && fase === "contar" && (
            <>
              <Button
                type="button"
                variant="outline"
                size="xl"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form="cierre-contar"
                size="xl"
                disabled={cents === null || cargando}
              >
                {cents === null ? "Cargá lo que contaste" : "Listo, conté"}
              </Button>
            </>
          )}

          {data && !bloqueado && fase === "resultado" && (
            <>
              <Button
                type="button"
                variant="outline"
                size="xl"
                onClick={volverAContar}
                disabled={enviando}
              >
                <RotateCcw className="mr-2 size-4" />
                Volver a contar
              </Button>
              <Button
                type="button"
                size="xl"
                disabled={enviando || faltaMotivo}
                onClick={cerrar}
              >
                <Lock className="mr-2 size-4" />
                {faltaMotivo
                  ? "Escribí qué pasó para cerrar"
                  : diff !== 0
                    ? "Cerrar con esta diferencia"
                    : `Cerrar caja y retirar ${formatCurrency(aRetirar)}`}
              </Button>
            </>
          )}

          {(!data || bloqueado) && (
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => onOpenChange(false)}
            >
              <ArrowLeft className="mr-2 size-4" />
              Volver
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/** Billetes en circulación, del más grande al más chico. En pesos, no centavos. */
const DENOMINACIONES = [20_000, 10_000, 2_000, 1_000, 500, 200, 100, 50];

/** Cantidad de billetes: entera y no negativa («1.5» o «-2» no son billetes). */
function cantidadBilletes(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function Fila({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-foreground/80 text-sm">{label}</dt>
      <dd className="text-foreground text-lg font-semibold tabular-nums">
        {formatCurrency(cents)}
      </dd>
    </div>
  );
}

function AnuncioSalon({
  salon,
}: {
  salon: CierreCajaData["salon"];
}) {
  const partes: string[] = [];
  if (salon.mesas_a_liberar > 0) {
    partes.push(
      salon.mesas_a_liberar === 1
        ? "se libera 1 mesa"
        : `se liberan ${salon.mesas_a_liberar} mesas`,
    );
  }
  if (salon.mozos_asignados > 0) {
    partes.push(
      `se limpia la distribución de ${salon.mozos_asignados === 1 ? "1 mozo" : `${salon.mozos_asignados} mozos`}`,
    );
  }
  return partes.length > 0 ? <>; {partes.join(" y ")}</> : null;
}

/**
 * Lo que falta antes de contar. La franja «Cierre del turno» ya lo muestra, así
 * que esto sólo aparece si cambió algo con el modal abierto: dice qué falta y
 * lleva a resolverlo, en vez de dejar un botón apagado.
 */
function Bloqueantes({
  slug,
  mesas,
  mozos,
  onVolver,
}: {
  slug: string;
  mesas: CierreCajaData["cuentas_abiertas"];
  mozos: CierreCajaData["deben_rendir"];
  onVolver: () => void;
}) {
  return (
    <div className="rounded-xl bg-rose-50 p-4 text-rose-950 ring-1 ring-rose-200">
      <p className="inline-flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4" />
        Antes de contar falta:
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {mesas.map((m) => (
          <li key={m.order_id} className="flex items-center justify-between gap-3">
            <span>
              Cobrar la mesa {m.table_label}
              {m.mozo_name && <span className="text-rose-800"> · {m.mozo_name}</span>}
            </span>
            <IntentLink
              href={`/${slug}/admin/mesa/${m.table_id}/cobrar`}
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={onVolver}
              aria-label={`Cobrar mesa ${m.table_label}, ${formatCurrency(m.pendiente_cents)}`}
            >
              Cobrar {formatCurrency(m.pendiente_cents)}
            </IntentLink>
          </li>
        ))}
        {mozos.map((m) => (
          <li key={m.mozo_id} className="flex items-center justify-between gap-3">
            <span>Rendir a {m.mozo_name}</span>
            <button
              type="button"
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={onVolver}
            >
              Ir a rendir
            </button>
          </li>
        ))}
      </ul>
      {mozos.length > 0 && (
        <p className="mt-3 text-xs text-rose-900">
          Las rendiciones se hacen desde «Cierre del turno», arriba de la caja.
        </p>
      )}
    </div>
  );
}
