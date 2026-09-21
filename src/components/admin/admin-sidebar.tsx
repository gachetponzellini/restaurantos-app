"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  CircleHelp,
  Clock,
  History,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Package,
  Receipt,
  Settings,
  Tag,
  Truck,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { IntentLink } from "@/components/ui/intent-link";
import type { BusinessRole } from "@/lib/admin/context";
import { canSee, type AdminSection } from "@/lib/permissions/sections";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

// ─── Types ──────────────────────────────────────────────────────────────────

export type NavItem = {
  section: AdminSection;
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (pathname: string) => boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

// ─── Nav builder ────────────────────────────────────────────────────────────
//
// Se arman TODOS los grupos/items con su `section`, y se filtran por `canSee`
// (matriz en `src/lib/permissions/sections.ts`). Los grupos que quedan vacíos
// para el rol se descartan. Así sidebar y page-gates comparten la misma fuente.

function buildNav(
  slug: string,
  role: BusinessRole | null,
  isPlatformAdmin: boolean,
): NavGroup[] {
  const adminBase = `/${slug}/admin`;
  const icon = (I: React.ComponentType<{ className?: string; strokeWidth?: number }>) => (
    <I className="size-[18px]" strokeWidth={1.75} />
  );

  const allGroups: NavGroup[] = [
    {
      label: "Operación",
      items: [
        {
          section: "dashboard",
          href: adminBase,
          label: "Dashboard",
          icon: icon(LayoutDashboard),
          match: (p) => p === adminBase,
        },
        {
          section: "operacion",
          href: `${adminBase}/operacion`,
          label: "Operación Diaria",
          icon: icon(Zap),
          match: (p) =>
            p === `${adminBase}/operacion` ||
            p.startsWith(`${adminBase}/operacion/`) ||
            p === `${adminBase}/pedidos` ||
            (p.startsWith(`${adminBase}/pedidos/`) &&
              !p.startsWith(`${adminBase}/pedidos/historial`)),
        },
        {
          // Reservas vive en Operación (no en Catálogo): es agenda del turno,
          // no configuración. La misma vista existe como tab del operativo
          // (`operacion?tab=reservas`); este item abre la página completa.
          section: "reservas",
          href: `${adminBase}/reservas`,
          label: "Reservas",
          icon: icon(CalendarDays),
          match: (p) => p.startsWith(`${adminBase}/reservas`),
        },
        {
          section: "pedidos",
          href: `${adminBase}/pedidos/historial`,
          label: "Pedidos",
          icon: icon(History),
          match: (p) => p.startsWith(`${adminBase}/pedidos/historial`),
        },
        {
          section: "cajas",
          href: `${adminBase}/caja`,
          // Spec 153 · dejó de ser el catálogo de cajas y pasó a ser todo lo de
          // la plata: las cajas, los cierres y el libro. Por eso el singular.
          label: "Caja",
          icon: icon(Wallet),
          match: (p) => p.startsWith(`${adminBase}/caja`),
        },
      ],
    },
    {
      label: "Catálogo",
      items: [
        {
          section: "catalogo",
          href: `${adminBase}/catalogo`,
          label: "Productos e inventario",
          icon: icon(Package),
          match: (p) =>
            p.startsWith(`${adminBase}/catalogo`) ||
            p.startsWith(`${adminBase}/menu-del-dia`) ||
            p.startsWith(`${adminBase}/stock`),
        },
        {
          section: "salones",
          href: `${adminBase}/salones`,
          label: "Salones",
          icon: icon(LayoutGrid),
          match: (p) => p.startsWith(`${adminBase}/salones`),
        },
      ],
    },
    {
      label: "Marketing",
      items: [
        {
          section: "clientes",
          href: `${adminBase}/clientes`,
          label: "Clientes",
          icon: icon(Users),
          match: (p) => p.startsWith(`${adminBase}/clientes`),
        },
        {
          section: "promociones",
          href: `${adminBase}/promociones`,
          label: "Promociones",
          icon: icon(Tag),
          match: (p) => p.startsWith(`${adminBase}/promociones`),
        },
        {
          section: "campanas",
          href: `${adminBase}/campanas`,
          label: "Campañas",
          icon: icon(Megaphone),
          match: (p) => p.startsWith(`${adminBase}/campanas`),
        },
        {
          section: "chatbot",
          href: `${adminBase}/chatbot`,
          label: "Chatbot",
          icon: icon(MessageSquare),
          match: (p) => p.startsWith(`${adminBase}/chatbot`),
        },
        {
          section: "conversaciones",
          href: `${adminBase}/conversaciones`,
          label: "Conversaciones",
          icon: icon(MessagesSquare),
          match: (p) => p.startsWith(`${adminBase}/conversaciones`),
        },
      ],
    },
    {
      label: "Administración",
      items: [
        {
          section: "reportes",
          href: `${adminBase}/reportes`,
          label: "Reportes",
          icon: icon(BarChart3),
          match: (p) => p.startsWith(`${adminBase}/reportes`),
        },
        {
          section: "proveedores",
          href: `${adminBase}/proveedores`,
          label: "Proveedores",
          icon: icon(Truck),
          match: (p) => p.startsWith(`${adminBase}/proveedores`),
        },
        {
          section: "facturacion",
          href: `${adminBase}/facturacion`,
          label: "Facturación",
          icon: icon(Receipt),
          match: (p) => p.startsWith(`${adminBase}/facturacion`),
        },
        {
          section: "rrhh",
          href: `${adminBase}/rrhh`,
          label: "RRHH",
          icon: icon(Clock),
          match: (p) =>
            p.startsWith(`${adminBase}/rrhh`) ||
            p.startsWith(`${adminBase}/empleados`) ||
            p.startsWith(`${adminBase}/usuarios`),
        },
        {
          section: "configuracion",
          href: `${adminBase}/configuracion`,
          label: "Ajustes",
          icon: icon(Settings),
          match: (p) => p.startsWith(`${adminBase}/configuracion`),
        },
      ],
    },
    // Ayuda (spec 134) va en su propio grupo y al final, no adentro de
    // "Administración": no es un módulo del panel, es cómo se usa el panel.
    // Grupo propio y no un item suelto al pie del `<nav>` porque desde acá
    // baja a los dos lados —rail desktop y drawer mobile— sin duplicar la
    // lógica en `AdminMobileNav`, que consume estos mismos `groups`.
    {
      label: "Ayuda",
      items: [
        {
          section: "ayuda",
          href: `${adminBase}/ayuda`,
          label: "Cómo se usa el panel",
          icon: icon(CircleHelp),
          match: (p) => p.startsWith(`${adminBase}/ayuda`),
        },
      ],
    },
  ];

  return allGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) =>
        canSee(it.section, role, { isPlatformAdmin }),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

// ─── Dimensiones ────────────────────────────────────────────────────────────

const COLLAPSED_WIDTH = 60;
const EXPANDED_WIDTH = 256;

// ─── Main component ──────────────────────────────────────────────────────────

export function AdminSidebar({
  slug,
  businessId,
  businessName,
  businessLogoUrl = null,
  userEmail,
  userName,
  isPlatformAdmin = false,
  role = null,
  siblings = [],
  initialPendingCount = 0,
  lowStockCount = 0,
  ayudaPendientes = 0,
  isActive: _isActive = true,
}: {
  slug: string;
  businessId: string;
  businessName: string;
  businessLogoUrl?: string | null;
  userEmail: string;
  userName?: string | null;
  isPlatformAdmin?: boolean;
  role?: BusinessRole | null;
  siblings?: { slug: string; name: string; logoUrl: string | null }[];
  initialPendingCount?: number;
  lowStockCount?: number;
  /** Temas del recorrido de la guía sin leer (spec 169 · D4). 0 = nada que
   *  mostrar: o lo terminó, o su rol todavía no tiene guía. */
  ayudaPendientes?: number;
  isActive?: boolean;
}) {
  void _isActive;
  const pathname = usePathname();
  const groups = buildNav(slug, role, isPlatformAdmin);

  // ── Sidebar expanded / collapsed (hover-driven) ───────────────────────────
  const [expanded, setExpanded] = useState(false);

  // El sidebar siempre ocupa COLLAPSED_WIDTH en el flujo: la versión expandida
  // se renderiza absoluta encima del contenido para no empujarlo al hacer hover.
  // Mantenemos `--admin-sidebar-width` igual al ancho colapsado para que los
  // overlays externos (ej: tab Salón de /admin/operacion) sigan calibrando su left.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--admin-sidebar-width",
      `${COLLAPSED_WIDTH}px`,
    );
  }, []);

  // ── Pending order badge ───────────────────────────────────────────────────
  const [pendingCount, setPendingCount] = useState(initialPendingCount);

  // ── Realtime subscription ─────────────────────────────────────────────────
  const businessIdRef = useRef(businessId);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`admin-orders-${businessIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `business_id=eq.${businessIdRef.current}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newOrder = payload.new as {
              order_number?: number;
              customer_name?: string;
              delivery_type?: string;
            };
            // Solo pedidos online: las órdenes de mesa (dine_in) viven en el
            // salón, no son "pedidos" de este badge. Contarlas lo inflaba y
            // disparaba un toast de pedido cuando un mozo abría una mesa.
            if (newOrder.delivery_type === "dine_in") return;
            setPendingCount((c) => c + 1);
            toast(
              `🔔 Pedido #${newOrder.order_number ?? "—"} — ${newOrder.customer_name ?? "cliente"}`,
              { duration: 6000 },
            );
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as {
              status?: string;
              delivery_type?: string;
            };
            if (updated.delivery_type === "dine_in") return;
            const newStatus = updated.status ?? "";
            const isTerminal =
              newStatus === "delivered" || newStatus === "cancelled";
            if (isTerminal) {
              setPendingCount((c) => Math.max(0, c - 1));
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // intentionally empty — runs once, uses ref for businessId

  // ── Tab title ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (pendingCount > 0) {
      document.title = `(${pendingCount}) Pedidos · ${businessName}`;
    } else {
      document.title = businessName;
    }
  }, [pendingCount, businessName]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <aside
      aria-label="Navegación admin"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{ width: COLLAPSED_WIDTH }}
      className="sticky top-0 z-40 hidden h-screen shrink-0 md:block"
    >
      <div
        style={{ width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col overflow-hidden",
          "border-r border-zinc-200/70 bg-zinc-50/95 backdrop-blur-xl",
          "shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)]",
          "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        )}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex flex-row items-center gap-2 px-3 pt-2.5 pb-1.5">
          {siblings.length >= 2 ? (
            <BusinessSwitcher
              currentSlug={slug}
              businessName={businessName}
              businessLogoUrl={businessLogoUrl}
              siblings={siblings}
              expanded={expanded}
            />
          ) : (
            <>
              <BusinessMark
                slug={slug}
                name={businessName}
                logoUrl={businessLogoUrl}
              />
              <div
                className={cn(
                  "min-w-0 flex-1 overflow-hidden transition-opacity duration-200",
                  expanded
                    ? "opacity-100 delay-100"
                    : "pointer-events-none opacity-0",
                )}
                aria-hidden={!expanded}
              >
                <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
                  {businessName}
                </p>
                <p className="truncate text-[0.65rem] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Panel admin
                </p>
              </div>
            </>
          )}
        </header>

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <nav
          aria-label="Navegación principal"
          className={cn(
            "flex flex-1 flex-col overflow-y-auto overflow-x-hidden pt-1 pb-3",
            expanded ? "px-3" : "items-center px-0",
          )}
        >
          {groups.map((group, gi) => (
            <div
              key={group.label}
              className={cn(
                "flex flex-col gap-0.5",
                !expanded && "items-center",
              )}
            >
              {gi > 0 && (
                <div
                  className={cn(
                    "my-1 h-px bg-zinc-200/70",
                    expanded ? "" : "w-6",
                  )}
                />
              )}
              {expanded && (
                <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <NavIcon
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={item.match(pathname)}
                  expanded={expanded}
                  badge={
                    item.label === "Operación Diaria" && pendingCount > 0
                      ? pendingCount
                      : item.label === "Productos e inventario" &&
                          lowStockCount > 0
                        ? lowStockCount
                        : // Spec 169 · D4 — lo que le falta leer del turno. Es
                          // la única forma que tiene el rail colapsado de decir
                          // que el recorrido quedó a medias, y se apaga solo
                          // cuando lo termina.
                          item.section === "ayuda" && ayudaPendientes > 0
                          ? ayudaPendientes
                          : undefined
                  }
                />
              ))}
            </div>
          ))}

          {isPlatformAdmin && (
            <>
              <div
                className={cn(
                  "my-1 h-px bg-zinc-200/70",
                  expanded ? "" : "w-6",
                )}
              />
              <NavIcon
                href="/"
                label="Plataforma"
                icon={<ArrowLeft className="size-[18px]" strokeWidth={1.75} />}
                active={false}
                expanded={expanded}
              />
            </>
          )}
        </nav>

        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />

        {/* ── Footer: user ─────────────────────────────────────────────────── */}
        <div className="flex items-center px-3 py-2">
          <UserMenu
            slug={slug}
            userEmail={userEmail}
            userName={userName}
            isPlatformAdmin={isPlatformAdmin}
            expanded={expanded}
          />
        </div>
      </div>
      </aside>

      {/* Navegación mobile (<md): top-bar + bottom-bar + drawer. Comparte el
          modelo de nav (groups) y los badges realtime con el rail desktop. */}
      <AdminMobileNav
        groups={groups}
        slug={slug}
        pathname={pathname}
        pendingCount={pendingCount}
        lowStockCount={lowStockCount}
        ayudaPendientes={ayudaPendientes}
        businessName={businessName}
        businessLogoUrl={businessLogoUrl}
        userEmail={userEmail}
        userName={userName}
        isPlatformAdmin={isPlatformAdmin}
        siblings={siblings}
      />
    </>
  );
}

// ─── Business mark (logo) ────────────────────────────────────────────────────

function BusinessMark({
  slug,
  name,
  logoUrl,
}: {
  slug: string;
  name: string;
  logoUrl: string | null;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <IntentLink
      href={`/${slug}/admin`}
      aria-label={name}
      title={name}
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl",
        "ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition",
        "hover:ring-black/20",
      )}
      style={{
        background: "var(--brand)",
        color: "var(--brand-foreground)",
      }}
    >
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={name}
          fill
          sizes="44px"
          className="object-cover"
        />
      ) : (
        <span className="text-xs font-bold tracking-tight">{initials}</span>
      )}
    </IntentLink>
  );
}

// ─── Business switcher (dueño multi-local) ──────────────────────────────────

function BusinessSwitcher({
  currentSlug,
  businessName,
  businessLogoUrl,
  siblings,
  expanded,
}: {
  currentSlug: string;
  businessName: string;
  businessLogoUrl: string | null;
  siblings: { slug: string; name: string; logoUrl: string | null }[];
  expanded: boolean;
}) {
  // base-ui's Menu usa useId → hydration mismatch en SSR. Igual que UserMenu,
  // pintamos un placeholder no-interactivo hasta montar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mark = (
    <span
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl",
        "ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
      )}
      style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
    >
      {businessLogoUrl ? (
        <Image
          src={businessLogoUrl}
          alt={businessName}
          fill
          sizes="44px"
          className="object-cover"
        />
      ) : (
        <Building2 className="size-5" strokeWidth={1.75} />
      )}
    </span>
  );

  const labels = (
    <div
      className={cn(
        "min-w-0 flex-1 overflow-hidden text-left transition-opacity duration-200",
        expanded ? "opacity-100 delay-100" : "pointer-events-none opacity-0",
      )}
      aria-hidden={!expanded}
    >
      <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
        {businessName}
      </p>
      <p className="truncate text-[0.65rem] font-medium uppercase tracking-[0.14em] text-zinc-500">
        Cambiar local
      </p>
    </div>
  );

  if (!mounted) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2" aria-hidden>
        {mark}
        {labels}
      </div>
    );
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Cambiar de local"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-xl outline-none transition",
          expanded && "hover:bg-zinc-200/40",
          "focus-visible:ring-2 focus-visible:ring-zinc-900/20",
        )}
      >
        {mark}
        {labels}
        {expanded && (
          <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" />
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="start" side="bottom" className="z-50">
          <Menu.Popup
            className={cn(
              "min-w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1",
              "shadow-lg shadow-zinc-900/5",
              "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity",
            )}
          >
            <p className="px-3 py-2 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Tus locales
            </p>
            {siblings.map((b) => (
              <Menu.Item
                key={b.slug}
                render={<Link href={`/${b.slug}/admin`} />}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none transition",
                  "data-[highlighted]:bg-zinc-100",
                  b.slug === currentSlug && "font-semibold",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-600">
                  {b.logoUrl ? (
                    <Image
                      src={b.logoUrl}
                      alt={b.name}
                      width={24}
                      height={24}
                      className="size-full object-cover"
                    />
                  ) : (
                    <Building2 className="size-3.5" strokeWidth={1.75} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-800">
                  {b.name}
                </span>
                {b.slug === currentSlug && (
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: "var(--brand)" }}
                  />
                )}
              </Menu.Item>
            ))}
            <div className="my-1 h-px bg-zinc-100" />
            <Menu.Item
              render={<Link href="/mis-locales" />}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none transition",
                "data-[highlighted]:bg-zinc-100",
              )}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-zinc-50">
                <BarChart3 className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="font-medium text-zinc-900">Mis locales</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// ─── Nav icon (with optional badge) ─────────────────────────────────────────

function NavIcon({
  href,
  label,
  icon,
  active,
  expanded,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  expanded: boolean;
  badge?: number;
}) {
  if (expanded) {
    return (
      <IntentLink
        href={href}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition",
          "outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20",
          active
            ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/70"
            : "text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900",
        )}
      >
        <span
          className={cn(
            "shrink-0 transition",
            active ? "" : "text-zinc-500 group-hover:text-zinc-900",
          )}
          style={active ? { color: "var(--brand)" } : undefined}
        >
          {icon}
        </span>
        <span className="flex-1 truncate font-medium">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 py-px text-[0.55rem] font-bold leading-none text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {active && badge === undefined ? (
          <span
            aria-hidden
            className="absolute right-2.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full"
            style={{ background: "var(--brand)" }}
          />
        ) : null}
      </IntentLink>
    );
  }

  return (
    <div className="group relative">
      <IntentLink
        href={href}
        aria-label={label}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-xl transition",
          "outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20",
          active
            ? "bg-white shadow-sm ring-1 ring-zinc-200/70"
            : "text-zinc-500 hover:bg-zinc-200/40 hover:text-zinc-900",
        )}
        style={active ? { color: "var(--brand)" } : undefined}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex min-w-[0.875rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[0.5rem] font-bold leading-none text-white ring-1 ring-zinc-50"
            style={{ minHeight: "0.875rem" }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </IntentLink>
      <Tooltip label={badge ? `${label} (${badge})` : label} />
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2",
        "whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5",
        "text-xs font-medium text-zinc-50 shadow-lg shadow-zinc-900/10",
        "opacity-0 transition-opacity duration-200 group-hover:opacity-100",
      )}
    >
      {label}
    </span>
  );
}

// ─── User menu ───────────────────────────────────────────────────────────────

function UserMenu({
  slug,
  userEmail,
  userName,
  isPlatformAdmin,
  expanded,
}: {
  slug: string;
  userEmail: string;
  userName?: string | null;
  isPlatformAdmin: boolean;
  expanded: boolean;
}) {
  const displayName = userName?.trim() || userEmail.split("@")[0];
  const initials =
    (userName ?? userEmail)
      .split(/\s+|[@.]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = isPlatformAdmin
      ? "/login"
      : `/${slug}/admin/login`;
  };

  // base-ui's Menu.Trigger genera un id via useId que se desincroniza entre
  // server y client, causando hydration mismatch. Evitamos el SSR del menú
  // pintando un placeholder visualmente idéntico hasta que se monte.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-xl p-1.5",
          expanded ? "w-full" : "",
        )}
        aria-hidden
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            "bg-zinc-900 text-zinc-50 text-[0.7rem] font-semibold",
            "ring-1 ring-zinc-900/10",
          )}
        >
          {initials}
        </span>
        {expanded && (
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-zinc-900">
              {displayName}
            </p>
            <p className="truncate text-[0.65rem] text-zinc-500">{userEmail}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Cuenta"
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-xl p-1.5 outline-none transition",
          "hover:bg-zinc-200/50",
          "focus-visible:ring-2 focus-visible:ring-zinc-900/20",
          expanded ? "w-full" : "",
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            "bg-zinc-900 text-zinc-50 text-[0.7rem] font-semibold",
            "ring-1 ring-zinc-900/10",
          )}
        >
          {initials}
        </span>
        {expanded && (
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-zinc-900">
              {displayName}
            </p>
            <p className="truncate text-[0.65rem] text-zinc-500">
              {userEmail}
            </p>
          </div>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={10}
          align="end"
          side="top"
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "min-w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1",
              "shadow-lg shadow-zinc-900/5",
              "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
              "transition-opacity",
            )}
          >
            <div className="border-b border-zinc-100 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-zinc-900">
                {displayName}
              </p>
              <p className="truncate text-xs text-zinc-500">{userEmail}</p>
            </div>
            <Menu.Item
              onClick={handleSignOut}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
                "outline-none transition",
                "data-[highlighted]:bg-zinc-100",
              )}
            >
              <LogOut className="size-4" />
              Cerrar sesión
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
