// @ts-nocheck
/**
 * import-maxirest-comanderas-kcc.ts — Carga las 2ª/3ª comanderas de KCC
 * (Kentucky Club House) desde la config real de MaxiRest a `products`
 * (spec 180).
 *
 * Fuente: `raw/maxirest/kcc-carta-20260720.md` del brain, que ya tiene por
 * artículo los tres campos `cmd1/cmd2/cmd3` extraídos de `mxart.comanda1..3`
 * (base mx_51617, corte 2026-07-20). Códigos:
 *
 *   1  Cocina     Z  Fritera     [  Parrilla     2  (3 ítems de cafetería,
 *                                                     destino sin identificar
 *                                                     — se saltean)
 *
 * Qué escribe:
 *   - `extra_station_ids`  = cmd2/cmd3 mapeados, sin repetir el principal
 *                            (`station_id`, que ya venía de cmd1).
 *   - `sin_comanda = true` = artículos SIN ninguna comandera en MaxiRest pero
 *                            cuya categoría acá tiene sector — los 9 postres que
 *                            el relevamiento marcó como «van a imprimir en
 *                            Cocina sin querer».
 *
 * Cruce por nombre normalizado (los productos vinieron del mismo backup). Los
 * que no cruzan se listan y no se tocan. Idempotente: re-correrlo deja lo mismo.
 *
 * Correrlo con la nube apuntada en .env.local (perfil cloud):
 *   npx tsx scripts/import-maxirest-comanderas-kcc.ts [--dry-run]
 *
 * Corrida real 2026-09-13: 94 productos con extras (48 +Cocina, 16 +Fritera,
 * 27 +Parrilla, 3 +Fritera+Parrilla) y 9 `sin_comanda`. Coincide con el
 * relevamiento (96 artículos multi-comandera; la diferencia son 2 vinos
 * duplicados sin comandera y renglones vacíos del raw).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SLUG = "kcc";
const RAW = resolve(
  process.env.BRAIN_DIR ?? "../..",
  "raw/maxirest/kcc-carta-20260720.md",
);
const COD: Record<string, string> = { "1": "cocina", Z: "fritera", "[": "parrilla" };
const dryRun = process.argv.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

async function main() {
  const { data: biz } = await sb.from("businesses").select("id").eq("slug", SLUG).single();
  if (!biz) throw new Error(`no existe el negocio ${SLUG}`);

  const { data: stations } = await sb.from("stations").select("id, name").eq("business_id", biz.id);
  const stationByName = new Map((stations ?? []).map((s) => [s.name.toLowerCase(), s.id]));

  const { data: prods } = await sb
    .from("products")
    .select("id, name, station_id, categories(station_id)")
    .eq("business_id", biz.id);
  const byName = new Map<string, typeof prods>();
  for (const p of prods ?? []) {
    const k = norm(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  const rows = readFileSync(RAW, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
    .filter((c) => c.length >= 6 && /^\d+$/.test(c[0]));

  let extras = 0, sin = 0;
  const sinMatch: string[] = [];
  for (const [, nombre, , c1, c2, c3] of rows) {
    const cands = byName.get(norm(nombre)) ?? [];
    if (cands.length !== 1) { if (nombre) sinMatch.push(nombre); continue; }
    const p = cands[0]!;
    const ids: string[] = [];
    for (const c of [c2, c3]) {
      const st = c && COD[c] ? stationByName.get(COD[c]) : undefined;
      if (st && st !== p.station_id && !ids.includes(st)) ids.push(st);
    }
    if (ids.length > 0) {
      extras++;
      if (!dryRun) await sb.from("products").update({ extra_station_ids: ids }).eq("id", p.id);
    }
    const catStation = (p.categories as { station_id: string | null } | null)?.station_id;
    if (!c1 && !c2 && !c3 && (p.station_id || catStation)) {
      sin++;
      if (!dryRun) await sb.from("products").update({ sin_comanda: true }).eq("id", p.id);
    }
  }
  console.log(`${dryRun ? "[dry-run] " : ""}extras: ${extras} · sin_comanda: ${sin} · sin cruzar: ${sinMatch.length}`);
  if (sinMatch.length) console.log("  sin cruzar:", sinMatch.join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
