// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

// ── Qué cubre este archivo (spec 190) ──────────────────────────────────
// La comandera de control dejó de ser un string escrito en la ficha de cada
// persona y pasó a ser una fila que el usuario ELIGE. Lo que se prueba contra
// Postgres de verdad es lo que un mock no puede: el índice único por nombre, la
// guarda cross-tenant (una comandera de otro negocio no se puede asignar) y que
// borrar una en uso se niegue en vez de dejar a alguien imprimiendo en otro lado
// sin enterarse.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-comanderas-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let ACTING_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: ACTING_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: ACTING_USER_ID } },
        error: null,
      }),
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { createControlPrinter, deleteControlPrinter, updateControlPrinterRow } =
  await import("./control-printers-actions");
const { listControlPrinters } = await import("./control-printers");
const { updateControlPrinter } = await import("@/lib/admin/members-actions");

describe.skipIf(!dbAvailable)(
  "comanderas de control · la lista del negocio (spec 190)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId = "";
    let businessSlug = "";
    let otroBusinessId = "";
    let encargadoId = "";
    const usuarios: string[] = [];

    async function crearUsuario(email: string): Promise<string> {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: "test-pass-12345",
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
      await supabase.from("users").upsert({ id: data.user.id, email });
      usuarios.push(data.user.id);
      return data.user.id;
    }

    beforeAll(async () => {
      ACTING_USER_ID = await crearUsuario(`${TEST_TAG}-admin@example.test`);
      encargadoId = await crearUsuario(`${TEST_TAG}-encargado@example.test`);

      const { data: biz } = await supabase
        .from("businesses")
        .insert({ slug: TEST_TAG, name: "Comanderas Test", is_active: true })
        .select("id, slug")
        .single();
      businessId = biz!.id;
      businessSlug = biz!.slug;

      const { data: otro } = await supabase
        .from("businesses")
        .insert({
          slug: `${TEST_TAG}-otro`,
          name: "Otro local",
          is_active: true,
        })
        .select("id")
        .single();
      otroBusinessId = otro!.id;

      await supabase.from("business_users").insert([
        {
          business_id: businessId,
          user_id: ACTING_USER_ID,
          role: "admin",
          full_name: "Admin Test",
        },
        {
          business_id: businessId,
          user_id: encargadoId,
          role: "encargado",
          full_name: "Encargada de la caja 2",
        },
      ]);
    });

    afterAll(async () => {
      for (const id of [businessId, otroBusinessId]) {
        if (id) await supabase.from("businesses").delete().eq("id", id);
      }
      for (const id of usuarios) {
        await supabase.auth.admin.deleteUser(id).catch(() => undefined);
      }
    });

    it("se crea con nombre y destino, y aparece en la lista", async () => {
      const r = await createControlPrinter({
        business_slug: businessSlug,
        name: "Caja 2",
        printer_ip: "local:CAJA2",
        printer_port: 9100,
      });
      expect(r.ok).toBe(true);

      const lista = await listControlPrinters(businessId);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        name: "Caja 2",
        printer_ip: "local:CAJA2",
        is_active: true,
        usuarios: 0,
      });
    });

    it("dos comanderas no se pueden llamar igual", async () => {
      const r = await createControlPrinter({
        business_slug: businessSlug,
        name: "caja 2",
        printer_ip: "192.168.10.99",
        printer_port: 9100,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/ya hay una comandera/i);
    });

    it("un destino que no es IP ni `local:` se rechaza", async () => {
      const r = await createControlPrinter({
        business_slug: businessSlug,
        name: "Rota",
        printer_ip: "no es una impresora",
        printer_port: 9100,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/destino inválido/i);
    });

    it("el encargado la elige, y la lista dice cuánta gente imprime ahí", async () => {
      const [caja2] = await listControlPrinters(businessId);
      const r = await updateControlPrinter({
        business_slug: businessSlug,
        user_id: encargadoId,
        control_printer_id: caja2!.id,
      });
      expect(r.ok).toBe(true);

      const { data } = await supabase
        .from("business_users")
        .select("control_printer_id")
        .eq("business_id", businessId)
        .eq("user_id", encargadoId)
        .maybeSingle();
      expect((data as { control_printer_id: string }).control_printer_id).toBe(
        caja2!.id,
      );

      const lista = await listControlPrinters(businessId);
      expect(lista[0]!.usuarios).toBe(1);
    });

    it("una comandera de OTRO negocio no se puede asignar", async () => {
      const { data: ajena } = await supabase
        .from("control_printers")
        .insert({
          business_id: otroBusinessId,
          name: "La del otro local",
          printer_ip: "192.168.99.99",
        })
        .select("id")
        .single();

      const r = await updateControlPrinter({
        business_slug: businessSlug,
        user_id: encargadoId,
        control_printer_id: (ajena as { id: string }).id,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/no es de este negocio/i);
    });

    it("borrar una que alguien usa se niega: primero se la sacás", async () => {
      const [caja2] = await listControlPrinters(businessId);
      const r = await deleteControlPrinter({
        business_slug: businessSlug,
        id: caja2!.id,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/1 persona/i);
    });

    it("desactivada, el usuario la conserva pero no se le puede reasignar", async () => {
      const [caja2] = await listControlPrinters(businessId);
      const apagar = await updateControlPrinterRow({
        business_slug: businessSlug,
        id: caja2!.id,
        name: caja2!.name,
        printer_ip: caja2!.printer_ip,
        printer_port: caja2!.printer_port,
        is_active: false,
      });
      expect(apagar.ok).toBe(true);

      const r = await updateControlPrinter({
        business_slug: businessSlug,
        user_id: encargadoId,
        control_printer_id: caja2!.id,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/desactivada/i);
    });

    it("volviendo a «la del negocio», la comandera se puede borrar", async () => {
      const sacar = await updateControlPrinter({
        business_slug: businessSlug,
        user_id: encargadoId,
        control_printer_id: null,
      });
      expect(sacar.ok).toBe(true);

      const [caja2] = await listControlPrinters(businessId);
      const r = await deleteControlPrinter({
        business_slug: businessSlug,
        id: caja2!.id,
      });
      expect(r.ok).toBe(true);
      expect(await listControlPrinters(businessId)).toHaveLength(0);
    });
  },
);
