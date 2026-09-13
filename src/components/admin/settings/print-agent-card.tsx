"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  createPrintAgent,
  deletePrintAgent,
  getPrintAgentInstaller,
  rotatePrintAgentKey,
  updatePrintAgentScope,
  type PrintAgentSummary,
} from "@/lib/print-agent/credentials-actions";
import { alcanzaLaImpresora } from "@/lib/print/agent-scope";

const OFFLINE_THRESHOLD_MS = 60_000;

function relativeTime(fromIso: string, now: number): string {
  const diff = Math.max(0, now - new Date(fromIso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

function triggerDownload(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Descarga una URL remota vía <a> (no window.open): el .exe viene por signed URL
 * con Content-Disposition: attachment, así el click descarga sin navegar y sin
 * que el bloqueador de popups lo mate tras el await de la server action.
 */
function triggerUrlDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Impresora = { label: string; ip: string };

function EstadoPill({
  lastSeenAt,
  now,
}: {
  lastSeenAt: string | null;
  now: number;
}) {
  const online =
    lastSeenAt != null &&
    now - new Date(lastSeenAt).getTime() < OFFLINE_THRESHOLD_MS;

  return (
    <span
      className={
        online
          ? "inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200/70"
          : "inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700 ring-1 ring-red-200/70"
      }
    >
      <span
        className={
          online
            ? "size-2 rounded-full bg-emerald-500"
            : "size-2 rounded-full bg-red-500"
        }
        aria-hidden
      />
      {online
        ? `Conectado · ${relativeTime(lastSeenAt as string, now)}`
        : lastSeenAt
          ? `Sin conexión · ${relativeTime(lastSeenAt, now)}`
          : "Sin conexión · nunca reportó"}
    </span>
  );
}

/**
 * Qué versión corre esa PC (issue #278).
 *
 * Un agente que **no** reporta versión no es un dato faltante: es un agente
 * anterior a set-2026, o sea de cuando el .exe todavía armaba el ticket con su
 * propio código en vez de imprimir el que manda el server. Eso hace que los
 * cambios en la comanda no lleguen al papel —fue lo que pasó con la nota de
 * cocina en golf— así que la card lo dice y pide reinstalar, en vez de mostrar
 * un guioncito.
 *
 * Sólo se muestra si el agente está conectado: de uno caído no sabemos qué
 * versión tiene hoy, sólo qué versión tenía la última vez, y adivinar sobre eso
 * es lo que este cambio vino a evitar.
 */
function VersionLinea({ version }: { version: string | null }) {
  if (version) {
    return (
      <p className="text-xs text-zinc-500">
        Versión <span className="tabular-nums">{version}</span>
      </p>
    );
  }
  return (
    <p className="text-xs text-amber-700">
      Versión anterior a set-2026 — arma la comanda por su cuenta, así que los
      cambios del sistema no llegan al papel. Conviene reinstalarla.
    </p>
  );
}

/**
 * Un agente instalado: su estado, qué impresoras alcanza y las acciones sobre
 * él. Con un solo agente la card se ve igual que siempre (el bloque de alcance
 * queda plegado); recién aparece cuando hay más de uno, que es cuando importa.
 */
function AgenteRow({
  slug,
  agente,
  impresoras,
  now,
  soloUno,
}: {
  slug: string;
  agente: PrintAgentSummary;
  impresoras: Impresora[];
  now: number;
  soloUno: boolean;
}) {
  const [downloading, startDownload] = useTransition();
  const [rotating, startRotate] = useTransition();
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [scope, setScope] = useState(agente.printerScope?.join(", ") ?? "");

  const alcanzadas = useMemo(
    () =>
      impresoras.filter((p) =>
        alcanzaLaImpresora(agente.printerScope, p.ip),
      ),
    [impresoras, agente.printerScope],
  );

  const handleDownload = () => {
    startDownload(async () => {
      const r = await getPrintAgentInstaller(slug, agente.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      // El nombre del archivo NO lleva el label: `instalar.bat` busca un
      // `config.json` exacto al lado suyo. Cada PC baja el suyo en la máquina
      // donde se va a instalar, así que no se pisan.
      triggerDownload("config.json", r.data.configJson, "application/json");
      if (r.data.zipUrl) {
        triggerUrlDownload(r.data.zipUrl);
        toast.success(
          "Descargando instalador. Descomprimí el ZIP, dejá config.json adentro y doble clic en instalar.bat.",
        );
      } else {
        toast.success(
          "Bajé config.json. El instalador todavía no está publicado — usá el que ya tenés en la carpeta.",
        );
      }
    });
  };

  const handleRotate = () => {
    startRotate(async () => {
      const r = await rotatePrintAgentKey(slug, agente.id);
      setConfirmRotate(false);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setFreshKey(r.data.key);
      toast.success(`Key de «${agente.label}» regenerada. Reinstalá esa PC.`);
    });
  };

  const handleSaveScope = () => {
    startSave(async () => {
      const r = await updatePrintAgentScope(slug, agente.id, scope);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.data.printerScope
          ? "Alcance guardado."
          : "Alcance vacío: este agente recibe todas las impresoras.",
      );
    });
  };

  const handleDelete = () => {
    startDelete(async () => {
      const r = await deletePrintAgent(slug, agente.id);
      setConfirmDelete(false);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`«${agente.label}» borrado.`);
    });
  };

  return (
    <li className="grid gap-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900">
          {agente.label}
        </span>
        <EstadoPill lastSeenAt={agente.lastSeenAt} now={now} />
      </div>

      {agente.lastSeenAt != null &&
      now - new Date(agente.lastSeenAt).getTime() < OFFLINE_THRESHOLD_MS ? (
        <VersionLinea version={agente.agentVersion} />
      ) : null}

      <div className="grid gap-1.5">
        <label
          className="text-xs font-medium text-zinc-700"
          htmlFor={`scope-${agente.id}`}
        >
          Impresoras que alcanza
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`scope-${agente.id}`}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="192.168.100.0/24, 10.0.0.7, local:CONTROL-T1 — vacío = todas las IPs"
            className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-200/70"
          />
          <Button variant="ghost" onClick={handleSaveScope} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          {agente.printerScope
            ? `Alcanza ${alcanzadas.length} de ${impresoras.length} impresoras configuradas.`
            : "Sin restricción: recibe todos los trabajos del negocio."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleDownload} disabled={downloading}>
          {downloading ? "Preparando…" : "Descargar instalador"}
        </Button>

        {confirmRotate ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-sm text-zinc-700">
            ¿Regenerar? «{agente.label}» deja de imprimir hasta reinstalarla.
            <Button
              variant="destructive"
              onClick={handleRotate}
              disabled={rotating}
            >
              {rotating ? "Generando…" : "Sí, regenerar"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmRotate(false)}
              disabled={rotating}
            >
              Cancelar
            </Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmRotate(true)}>
            Regenerar key
          </Button>
        )}

        {soloUno ? null : confirmDelete ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-sm text-zinc-700">
            ¿Borrar «{agente.label}»?
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Borrando…" : "Sí, borrar"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Borrar
          </Button>
        )}
      </div>

      {freshKey ? (
        <div className="grid gap-2 rounded-xl bg-white p-3 ring-1 ring-zinc-200/70">
          <p className="text-xs font-medium text-zinc-700">
            Key nueva (se muestra una sola vez — ya quedó en el config.json que
            vas a descargar):
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-2 py-1.5 text-xs text-zinc-900 ring-1 ring-zinc-200/70">
              {freshKey}
            </code>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(freshKey);
                toast.success("Key copiada.");
              }}
            >
              Copiar
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function PrintAgentCard({
  slug,
  keySet,
  agents,
  impresoras,
}: {
  slug: string;
  keySet: boolean;
  agents: PrintAgentSummary[];
  impresoras: Impresora[];
}) {
  const [now, setNow] = useState(() => Date.now());
  const [creating, startCreate] = useTransition();
  const [nuevoLabel, setNuevoLabel] = useState("");
  const [nuevoScope, setNuevoScope] = useState("");
  const [agregando, setAgregando] = useState(false);

  // Un solo reloj vivo para toda la card: "hace X" y conectado/caído se
  // actualizan solos sin montar un intervalo por agente.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Impresoras que no alcanza NINGÚN agente: el papel no sale y nadie reporta
  // nada, porque el agente que no la alcanza directamente no recibe el trabajo.
  // Es el modo de fallar más caro del alcance, así que se muestra siempre.
  const huerfanas = useMemo(
    () =>
      agents.length === 0
        ? []
        : impresoras.filter(
            (p) => !agents.some((a) => alcanzaLaImpresora(a.printerScope, p.ip)),
          ),
    [agents, impresoras],
  );

  const handleCreate = () => {
    startCreate(async () => {
      const r = await createPrintAgent(slug, {
        label: nuevoLabel,
        printerScope: nuevoScope,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setNuevoLabel("");
      setNuevoScope("");
      setAgregando(false);
      toast.success("Agente agregado. Bajá su instalador desde su fila.");
    });
  };

  return (
    <div className="grid gap-4">
      {agents.length === 0 ? (
        <>
          <p className="text-sm text-zinc-600">
            Todavía no hay ningún agente instalado.
          </p>
          <PrimeraInstalacion slug={slug} keySet={keySet} />
        </>
      ) : (
        <ul className="grid gap-3">
          {agents.map((a) => (
            <AgenteRow
              key={a.id}
              slug={slug}
              agente={a}
              impresoras={impresoras}
              now={now}
              soloUno={agents.length === 1}
            />
          ))}
        </ul>
      )}

      {huerfanas.length > 0 ? (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200/60">
          ⚠️ Ningún agente alcanza{" "}
          <strong>
            {huerfanas.map((p) => `${p.label} (${p.ip})`).join(", ")}
          </strong>
          . Esos tickets no se van a imprimir y no van a avisar: revisá el
          alcance de cada agente.
        </p>
      ) : null}

      {agents.length > 0 ? (
        agregando ? (
          <div className="grid gap-2 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
            <p className="text-xs font-medium text-zinc-700">
              Otra PC con agente — usala si hay impresoras en una red que la
              primera no alcanza.
            </p>
            <input
              value={nuevoLabel}
              onChange={(e) => setNuevoLabel(e.target.value)}
              placeholder="Nombre (ej: Caja bar)"
              className="rounded-lg bg-white px-2 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-200/70"
            />
            <input
              value={nuevoScope}
              onChange={(e) => setNuevoScope(e.target.value)}
              placeholder="Impresoras que alcanza (ej: 192.168.1.0/24) — vacío = todas"
              className="rounded-lg bg-white px-2 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-200/70"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? "Creando…" : "Agregar agente"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setAgregando(false)}
                disabled={creating}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="ghost" onClick={() => setAgregando(true)}>
              Agregar otra PC
            </Button>
          </div>
        )
      ) : null}

      <p className="text-xs text-zinc-500">
        Descomprimí el ZIP, dejá el <code>config.json</code> descargado en la
        misma carpeta y doble clic en <code>instalar.bat</code>. Queda corriendo
        y arranca solo al prender la PC. Bajá el <code>config.json</code> de cada
        agente <strong>en la PC donde lo vas a instalar</strong>: el archivo se
        llama igual para todos.
      </p>
    </div>
  );
}

/**
 * Camino de la primera instalación (spec 046): el negocio todavía no tiene
 * ninguna credencial, así que se crea lazily al bajar el instalador y no hay
 * nada que nombrar ni que acotar.
 */
function PrimeraInstalacion({ slug, keySet }: { slug: string; keySet: boolean }) {
  const [downloading, startDownload] = useTransition();

  const handleDownload = () => {
    startDownload(async () => {
      const r = await getPrintAgentInstaller(slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      triggerDownload("config.json", r.data.configJson, "application/json");
      if (r.data.zipUrl) {
        triggerUrlDownload(r.data.zipUrl);
        toast.success(
          "Descargando instalador. Descomprimí el ZIP, dejá config.json adentro y doble clic en instalar.bat.",
        );
      } else {
        toast.success(
          "Bajé config.json. El instalador todavía no está publicado — usá el que ya tenés en la carpeta.",
        );
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={handleDownload} disabled={downloading}>
        {downloading ? "Preparando…" : "Descargar instalador"}
      </Button>
      {keySet ? (
        <span className="text-xs text-zinc-500">
          Hay una key cargada pero ningún agente listado: recargá la página.
        </span>
      ) : null}
    </div>
  );
}
