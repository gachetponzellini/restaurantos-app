import { notFound } from "next/navigation";

import { CartaClient } from "@/components/menu/carta-client";
import { computeIsOpen } from "@/lib/business-hours";
import { resolveCartaTheme } from "@/lib/carta-theme";
import { currentDayOfWeek } from "@/lib/day-of-week";
import { getMenu } from "@/lib/menu";
import { getBusiness } from "@/lib/tenant";

// Carta SOLO VISUAL (read-only) para el QR de la mesa: el comensal mira la carta
// y le pide al mozo. No tiene carrito ni checkout (eso vive en /menu). Reusa el
// mismo catálogo (getMenu) y las primitivas de presentación.
export default async function CartaPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const todayDow = currentDayOfWeek(business.timezone);

  // Contexto `salon`: quien escanea el QR está sentado en la mesa, así que ve
  // los menús del día del salón — no los de pedidos online.
  const menu = await getMenu(business.id, todayDow, "salon");
  const isOpen =
    (business.is_active ?? true) && computeIsOpen(menu.hours, business.timezone);
  const tagline =
    (business.settings as { tagline?: string } | null)?.tagline ??
    business.address ??
    null;

  return (
    <CartaClient
      businessName={business.name}
      tagline={tagline}
      theme={resolveCartaTheme(business.settings)}
      coverImageUrl={business.cover_image_url ?? business.logo_url}
      logoUrl={business.logo_url}
      categories={menu.categories}
      beverageSuperCategoryId={menu.beverageSuperCategoryId}
      hours={menu.hours}
      timezone={business.timezone}
      isOpenInitial={isOpen}
    />
  );
}
