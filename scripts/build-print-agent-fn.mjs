// Empaqueta la ruta del print-agent para la Edge Function (spec 206 · D2).
//   node scripts/build-print-agent-fn.mjs
// Genera supabase/functions/print-agent/ruta.bundle.js — NO editarlo a mano.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// esbuild no es dependencia directa (viene con vite/next): se toma del store
// de pnpm, la versión más nueva que haya.
const store = path.join(root, "node_modules/.pnpm");
const dir = fs
  .readdirSync(store)
  .filter((d) => /^esbuild@\d/.test(d))
  .sort()
  .at(-1);
const { build } = await import(
  pathToFileURL(path.join(store, dir, "node_modules/esbuild/lib/main.js")).href
);
const shim = (f) => path.join(root, "src/lib/print-agent/edge/shims", f);
const alias = {
  "next/server": shim("next-server.ts"),
  "server-only": shim("empty.ts"),
  "@/lib/supabase/service": shim("service.ts"),
  "@/lib/notifications/events": shim("notify.ts"),
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const NPM = Object.fromEntries(
  ["@supabase/supabase-js", "date-fns-tz", "date-fns", "zod"].map((n) => [
    n,
    String(deps[n] ?? "latest").replace(/^[\^~]/, ""),
  ]),
);

await build({
  entryPoints: [path.join(root, "src/lib/print-agent/edge/entry.ts")],
  outfile: path.join(root, "supabase/functions/print-agent/ruta.bundle.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  banner: {
    js: [
      "// GENERADO por scripts/build-print-agent-fn.mjs — no editar.",
      "// deno-lint-ignore-file",
      // Deno no tiene `Buffer` global; el armado de tickets y la auth lo usan.
      'import { Buffer as __Buffer } from "node:buffer";',
      "globalThis.Buffer ??= __Buffer;",
    ].join("\n"),
  },
  plugins: [
    {
      name: "alias",
      setup(b) {
        b.onResolve({ filter: /^(next\/server|server-only|@\/lib\/supabase\/service|@\/lib\/notifications\/events)$/ }, (a) => ({ path: alias[a.path] }));
        // Las librerías npm no se empaquetan: Deno las trae con `npm:` (el
        // bundle queda chico y entra en un deploy por MCP).
        b.onResolve({ filter: /^(@supabase\/supabase-js|date-fns-tz|date-fns|zod)(\/.*)?$/ }, (a) => ({
          path: `npm:${a.path.replace(/^(@supabase\/supabase-js|date-fns-tz|date-fns|zod)/, (m) => `${m}@${NPM[m]}`)}`,
          external: true,
        }));
        b.onResolve({ filter: /^@\// }, (a) => {
          const rel = a.path.slice(2);
          return b.resolve("./" + rel, { resolveDir: path.join(root, "src"), kind: a.kind });
        });
      },
    },
  ],
  // Deno trae los `node:*` (node:crypto para el timingSafeEqual de la key).
  external: ["node:*"],
  logLevel: "warning",
});
// esbuild deja algunos bytes de control LITERALES dentro de los strings (los
// comandos ESC/POS: GS, 0x01, 0x02…). Invisibles y frágiles —un copy/paste o
// un deploy por texto los pierde y el ticket sale roto—: se escriben como
// escapes `\xNN`, que valen igual en strings y en template literals.
const out = path.join(root, "supabase/functions/print-agent/ruta.bundle.js");
const code = fs.readFileSync(out, "utf8");
fs.writeFileSync(
  out,
  code.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, (c) =>
    `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  ),
);
console.log("✓ supabase/functions/print-agent/ruta.bundle.js");
