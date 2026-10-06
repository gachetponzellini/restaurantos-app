import { notFound, redirect } from "next/navigation";

import { ResumenDeCierre } from "@/components/admin/local/resumen-de-cierre";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getResumenDeCorte } from "@/lib/caja/queries";
import { resolveCierrePrinter } from "@/lib/print/cuenta-printer";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const AR_TZ = "America/Argentina/Buenos_Aires";

/** Pasado esto, reabrir el link del cierre ya no lo anuncia como recién hecho. */
const VENTANA_RECIEN_MS = 10 * 60_000;

export default async function ResumenDeCierrePage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string; corteId: string }>;
  searchParams: Promise<{ recien?: string }>;
}) {
  const { business_slug, corteId } = await params;
  const q = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  if (!canSee("cajas", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  // El scope por negocio vive en la query: un `corteId` válido de OTRO negocio
  // vuelve `null` y cae en 404, no en «no encontrado» después de haberlo leído.
  const resumen = await getResumenDeCorte(corteId, business.id);
  if (!resumen) notFound();

  // Spec 209 · R7 — el banner de «recién cerrada». El `?recien=1` sólo dice de
  // dónde se viene; el retiro sale del corte (el movimiento atado por
  // `corte_id`) y el banner se apaga solo si el link se reabre más tarde. Así
  // un link armado a mano no puede decir «retiraste $X».
  const recienCerrada =
    q.recien === "1" &&
    Date.now() - new Date(resumen.corte.created_at).getTime() < VENTANA_RECIEN_MS;
  const recien = recienCerrada
    ? {
        retiro_cents: resumen.retiro_cents ?? 0,
        hayComandera: resolveCierrePrinter(business) !== null,
      }
    : null;

  return (
    <PageShell width="wide">
      <ResumenDeCierre
        slug={business_slug}
        timezone={business.timezone || AR_TZ}
        resumen={resumen}
        recien={recien}
      />
    </PageShell>
  );
}
