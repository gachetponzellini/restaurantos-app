import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { getInvoiceForOrder } from "@/lib/afip/queries";
import { ensureAdminAccess } from "@/lib/admin/context";
import { iniciarCobro } from "@/lib/billing/cobro-actions";
import { getCuentaForTable } from "@/lib/billing/cuenta-query";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

import { canFiar } from "@/lib/permissions/can";
import { getClientesParaFiar } from "@/lib/caja/cuenta-corriente-queries";
import { CobrarDesktopClient } from "./cobrar-desktop-client";

export const dynamic = "force-dynamic";

export default async function AdminCobrarPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string; id: string }>;
  searchParams?: Promise<{ volver?: string }>;
}) {
  const { business_slug, id: tableId } = await params;
  // Adónde volver al terminar de cobrar (p. ej. el cierre del turno). Sólo una
  // ruta del admin de este mismo negocio: nada de redirigir afuera.
  const volverRaw = (await searchParams)?.volver;
  const volverA =
    volverRaw && volverRaw.startsWith(`/${business_slug}/admin/`) && !volverRaw.startsWith("//")
      ? volverRaw
      : undefined;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Spec 140: el gate sale de la matriz. La `terminal` opera desde el panel y
  // rebotarla a la UI móvil del mozo la sacaría del flujo a mitad de la carga.
  if (
    !canSee("operacion", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })
  ) {
    redirect(`/${business_slug}/mozo/mesa/${tableId}/cobrar`);
  }

  const cuenta = await getCuentaForTable(tableId, business.id);
  if (!cuenta) {
    return (
      <PageShell width="narrow">
        <PageHeader
          eyebrow="Cobro"
          title="No hay cuenta para cobrar"
          description="Esta mesa no tiene un pedido activo. Cargá items primero desde la pantalla de pedido."
          back={{
            href: `/${business_slug}/admin/operacion`,
            label: "Volver al salón",
          }}
        />
        <Link
          href={`/${business_slug}/admin/operacion`}
          className="inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Volver al salón
        </Link>
      </PageShell>
    );
  }

  const init = await iniciarCobro(cuenta.order.id, business_slug);
  if (!init.ok) {
    return (
      <PageShell width="narrow">
        <PageHeader
          eyebrow="Cobro"
          title="No se puede cobrar"
          description={init.error}
          back={{
            href: `/${business_slug}/admin/operacion`,
            label: "Volver al salón",
          }}
        />
        <Link
          href={`/${business_slug}/admin/operacion?tab=caja`}
          className="text-sm font-semibold text-zinc-900 underline"
        >
          Ir a caja →
        </Link>
      </PageShell>
    );
  }

  const service = createSupabaseServiceClient();
  const [{ data: tableRow }, existingInvoice] = await Promise.all([
    service.from("tables").select("label").eq("id", tableId).single(),
    getInvoiceForOrder(business.id, cuenta.order.id),
  ]);

  // Con AFIP configurado el cobro ofrece emitir el comprobante y no se cierra
  // solo al terminar (#137). Mismo criterio que el cobro del mozo.
  const biz = business as Record<string, unknown>;
  const afipConfigured = !!(biz.afip_cuit && biz.afip_punto_venta);

  // spec 141 — esta ruta arma sus datos por su cuenta (no pasa por
  // `loadCobroForTable`), así que la lista de a quién fiarle se pide acá, con el
  // mismo gate de rol.
  const rolEfectivo = ctx.isPlatformAdmin ? "admin" : (ctx.role ?? "admin");
  const clientesParaFiar = canFiar(rolEfectivo)
    ? await getClientesParaFiar(business.id)
    : [];

  return (
    <CobrarDesktopClient
      slug={business_slug}
      tableId={tableId}
      tableLabel={tableRow?.label ?? "?"}
      role={ctx.isPlatformAdmin ? "admin" : (ctx.role ?? "admin")}
      cuenta={cuenta}
      init={init.data}
      existingInvoice={existingInvoice}
      afipConfigured={afipConfigured}
      clientesParaFiar={clientesParaFiar}
      volverA={volverA}
    />
  );
}
