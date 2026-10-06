import { notFound, redirect } from "next/navigation";

import { CheckoutForm } from "@/components/checkout/checkout-form";
// SPEC 25 (PENDING): banner "Verificá tu cuenta" desactivado.
// import { VerifyAccountBanner } from "@/components/public/verify-account-banner";
import { listUserAddresses } from "@/lib/customers/addresses";
import { getCustomerProfile } from "@/lib/customers/profile";
import { contactoInicial } from "@/lib/orders/contacto-inicial";
import { orderSlotsForDay } from "@/lib/orders/scheduled";
import { getAssignedCoupon } from "@/lib/promos/assigned-coupon";
import {
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/tenant";

export default async function CheckoutPage({
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
  if (!user) {
    const next = encodeURIComponent(`/${business_slug}/checkout`);
    redirect(`/${business_slug}/login?next=${next}`);
  }

  const [savedAddresses, profile, reservationSettings, reservationServices] =
    await Promise.all([
      listUserAddresses(user.id, business.id),
      getCustomerProfile(user.id, business.id),
      // Config de reservas: desde spec 064 el pedido programado se elige con
      // los MISMOS chips de horario que una reserva, y sólo para hoy. En modo
      // flexible salen de los servicios (cada 15 min); en estricto, de la
      // grilla fija. El server revalida igual en persist-order.
      getReservationSettings(business.id),
      getReservationServices(business.id),
    ]);

  // Los horarios de hoy se resuelven en el server (con "hoy" en el TZ del
  // local) para que el chip que ve el cliente sea estable entre SSR e
  // hidratación; el filtro por anticipación mínima corre en el cliente.
  const todaySlots = orderSlotsForDay(
    {
      mode: reservationSettings.mode ?? null,
      schedule: reservationSettings.schedule,
      services: reservationServices,
    },
    new Date(),
    business.timezone,
  );

  const mpEnabled = Boolean(
    business.mp_accepts_payments && business.mp_access_token,
  );

  const assignedCoupon = await getAssignedCoupon(
    user.id,
    business.id,
    0,
    Number(business.delivery_fee_cents),
  );

  // Prefer the customer row (set on previous orders) over session metadata —
  // the customer row reflects the last name/phone the user actually typed.
  // H-19 (QA #382): `contactoInicial` descarta los strings vacíos; Supabase
  // devuelve `user.phone === ""` y con `??` eso tapaba `user_metadata.phone`.
  const {
    name: initialName,
    email: initialEmail,
    phone: initialPhone,
  } = contactoInicial(profile, user);

  // SPEC 25 (PENDING) — gate suave desactivado:
  // const showVerifyBanner = user.user_metadata?.phone_verified !== true;
  // {showVerifyBanner && (
  //   <VerifyAccountBanner
  //     href={`/${business_slug}/verificar?next=${encodeURIComponent(
  //       `/${business_slug}/checkout`,
  //     )}`}
  //   />
  // )}

  return (
    <CheckoutForm
      slug={business_slug}
      businessName={business.name}
      businessAddress={business.address}
      businessTimezone={business.timezone}
      todaySlots={todaySlots}
      deliveryFeeCents={Number(business.delivery_fee_cents)}
      minOrderCents={Number(business.min_order_cents ?? 0)}
      estimatedMinutes={business.estimated_delivery_minutes}
      estimatedPickupMinutes={
        (business as { estimated_pickup_minutes?: number | null })
          .estimated_pickup_minutes ?? null
      }
      savedAddresses={savedAddresses}
      mpEnabled={mpEnabled}
      initialName={initialName}
      initialEmail={initialEmail}
      initialPhone={initialPhone}
      initialPromo={
        assignedCoupon
          ? {
              code: assignedCoupon.code,
              discount_cents: assignedCoupon.discount_cents,
              free_shipping: assignedCoupon.free_shipping,
            }
          : undefined
      }
    />
  );
}
