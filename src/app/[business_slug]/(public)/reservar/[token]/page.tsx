import { notFound, redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";

import { ConfirmReservationFromIntent } from "./confirm-reservation-from-intent";
import { getReservationIntentByToken } from "@/lib/reservations/chatbot-actions";
import {
  formatReservationDay,
  formatReservationSlotWhen,
} from "@/lib/reservations/format-when";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Chatbot handoff: the bot generated this token via `generate_reservation_link`
 * after the customer agreed on date + time + party. Here we resurrect the
 * intent, gate the customer through login, and render a confirmation form
 * that uses the canonical `createReservationFromCustomer` server action.
 *
 * Mirrors the structure of `/cart/[token]` (the orders handoff), with two
 * differences:
 *   1. We DO consume the intent post-success (cart_token isn't consumed).
 *   2. We DO require auth at this page (cart pushes auth to /checkout).
 *      Reservations need a `user_id` to be cancellable later from /perfil,
 *      so requiring login here is cheaper than threading a fake user.
 */
export default async function ReservarTokenPage({
  params,
}: {
  params: Promise<{ business_slug: string; token: string }>;
}) {
  const { business_slug, token } = await params;

  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const intent = await getReservationIntentByToken(token);
  if (!intent || intent.businessId !== business.id) notFound();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/${business_slug}/login?next=${encodeURIComponent(`/${business_slug}/reservar/${token}`)}`,
    );
  }

  const prefillName =
    intent.intent.customer_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  const prefillPhone =
    intent.intent.customer_phone ||
    // H-19: el alta guarda el teléfono en `user_metadata.phone`.
    (user.phone as string | undefined) ||
    (user.user_metadata?.phone as string | undefined) ||
    null;

  return (
    <ConfirmReservationFromIntent
      slug={business_slug}
      token={token}
      businessName={business.name}
      logoUrl={business.logo_url ?? null}
      intent={intent.intent}
      whenLabel={formatReservationSlotWhen(
        intent.intent.date,
        intent.intent.slot,
        business.timezone,
      )}
      dayLabel={formatReservationDay(
        fromZonedTime(
          `${intent.intent.date}T${intent.intent.slot}:00`,
          business.timezone,
        ),
        business.timezone,
      )}
      prefillName={prefillName}
      prefillPhone={prefillPhone}
    />
  );
}
