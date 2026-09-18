"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, MapPin, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalFooter,
  ModalHeader,
  PanelContent,
} from "@/components/ui/modal";
import { SectionLabel } from "@/components/ui/section-label";
import {
  fetchAvailability,
  fetchFlexibleAvailability,
  fetchReservationContext,
} from "@/lib/reservations/availability-actions";
import {
  createFlexibleReservation,
  createReservationFromAdmin,
} from "@/lib/reservations/booking-actions";
import { arrivalSlots } from "@/lib/reservations/flexible-availability";
import { CustomerFields } from "@/components/shared/customer-fields";
import { MesaPickerPlano } from "@/components/reservations/mesa-picker-plano";
import { partySizeFromKey } from "@/lib/mozo/party-size-keys";
import { useArrowFocus } from "@/lib/ui/use-arrow-focus";
import { useRovingList } from "@/lib/ui/use-roving-list";
import type { FloorTable, ReservationMode, ReservationService } from "@/lib/reservations/types";

type Slot = {
  slot: string;
  starts_at: string;
  ends_at: string;
  /** Spec 144 — mesas libres EN ese slot (modo estricto). */
  free_table_ids?: string[];
};
type FreeTable = { id: string; label: string; seats: number };

/**
 * Integración con el modo "elegir mesa en el plano" del salón (spec 059).
 * Cuando viene, el form deja de mostrar el `<select>` de mesas y delega la
 * elección al plano — misma mecánica que "Asignar mesa" de una reserva ya creada.
 */
export type TablePickerBridge = {
  pickedTableId: string | null;
  pickedLabel: string | null;
  /** true mientras el plano está esperando el tap. */
  picking: boolean;
  onRequest: () => void;
  onClear: () => void;
};

const INPUT_CLS_BASE =
  "h-12 w-full rounded-xl border border-border bg-card px-3 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";
const INPUT_CLS = `mt-1 ${INPUT_CLS_BASE}`;
const LABEL_CLS = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function maxDateISO(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Formulario de alta de reserva del encargado. Sin shell propio: lo envuelven
 * el `NewReservationModal` (sheet, página de reservas) y el `NuevaReservaPanel`
 * (sidebar del salón), así los dos comparten exactamente la misma lógica.
 */
export function ReservaForm({
  slug,
  tables,
  floorPlanId,
  floorPlans = [],
  defaultFloorPlanId = null,
  onDone,
  tablePicker,
  footerClassName,
  onChanged,
}: {
  slug: string;
  tables: FloorTable[];
  /** Salón fijo: lo pasa el sidebar, que ya está parado en un plano. */
  floorPlanId: string | null;
  /**
   * Spec 144 — salones del negocio. Cuando vienen (la hoja de la tab de
   * Reservas, que no está parada en ninguno), el salón se **elige acá**: sin él
   * la reserva se guarda sin zona y el cupo del servicio no la cuenta.
   */
  floorPlans?: Array<{ id: string; name: string }>;
  /** Salón preelegido (la tab de Operación filtrada por un solo salón). */
  defaultFloorPlanId?: string | null;
  onDone: () => void;
  tablePicker?: TablePickerBridge;
  footerClassName?: string;
  /** Spec 103: re-sincroniza al que me renderiza (default: refresh de ruta). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Datos compartidos.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [tableId, setTableId] = useState<string | undefined>(undefined);

  // Buscar cliente existente (reusa buscarClientes de spec 054).

  // Modo + servicios (spec 059). mode=null → cargando.
  const [mode, setMode] = useState<ReservationMode | null>(null);
  const [services, setServices] = useState<ReservationService[]>([]);

  // Estricto: slots.
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Flexible: servicio + hora + mesas libres + cubiertos.
  const [service, setService] = useState<string>("");
  const [arrivalTime, setArrivalTime] = useState<string>("");
  const [flexTables, setFlexTables] = useState<FreeTable[]>([]);
  const [flexInfo, setFlexInfo] = useState<{
    reservedCovers: number;
    softCapacity: number | null;
    overCapacity: boolean;
    outOfTables: boolean;
  } | null>(null);
  const [loadingFlex, setLoadingFlex] = useState(false);

  // ── Salón (spec 144) ──────────────────────────────────────────────────────
  //
  // Reservable = tiene al menos una mesa activa que no sea de barra; es el
  // mismo criterio que el motor (`getAllReservableTables` filtra `is_bar`), así
  // que ningún salón que el server vaya a rechazar aparece en la lista.
  const salones = useMemo(
    () =>
      floorPlans.filter((fp) =>
        tables.some(
          (t) => t.floor_plan_id === fp.id && t.status === "active" && !t.is_bar,
        ),
      ),
    [floorPlans, tables],
  );
  const [salonId, setSalonId] = useState<string | null>(null);

  // Con un solo salón no hay nada que preguntar (y la tab de Operación puede
  // venir filtrada por uno: ése arranca elegido).
  useEffect(() => {
    if (salonId && salones.some((s) => s.id === salonId)) return;
    if (salones.length === 1) {
      setSalonId(salones[0].id);
      return;
    }
    if (defaultFloorPlanId && salones.some((s) => s.id === defaultFloorPlanId)) {
      setSalonId(defaultFloorPlanId);
    }
  }, [salones, salonId, defaultFloorPlanId]);

  /** El salón con el que se consulta y se guarda: fijo (sidebar) o elegido. */
  const zonaId = floorPlanId ?? salonId;
  /** Hay que elegirlo antes de seguir. */
  const faltaElegirSalon = !tablePicker && salones.length > 1 && !zonaId;

  // La mesa efectiva sale del plano cuando hay bridge; si no, del picker.
  const effectiveTableId = tablePicker ? (tablePicker.pickedTableId ?? undefined) : tableId;

  useEffect(() => {
    fetchReservationContext({ business_slug: slug }).then((r) => {
      if (r.ok) {
        setMode(r.data.mode);
        setServices(r.data.services);
      } else {
        setMode("estricto");
      }
    });
  }, [slug]);

  /**
   * Spec 144 · D7 — un servicio configurado para una zona sólo se ofrece en esa
   * zona (más los que no tienen zona). Si el salón elegido no tiene ninguno
   * —el Bar de golf-jcr no tiene servicios cargados— se ofrecen todos igual:
   * bloquear la reserva sería una regresión silenciosa.
   */
  const serviciosDelSalon = useMemo(() => {
    if (!zonaId) return services;
    const propios = services.filter(
      (s) => s.floor_plan_id === zonaId || s.floor_plan_id == null,
    );
    return propios.length > 0 ? propios : services;
  }, [services, zonaId]);

  // Servicios aplicables a la fecha elegida (día exacto o "todos los días").
  const serviceNames = useMemo(() => {
    const dow = new Date(
      Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ),
    ).getUTCDay();
    const applicable = serviciosDelSalon.filter(
      (s) => s.day_of_week == null || s.day_of_week === dow,
    );
    return Array.from(new Set(applicable.map((s) => s.name)));
  }, [serviciosDelSalon, date]);

  const selectedServiceRow = useMemo(() => {
    if (!service) return null;
    const dow = new Date(
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
    ).getUTCDay();
    const matches = serviciosDelSalon.filter((s) => s.name === service);
    return (
      matches.find((s) => s.day_of_week === dow) ??
      matches.find((s) => s.day_of_week == null) ??
      matches[0] ??
      null
    );
  }, [serviciosDelSalon, service, date]);

  const arrivalOptions = useMemo(
    () =>
      selectedServiceRow
        ? arrivalSlots(selectedServiceRow.opens_at, selectedServiceRow.closes_at)
        : [],
    [selectedServiceRow],
  );

  // Oculta los horarios ya pasados cuando la fecha elegida es hoy.
  const shownArrivalOptions = useMemo(() => {
    if (date !== todayISO()) return arrivalOptions;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return arrivalOptions.filter((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m >= nowMin;
    });
  }, [arrivalOptions, date]);

  useEffect(() => {
    if (mode === "flexible" && serviceNames.length > 0 && !serviceNames.includes(service)) {
      setService(serviceNames[0]);
    }
  }, [mode, serviceNames, service]);

  // Estricto: slots por fecha + party (del salón elegido, spec 144).
  useEffect(() => {
    if (mode !== "estricto" || !date || partySize < 1) return;
    setSelectedSlot(null);
    if (faltaElegirSalon) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    fetchAvailability({
      business_slug: slug,
      date,
      party_size: partySize,
      ...(zonaId ? { floor_plan_id: zonaId } : {}),
    }).then((r) => {
      setLoadingSlots(false);
      setSlots(r.ok ? r.data : []);
    });
  }, [mode, slug, date, partySize, zonaId, faltaElegirSalon]);

  // Flexible: mesas libres + cubiertos del servicio.
  useEffect(() => {
    if (mode !== "flexible" || !service || faltaElegirSalon) {
      setFlexTables([]);
      setFlexInfo(null);
      return;
    }
    setLoadingFlex(true);
    if (!tablePicker) setTableId(undefined);
    fetchFlexibleAvailability({
      business_slug: slug,
      date,
      service,
      party_size: partySize,
      ...(zonaId ? { floor_plan_id: zonaId } : {}),
    }).then((r) => {
      setLoadingFlex(false);
      if (r.ok) {
        setFlexTables(r.data.freeTables);
        setFlexInfo({
          reservedCovers: r.data.reservedCovers,
          softCapacity: r.data.softCapacity,
          overCapacity: r.data.overCapacity,
          outOfTables: r.data.outOfTables,
        });
      } else {
        setFlexTables([]);
        setFlexInfo(null);
      }
    });
    // `tablePicker` se omite a propósito: sólo decide si reseteamos la mesa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, slug, date, service, partySize, zonaId, faltaElegirSalon]);

  // Spec 077 — el servicio está lleno cuando se agotaron los cubiertos del cupo
  // o cuando no queda mesa libre que entre el party. Al cliente eso lo frena; a
  // el encargado sólo le pide confirmar (`allow_overbook`).
  // Spec 081 — el veredicto de mesas lo da el motor (cuenta lo que consumen las
  // reservas vivas + el colchón de walk-ins), no la lista de mesas asignables:
  // para un grupo de 10 puede no haber ninguna mesa individual y sí lugar
  // juntando dos.
  const sinMesasLibres = mode === "flexible" && !!service && !loadingFlex && !!flexInfo?.outOfTables;
  const servicioLleno = !!flexInfo?.overCapacity || sinMesasLibres;

  const [overbookOk, setOverbookOk] = useState(false);
  // Cambió el servicio/fecha/personas → la confirmación anterior ya no aplica.
  useEffect(() => {
    setOverbookOk(false);
  }, [service, date, partySize, zonaId]);

  // El teléfono es opcional cuando la carga el encargado (el libro del club no
  // siempre lo tiene). El cliente web sí lo necesita — eso lo valida el server.
  const baseValid = name.trim().length > 0 && !pending && !faltaElegirSalon;
  const canSubmit =
    mode === "flexible"
      ? baseValid &&
        service.length > 0 &&
        arrivalTime.length > 0 &&
        (!servicioLleno || overbookOk)
      : baseValid && selectedSlot !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result =
        mode === "flexible"
          ? await createFlexibleReservation({
              business_slug: slug,
              date,
              service,
              party_size: partySize,
              customer_name: name.trim(),
              customer_phone: phone.trim(),
              notes: notes.trim() || undefined,
              source: "admin",
              ...(overbookOk ? { allow_overbook: true } : {}),
              ...(arrivalTime ? { arrival_time: arrivalTime } : {}),
              ...(effectiveTableId ? { table_id: effectiveTableId } : {}),
              ...(zonaId ? { floor_plan_id: zonaId } : {}),
            })
          : await createReservationFromAdmin({
              business_slug: slug,
              date,
              slot: selectedSlot!,
              party_size: partySize,
              customer_name: name.trim(),
              customer_phone: phone.trim(),
              notes: notes.trim() || undefined,
              ...(zonaId ? { floor_plan_id: zonaId } : {}),
              ...(effectiveTableId ? { table_id: effectiveTableId } : {}),
            });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reserva creada.");
      // Spec 103: quien me renderiza decide cómo re-sincronizar. Sin `onChanged`
      // se cae al refresh de ruta histórico (lo que sigue usando el panel de
      // nueva reserva del salón).
      if (onChanged) onChanged();
      else router.refresh();
      onDone();
    });
  };

  // ── Teclado (spec 075) ────────────────────────────────────────────────────
  //
  // Cargar una reserva es el flujo con más campos del panel y era 100% mouse:
  // ni el stepper de Personas —que en el walk-in ya se teclea— ni la grilla de
  // horarios tenían una sola tecla.
  //
  // ↑/↓ recorren los controles del formulario; la grilla de horarios y los
  // chips de servicio son **zonas anidadas** con su propio índice, así que
  // aportan una sola parada al recorrido y adentro se navegan solas.
  const formRef = useRef<HTMLFormElement>(null);
  const { handleKeyDown: handleFormArrows, move: moverEnForm } =
    useArrowFocus(formRef);

  const salonesZona = useRovingList<HTMLButtonElement>({
    length: salones.length,
    onExitUp: () => moverEnForm(-1),
    onExitDown: () => moverEnForm(1),
  });

  const serviciosZona = useRovingList<HTMLButtonElement>({
    length: serviceNames.length,
    onExitUp: () => moverEnForm(-1),
    onExitDown: () => moverEnForm(1),
  });

  const horariosVisibles = useMemo(
    () => (mode === "flexible" ? shownArrivalOptions : slots.map((s) => s.slot)),
    [mode, shownArrivalOptions, slots],
  );

  // La grilla de horarios es `grid-cols-4 sm:grid-cols-5`: la cantidad real de
  // columnas depende del ancho (no es lo mismo el sidebar de 480px que el sheet
  // a pantalla completa), así que se mide en vez de hardcodearse — si no, ↓ se
  // movería de a 4 en una grilla de 5 y saltearía horarios.
  const horariosRef = useRef<HTMLDivElement>(null);
  const [horarioCols, setHorarioCols] = useState(4);
  useEffect(() => {
    const el = horariosRef.current;
    if (!el) return;
    const medir = () => {
      // Sin layout resuelto (jsdom, o el panel todavía oculto) esto es `none`:
      // ahí conviene quedarse con el default antes que leer "1 columna" y
      // navegar la grilla como si fuera una lista.
      const tracks = getComputedStyle(el).gridTemplateColumns;
      if (!tracks || tracks === "none") return;
      const cols = tracks.split(" ").filter(Boolean).length;
      if (cols > 0) setHorarioCols(cols);
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [horariosVisibles.length]);

  const horariosZona = useRovingList<HTMLButtonElement>({
    length: horariosVisibles.length,
    columns: horarioCols,
    onExitUp: () => moverEnForm(-1),
    onExitDown: () => moverEnForm(1),
  });

  /**
   * Teclas del formulario: primero las flechas (con las zonas anidadas ya
   * servidas), después los atajos de Personas — los mismos que abrir mesa
   * (spec 066): `1`–`9` fijan, `+`/`−` mueven de a uno. Escribiendo en un campo
   * no aplican: ahí un `4` es un cuatro.
   */
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (handleFormArrows(e)) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const next = partySizeFromKey(e.key, partySize);
    if (next === null) return;
    e.preventDefault();
    setPartySize(next);
  };

  // ── La mesa, sobre el plano (spec 144) ───────────────────────────────────
  //
  // Mesas del salón elegido que el motor considera reservables: activas y sin
  // barra (las de barra las rechaza el server). El picker las pinta todas y
  // marca cuáles se pueden elegir.
  const mesasDelSalon = useMemo(
    () =>
      zonaId
        ? tables.filter(
            (t) => t.floor_plan_id === zonaId && t.status === "active" && !t.is_bar,
          )
        : [],
    [tables, zonaId],
  );

  /** Las libres las dice el motor: el servicio en flexible, el slot en estricto. */
  const mesasLibres = useMemo(() => {
    if (mode === "flexible") return flexTables.map((t) => t.id);
    const slotElegido = slots.find((s) => s.slot === selectedSlot);
    return slotElegido?.free_table_ids ?? [];
  }, [mode, flexTables, slots, selectedSlot]);

  const avisoDelPlano = faltaElegirSalon
    ? "Elegí un salón para ver las mesas."
    : mode === "flexible"
      ? !service
        ? "Elegí un servicio primero."
        : loadingFlex
          ? "Buscando mesas libres…"
          : null
      : !selectedSlot
        ? "Elegí un horario y te muestro qué mesas quedan libres."
        : null;

  // Una mesa que dejó de estar libre (cambió el horario, el servicio o la
  // cantidad de personas) no puede quedar elegida a espaldas del encargado.
  useEffect(() => {
    if (tablePicker || !tableId) return;
    if (!mesasLibres.includes(tableId)) setTableId(undefined);
  }, [mesasLibres, tableId, tablePicker]);

  const [planoAbierto, setPlanoAbierto] = useState(false);
  const mesaElegida = tables.find((t) => t.id === tableId) ?? null;

  /** Selector de mesa: el plano de la página si hay bridge, si no el de acá. */
  const tableField = tablePicker ? (

    <div>
      <SectionLabel as="label">Mesa (opcional)</SectionLabel>
      {tablePicker.pickedTableId ? (
        <div className="mt-1 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 ring-1 ring-indigo-200 @lg:max-w-xs">
          <MapPin className="h-4 w-4 shrink-0 text-indigo-600" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-indigo-900">
            Mesa {tablePicker.pickedLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={tablePicker.onRequest}
            className="shrink-0 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-700"
          >
            Cambiar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={tablePicker.onClear}
            aria-label="Quitar mesa"
            className="shrink-0 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-500"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="xl"
          onClick={tablePicker.onRequest}
          className={`w-full @lg:max-w-xs ${tablePicker.picking ? "ring-2 ring-ring" : ""}`}
        >
          <MapPin className="h-4 w-4" />
          {tablePicker.picking ? "Elegí en el plano…" : "Elegir mesa en el plano"}
        </Button>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        Sin mesa, se sienta al llegar.
      </p>
    </div>
  ) : (
    // Spec 144 — el mismo chip índigo que el sidebar, pero el plano se despliega
    // acá adentro: el formulario es una hoja modal, y en la tab de Operación no
    // hay plano al lado en el que delegar.
    <div>
      <SectionLabel as="label">Mesa (opcional)</SectionLabel>
      {mesaElegida ? (
        <div className="mt-1 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 ring-1 ring-indigo-200 @lg:max-w-xs">
          <MapPin className="h-4 w-4 shrink-0 text-indigo-600" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-indigo-900">
            Mesa {mesaElegida.label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setPlanoAbierto((v) => !v)}
            className="shrink-0 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-700"
          >
            Cambiar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setTableId(undefined);
              setPlanoAbierto(false);
            }}
            aria-label="Quitar mesa"
            className="shrink-0 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-500"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="xl"
          onClick={() => setPlanoAbierto((v) => !v)}
          disabled={faltaElegirSalon}
          className={`w-full @lg:max-w-xs ${planoAbierto ? "ring-2 ring-ring" : ""}`}
        >
          <MapPin className="h-4 w-4" />
          {planoAbierto ? "Elegí una mesa del plano…" : "Elegir mesa en el plano"}
        </Button>
      )}

      {planoAbierto && (
        <MesaPickerPlano
          mesas={mesasDelSalon}
          libres={mesasLibres}
          partySize={partySize}
          elegida={tableId ?? null}
          onElegir={(id) => {
            setTableId(id ?? undefined);
            if (id) setPlanoAbierto(false);
          }}
          aviso={avisoDelPlano}
        />
      )}

      <p className="mt-1 text-[11px] text-muted-foreground/70">
        Sin mesa, se sienta al llegar.
      </p>
    </div>
  );

  return (
    <form
      ref={formRef}
      onKeyDown={handleFormKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {/* Spec 068: mismo bloque de cliente que abrir mesa y cargar pedido —
            un solo buscador, y la regla del teléfono bloqueado vive adentro.
            El foco arranca acá (FR-002) y Enter crea la reserva (FR-003): el
            buscador sólo se queda con Enter si hay un resultado marcado. */}
        <CustomerFields
          slug={slug}
          idPrefix="reserva"
          name={name}
          phone={phone}
          onNameChange={setName}
          onPhoneChange={setPhone}
          autoFocus
          nameLabel="Cliente *"
          phoneLabel="Teléfono (opcional)"
          labelClassName={LABEL_CLS}
          inputClassName={INPUT_CLS_BASE}
        />

        <div>
          <SectionLabel as="label">
            Personas
            <span className="ml-1.5 font-semibold normal-case tracking-normal text-muted-foreground/70">
              · teclas 1-9, + y −
            </span>
          </SectionLabel>
          <div className="mt-2 flex items-center justify-between rounded-2xl bg-muted/50 p-2 ring-1 ring-border @lg:max-w-xs">
            <button
              type="button"
              aria-label="Una persona menos"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-foreground/80 outline-none ring-1 ring-border transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-30"
              disabled={partySize <= 1}
              onClick={() => setPartySize((v) => Math.max(1, v - 1))}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="font-heading text-2xl font-extrabold tabular-nums text-foreground">
              {partySize}
            </span>
            <button
              type="button"
              aria-label="Una persona más"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-foreground/80 outline-none ring-1 ring-border transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-30"
              disabled={partySize >= 20}
              onClick={() => setPartySize((v) => Math.min(20, v + 1))}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <SectionLabel as="label">Fecha</SectionLabel>
          <input
            type="date"
            value={date}
            min={todayISO()}
            max={maxDateISO(60)}
            onChange={(e) => setDate(e.target.value)}
            className={`${INPUT_CLS} @lg:max-w-xs`}
          />
        </div>

        {/* Spec 144 — el salón manda: define qué mesas hay y, sobre todo, en qué
            cupo entra la reserva. Con un solo salón no se dibuja. */}
        {!tablePicker && salones.length > 1 && (
          <div>
            <SectionLabel as="label">Salón *</SectionLabel>
            <div
              onKeyDown={salonesZona.handleKeyDown}
              className="mt-2 flex flex-wrap gap-1.5"
            >
              {salones.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSalonId(s.id);
                    setTableId(undefined);
                    setPlanoAbierto(false);
                  }}
                  {...salonesZona.itemProps(i)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-900/30 ${
                    salonId === s.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-muted text-foreground/80 hover:bg-border"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            {faltaElegirSalon && (
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                El salón define el cupo del servicio: sin él, la reserva no
                cuenta en ninguno.
              </p>
            )}
          </div>
        )}

        {mode === null ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground/70">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : mode === "flexible" ? (
          <>
            <div>
              <SectionLabel as="label">Servicio</SectionLabel>
              {serviceNames.length === 0 ? (
                <p className="mt-2 text-center text-sm text-muted-foreground/70">
                  No hay servicios configurados para esta fecha.
                </p>
              ) : (
                <div
                  onKeyDown={serviciosZona.handleKeyDown}
                  className="mt-2 flex flex-wrap gap-1.5"
                >
                  {serviceNames.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setService(s);
                        setArrivalTime("");
                      }}
                      {...serviciosZona.itemProps(i)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-900/30 ${
                        service === s
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-muted text-foreground/80 hover:bg-border"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <SectionLabel as="label">Horario</SectionLabel>
              {!service ? (
                <p className="mt-2 text-sm text-muted-foreground/70">Elegí un servicio primero.</p>
              ) : shownArrivalOptions.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground/70">
                  No quedan horarios disponibles para este servicio.
                </p>
              ) : (
                <div
                  ref={horariosRef}
                  onKeyDown={horariosZona.handleKeyDown}
                  className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5 @lg:grid-cols-6 @2xl:grid-cols-7 @3xl:grid-cols-8"
                >
                  {shownArrivalOptions.map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setArrivalTime(t)}
                      {...horariosZona.itemProps(i)}
                      className={`rounded-xl px-2 py-2.5 text-sm font-semibold outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-900/30 ${
                        arrivalTime === t
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-muted text-foreground/80 hover:bg-border"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {flexInfo && flexInfo.softCapacity != null ? (
              <p
                className={`text-sm ${
                  flexInfo.overCapacity ? "font-semibold text-amber-600" : "text-muted-foreground"
                }`}
              >
                {flexInfo.reservedCovers}/{flexInfo.softCapacity} cubiertos reservados
                {flexInfo.overCapacity ? " — te pasás del cupo" : ""}
              </p>
            ) : null}

            {/* Spec 077 — el cliente ya no puede reservar acá, pero el mostrador
                sí: lo confirma a propósito para que no se le escape. */}
            {servicioLleno ? (
              <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={overbookOk}
                  onChange={(e) => setOverbookOk(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-600"
                />
                <span>
                  {sinMesasLibres
                    ? "No quedan mesas libres en este servicio."
                    : "Este servicio ya está completo."}{" "}
                  <span className="font-semibold">Reservar igual.</span>
                </span>
              </label>
            ) : null}

            {tableField}
          </>
        ) : (
          <>
            <div>
              <SectionLabel as="label">Horario</SectionLabel>
              {loadingSlots ? (
                <div className="mt-2 flex items-center justify-center py-6 text-muted-foreground/70">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : slots.length === 0 ? (
                <p className="mt-2 text-center text-sm text-muted-foreground/70">
                  {faltaElegirSalon
                    ? "Elegí un salón para ver los horarios."
                    : "Sin horarios disponibles para esta fecha."}
                </p>
              ) : (
                <div
                  ref={horariosRef}
                  onKeyDown={horariosZona.handleKeyDown}
                  className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5 @lg:grid-cols-6 @2xl:grid-cols-7 @3xl:grid-cols-8"
                >
                  {slots.map((s, i) => (
                    <button
                      key={s.slot}
                      type="button"
                      onClick={() => setSelectedSlot(s.slot)}
                      {...horariosZona.itemProps(i)}
                      className={`rounded-xl px-2 py-2.5 text-sm font-semibold outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-blue-900/30 ${
                        selectedSlot === s.slot
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-muted text-foreground/80 hover:bg-border"
                      }`}
                    >
                      {s.slot}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tableField}
          </>
        )}

        <div>
          <SectionLabel as="label">Notas (opcional)</SectionLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            placeholder="Ej: cumpleaños, alérgico a maní…"
          />
        </div>
      </div>

      <ModalFooter className={footerClassName}>
        <Button
          type="submit"
          size="xl"
          disabled={!canSubmit}
          className="w-full @2xl:mx-auto @2xl:max-w-md"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creando…
            </>
          ) : (
            <>
              <CalendarPlus className="size-4" />
              Crear reserva
            </>
          )}
        </Button>
      </ModalFooter>
    </form>
  );
}

/** Versión sheet — la usa la página de gestión de reservas. */
export function NewReservationModal({
  slug,
  tables,
  floorPlanId,
  floorPlans = [],
  defaultFloorPlanId = null,
  onClose,
  onChanged,
}: {
  slug: string;
  tables: FloorTable[];
  floorPlanId: string | null;
  /** Spec 144 — salones entre los que elegir (la hoja no está parada en uno). */
  floorPlans?: Array<{ id: string; name: string }>;
  defaultFloorPlanId?: string | null;
  onClose: () => void;
  /** Spec 103: re-sincroniza al que me renderiza (default: refresh de ruta). */
  onChanged?: () => void;
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* Spec 144 — adentro va el plano del salón: un panel lateral le da más
          lugar que el diálogo centrado. */}
      <PanelContent size="lg">
        <ModalHeader
          title="Nueva reserva"
          description="Crear una reserva manual desde el admin."
          icon={<CalendarPlus />}
        />
        <ReservaForm
          slug={slug}
          tables={tables}
          floorPlanId={floorPlanId}
          floorPlans={floorPlans}
          defaultFloorPlanId={defaultFloorPlanId}
          onDone={onClose}
          onChanged={onChanged}
        />
      </PanelContent>
    </Modal>
  );
}
