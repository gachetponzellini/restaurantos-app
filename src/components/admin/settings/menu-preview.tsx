"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  ChevronRight,
  Clock,
  ImageIcon,
  MapPin,
  Minus,
  Plus,
  ShoppingBag,
  Truck,
} from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import {
  FONT_OPTIONS,
  ICON_STROKE_VALUE,
  ICON_STYLE_VALUE,
  RADIUS_PX,
  SHADOW_VALUE,
  type FontKey,
  type IconStroke,
  type IconStyle,
  type Mode,
  type RadiusScale,
  type ShadowScale,
} from "@/lib/branding/tokens";
import { cn } from "@/lib/utils";

export type PreviewProduct = {
  id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
};

type ViewKey = "menu" | "product" | "cart" | "confirmed";

function fontVarOf(key: FontKey): string {
  return (FONT_OPTIONS.find((o) => o.key === key) ?? FONT_OPTIONS[0]!).cssVar;
}

type Theme = {
  primary: string;
  primaryFg: string;
  accent: string;
  ink: string;
  ink2: string;
  ink3: string;
  hairline: string;
  surface: string;
  cardBg: string;
  fontBodyVar: string;
  fontHeadingVar: string;
  radius: string;
  shadow: string;
  iconStroke: string;
  iconLinecap: "round" | "butt";
  iconLinejoin: "round" | "miter";
};

export function MenuPreview({
  businessName,
  logoUrl,
  coverImageUrl,
  primary,
  primaryForeground,
  background,
  fontHeading,
  fontBody,
  radiusScale,
  shadowScale,
  iconStroke,
  iconStyle,
  mode,
  products,
  tagline,
  address,
  deliveryFeeCents,
  minOrderCents,
  estimatedMinutes,
}: {
  businessName: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primary: string;
  primaryForeground: string;
  background: string;
  fontHeading: FontKey;
  fontBody: FontKey;
  radiusScale: RadiusScale;
  shadowScale: ShadowScale;
  iconStroke: IconStroke;
  iconStyle: IconStyle;
  mode: Mode;
  products: PreviewProduct[];
  tagline?: string | null;
  address?: string | null;
  deliveryFeeCents?: number;
  minOrderCents?: number;
  estimatedMinutes?: number | null;
}) {
  const [view, setView] = useState<ViewKey>("menu");
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const safe = (v: string, fb: string) => (hex.test(v) ? v : fb);

  const isDark = mode === "dark";
  // accent is ALWAYS the primary color — the delivery theme treats them as
  // the same brand hue, and exposing both in the form confuses users.
  const safePrimary = safe(primary, "#E11D48");
  const theme: Theme = {
    primary: safePrimary,
    primaryFg: safe(primaryForeground, "#FFFFFF"),
    accent: safePrimary,
    ink: isDark ? "#F4F4F5" : "#18181B",
    ink2: isDark ? "#A1A1AA" : "#52525B",
    ink3: isDark ? "#71717A" : "#A1A1AA",
    hairline: isDark ? "#27272A" : "#E4E4E7",
    surface: isDark ? "#0B0B0D" : safe(background, "#FFFFFF"),
    cardBg: isDark ? "#18181B" : "#FFFFFF",
    fontBodyVar: fontVarOf(fontBody),
    fontHeadingVar: fontVarOf(fontHeading),
    radius: RADIUS_PX[radiusScale],
    shadow: SHADOW_VALUE[shadowScale],
    iconStroke: ICON_STROKE_VALUE[iconStroke],
    iconLinecap: ICON_STYLE_VALUE[iconStyle].linecap,
    iconLinejoin: ICON_STYLE_VALUE[iconStyle].linejoin,
  };

  const frameStyle: React.CSSProperties = {
    fontFamily: `${theme.fontBodyVar}, -apple-system, system-ui, sans-serif`,
    background: theme.surface,
    color: theme.ink,
    ["--icon-stroke" as string]: theme.iconStroke,
    ["--icon-linecap" as string]: theme.iconLinecap,
    ["--icon-linejoin" as string]: theme.iconLinejoin,
    strokeLinecap: theme.iconLinecap,
    strokeLinejoin: theme.iconLinejoin,
  };

  const views: { key: ViewKey; label: string }[] = [
    { key: "menu", label: "Menú" },
    { key: "product", label: "Producto" },
    { key: "cart", label: "Carrito" },
    { key: "confirmed", label: "Confirmación" },
  ];

  const sampleProduct = products[0] ?? {
    id: "p-sample",
    name: "Milanesa napolitana",
    price_cents: 890000,
    image_url: null,
  };

  return (
    <div className="space-y-3">
      {/* View selector */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[0.7rem] font-semibold transition",
              view === v.key
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-900",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Phone frame */}
      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[2rem] border-4 border-zinc-900 bg-zinc-50 shadow-[0_20px_60px_rgba(19,27,46,0.18)]">
        {/* Status notch */}
        <div className="flex h-6 items-center justify-center bg-zinc-900">
          <div className="h-1.5 w-16 rounded-full bg-zinc-700" />
        </div>

        <div
          className="relative max-h-[640px] overflow-y-auto"
          data-brand-scope
          style={frameStyle}
        >
          {view === "menu" && (
            <MenuView
              theme={theme}
              businessName={businessName}
              logoUrl={logoUrl}
              coverImageUrl={coverImageUrl}
              products={products}
              tagline={tagline ?? address ?? null}
              deliveryFeeCents={deliveryFeeCents ?? 0}
              minOrderCents={minOrderCents ?? 0}
              estimatedMinutes={estimatedMinutes ?? null}
            />
          )}
          {view === "product" && (
            <ProductView theme={theme} product={sampleProduct} />
          )}
          {view === "cart" && (
            <CartView theme={theme} products={products} />
          )}
          {view === "confirmed" && <ConfirmedView theme={theme} />}
        </div>
      </div>

      <p className="text-muted-foreground text-center text-[0.7rem]">
        Los cambios se aplican sin guardar. Guardá para que los vean los
        clientes.
      </p>
    </div>
  );
}

// ─── View: Menú (home) — replica del MenuClient público ──────────────
function MenuView({
  theme,
  businessName,
  logoUrl,
  coverImageUrl,
  products,
  tagline,
  deliveryFeeCents,
  minOrderCents,
  estimatedMinutes,
}: {
  theme: Theme;
  businessName: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  products: PreviewProduct[];
  tagline: string | null;
  deliveryFeeCents: number;
  minOrderCents: number;
  estimatedMinutes: number | null;
}) {
  const headingStyle: React.CSSProperties = {
    fontFamily: `${theme.fontHeadingVar}, Georgia, serif`,
  };
  const eta = estimatedMinutes ? `${estimatedMinutes} min` : "30–45 min";
  const hasDelivery =
    deliveryFeeCents > 0 || minOrderCents > 0 || estimatedMinutes != null;

  return (
    <>
      {/* Cover with "Ingresar" button top-right (logged-out state, like real) */}
      <div
        className="relative h-40 w-full"
        style={{
          background: `linear-gradient(135deg, ${theme.accent}26, ${theme.primary}26)`,
        }}
      >
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={businessName}
            fill
            sizes="320px"
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center opacity-40">
            <ImageIcon
              className="size-8"
              style={{ strokeWidth: theme.iconStroke, color: theme.ink2 }}
            />
          </div>
        )}
        <div
          className="absolute right-3 top-3 flex h-9 items-center rounded-full px-4 text-[0.7rem] font-semibold"
          style={{ background: theme.ink, color: theme.surface }}
        >
          Ingresar
        </div>
      </div>

      {/* Identity + tagline + delivery info */}
      <div
        className="px-4 pt-3 pb-3"
        style={{ borderBottom: `1px solid ${theme.hairline}` }}
      >
        <div className="flex items-center gap-2.5">
          {logoUrl && (
            <div
              className="relative size-10 shrink-0 overflow-hidden rounded-full border"
              style={{ borderColor: theme.hairline, background: theme.cardBg }}
            >
              <Image
                src={logoUrl}
                alt={businessName}
                fill
                sizes="40px"
                className="object-cover"
              />
            </div>
          )}
          <h3
            className="truncate leading-none"
            style={{ ...headingStyle, color: theme.ink, fontSize: 26 }}
          >
            {businessName || "Nombre del negocio"}
          </h3>
        </div>

        {/* Tagline + status */}
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.7rem]"
          style={{ color: theme.ink2 }}
        >
          {tagline ? (
            <>
              <span>{tagline}</span>
              <span style={{ color: theme.ink3 }}>·</span>
            </>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: "#22c55e" }}
            />
            Abierto
          </span>
        </div>

        {/* Delivery row */}
        {hasDelivery ? (
          <div
            className="mt-2.5 flex flex-wrap items-center gap-3 text-[0.65rem]"
            style={{ color: theme.ink2 }}
          >
            <span className="inline-flex items-center gap-1">
              <Clock
                className="size-3"
                style={{ color: theme.ink3, strokeWidth: theme.iconStroke }}
              />
              {eta}
            </span>
            <span className="inline-flex items-center gap-1">
              <Bike
                className="size-3.5"
                style={{ color: theme.ink3, strokeWidth: theme.iconStroke }}
              />
              {deliveryFeeCents > 0
                ? `Envío ${formatCurrency(deliveryFeeCents)}`
                : "Envío gratis"}
            </span>
            {minOrderCents > 0 ? (
              <span>Mín. {formatCurrency(minOrderCents)}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Sticky category tabs */}
      <div
        className="sticky top-0 z-[2]"
        style={{
          background: theme.surface,
          borderBottom: `1px solid ${theme.hairline}`,
        }}
      >
        <div className="no-scrollbar flex gap-5 overflow-x-auto px-4 pt-1 text-xs">
          {["Destacados", "Entradas", "Principales", "Bebidas", "Postres"].map(
            (c, i) => {
              const isActive = i === 0;
              return (
                <span
                  key={c}
                  className="shrink-0 py-2.5"
                  style={{
                    color: isActive ? theme.ink : theme.ink3,
                    fontWeight: isActive ? 600 : 500,
                    borderBottom: isActive
                      ? `2px solid ${theme.ink}`
                      : "2px solid transparent",
                    marginBottom: -1,
                  }}
                >
                  {c}
                </span>
              );
            },
          )}
        </div>
      </div>

      {/* Products */}
      <div>
        {products.length === 0 ? (
          <PlaceholderRow hairline={theme.hairline} />
        ) : (
          products.map((p) => <ProductRow key={p.id} product={p} theme={theme} />)
        )}
      </div>

      {/* Cart pill */}
      <div className="sticky bottom-2 mx-3 mt-4 mb-3">
        <div
          className="flex items-center justify-between px-3 py-2.5"
          style={{
            background: theme.accent,
            color: "#FFFFFF",
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
          }}
        >
          <span className="flex items-center gap-2">
            <span
              className="flex size-7 items-center justify-center text-[0.75rem] font-bold"
              style={{
                background: "rgba(255,255,255,0.2)",
                borderRadius: `calc(${theme.radius} * 0.6)`,
              }}
            >
              2
            </span>
            <span className="text-[0.8rem] font-semibold">Ver mi pedido</span>
          </span>
          <span className="text-[0.8rem] font-bold tabular-nums">
            {formatCurrency(25000)}
          </span>
        </div>
      </div>
    </>
  );
}

function ProductRow({
  product,
  theme,
}: {
  product: PreviewProduct;
  theme: Theme;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 px-4 py-3"
      style={{ borderBottom: `1px solid ${theme.hairline}` }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" style={{ color: theme.ink }}>
          {product.name}
        </p>
        <p
          className="mt-0.5 text-xs font-bold tabular-nums"
          style={{ color: theme.accent }}
        >
          {formatCurrency(product.price_cents)}
        </p>
      </div>
      {product.image_url ? (
        <div
          className="relative size-14 shrink-0 overflow-hidden"
          style={{
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            background: theme.cardBg,
          }}
        >
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="56px"
            className="object-cover"
          />
        </div>
      ) : (
        <div
          className="flex size-14 shrink-0 items-center justify-center"
          style={{
            background: theme.cardBg,
            color: theme.ink2,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
          }}
        >
          <ShoppingBag className="size-5" style={{ strokeWidth: theme.iconStroke }} />
        </div>
      )}
    </div>
  );
}

function PlaceholderRow({ hairline }: { hairline: string }) {
  return (
    <div className="space-y-3 px-4 py-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded" style={{ background: hairline }} />
            <div className="h-2.5 w-1/4 rounded" style={{ background: hairline }} />
          </div>
          <div className="size-14 shrink-0 rounded-lg" style={{ background: hairline }} />
        </div>
      ))}
    </div>
  );
}

// ─── View: Producto (detail) ──────────────────────────────────────────
function ProductView({
  theme,
  product,
}: {
  theme: Theme;
  product: PreviewProduct;
}) {
  const headingStyle: React.CSSProperties = {
    fontFamily: `${theme.fontHeadingVar}, Georgia, serif`,
  };
  return (
    <>
      {/* Image + back */}
      <div
        className="relative h-48 w-full"
        style={{
          background: `linear-gradient(135deg, ${theme.accent}22, ${theme.primary}22)`,
        }}
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="320px"
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center opacity-40">
            <ImageIcon
              className="size-12"
              style={{ strokeWidth: theme.iconStroke, color: theme.ink2 }}
            />
          </div>
        )}
        <button
          type="button"
          aria-label="Volver"
          className="absolute left-3 top-3 flex size-9 items-center justify-center rounded-full"
          style={{
            background: theme.cardBg,
            color: theme.ink,
            boxShadow: theme.shadow,
          }}
        >
          <ArrowLeft className="size-4" style={{ strokeWidth: theme.iconStroke }} />
        </button>
      </div>

      {/* Product info */}
      <div className="px-4 py-4">
        <h2
          className="text-xl font-bold tracking-tight"
          style={{ ...headingStyle, color: theme.ink }}
        >
          {product.name}
        </h2>
        <p className="mt-1 text-sm" style={{ color: theme.ink2 }}>
          Receta casera con ingredientes frescos. Incluye papas fritas y
          guarnición del día.
        </p>
        <p
          className="mt-3 text-2xl font-bold tabular-nums"
          style={{ color: theme.accent, ...headingStyle }}
        >
          {formatCurrency(product.price_cents)}
        </p>
      </div>

      {/* Variants */}
      <div className="px-4 pb-4">
        <p
          className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider"
          style={{ color: theme.ink3 }}
        >
          Tamaño
        </p>
        <div className="grid grid-cols-3 gap-2">
          {["Chica", "Mediana", "Grande"].map((s, i) => (
            <div
              key={s}
              className="flex flex-col items-center py-2 text-center"
              style={{
                borderRadius: theme.radius,
                border: `1px solid ${i === 1 ? theme.primary : theme.hairline}`,
                background: i === 1 ? `${theme.primary}0F` : "transparent",
                color: i === 1 ? theme.primary : theme.ink,
              }}
            >
              <span className="text-xs font-semibold">{s}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="px-4 pb-6">
        <p
          className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider"
          style={{ color: theme.ink3 }}
        >
          Notas
        </p>
        <div
          className="px-3 py-2 text-xs"
          style={{
            borderRadius: theme.radius,
            border: `1px solid ${theme.hairline}`,
            color: theme.ink3,
          }}
        >
          Sin cebolla, por favor…
        </div>
      </div>

      {/* Sticky add to cart */}
      <div className="sticky bottom-2 mx-3 mb-3 flex items-center gap-2">
        <div
          className="flex items-center gap-0"
          style={{
            background: theme.cardBg,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            border: `1px solid ${theme.hairline}`,
          }}
        >
          <button
            type="button"
            aria-label="Quitar"
            className="flex size-10 items-center justify-center"
            style={{ color: theme.ink2 }}
          >
            <Minus className="size-4" style={{ strokeWidth: theme.iconStroke }} />
          </button>
          <span
            className="min-w-[24px] text-center text-sm font-bold tabular-nums"
            style={{ color: theme.ink }}
          >
            1
          </span>
          <button
            type="button"
            aria-label="Sumar"
            className="flex size-10 items-center justify-center"
            style={{ color: theme.ink2 }}
          >
            <Plus className="size-4" style={{ strokeWidth: theme.iconStroke }} />
          </button>
        </div>
        <button
          type="button"
          className="flex-1 py-3 text-xs font-bold"
          style={{
            background: theme.primary,
            color: theme.primaryFg,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
          }}
        >
          Agregar {formatCurrency(product.price_cents)}
        </button>
      </div>
    </>
  );
}

// ─── View: Carrito ────────────────────────────────────────────────────
function CartView({
  theme,
  products,
}: {
  theme: Theme;
  products: PreviewProduct[];
}) {
  const headingStyle: React.CSSProperties = {
    fontFamily: `${theme.fontHeadingVar}, Georgia, serif`,
  };
  const items = (products.length ? products : [
    {
      id: "s1",
      name: "Milanesa napolitana",
      price_cents: 890000,
      image_url: null,
    },
    {
      id: "s2",
      name: "Papas con cheddar",
      price_cents: 450000,
      image_url: null,
    },
  ]).slice(0, 2);
  const subtotal = items.reduce((a, b) => a + b.price_cents, 0) * 1;
  const delivery = 120000;
  const total = subtotal + delivery;

  return (
    <>
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3"
        style={{
          background: theme.surface,
          borderBottom: `1px solid ${theme.hairline}`,
        }}
      >
        <button
          type="button"
          aria-label="Volver"
          className="flex size-8 items-center justify-center"
          style={{ color: theme.ink }}
        >
          <ArrowLeft className="size-4" style={{ strokeWidth: theme.iconStroke }} />
        </button>
        <h2
          className="text-base font-bold tracking-tight"
          style={{ ...headingStyle, color: theme.ink }}
        >
          Tu pedido
        </h2>
      </div>

      {/* Items */}
      <div className="px-4 pt-3">
        {items.map((p) => (
          <div
            key={p.id}
            className="flex items-start gap-3 py-3"
            style={{ borderBottom: `1px solid ${theme.hairline}` }}
          >
            <div
              className="flex size-12 shrink-0 items-center justify-center text-[0.7rem] font-bold tabular-nums"
              style={{
                background: `${theme.primary}14`,
                color: theme.primary,
                borderRadius: theme.radius,
              }}
            >
              ×1
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" style={{ color: theme.ink }}>
                {p.name}
              </p>
              <p className="mt-0.5 text-[0.7rem]" style={{ color: theme.ink3 }}>
                Sin cebolla
              </p>
            </div>
            <p
              className="text-xs font-bold tabular-nums"
              style={{ color: theme.ink }}
            >
              {formatCurrency(p.price_cents)}
            </p>
          </div>
        ))}
      </div>

      {/* Delivery option */}
      <div className="px-4 pt-3">
        <p
          className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider"
          style={{ color: theme.ink3 }}
        >
          Entrega
        </p>
        <div
          className="flex items-center gap-3 px-3 py-3"
          style={{
            borderRadius: theme.radius,
            border: `1.5px solid ${theme.primary}`,
            background: `${theme.primary}0A`,
          }}
        >
          <Truck
            className="size-5"
            style={{ color: theme.primary, strokeWidth: theme.iconStroke }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold" style={{ color: theme.ink }}>
              Delivery
            </p>
            <p className="text-[0.7rem]" style={{ color: theme.ink3 }}>
              Av. Corrientes 1234
            </p>
          </div>
          <ChevronRight
            className="size-4"
            style={{ color: theme.ink3, strokeWidth: theme.iconStroke }}
          />
        </div>
      </div>

      {/* Totals */}
      <div className="px-4 py-4">
        <Row label="Subtotal" value={subtotal} theme={theme} muted />
        <Row label="Envío" value={delivery} theme={theme} muted />
        <div
          className="mt-2 flex items-center justify-between pt-2"
          style={{ borderTop: `1px solid ${theme.hairline}` }}
        >
          <span className="text-sm font-bold" style={{ color: theme.ink }}>
            Total
          </span>
          <span
            className="text-lg font-bold tabular-nums"
            style={{ color: theme.accent, ...headingStyle }}
          >
            {formatCurrency(total)}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="sticky bottom-2 mx-3 mb-3">
        <button
          type="button"
          className="w-full py-3 text-sm font-bold"
          style={{
            background: theme.primary,
            color: theme.primaryFg,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
          }}
        >
          Confirmar pedido
        </button>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  theme,
  muted,
}: {
  label: string;
  value: number;
  theme: Theme;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span style={{ color: muted ? theme.ink3 : theme.ink }}>{label}</span>
      <span
        className="tabular-nums"
        style={{ color: muted ? theme.ink2 : theme.ink }}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

// ─── View: Confirmación ───────────────────────────────────────────────
function ConfirmedView({ theme }: { theme: Theme }) {
  const headingStyle: React.CSSProperties = {
    fontFamily: `${theme.fontHeadingVar}, Georgia, serif`,
  };
  return (
    <div className="flex min-h-[620px] flex-col">
      {/* Hero with success */}
      <div
        className="flex flex-col items-center gap-3 px-6 pt-10 pb-8"
        style={{
          background: `linear-gradient(180deg, ${theme.primary}14, transparent)`,
        }}
      >
        <div
          className="flex size-16 items-center justify-center"
          style={{
            background: theme.primary,
            color: theme.primaryFg,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
          }}
        >
          <CheckCircle2
            className="size-8"
            style={{ strokeWidth: theme.iconStroke }}
          />
        </div>
        <h2
          className="text-center text-2xl font-bold tracking-tight"
          style={{ ...headingStyle, color: theme.ink }}
        >
          ¡Pedido confirmado!
        </h2>
        <p className="text-center text-xs" style={{ color: theme.ink2 }}>
          Tu pedido #8312 llegará en 30–45 min
        </p>
      </div>

      {/* Status timeline */}
      <div className="px-4 py-4">
        <div className="space-y-0">
          {[
            { label: "Recibido", active: true, done: true },
            { label: "En preparación", active: true, done: false },
            { label: "Entregado", active: false, done: false },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <div
                  className="flex size-6 shrink-0 items-center justify-center text-[0.65rem] font-bold"
                  style={{
                    background: step.active ? theme.primary : theme.hairline,
                    color: step.active ? theme.primaryFg : theme.ink3,
                    borderRadius: "9999px",
                  }}
                >
                  {step.done ? "✓" : i + 1}
                </div>
                {i < arr.length - 1 ? (
                  <div
                    className="w-px flex-1"
                    style={{
                      background: step.active ? theme.primary : theme.hairline,
                      minHeight: 24,
                    }}
                  />
                ) : null}
              </div>
              <div className="pb-4">
                <p
                  className="text-xs font-semibold"
                  style={{
                    color: step.active ? theme.ink : theme.ink3,
                  }}
                >
                  {step.label}
                </p>
                {step.active && !step.done ? (
                  <p className="text-[0.65rem]" style={{ color: theme.ink3 }}>
                    Estimado 15 min
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Address card */}
      <div className="px-4 pb-4">
        <div
          className="flex items-center gap-3 px-3 py-3"
          style={{
            borderRadius: theme.radius,
            background: theme.cardBg,
            boxShadow: theme.shadow,
            border: `1px solid ${theme.hairline}`,
          }}
        >
          <MapPin
            className="size-5"
            style={{ color: theme.accent, strokeWidth: theme.iconStroke }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold" style={{ color: theme.ink }}>
              Av. Corrientes 1234
            </p>
            <p className="text-[0.7rem]" style={{ color: theme.ink3 }}>
              Piso 4, Depto B · CABA
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {/* CTA */}
      <div className="mx-3 mb-3">
        <button
          type="button"
          className="w-full py-3 text-sm font-bold"
          style={{
            background: "transparent",
            color: theme.ink,
            borderRadius: theme.radius,
            border: `1.5px solid ${theme.hairline}`,
          }}
        >
          Volver al menú
        </button>
      </div>
    </div>
  );
}
