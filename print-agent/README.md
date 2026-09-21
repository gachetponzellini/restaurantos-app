# Print agent (referencia — spec 28 / 33 / 35 / 183)

Programita que corre en una PC del local: lee las comandas `pendiente` de la app
y las imprime. Loop **pull → imprimir → confirmar**. No es parte del build de
Next; corre suelto con Node (`node print-agent/agent.mjs`).

**Un solo request por vuelta** desde la spec 183 · D1: el pull ES el latido de
salud. El server lo registra como efecto del mismo GET y lee la versión del
agente de `x-agent-version`. El `POST /api/print-agent/heartbeat` (spec 35)
sigue existiendo para los `.exe` viejos, que lo mandan aparte, pero está
deprecado. La **reimpresión** (spec 35) no requiere nada del agente: el server
incluye las comandas con reimpresión pedida en el mismo GET.

**El GET puede tardar ~25 s y eso es normal** (spec 183 · D5): cuando no hay
nada para imprimir, el server **retiene la respuesta** mirando la cola y
contesta apenas aparece algo. Un agente ocioso queda preguntando cada ~30 s
—diez veces menos tráfico— y cuando hay trabajo la comanda sale en ~2-3 s, más
rápido que antes. No es un cuelgue; no le pongas timeout corto al fetch.

**La cadencia la manda el server** (spec 183 · D2): la respuesta trae
`next_poll_ms` y el agente duerme eso. Si no viene —server viejo, rollback— usa
el `pollMs` del config. Así se tunea un local con un deploy en vez de una
visita.

## Config (`config.json`)

`config.json` **no se commitea** (#113): para desarrollo, copiá
`config.example.json` a `config.json` y completá la key y el negocio. En una
instalación real, el `config.json` lo genera el panel.

| campo | qué es |
|---|---|
| `serverUrl` | base de la app (ej. `http://localhost:3000`) |
| `printAgentKey` | key del agente en `print_agent_credentials` (la genera el panel; la `PRINT_AGENT_KEY` global ya no existe) |
| `businessId` | UUID del negocio cuyas comandas imprime |
| `transport` | `windows` (driver/Out-Printer) o `network` (socket TCP ESC/POS) |
| `printerName` | sólo para `windows`: nombre exacto de la impresora instalada |
| `pollMs` | cada cuánto consulta (ms). **3000** desde la spec 183 · D3 — lo escribe el panel, no se toca a mano. Desde la D2 es sólo el **fallback**: manda el `next_poll_ms` del server. Y desde la D5 importa poco: la retención del GET pacea el loop sola |

- **`network`** = producción on-site: usa la `printer_ip`/`printer_port` que cada
  comanda trae en el GET (configurada en Configuración → Comanderas). Cero mapeo local.
- **`windows`** = prueba con impresora USB/no-térmica (ej. HP LaserJet): imprime
  por el driver del SO; la `printer_ip` de la comanda se ignora.

## Uso

```bash
node print-agent/agent.mjs --once --dry-run   # ve el ticket en consola (no imprime)
node print-agent/agent.mjs --once --limit=1   # imprime UNA comanda y confirma
node print-agent/agent.mjs                    # loop: imprime todo lo pendiente
```

Flags: `--once` (una pasada), `--dry-run` (no imprime ni confirma),
`--no-confirm` (imprime sin avanzar el estado), `--limit=N` (tope por corrida).

> El server tiene que tener `PRINT_AGENT_KEY` en `.env.local` (igual a
> `printAgentKey`). Si la agregás con el server prendido, **reiniciá `pnpm dev`**.

---

## Cambiar la cadencia de un local ya instalado

> **Desde la spec 183 · D2 esto casi nunca hace falta.** El server manda
> `next_poll_ms` en cada respuesta y la retención de la D5 pacea al agente sin
> que el config importe: con la retención viva, golf (`pollMs` 10000) quedó en
> un período de 36 s y kcc (1000) en 27 s **sin tocar ninguna de las dos PCs**.
> Este procedimiento queda para un `.exe` anterior a 2026-09-15 al que haya que
> cambiarle el fallback, o para bajar un instalador nuevo.

El `.exe` lee `config.json` **una sola vez, al arrancar**, y no tiene default
propio: el valor sale del `config.json` que generó el panel
(`buildAgentConfig`, `src/lib/print-agent/credentials.ts`). Un agente instalado
antes de la spec 183 sigue a `pollMs: 1000` hasta que alguien le cambie el
archivo — deployar el server **no lo alcanza**.

No hace falta TeamViewer ni un `.exe` nuevo. Desde la PC del local, con sesión
de admin del negocio:

1. Configuración → Comanderas → **Descargar instalador** en la card del agente.
2. Descomprimir el ZIP y dejar el `config.json` recién bajado al lado de
   `instalar.bat`.
3. Doble clic en `instalar.bat`. Frena la tarea, copia los archivos y la vuelve
   a registrar.

**La key no cambia.** `getPrintAgentInstaller` devuelve la credencial que ya
existe (`resolverAgente`); la que rota es `rotatePrintAgentKey`, que es otro
botón. Bajar el config de nuevo es seguro y no deja al local sin imprimir.

Para verificar que quedó, desde la base:

```sql
select b.slug, round(extract(epoch from (now() - s.last_seen_at))::numeric, 2)
from print_agent_status s join businesses b on b.id = s.business_id
order by b.slug;
```

Dos corridas seguidas: si el staleness pasea entre 0 y ~3s en vez de quedarse
abajo de 1,3s, el local tomó los 3000.

> El `print-agent/config.example.json` del repo es la config de **desarrollo**
> (`serverUrl: localhost`). Sigue en `pollMs: 1000` a propósito: contra tu
> propia máquina no cuesta nada y probar impresión con 3s de espera es
> molesto. El valor que importa es el de `buildAgentConfig`.
