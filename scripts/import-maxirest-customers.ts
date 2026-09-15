/**
 * import-maxirest-customers.ts — importa la agenda de delivery de MaxiRest
 * (`mxcli`) a `customers` + `customer_addresses` (spec 195, #320).
 *
 * Uso:
 *   npx tsx scripts/import-maxirest-customers.ts --slug kcc --json <mxcli.json>
 *   npx tsx scripts/import-maxirest-customers.ts --slug kcc --json <mxcli.json> --csv control.csv
 *   npx tsx scripts/import-maxirest-customers.ts --slug kcc --json <mxcli.json> --apply
 *
 * **Por defecto es dry-run**: imprime el reporte, escribe el CSV si se lo pide,
 * y no toca la base. Escribe sólo con `--apply`.
 *
 * El JSON lo produce `extract-maxirest-clientes.mjs` a partir del dump. El mapeo
 * —qué teléfono queda como identidad y cómo se deduce el lote— vive en
 * `src/lib/customers/maxirest-import.ts`, que está testeado.
 *
 * **El CSV va primero.** Lo que sale de acá es el lote al que va a ir el
 * repartidor: si está mal, toca el timbre equivocado. El local lo confirma antes
 * de que esto escriba nada.
 *
 * Un re-import no pisa lo editado a mano: el cliente se busca por
 * `(business_id, phone)` y sólo se completan los campos que estén vacíos.
 *
 * Contra qué base corre lo decide el `.env.local` (o `--env <archivo>`): apuntar
 * a la nube requiere las credenciales de la nube, no las del stack local.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

import {
  planificarImportClientes,
  type ClienteImportado,
  type MxcliClienteRow,
} from "../src/lib/customers/maxirest-import";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

config({ path: resolve(__dirname, `../${arg("env") ?? ".env.local"}`) });

/** De a lotes: 153 filas en una sentencia hacen ilegible el error de una sola. */
const BATCH = 50;

function csv(clientes: ClienteImportado[]): string {
  const campo = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const filas = clientes.map((c) =>
    [c.codigo, c.name, c.phone, c.lote, c.calle, c.loteOrigen, c.aviso]
      .map((v) => campo(v == null ? null : String(v)))
      .join(","),
  );
  return [
    "codigo_maxirest,nombre,telefono,lote,calle,de_donde_sale_el_lote,revisar",
    ...filas,
  ].join("\n");
}

async function main() {
  const slug = arg("slug");
  const jsonPath = arg("json");
  const csvPath = arg("csv");
  const apply = process.argv.includes("--apply");

  if (!slug || !jsonPath) {
    console.error(
      "Uso: npx tsx scripts/import-maxirest-customers.ts --slug <slug> --json <mxcli.json> [--csv <salida.csv>] [--apply]",
    );
    process.exit(1);
  }

  const rows = JSON.parse(readFileSync(jsonPath, "utf8")) as MxcliClienteRow[];
  const { clientes, descartados } = planificarImportClientes(rows);

  // ── Reporte ────────────────────────────────────────────────────
  console.log(`\n═══ ${slug} · ${rows.length} filas en mxcli ═══`);
  console.log(`  importables (con teléfono): ${clientes.length}`);
  console.log(`  ... con lote: ${clientes.filter((c) => c.lote).length}`);
  console.log(`  ... para revisar: ${clientes.filter((c) => c.aviso).length}`);
  console.log(`  descartados: ${descartados.length}`);
  const motivos = new Map<string, number>();
  for (const d of descartados) motivos.set(d.motivo, (motivos.get(d.motivo) ?? 0) + 1);
  for (const [motivo, n] of motivos) console.log(`     ${n} · ${motivo}`);

  if (csvPath) {
    writeFileSync(csvPath, csv(clientes), "utf8");
    console.log(`\nCSV de control → ${csvPath}`);
  }

  if (!apply) {
    console.log("\nDry-run: no se escribió nada. Agregá --apply para importar.\n");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (!business) {
    console.error(`Negocio "${slug}" no encontrado en ${url}.`);
    process.exit(1);
  }
  console.log(`\nEscribiendo en ${business.name} (${url}).`);

  const { data: existentes } = await supabase
    .from("customers")
    .select("id, phone, name")
    .eq("business_id", business.id);
  const porTelefono = new Map(
    (existentes ?? []).map((c) => [c.phone, c as { id: string; phone: string; name: string | null }]),
  );

  let creados = 0;
  let completados = 0;
  const conDireccion: { customer_id: string; cliente: ClienteImportado }[] = [];

  for (let i = 0; i < clientes.length; i += BATCH) {
    for (const cliente of clientes.slice(i, i + BATCH)) {
      const previo = porTelefono.get(cliente.phone);
      if (previo) {
        // No pisar lo editado a mano: sólo completar lo que falta.
        if (!previo.name && cliente.name) {
          await supabase.from("customers").update({ name: cliente.name }).eq("id", previo.id);
          completados++;
        }
        if (cliente.lote) conDireccion.push({ customer_id: previo.id, cliente });
        continue;
      }
      const { data: creado, error } = await supabase
        .from("customers")
        .insert({ business_id: business.id, phone: cliente.phone, name: cliente.name })
        .select("id")
        .single();
      if (error) {
        console.error(`  ✗ ${cliente.codigo} (${cliente.phone}): ${error.message}`);
        continue;
      }
      creados++;
      if (cliente.lote) conDireccion.push({ customer_id: creado.id, cliente });
    }
  }

  let direcciones = 0;
  for (const { customer_id, cliente } of conDireccion) {
    const street = `Lote ${cliente.lote}`;
    const { data: yaEsta } = await supabase
      .from("customer_addresses")
      .select("id")
      .eq("customer_id", customer_id)
      .eq("street", street)
      .maybeSingle();
    if (yaEsta) continue;
    const { error } = await supabase.from("customer_addresses").insert({
      customer_id,
      street,
      label: cliente.calle,
    });
    if (error) {
      console.error(`  ✗ dirección de ${cliente.phone}: ${error.message}`);
      continue;
    }
    direcciones++;
  }

  console.log(
    `\n✓ ${creados} clientes nuevos, ${completados} completados, ${direcciones} lotes cargados.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
