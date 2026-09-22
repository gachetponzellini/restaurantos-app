import { notFound } from "next/navigation";

// SPEC 25 (PENDING): banner "Verificá tu cuenta" desactivado.
// import { VerifyAccountBanner } from "@/components/public/verify-account-banner";
import { ReservarFlow } from "@/components/reservations/reservar-flow";
import { parseReservaInicial } from "@/lib/reservations/reserva-inicial";
import {
  getBusinessSalones,
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ReservarPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business_slug } = await params;
  const sp = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pre-fill name + phone from auth profile when logged in. Falls back to
  // user_metadata so Google sign-in users see their name on the form.
  let name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  if (user) {
    name =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      null;
    phone = (user.phone as string | undefined) ?? null;
    email = user.email ?? null;
  }

  const tagline =
    (business.settings as { tagline?: string } | null)?.tagline ??
    business.address ??
    null;

  const [reservationSettings, salones, services] = await Promise.all([
    getReservationSettings(business.id, { useService: true }),
    getBusinessSalones(business.id, { useService: true }),
    getReservationServices(business.id, { useService: true }),
  ]);

  // SPEC 25 (PENDING) — gate suave desactivado:
  // const showVerifyBanner = !!user && user.user_metadata?.phone_verified !== true;
  // {showVerifyBanner && (
  //   <VerifyAccountBanner
  //     href={`/${business_slug}/verificar?next=${encodeURIComponent(
  //       `/${business_slug}/reservar`,
  //     )}`}
  //   />
  // )}

  return (
    <ReservarFlow
      slug={business_slug}
      timezone={business.timezone}
      businessName={business.name}
      tagline={tagline}
      coverImageUrl={business.cover_image_url ?? business.logo_url ?? null}
      logoUrl={business.logo_url ?? null}
      settings={{
        advance_days_max: reservationSettings.advance_days_max,
        max_party_size: reservationSettings.max_party_size,
        slot_duration_min: reservationSettings.slot_duration_min,
        schedule: reservationSettings.schedule,
      }}
      salones={salones}
      mode={reservationSettings.mode ?? "estricto"}
      // Auditoría de reservas · media — lo elegido antes del login.
      inicial={parseReservaInicial(sp, {
        maxParty: reservationSettings.max_party_size,
      })}
      services={services}
      // Spec 080 — teléfono del negocio para el botón de WhatsApp del aviso
      // de invitados (sólo se usa en los negocios que tienen política).
      businessPhone={business.phone ?? null}
      user={{ isLoggedIn: !!user, name, phone, email }}
    />
  );
}
