/**
 * Entrada del bundle de la Edge Function `print-agent` (spec 206 · D2).
 *
 * La función corre **el mismo código** que la ruta de Vercel: el armado de los
 * papeles, el alcance por impresora, la comandera de quien pidió y la
 * confirmación. `scripts/build-print-agent-fn.mjs` lo empaqueta con esbuild y
 * cambia sólo los bordes que dependen de Next (ver `./shims/`). Así las dos
 * puertas devuelven lo mismo por construcción, no por disciplina.
 */
export { GET, POST } from "@/app/api/print-agent/route";
export { autenticarAgente } from "@/app/api/print-agent/agent-auth";
