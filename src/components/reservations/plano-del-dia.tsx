"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  Check,
  Clock,
  Globe,
  Pencil,
  Phone,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ElegirMesaBanner } from "@/components/reservations/elegir-mesa-banner";
import { MesaFigura } from "@/components/reservations/mesa-figura";
import { Button } from "@/components/ui/button";
import {
  ReservationEditPanel,
  type EditPatch,
} from "@/components/reservations/reservation-edit-panel";
import {
  mesaSirveParaReserva,
  textoDeAsignacion,
  textoDelModo,
} from "@/lib/reservations/asignar-mesa";
import {
  decideReservation,
  sentarReserva,
  updateReservationDetails,
  updateReservationStatus,
} from "@/lib/reservations/booking-actions";
import { OVERBOOK_HINT } from "@/lib/reservations/edit-window";
import {
  conteoPorTurno,
  encuadreDeMesas,
  renglonesDeMesa,
  reservasDelDia,
  sinMesa,
  TURNOS,
  type EstadoDeMesa,
  type MesaEnElPlano,
  type ReservaEnPlano,
  type TurnoId,
} from "@/lib/reservations/plano-del-dia";
import type {
  DayServiceOption,
  FloorTable,
  ReservationMode,
  ReservationStatus,
} from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/**
 * El salón a la hora que elijas (spec 137).
 *
 * El plano de Operación es la foto del ahora; éste responde la otra pregunta,
 * la que hay que contestar para decidir una solicitud: **cómo queda el sábado a
 * las 21**. Dibujo deliberadamente simple —sin sillas ni detalle de editor—:
 * son 70 mesas que hay que leer de un vistazo.
 *
 * Spec 189 — y ahora es la vista de entrada de Reservas, no la segunda pestaña.
 * Eso le cambia el trabajo: además de pintar el estado, tiene que contestar
 * toda la ficha (quién, teléfono, nota, origen) y dejar operar sin volver a la
 * lista, porque el que la mira ya no tiene la lista delante.
 */

const RELLENO: Record<EstadoDeMesa, string> = {
  libre: "fill-white stroke-foreground/20",
  reservada: "fill-blue-50 stroke-blue-400",
  pendiente: "fill-amber-50 stroke-amber-500",
};

const TEXTO: Record<EstadoDeMesa, string> = {
  libre: "fill-muted-foreground/70",
  reservada: "fill-blue-700",
  pendiente: "fill-amber-800",
};

const DETALLE: Record<EstadoDeMesa, string> = {
  libre: "fill-muted-foreground/40",
  reservada: "fill-blue-500",
  pendiente: "fill-amber-600",
};

const STATUS_LABEL: Partial<Record<ReservationStatus, string>> = {
  pending: "Sin responder",
  confirmed: "Confirmada",
  seated: "En mesa",
};

const STATUS_RING: Partial<Record<ReservationStatus, string>> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  confirmed: "bg-blue-50 text-blue-700 ring-blue-200",
  seated: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

function haceCuanto(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "recién";
  if (mins < 60) return `hace ${mins}m`;
  const horas = Math.floor(mins / 60);
  if (horas < 24) return `hace ${horas}h`;
  return `hace ${Math.floor(horas / 24)}d`;
}

export function PlanoDelDia({
  slug,
  date,
  timezone,
  reservas,
  mesas,
  floorPlans,
  mode = "estricto",
  services = [],
  asignando,
  onAsignarFin,
  onAsignarMesa,
  onChanged,
}: {
  slug: string;
  /** `YYYY-MM-DD` del día que se está mirando. */
  date: string;
  timezone: string;
  reservas: ReservaEnPlano[];
  mesas: FloorTable[];
  floorPlans: Array<{ id: string; name: string }>;
  /** Spec 189 — para editar sin volver a la lista. */
  mode?: ReservationMode;
  services?: DayServiceOption[];
  /**
   * Spec 138 — la solicitud que está esperando mesa. Viene de afuera porque el
   * botón que enciende el modo vive en la bandeja, que es hermana del plano en
   * la pantalla (spec 136).
   */
  asignando?: { id: string; nombre: string; partySize: number } | null;
  /** Se llama al asignar o al cancelar: la página apaga el modo. */
  onAsignarFin?: () => void;
  /** Prende el modo «elegir mesa» para una reserva sin mesa de la lista. */
  onAsignarMesa?: (r: { id: string; nombre: string; partySize: number }) => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Sin `onChanged` (la página server-side) se recarga sola: confirmar desde el
  // plano tiene que verse en el plano.
  const resincronizar = () => (onChanged ? onChanged() : router.refresh());
  /** Spec 192 — `null` = el día entero. Los turnos filtran; no hay recorrido. */
  const [turno, setTurno] = useState<TurnoId | null>(null);
  const [salonId, setSalonId] = useState(floorPlans[0]?.id ?? "");
  const [elegida, setElegida] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  /** Spec 189 — «No vino» y «Cancelar» piden un segundo tap, como en la lista
   *  piden un diálogo: se disparan con el pulgar sobre un plano lleno. */
  const [confirmando, setConfirmando] = useState<ReservationStatus | null>(null);

  const mesasDelSalon = useMemo(
    () => mesas.filter((t) => (salonId ? t.floor_plan_id === salonId : true)),
    [mesas, salonId],
  );

  const estado = useMemo(
    () => reservasDelDia(reservas, mesasDelSalon, { turno, timezone }),
    [reservas, mesasDelSalon, turno, timezone],
  );

  const genericas = useMemo(
    () => sinMesa(reservas, { turno, timezone }),
    [reservas, turno, timezone],
  );

  const porTurno = useMemo(
    () => conteoPorTurno(reservas, timezone),
    [reservas, timezone],
  );

  /** Cuántas reservas se están mostrando en el plano (mesa + genéricas). */
  const enPantalla =
    estado.reduce((n, m) => n + m.reservas.length, 0) + genericas.cantidad;

  /** Encuadre: el rectángulo que ocupan las mesas, con aire alrededor. */
  const viewBox = useMemo(() => encuadreDeMesas(mesasDelSalon), [mesasDelSalon]);

  const seleccionada = estado.find((m) => m.mesa.id === elegida) ?? null;
  /** Spec 192 — con dos turnos en la mesa hay que elegir cuál se mira. */
  const [reservaAbierta, setReservaAbierta] = useState<string | null>(null);
  const reservaDeLaFicha =
    seleccionada?.reservas.find((r) => r.id === reservaAbierta) ??
    seleccionada?.reservas[0] ??
    null;

  // La ficha abierta se resetea si el turno o el salón la dejaron sin sentido:
  // un panel de edición sobre una reserva que ya no está en pantalla guarda
  // cambios a ciegas.
  useEffect(() => {
    setEditando(false);
    setConfirmando(null);
    setReservaAbierta(null);
  }, [elegida, turno, salonId]);

  function asignarMesa(mesa: FloorTable) {
    if (!asignando) return;
    const chequeo = mesaSirveParaReserva({
      mesa,
      partySize: asignando.partySize,
    });
    if (!chequeo.ok) {
      toast.error(chequeo.motivo);
      return;
    }
    start(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: asignando.id,
        table_id: mesa.id,
        party_size: asignando.partySize,
      });
      if (result.ok) {
        toast.success(
          textoDeAsignacion({
            intent: "assign",
            etiquetaMesa: mesa.label,
            nombre: asignando.nombre,
          }),
        );
        onAsignarFin?.();
        resincronizar();
        return;
      }
      // Sobrecupo en flexible: no es un no, es un «confirmá» (spec 077). Acá no
      // hay dónde confirmarlo sin sacar al encargado del plano, así que se lo
      // manda al panel de edición, que sí tiene ese diálogo.
      toast.error(
        result.error.endsWith(OVERBOOK_HINT)
          ? `${result.error} Usá «Editar» en la solicitud.`
          : result.error,
      );
    });
  }

  function decidir(id: string, decision: "confirm" | "reject") {
    start(async () => {
      const result = await decideReservation({
        business_slug: slug,
        id,
        decision,
      });
      if (result.ok) {
        toast.success(
          decision === "confirm" ? "Reserva confirmada." : "Reserva rechazada.",
        );
        setElegida(null);
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  /** Spec 189 — el día se opera desde el plano: sentar, completar, no vino. */
  function cambiarEstado(id: string, status: ReservationStatus) {
    start(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id,
        status,
      });
      if (result.ok) {
        toast.success("Estado actualizado.");
        setConfirmando(null);
        setElegida(null);
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  function sentar(id: string) {
    start(async () => {
      const result = await sentarReserva({
        business_slug: slug,
        reservation_id: id,
      });
      if (result.ok) {
        toast.success("Reserva sentada.");
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  function guardarEdicion(
    id: string,
    patch: EditPatch,
    callbacks: { onDone: () => void; onOverbook: (m: string) => void },
  ) {
    start(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: id,
        ...patch,
      });
      if (result.ok) {
        toast.success("Reserva actualizada.");
        callbacks.onDone();
        setEditando(false);
        resincronizar();
        return;
      }
      // Sobrecupo: no es un «no», es un «confirmá» (spec 077).
      if (result.error.endsWith(OVERBOOK_HINT)) {
        callbacks.onOverbook(result.error);
        return;
      }
      toast.error(result.error);
    });
  }

  if (mesasDelSalon.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-border/70">
        Este salón todavía no tiene mesas cargadas.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl bg-card p-4 ring-1",
        asignando ? "ring-2 ring-indigo-500" : "ring-border/70",
      )}
    >
      {/* Spec 138 — el plano queda esperando el tap, como en Operación. */}
      {asignando && (
        <div className="mb-3">
          <ElegirMesaBanner
            texto={textoDelModo({
              intent: "assign",
              nombre: asignando.nombre,
              partySize: asignando.partySize,
            })}
            onCancelar={() => onAsignarFin?.()}
          />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {floorPlans.length > 1 && (
          <select
            value={salonId}
            onChange={(e) => {
              setSalonId(e.target.value);
              setElegida(null);
            }}
            className="h-8 rounded-xl border-0 bg-muted px-2.5 text-xs font-medium text-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            {floorPlans.map((fp) => (
              <option key={fp.id} value={fp.id}>
                {fp.name}
              </option>
            ))}
          </select>
        )}

        {/* Spec 192 — los turnos FILTRAN; el default es el día entero. Un
            servicio normal tiene una reserva por mesa y por turno, así que casi
            siempre no hace falta tocarlos. */}
        <div
          className="inline-flex rounded-full bg-muted/80 p-1 ring-1 ring-border/60"
          role="tablist"
          aria-label="Turno del plano"
        >
          <BotonTurno
            activo={turno === null}
            onClick={() => setTurno(null)}
            label="Todo el día"
          />
          {TURNOS.map((t) => (
            <BotonTurno
              key={t.id}
              activo={turno === t.id}
              onClick={() => setTurno(turno === t.id ? null : t.id)}
              label={t.label}
              cantidad={porTurno[t.id]}
            />
          ))}
        </div>

        <span className="ml-auto text-[11px] text-muted-foreground">
          {enPantalla === 0
            ? "Sin reservas"
            : `${enPantalla} ${enPantalla === 1 ? "reserva" : "reservas"}`}
        </span>
      </div>

      {/* Spec 059/189 — las genéricas no se dibujan, pero se abren: en flexible
          son la mayoría de la noche y el plano sólo las contaba. Van ARRIBA del
          plano y abiertas: debajo de un SVG de 72vh quedaban fuera de pantalla. */}
      {genericas.cantidad > 0 && (
        <SinMesa
          reservas={genericas.reservas}
          cubiertos={genericas.cubiertos}
          timezone={timezone}
          floorPlans={floorPlans}
          asignandoId={asignando?.id ?? null}
          onAsignarMesa={onAsignarMesa}
        />
      )}

      <svg
        viewBox={viewBox}
        className="h-auto w-full"
        style={{ maxHeight: "72vh" }}
        role="img"
        aria-label={`Plano del salón — ${turno ? TURNOS.find((t) => t.id === turno)?.label : "todo el día"}`}
      >
        {estado.map((m) => (
          <MesaDibujada
            key={m.mesa.id}
            m={m}
            timezone={timezone}
            elegida={m.mesa.id === elegida}
            // Con el modo activo, la mesa que no da la capacidad se ve apagada:
            // que el «no entran» se vea antes del tap, no después.
            apagada={
              !!asignando &&
              !mesaSirveParaReserva({
                mesa: m.mesa,
                partySize: asignando.partySize,
              }).ok
            }
            onClick={() => {
              if (asignando) {
                asignarMesa(m.mesa);
                return;
              }
              setElegida(m.mesa.id === elegida ? null : m.mesa.id);
            }}
          />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <Leyenda className="bg-card ring-foreground/20" label="libre" />
        <Leyenda className="bg-blue-50 ring-blue-400" label="reservada" />
        <Leyenda
          className="bg-amber-50 ring-amber-500 ring-dashed"
          label="solicitud sin responder"
        />
      </div>

      {seleccionada && (
        <FichaDeMesa
          m={seleccionada}
          reserva={reservaDeLaFicha}
          onElegirReserva={setReservaAbierta}
          timezone={timezone}
          multiSalon={floorPlans.length > 1}
          salonName={
            floorPlans.find((fp) => fp.id === seleccionada.mesa.floor_plan_id)
              ?.name ?? null
          }
          pending={pending}
          editando={editando}
          confirmando={confirmando}
          mode={mode}
          services={services}
          activeTables={mesas}
          floorPlans={floorPlans}
          onCerrar={() => setElegida(null)}
          onEditar={() => setEditando(true)}
          onCerrarEdicion={() => setEditando(false)}
          onGuardar={(patch, callbacks) =>
            guardarEdicion(reservaDeLaFicha!.id, patch, callbacks)
          }
          onDecidir={(d) => decidir(reservaDeLaFicha!.id, d)}
          onSentar={() => sentar(reservaDeLaFicha!.id)}
          onPedirConfirmacion={setConfirmando}
          onCambiarEstado={(s) => cambiarEstado(reservaDeLaFicha!.id, s)}
        />
      )}

    </div>
  );
}

/* ─── La ficha de la mesa elegida ────────────────────────────────────────── */

function FichaDeMesa({
  m,
  reserva,
  onElegirReserva,
  timezone,
  multiSalon,
  salonName,
  pending,
  editando,
  confirmando,
  mode,
  services,
  activeTables,
  floorPlans,
  onCerrar,
  onEditar,
  onCerrarEdicion,
  onGuardar,
  onDecidir,
  onSentar,
  onPedirConfirmacion,
  onCambiarEstado,
}: {
  m: MesaEnElPlano;
  /** La reserva de la mesa que se está mirando (la primera, por defecto). */
  reserva: ReservaEnPlano | null;
  onElegirReserva: (id: string) => void;
  timezone: string;
  multiSalon: boolean;
  salonName: string | null;
  pending: boolean;
  editando: boolean;
  confirmando: ReservationStatus | null;
  mode: ReservationMode;
  services: DayServiceOption[];
  activeTables: FloorTable[];
  floorPlans: Array<{ id: string; name: string }>;
  onCerrar: () => void;
  onEditar: () => void;
  onCerrarEdicion: () => void;
  onGuardar: (
    patch: EditPatch,
    callbacks: { onDone: () => void; onOverbook: (m: string) => void },
  ) => void;
  onDecidir: (decision: "confirm" | "reject") => void;
  onSentar: () => void;
  onPedirConfirmacion: (s: ReservationStatus | null) => void;
  onCambiarEstado: (s: ReservationStatus) => void;
}) {
  const { mesa, estado, reservas } = m;

  return (
    <div
      className={cn(
        "mt-3 rounded-xl p-3.5 ring-1",
        estado === "pendiente"
          ? "bg-amber-50/70 ring-amber-200"
          : "bg-muted/50 ring-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Mesa {mesa.label}
            {multiSalon && salonName ? ` · ${salonName}` : ""} · {mesa.seats}{" "}
            lugares
          </p>

          {/* Spec 192 — la mesa con dos turnos: se elige cuál se mira. */}
          {reservas.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {reservas.map((r) => {
                const activa = r.id === reserva?.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onElegirReserva(r.id)}
                    className={cn(
                      "rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums ring-1 transition",
                      activa
                        ? "bg-primary text-white ring-primary"
                        : "bg-card text-foreground/70 ring-border hover:bg-muted",
                      r.status === "pending" && !activa && "text-amber-800 ring-amber-300",
                    )}
                  >
                    {formatInTimeZone(new Date(r.starts_at), timezone, "HH:mm")}
                  </button>
                );
              })}
            </div>
          )}

          {reserva ? (
            <>
              <p className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-foreground">
                <User className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="truncate">{reserva.customer_name}</span>
                {STATUS_LABEL[reserva.status] && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                      STATUS_RING[reserva.status],
                    )}
                  >
                    {STATUS_LABEL[reserva.status]}
                  </span>
                )}
              </p>

              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/70">
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {formatInTimeZone(new Date(reserva.starts_at), timezone, "HH:mm")}
                  {" → "}
                  {formatInTimeZone(new Date(reserva.ends_at), timezone, "HH:mm")}
                </span>
                <span className="font-medium">{reserva.party_size} comensales</span>
                {reserva.service ? (
                  <span className="capitalize text-muted-foreground">{reserva.service}</span>
                ) : null}
                {reserva.customer_phone ? (
                  <a
                    href={`tel:${reserva.customer_phone}`}
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {reserva.customer_phone}
                  </a>
                ) : null}
              </p>

              {reserva.notes ? (
                <p className="mt-1.5 rounded-lg bg-white/70 px-2 py-1 text-[11px] italic text-foreground/70 ring-1 ring-border/70">
                  &ldquo;{reserva.notes}&rdquo;
                </p>
              ) : null}

              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/70">
                {reserva.source ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ring-1",
                      reserva.source === "web"
                        ? "bg-sky-50 text-sky-700 ring-sky-200"
                        : "bg-muted text-foreground/70 ring-border",
                    )}
                  >
                    {reserva.source === "web" ? (
                      <Globe className="h-2.5 w-2.5" />
                    ) : (
                      <User className="h-2.5 w-2.5" />
                    )}
                    {reserva.source === "web" ? "Web" : "Admin"}
                  </span>
                ) : null}
                {reserva.created_at ? (
                  <span title={reserva.created_at}>
                    creada {haceCuanto(reserva.created_at)}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Sin reservas {"en este turno."}
            </p>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCerrar}
          aria-label="Cerrar ficha"
          className="rounded-full"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Acciones — las mismas que la fila de la lista, por estado. */}
      {reserva && !editando && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {reserva.status === "pending" && (
            <>
              <BotonFicha
                tone="ok"
                icon={<Check className="h-3.5 w-3.5" />}
                label="Confirmar"
                disabled={pending}
                onClick={() => onDecidir("confirm")}
              />
              <BotonFicha
                tone="neutral"
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="Editar"
                disabled={pending}
                onClick={onEditar}
              />
              <BotonFicha
                tone="danger"
                icon={<X className="h-3.5 w-3.5" />}
                label="Rechazar"
                disabled={pending}
                onClick={() => onDecidir("reject")}
              />
            </>
          )}

          {reserva.status === "confirmed" && (
            <>
              <BotonFicha
                tone="ok"
                icon={<UserPlus className="h-3.5 w-3.5" />}
                label="Sentar"
                disabled={pending}
                onClick={onSentar}
              />
              <BotonFicha
                tone="neutral"
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="Editar"
                disabled={pending}
                onClick={onEditar}
              />
              <BotonFicha
                tone="warn"
                icon={<Clock className="h-3.5 w-3.5" />}
                label={confirmando === "no_show" ? "¿Seguro?" : "No vino"}
                disabled={pending}
                onClick={() =>
                  confirmando === "no_show"
                    ? onCambiarEstado("no_show")
                    : onPedirConfirmacion("no_show")
                }
              />
              <BotonFicha
                tone="danger"
                icon={<X className="h-3.5 w-3.5" />}
                label={confirmando === "cancelled" ? "¿Seguro?" : "Cancelar"}
                disabled={pending}
                onClick={() =>
                  confirmando === "cancelled"
                    ? onCambiarEstado("cancelled")
                    : onPedirConfirmacion("cancelled")
                }
              />
            </>
          )}

          {reserva.status === "seated" && (
            <BotonFicha
              tone="ok"
              icon={<Check className="h-3.5 w-3.5" />}
              label="Completar"
              disabled={pending}
              onClick={() => onCambiarEstado("completed")}
            />
          )}
        </div>
      )}

      {/* Spec 097 — el mismo panel de edición de la lista y de la bandeja. */}
      {reserva && editando && (
        <ReservationEditPanel
          row={reserva}
          timezone={timezone}
          mode={mode}
          services={services}
          activeTables={activeTables}
          floorPlans={floorPlans}
          multiSalon={multiSalon}
          pending={pending}
          onSave={onGuardar}
          onClose={onCerrarEdicion}
          className="mt-3"
        />
      )}
    </div>
  );
}

function BotonFicha({
  tone,
  icon,
  label,
  disabled,
  onClick,
}: {
  tone: "ok" | "neutral" | "warn" | "danger";
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const variants: Record<
    typeof tone,
    "default" | "outline" | "destructive"
  > = {
    ok: "default",
    neutral: "outline",
    warn: "destructive",
    danger: "destructive",
  };
  return (
    <Button type="button" variant={variants[tone]} onClick={onClick} disabled={disabled}>
      {icon}
      {label}
    </Button>
  );
}

/* ─── Las reservas sin mesa de ese momento ───────────────────────────────── */

function SinMesa({
  reservas,
  cubiertos,
  timezone,
  floorPlans,
  asignandoId,
  onAsignarMesa,
}: {
  reservas: ReservaEnPlano[];
  cubiertos: number;
  timezone: string;
  floorPlans: Array<{ id: string; name: string }>;
  asignandoId: string | null;
  onAsignarMesa?: (r: { id: string; nombre: string; partySize: number }) => void;
}) {
  const [abierto, setAbierto] = useState(true);
  const salonDe = (id?: string | null) =>
    floorPlans.find((fp) => fp.id === id)?.name ?? null;

  return (
    <div className="mb-3 rounded-xl bg-muted/50 p-3 ring-1 ring-border">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-between gap-2 px-0 py-0 text-left font-normal hover:bg-transparent"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        <span className="text-xs font-semibold text-foreground/80">
          {reservas.length} {reservas.length === 1 ? "reserva" : "reservas"} sin
          mesa · {cubiertos} cubiertos
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">
          {abierto ? "Ocultar" : "Ver"}
        </span>
      </Button>

      {abierto && (
        <ul className="mt-2 space-y-1.5">
          {reservas.map((r) => {
            const salon = salonDe(r.floor_plan_id);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-card px-2.5 py-1.5 text-xs text-foreground/70 ring-1 ring-border/70"
              >
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {formatInTimeZone(new Date(r.starts_at), timezone, "HH:mm")}
                </span>
                <span className="font-medium text-foreground">
                  {r.customer_name}
                </span>
                <span>{r.party_size}p</span>
                {salon ? <span className="text-muted-foreground">{salon}</span> : null}
                {r.customer_phone ? (
                  <a
                    href={`tel:${r.customer_phone}`}
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {r.customer_phone}
                  </a>
                ) : null}
                {STATUS_LABEL[r.status] && (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                      STATUS_RING[r.status],
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                )}
                {onAsignarMesa && r.status !== "seated" && (
                  <Button
                    type="button"
                    size="sm"
                    variant={asignandoId === r.id ? "default" : "outline"}
                    className={cn("h-7 px-2.5 text-[11px]", !STATUS_LABEL[r.status] && "ml-auto")}
                    disabled={asignandoId === r.id}
                    onClick={() =>
                      onAsignarMesa({
                        id: r.id,
                        nombre: r.customer_name,
                        partySize: r.party_size,
                      })
                    }
                  >
                    {asignandoId === r.id ? "Elegí la mesa" : "Asignar mesa"}
                  </Button>
                )}
                {r.notes ? (
                  <span className="w-full truncate text-[11px] italic text-muted-foreground">
                    &ldquo;{r.notes}&rdquo;
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MesaDibujada({
  m,
  timezone,
  elegida,
  apagada = false,
  onClick,
}: {
  m: MesaEnElPlano;
  timezone: string;
  elegida: boolean;
  /** Spec 138 — no sirve para la solicitud que se está asignando. */
  apagada?: boolean;
  onClick: () => void;
}) {
  const { mesa, estado, reservas } = m;
  const lineas = renglonesDeMesa(mesa, reservas, timezone);
  const primera = reservas[0] ?? null;

  return (
    <MesaFigura
      mesa={mesa}
      onClick={onClick}
      role="button"
      aria-label={
        primera
          ? `Mesa ${mesa.label}, ${estado}: ${primera.customer_name}, ${primera.party_size} comensales a las ${formatInTimeZone(new Date(primera.starts_at), timezone, "HH:mm")}${reservas.length > 1 ? ` y ${reservas.length - 1} reserva(s) más` : ""}`
          : `Mesa ${mesa.label}, ${estado}`
      }
      className={cn(
        RELLENO[estado],
        estado === "pendiente" ? "[stroke-dasharray:5_3]" : "",
        elegida ? "stroke-[3]" : "stroke-[1.5]",
        apagada ? "opacity-30" : "",
        "cursor-pointer transition",
      )}
      textClassName={TEXTO[estado]}
      lineas={lineas}
      lineasClassName={DETALLE[estado]}
    />
  );
}

function Leyenda({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-2.5 rounded ring-1", className)} />
      {label}
    </span>
  );
}

function BotonTurno({
  activo,
  onClick,
  label,
  cantidad,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
  /** Sin reservas el turno se ve apagado, pero se puede tocar igual. */
  cantidad?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activo}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition",
        activo
          ? "bg-card text-foreground shadow-[0_1px_2px_rgba(24,24,27,0.06)]"
          : cantidad === 0
            ? "text-muted-foreground/70 hover:text-foreground/70"
            : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {cantidad !== undefined && cantidad > 0 && (
        <span className="ml-1.5 tabular-nums text-muted-foreground/70">{cantidad}</span>
      )}
    </button>
  );
}
