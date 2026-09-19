import { notFound, redirect } from "next/navigation";

import { CajaShell } from "@/components/admin/caja/caja-shell";
import { FiltroFechas } from "@/components/admin/caja/filtro-fechas";
import { CierresClient } from "@/components/admin/local/cierres-client";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getAllCajasForBusiness, getCortesDelRango } from "@/lib/caja/queries";
import {
  parseAncla,
  parseGranularidad,
  rangoDe,
} from "@/lib/caja/rango-fechas";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const AR_TZ = "America/Argentina/Buenos_Aires";

export default async function CierresPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ gran?: string; fecha?: string; caja?: string }>;
}) {
  const { business_slug } = await params;
  const sp = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Spec 153 · D6/D7 — la sección Caja es de quien audita la plata: encargado y
  // admin. El `terminal` (la compu del salón) queda afuera por la matriz.
  if (!canSee("cajas", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  const tz = business.timezone || AR_TZ;
  // Cierres abre en la semana en curso: un solo día casi siempre muestra uno o dos.
  const gran = parseGranularidad(sp.gran, "semana");
  const ancla = parseAncla(gran, sp.fecha, tz);
  const { from, to } = rangoDe(gran, ancla, tz);

  const [cajas, cortes] = await Promise.all([
    getAllCajasForBusiness(business.id),
    getCortesDelRango(business.id, { from, to, cajaId: sp.caja || null }),
  ]);

  return (
    <PageShell width="wide">
      <CajaShell slug={business_slug} activa="cierres">
        <FiltroFechas
          basePath={`/${business_slug}/admin/caja/cierres`}
          gran={gran}
          ancla={ancla}
          timezone={tz}
          extra={{ caja: sp.caja }}
        />
        <CierresClient
          slug={business_slug}
          timezone={tz}
          cajas={cajas.map((c) => ({ id: c.id, name: c.name }))}
          cortes={cortes}
          cajaId={sp.caja ?? ""}
          filtroUrl={{ gran, fecha: ancla }}
        />
      </CajaShell>
    </PageShell>
  );
}
