"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Plus, ScrollText, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
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
import {
  crearCaja,
  renombrarCaja,
  setFondoFijoCaja,
  setCajaActive,
  setCajaDefault,
} from "@/lib/caja/actions";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

import { Diferencia } from "@/components/admin/local/cierres-client";
import type {
  Caja,
  CajaConEstado,
  CajaLiveStats,
  CorteDelHistorial,
} from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { duracionDelTurno } from "@/lib/caja/formato-cierre";
import { cn } from "@/lib/utils";

/** Una caja con lo que está haciendo (spec 153 · D3). */
export type CajaConVida = {
  caja: CajaConEstado;
  stats: CajaLiveStats | null;
  ultimoCorte: CorteDelHistorial | null;
  operadores: string[];
};

type Props = {
  slug: string;
  timezone: string;
  cajas: CajaConVida[];
  /** El encargado entró acá en la spec 153; el permiso de tocar es aparte. */
  puedeConfigurar: boolean;
};

/**
 * Las cajas del local (spec 153 · D3).
 *
 * **Dejó de ser una lista de config.** Antes mostraba nombre, renombrar y
 * pausar: de una caja llamada «Caja Principal» no se aprendía nada. Ahora cada
 * una dice qué está haciendo — cuánto hay adentro, cómo cerró la última vez y
 * quién la opera — que es dato que ya se calculaba y no estaba junto en ningún
 * lado.
 *
 * El caso que esto resuelve solo: una caja **sin operadores asignados** no
 * avisaba nada, y el que cobrara ahí terminaba rindiéndose a sí mismo
 * (spec 139 · D3). Ahora se ve de un vistazo.
 *
 * El día a día (sangrías, cortes) sigue en `/admin/operacion?tab=caja`: acá se
 * mira y se configura, no se opera.
 */
export function CajasClient({ slug, timezone, cajas, puedeConfigurar }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [crearOpen, setCrearOpen] = useState(false);
  const [editing, setEditing] = useState<Caja | null>(null);

  const activas = cajas.filter((c) => c.caja.is_active);
  const inactivas = cajas.filter((c) => !c.caja.is_active).map((c) => c.caja);

  const handleToggleActive = (caja: Caja, next: boolean) => {
    startTransition(async () => {
      const r = await setCajaActive(caja.id, next, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(next ? "Caja habilitada" : "Caja deshabilitada");
      router.refresh();
    });
  };

  const handleSetDefault = (caja: Caja) => {
    startTransition(async () => {
      const r = await setCajaDefault(caja.id, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Los cobros online van a ${caja.name}`);
      router.refresh();
    });
  };

  return (
    <>
      {/* Acciones arriba a la derecha: el libro (lectura) y crear caja. */}
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/${slug}/admin/caja/movimientos`}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
        >
          <ScrollText className="size-4" />
          Ver movimientos
        </Link>
        <button
          type="button"
          onClick={() => setCrearOpen(true)}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95 active:translate-y-px"
          style={{
            background: "var(--brand, #18181B)",
            color: "var(--brand-foreground, white)",
          }}
        >
          <Plus className="size-4" />
          Nueva caja
        </button>
      </div>

      {/* Empty global */}
      {cajas.length === 0 && (
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-8 text-center">
            <div
              className="flex size-12 items-center justify-center rounded-full"
              style={{ background: "var(--brand-soft, #F4F4F5)" }}
            >
              <Wallet
                className="size-6"
                style={{ color: "var(--brand, #18181B)" }}
              />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-zinc-900">
                Todavía no hay cajas
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                Creá la primera caja del local. Una caja = un lugar donde se
                cobra (Salón, Barra, Caja 1…).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCrearOpen(true)}
              className="mt-1 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95"
              style={{
                background: "var(--brand, #18181B)",
                color: "var(--brand-foreground, white)",
              }}
            >
              <Plus className="size-4" />
              Crear primera caja
            </button>
          </div>
        </Surface>
      )}

      {activas.length > 0 && (
        <div className="space-y-4">
          {activas.map((v) => (
            <CajaCard
              key={v.caja.id}
              vida={v}
              slug={slug}
              timezone={timezone}
              puedeConfigurar={puedeConfigurar}
              onRenombrar={() => setEditing(v.caja)}
              onDeshabilitar={() => handleToggleActive(v.caja, false)}
              onHacerDefault={() => handleSetDefault(v.caja)}
            />
          ))}
        </div>
      )}

      {/* Inactivas */}
      {inactivas.length > 0 && (
        <Surface tone="subtle" padding="compact" className="space-y-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Pausadas · {inactivas.length}
          </p>
          <p className="text-xs text-zinc-500">
            No aparecen para cobrar. El histórico de cortes sigue accesible.
          </p>
          <ul className="space-y-1.5">
            {inactivas.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-zinc-200/70"
              >
                <div className="flex items-center gap-2.5">
                  <Wallet className="size-3.5 text-zinc-400" />
                  <span className="text-sm text-zinc-600">{c.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="inline-flex size-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
                    aria-label="Renombrar"
                    title="Renombrar"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(c, true)}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100"
                  >
                    <Eye className="size-3" />
                    Habilitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {/* Modal: crear caja */}
      <CrearCajaModal
        open={crearOpen}
        onOpenChange={setCrearOpen}
        slug={slug}
        onCreated={() => {
          setCrearOpen(false);
          router.refresh();
        }}
      />

      {/* Modal: renombrar */}
      {editing && (
        <EditarCajaModal
          open={editing !== null}
          caja={editing}
          slug={slug}
          onOpenChange={(o) => !o && setEditing(null)}
          onRenamed={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ── Fila de caja activa ─────────────────────────────────────────

/**
 * Una caja con lo que está haciendo. El header lleva la identidad y las
 * acciones; abajo, la franja de cuatro datos que antes no estaban en ningún
 * lado juntos.
 */
function CajaCard({
  vida,
  slug,
  timezone,
  puedeConfigurar,
  onRenombrar,
  onDeshabilitar,
  onHacerDefault,
}: {
  vida: CajaConVida;
  slug: string;
  timezone: string;
  puedeConfigurar: boolean;
  onRenombrar: () => void;
  onDeshabilitar: () => void;
  onHacerDefault: () => void;
}) {
  const { caja, stats, ultimoCorte, operadores } = vida;
  // Los stats se piden en el server, pero una caja recién creada o una consulta
  // que falló vuelven `null`: entonces no se sabe, que no es lo mismo que $0.
  const seSabeCuantoHay = stats != null;

  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className={cn(
              "inline-flex size-11 shrink-0 items-center justify-center rounded-full",
              caja.is_default ? "text-white" : "bg-zinc-100 text-zinc-600",
            )}
            style={caja.is_default ? { background: "var(--brand, #18181B)" } : undefined}
          >
            <Wallet className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                {caja.name}
              </h2>
              {caja.is_default && (
                <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 text-[0.65rem] font-semibold text-white">
                  Principal
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[0.65rem] font-semibold text-emerald-800">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Cobrando
              </span>
            </div>
            <p className="mt-1 text-[0.8125rem] text-zinc-600">
              {caja.is_default
                ? "Barre el salón al cerrar · acá caen los cobros online"
                : "Cierra sola, sin tocar el salón ni las rendiciones"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/${slug}/admin/operacion?tab=caja&caja=${caja.id}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            Ver ahora
          </Link>
          <Link
            href={`/${slug}/admin/caja/cierres?caja=${caja.id}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200/70 transition hover:bg-zinc-50"
          >
            Cierres
          </Link>
          {puedeConfigurar && (
            <>
              <button
                type="button"
                onClick={onRenombrar}
                className="grid size-8 place-items-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
                aria-label={`Renombrar ${caja.name}`}
                title="Renombrar"
              >
                <Pencil className="size-3.5" />
              </button>
              {!caja.is_default && (
                <button
                  type="button"
                  onClick={onHacerDefault}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100"
                  title="Los cobros online van a caer acá"
                >
                  Hacer principal
                </button>
              )}
              {/* La principal no se pausa: los cobros online se quedarían sin
                  dónde caer (`payments.caja_id` es NOT NULL). */}
              {!caja.is_default && (
                <button
                  type="button"
                  onClick={onDeshabilitar}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100"
                >
                  Pausar
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-zinc-100 lg:grid-cols-4">
        <Dato label="Adentro ahora">
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {seSabeCuantoHay ? formatCurrency(stats.expected_cash_cents) : "—"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {seSabeCuantoHay
              ? `Desde hace ${duracionDelTurno(stats.periodo_desde, new Date().toISOString())}`
              : "No se pudo calcular"}
          </p>
        </Dato>

        <Dato label="Último cierre">
          {ultimoCorte ? (
            <>
              {/* Los cortes anteriores a la spec 139 no tienen número, y no se
                  retro-numeran. Un «—» grande no dice nada: en ese caso el dato
                  que identifica al cierre es CUÁNDO fue, así que sube al
                  renglón principal en vez de dejar el hueco. */}
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
                {ultimoCorte.numero != null
                  ? `Nº ${ultimoCorte.numero}`
                  : formatInTimeZone(
                      new Date(ultimoCorte.created_at),
                      timezone,
                      "d/M",
                      { locale: es },
                    )}
              </p>
              <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
                {formatInTimeZone(
                  new Date(ultimoCorte.created_at),
                  timezone,
                  ultimoCorte.numero != null ? "EEE d/M · HH:mm" : "EEE · HH:mm",
                  { locale: es },
                )}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-400">—</p>
              <p className="mt-0.5 text-xs text-zinc-400">Nunca se cortó</p>
            </>
          )}
        </Dato>

        <Dato label="Cerró con">
          {ultimoCorte ? (
            <>
              <div className="mt-1.5">
                <Diferencia cents={ultimoCorte.difference_cents} />
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                {ultimoCorte.difference_cents === 0
                  ? "Cerró justo"
                  : ultimoCorte.difference_cents < 0
                    ? "Faltó plata"
                    : "Sobró plata"}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-zinc-400">Sin cierres todavía</p>
          )}
        </Dato>

        <Dato label="La operan">
          {operadores.length > 0 ? (
            <>
              <p className="mt-1.5 truncate text-sm text-zinc-700">
                {operadores.join(", ")}
              </p>
              <p className="mt-1 text-xs text-zinc-400">No rinden: cobran acá</p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-zinc-400">Nadie asignado</p>
              {/* Spec 139 · D3 — sin operadores, el que cobre acá entra a la
                  lista de rendición y termina rindiéndose a sí mismo. */}
              <p className="mt-1 text-xs text-amber-700">
                El que cobre acá va a tener que rendirse a sí mismo
              </p>
            </>
          )}
        </Dato>
      </div>
    </section>
  );
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-5">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function CrearCajaModal({
  open,
  onOpenChange,
  slug,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    startTransition(async () => {
      const r = await crearCaja(trimmed, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Caja "${r.data.name}" creada`);
      setName("");
      onCreated();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva caja</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nombre</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Salón / Barra / Caja 1…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <p className="text-xs text-zinc-500">
            Usá el nombre que figura físicamente. Único por local.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={name.trim() === "" || pending} onClick={submit}>
            {pending ? "Creando…" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarCajaModal({
  open,
  caja,
  slug,
  onOpenChange,
  onRenamed,
}: {
  open: boolean;
  caja: Caja;
  slug: string;
  onOpenChange: (o: boolean) => void;
  onRenamed: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(caja.name);
  // Spec 177 · Parte C — en pesos para el que lo tipea, en centavos para todo
  // lo demás. La caja mayor no se arquea, así que no lleva fondo (spec 160).
  const [fondo, setFondo] = useState(String(caja.fondo_fijo_cents / 100));
  const fondoCents = Math.max(0, Math.round(Number(fondo || 0) * 100));

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      onOpenChange(false);
      return;
    }
    if (trimmed === caja.name && fondoCents === caja.fondo_fijo_cents) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      if (trimmed !== caja.name) {
        const r = await renombrarCaja(caja.id, trimmed, slug);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
      }
      if (fondoCents !== caja.fondo_fijo_cents) {
        const f = await setFondoFijoCaja(caja.id, fondoCents, slug);
        if (!f.ok) {
          toast.error(f.error);
          return;
        }
      }
      toast.success("Caja guardada");
      onRenamed();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar caja</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nombre</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        {!caja.is_administrative && (
          <div className="mt-4 space-y-2">
            <Label htmlFor="fondo-fijo">Fondo de caja</Label>
            <Input
              id="fondo-fijo"
              type="number"
              inputMode="decimal"
              min={0}
              value={fondo}
              onChange={(e) => setFondo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <p className="text-xs text-zinc-500">
              Lo que queda en el cajón al cerrar, para tener cambio al abrir.
              El cierre retira lo contado menos este monto.{" "}
              {fondoCents === 0 && "En $0 se retira todo, como hasta ahora."}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
