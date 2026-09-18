"use client";

import { Pill } from "@/components/admin/catalog/product-bits";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";

/** Si el cliente lo ve hoy: activo, disponible y el día de hoy está en sus días. */
export function isOnTodaysCarta(
  menu: AdminDailyMenu,
  todayDow: number,
): boolean {
  return (
    menu.is_active &&
    menu.is_available &&
    menu.available_days.includes(todayDow)
  );
}

/** Pills de estado de un menú del día (spec 205 · D8): igual espíritu que
 *  `ProductPills`, pero con lo que importa acá — hoy en la carta, dónde se
 *  ofrece. */
export function MenuPills({
  menu,
  todayDow,
}: {
  menu: AdminDailyMenu;
  todayDow: number;
}) {
  const salon =
    menu.display_context === "salon" || menu.display_context === "both";
  const online =
    menu.display_context === "delivery" || menu.display_context === "both";
  return (
    <>
      {!menu.is_active ? (
        <Pill tone="off">De baja</Pill>
      ) : (
        <>
          {!menu.is_available && <Pill tone="warn">Agotado</Pill>}
          {isOnTodaysCarta(menu, todayDow) && (
            <Pill tone="ok">Hoy en la carta</Pill>
          )}
        </>
      )}
      {salon && <Pill tone="off">Salón</Pill>}
      {online && <Pill tone="off">Carta online</Pill>}
    </>
  );
}
