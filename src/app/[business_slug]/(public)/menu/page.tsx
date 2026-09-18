import { notFound } from "next/navigation";

import { MenuClient } from "@/components/menu/menu-client";
import { computeIsOpen } from "@/lib/business-hours";
import { listActiveOrders } from "@/lib/customers/active-orders";
import { currentDayOfWeek } from "@/lib/day-of-week";
import { getMenu } from "@/lib/menu";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/tenant";

export default async function MenuPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // Día de la semana y fecha formateada se calculan en el server, con el TZ
  // del negocio, para que el cliente no haga drift contra el reloj local.
  const todayDow = currentDayOfWeek(business.timezone);

  const [menu, supabase] = await Promise.all([
    getMenu(business.id, todayDow),
    createSupabaseServerClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If the owner manually closed the business (is_active = false), treat it as
  // closed regardless of the business-hours schedule so the cart is disabled
  // and the "Cerrado" banner is shown. Orders are also blocked server-side in
  // persist-order.ts, but disabling the UI avoids confusion for the customer.
  const isOpen =
    (business.is_active ?? true) && computeIsOpen(menu.hours, business.timezone);
  const tagline =
    (business.settings as { tagline?: string } | null)?.tagline ??
    business.address ??
    null;

  const activeOrders = user
    ? await listActiveOrders(user.id, business.id)
    : [];

  return (
    <MenuClient
      slug={business_slug}
      businessName={business.name}
      tagline={tagline}
      coverImageUrl={business.cover_image_url ?? business.logo_url}
      logoUrl={business.logo_url}
      categories={menu.categories}
      superCategories={menu.superCategories}
      deliveryFeeCents={Number(business.delivery_fee_cents)}
      minOrderCents={Number(business.min_order_cents)}
      estimatedMinutes={business.estimated_delivery_minutes}
      activeOrders={activeOrders}
      hours={menu.hours}
      timezone={business.timezone}
      isOpenInitial={isOpen}
      user={
        user
          ? {
              name:
                (user.user_metadata?.full_name as string | undefined) ??
                (user.user_metadata?.name as string | undefined),
              email: user.email ?? "",
            }
          : null
      }
    />
  );
}
