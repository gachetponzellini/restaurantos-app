// @ts-nocheck
/**
 * import-maxirest-insumos-kcc.ts
 * ────────────────────────────────────────────────────────────────────────
 * Carga el catálogo de insumos (`mxins`, 500 filas) de KCC como `ingredients`
 * + `ingredient_presentations`. NO carga recetas: `mxrec` es basura en KCC
 * (112 de 113 filas con cod_ins=0, sólo texto libre) — ver
 * wiki/negocio/kcc-relevamiento-maxirest.md#insumos-recetas-y-proveedores.
 * La única línea real (Costillitas Sugerencia → Costilla de cerdo) referencia
 * un producto placeholder que ya se desactivó, así que tampoco se carga.
 *
 * Fuente: contenedor docker `kcc-maxirest` (mysqldump del backup 2026-07-20,
 * ver wiki). Requiere `docker start kcc-maxirest` antes de correr.
 *
 * Mapeo de unidad → kg|lt|un|g|ml (constraint de `ingredients.unit`):
 *   UNIDAD/UNIDADD/U/1/PORC./PORCION/DOCENA/CAJON/ART.VARIOS → un
 *   KG/KILO/KILOS/1KG                                        → kg
 *   LITROS/LITRO                                             → lt
 *   CC                                                       → ml
 *   cualquier otra cosa (vacío, "X5KG", "6.U X 200G", ...)   → un (fallback;
 *     son 41 insumos, casi todos con precio 0 — no hay costeo real que
 *     mapear mejor, y el unit no afecta nada sin receta que lo consuma)
 *
 * 3 filas sin nombre (codigo 302/355/389, basura) se saltean.
 * 1 colisión de nombre ("Leche" x2, distinto código/unidad) se desambigua
 * agregando la unidad de MaxiRest entre paréntesis.
 *
 * Idempotente: upsert por (business_id, name), ignora duplicados si se
 * vuelve a correr.
 *
 * Uso:
 *   npx tsx scripts/import-maxirest-insumos-kcc.ts            # dry-run
 *   APPLY=1 npx tsx scripts/import-maxirest-insumos-kcc.ts    # aplica
 */

import { resolve } from "path";
import { execSync } from "child_process";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(__dirname, "../.env.cloud") });

const SLUG = "kcc";
const APPLY = process.env.APPLY === "1";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

type Unit = "kg" | "lt" | "un" | "g" | "ml";

function mapUnit(raw: string): Unit {
  const u = raw.trim().toUpperCase();
  if (["UNIDAD", "UNIDADD", "U", "1", "PORC.", "PORCION", "DOCENA", "CAJON", "ART.VARIOS"].includes(u)) return "un";
  if (["KG", "KILO", "KILOS", "1KG"].includes(u)) return "kg";
  if (["LITROS", "LITRO"].includes(u)) return "lt";
  if (u === "CC") return "ml";
  return "un"; // fallback: unidad de compra ambigua, sin receta que la consuma
}

type RawInsumo = {
  codigo: string;
  nombre: string;
  unidad_med: string;
  precio: string;
  discont: string;
};

function readInsumos(): RawInsumo[] {
  const raw = execSync(
    `docker exec kcc-maxirest mysql -uroot -proot -N -B -e "select codigo, nombre, unidad_med, precio, discont from mx_51617.mxins order by codigo;"`,
    { encoding: "utf8" },
  );
  return raw
    .trim()
    .split("\n")
    .map((line) => {
      const [codigo, nombre, unidad_med, precio, discont] = line.split("\t");
      return { codigo, nombre, unidad_med, precio, discont };
    });
}

async function resolveBusinessId(): Promise<string> {
  const { data, error } = await sb.from("businesses").select("id").eq("slug", SLUG).maybeSingle();
  if (error || !data) throw new Error(`No se encontró el negocio '${SLUG}': ${error?.message}`);
  return data.id as string;
}

async function main() {
  console.log(`=== import insumos MaxiRest → ${SLUG} ===`);
  console.log(APPLY ? "MODO: APPLY (escribe en cloud)" : "MODO: DRY-RUN (no escribe; correr con APPLY=1 para aplicar)");

  const businessId = await resolveBusinessId();
  console.log(`business_id: ${businessId}`);

  const rows = readInsumos();
  console.log(`filas leídas de mxins: ${rows.length}`);

  // Detectar colisiones de nombre (case/espacios normalizados) para desambiguar.
  const nameCount = new Map<string, number>();
  for (const r of rows) {
    const n = r.nombre.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }

  let skippedNoName = 0;
  let created = 0;
  let skippedExisting = 0;
  const unitFallbackUsed: string[] = [];

  // Traer ingredients ya existentes para idempotencia (por si se re-corre).
  const { data: existingIngredients, error: exErr } = await sb
    .from("ingredients")
    .select("name")
    .eq("business_id", businessId);
  if (exErr) throw exErr;
  const existingNames = new Set((existingIngredients ?? []).map((i) => i.name));

  for (const r of rows) {
    const nombreRaw = r.nombre.trim();
    if (!nombreRaw) {
      skippedNoName++;
      continue;
    }

    const key = nombreRaw.toLowerCase();
    let name = titleCase(nombreRaw);
    if ((nameCount.get(key) ?? 0) > 1) {
      // Colisión: desambiguar con la unidad original de MaxiRest.
      name = `${name} (${r.unidad_med.trim() || "s/u"})`;
    }

    if (existingNames.has(name)) {
      skippedExisting++;
      continue;
    }

    const unit = mapUnit(r.unidad_med);
    if (mapUnit(r.unidad_med) === "un" && !["UNIDAD", "UNIDADD", "U", "1", "PORC.", "PORCION", "DOCENA", "CAJON", "ART.VARIOS"].includes(r.unidad_med.trim().toUpperCase())) {
      unitFallbackUsed.push(`${name} (unidad_med MaxiRest: "${r.unidad_med}")`);
    }

    const precio = parseFloat(r.precio) || 0;
    const costCents = Math.round(precio * 100);
    const isActive = r.discont !== "\x01" && r.discont !== "1";

    console.log(`  + ${name} (${unit}, $${precio}, ${isActive ? "activo" : "discontinuado"})`);

    if (!APPLY) continue;

    const { data: ing, error: ingErr } = await sb
      .from("ingredients")
      .insert({
        business_id: businessId,
        name,
        unit,
        waste_percent: 0,
        is_active: isActive,
        is_composite: false,
      })
      .select("id")
      .single();
    if (ingErr || !ing) {
      console.log(`    ✗ error insertando ingredient "${name}": ${ingErr?.message}`);
      continue;
    }

    const { error: presErr } = await sb.from("ingredient_presentations").insert({
      ingredient_id: ing.id,
      name: "Default",
      net_quantity: 1,
      cost_cents: costCents,
      is_default: true,
    });
    if (presErr) {
      console.log(`    ✗ error insertando presentación de "${name}": ${presErr.message}`);
      continue;
    }

    existingNames.add(name);
    created++;
  }

  console.log(`\n=== resumen ===`);
  console.log(`creados: ${created}`);
  console.log(`ya existían (saltados): ${skippedExisting}`);
  console.log(`sin nombre (basura, saltados): ${skippedNoName}`);
  console.log(`unidad ambigua → fallback "un" (${unitFallbackUsed.length}):`);
  unitFallbackUsed.forEach((u) => console.log(`   ! ${u}`));

  if (!APPLY) console.log("\nNada fue escrito. Revisá el plan y volvé a correr con APPLY=1.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
