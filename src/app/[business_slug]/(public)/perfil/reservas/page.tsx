import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MyReservationsScreen } from "@/components/reservations/my-reservations-screen";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { Reservation } from "@/lib/reservations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function MisReservasPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    redirect(`/${business_slug}/login?next=/${business_slug}/perfil/reservas`);

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await service
    .from("reservations")
    .select("*, tables(label)")
    .eq("business_id", business.id)
    .eq("user_id", user.id)
    .order("starts_at", { ascending: false });
  const reservations = (data ?? []) as (Reservation & {
    tables: { label: string } | null;
  })[];

  const settings = await getReservationSettings(business.id, {
    useService: true,
  });

  return (
    <MyReservationsScreen
      slug={business_slug}
      timezone={business.timezone}
      leadTimeMin={settings.lead_time_min}
      reservations={reservations}
    />
  );
}
