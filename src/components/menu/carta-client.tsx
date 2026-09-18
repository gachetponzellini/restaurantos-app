"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import * as m from "motion/react-m";

import { EASE_OUT } from "@/components/motion/presets";
import { computeIsOpen, type BusinessHour } from "@/lib/business-hours";
import type { CartaTheme } from "@/lib/carta-theme";
import { formatCurrency } from "@/lib/currency";
import {
  disponibilidadTexto,
  pasosDelMenu,
} from "@/lib/daily-menus/carta-resumen";
import type { MenuCategory, MenuDailyMenu, MenuProduct } from "@/lib/menu";

// Carta SOLO VISUAL (read-only) para el QR de la mesa. El comensal mira y le
// pide al mozo: sin carrito, sin "+", sin checkout. Estructura de spec 44:
// cover a pantalla + título de sección + líder de puntos plato···precio, en
// scroll único y sin fotos. Reusa el mismo catálogo (getMenu) que /menu.
//
// El arte y los colores son del negocio (spec 129): salen de `settings.carta`
// vía `resolveCartaTheme`, con la identidad de golf-house como default. Acá no
// hay ningún cliente hardcodeado.

type DisplayTab = {
  id: string;
  name: string;
  products: MenuProduct[];
  subcategories?: { name: string; products: MenuProduct[] }[];
};

function buildDisplayTabs(
  categories: MenuCategory[],
  beverageSuperCategoryId: string | null,
): DisplayTab[] {
  const flat = (cs: MenuCategory[]) =>
    cs.map((c) => ({ id: c.id, name: c.name, products: c.products }));

  if (!beverageSuperCategoryId) return flat(categories);

  const bevCats = categories.filter(
    (c) => c.super_category_id === beverageSuperCategoryId,
  );
  const nonBevCats = categories.filter(
    (c) => c.super_category_id !== beverageSuperCategoryId,
  );
  if (bevCats.length === 0) return flat(categories);

  const tabs: DisplayTab[] = flat(nonBevCats);
  tabs.push({
    id: "bebidas-grouped",
    name: "Bebidas",
    products: bevCats.flatMap((c) => c.products),
    subcategories: bevCats.map((c) => ({ name: c.name, products: c.products })),
  });
  return tabs;
}

// Cenefa del cliente. Sin ornamento no se dibuja nada — ni el hueco: la carta
// de KCC no tiene flourish y un espacio vacío bajo el título se lee como un
// error de maquetación, no como aire.
// Cada sección de la carta aparece al entrar en pantalla, como quien da vuelta
// la hoja: sube apenas y se funde. Una sola vez — volver a subir no re-anima.
function Reveal({
  as = "div",
  children,
}: {
  as?: "div" | "section";
  children: React.ReactNode;
}) {
  const Tag = as === "section" ? m.section : m.div;
  return (
    <Tag
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.7, ease: EASE_OUT }}
    >
      {children}
    </Tag>
  );
}

function Ornament({
  src,
  width = 104,
}: {
  src: string | null;
  width?: number;
}) {
  if (!src) return null;
  return (
    <Image
      src={src}
      alt=""
      aria-hidden
      unoptimized
      width={width}
      height={Math.round((width * 22) / 107)}
      style={{ opacity: 0.95 }}
    />
  );
}

// Fila de plato con líder de puntos dorado: nombre ······ precio, descripción
// debajo. Sin foto (la carta impresa no las lleva).
function ProductRow({ product }: { product: MenuProduct }) {
  const soldOut = !product.is_available;
  return (
    <li
      style={{
        listStyle: "none",
        padding: "11px 0",
        opacity: soldOut ? 0.5 : 1,
      }}
    >
      {/* Nombre ······ Precio */}
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <span
          style={{
            fontWeight:
              "var(--carta-item-weight)" as React.CSSProperties["fontWeight"],
            fontSize: 15.5,
            lineHeight: 1.25,
            color: "var(--carta-ink)",
            textDecoration: soldOut ? "line-through" : "none",
          }}
        >
          {product.name}
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            margin: "0 8px 5px",
            borderBottom: "1px dotted var(--carta-gold)",
            minWidth: 16,
          }}
        />
        <span
          style={{
            fontWeight:
              "var(--carta-item-weight)" as React.CSSProperties["fontWeight"],
            fontSize: 15.5,
            color: "var(--carta-ink)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {formatCurrency(product.price_cents)}
        </span>
      </div>
      {product.description && (
        <div
          style={{
            fontSize: 13,
            color: "var(--carta-ink-2)",
            lineHeight: 1.4,
            marginTop: 3,
            maxWidth: "44ch",
          }}
        >
          {product.description}
        </div>
      )}
      {soldOut && (
        <span
          style={{
            display: "inline-block",
            marginTop: 6,
            fontSize: 10.5,
            padding: "2px 7px",
            borderRadius: 4,
            background:
              "color-mix(in srgb, var(--carta-gold) 16%, transparent)",
            color: "var(--carta-ink-2)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          No disponible
        </span>
      )}
    </li>
  );
}

// Título de sección centrado + ornamento debajo. El script dorado pide cuerpo
// grande para leerse; la serif itálica a 46px se comería la sección entera.
function SectionTitle({
  theme,
  children,
}: {
  theme: CartaTheme;
  children: React.ReactNode;
}) {
  const script = theme.title_style === "script";
  return (
    <div style={{ textAlign: "center", padding: "38px 0 8px" }}>
      <h2
        className={script ? "carta-script" : "carta-serif-italic"}
        style={{ margin: 0, fontSize: script ? 46 : 30 }}
      >
        {children}
      </h2>
      {theme.ornament_url && (
        <div
          style={{ marginTop: 6, display: "flex", justifyContent: "center" }}
        >
          <Ornament src={theme.ornament_url} width={104} />
        </div>
      )}
    </div>
  );
}

// El menú del día como bloque centrado dentro de un marco de línea dorada
// finita — no como una fila de plato: el menú es el único ítem de la carta que
// se lee de arriba a abajo (nombre → cuándo se ofrece → los pasos → precio), y
// el marco lo separa del listado sin el relleno dorado de antes.
//
// Los pasos son SÓLO el nombre del grupo, apilados con un «+». Listar las
// opciones una por una tapaba media carta: el «Menú» de golf-jcr tiene 57
// componentes (spec 112). Qué milanesa hay se pregunta en la mesa.
function DailyMenuCard({
  menu,
}: {
  menu: MenuDailyMenu;
}) {
  const pasos = pasosDelMenu(menu);
  const disponibilidad = disponibilidadTexto(menu.available_days);

  return (
    <li
      style={{
        listStyle: "none",
        textAlign: "center",
        padding: "20px 18px 18px",
        border:
          "1px solid color-mix(in srgb, var(--carta-gold) 55%, transparent)",
        borderRadius: 3,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.8,
          color: "var(--carta-ink)",
        }}
      >
        {menu.name}
      </div>

      {disponibilidad && (
        <div
          style={{
            marginTop: 2,
            fontSize: 12.5,
            fontStyle: "italic",
            color: "var(--carta-ink-2)",
          }}
        >
          {disponibilidad}
        </div>
      )}

      {pasos.length > 0 && (
        <ul style={{ listStyle: "none", margin: "13px 0 0", padding: 0 }}>
          {pasos.map((paso, i) => (
            <li
              key={`${paso}-${i}`}
              style={{
                fontSize: 14.5,
                lineHeight: 1.35,
                color: "var(--carta-ink)",
              }}
            >
              {i > 0 && (
                <span
                  aria-hidden
                  style={{
                    display: "block",
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: "var(--carta-gold)",
                  }}
                >
                  +
                </span>
              )}
              {paso}
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          marginTop: 13,
          fontSize: 15.5,
          fontWeight: 600,
          color: "var(--carta-ink)",
        }}
      >
        {formatCurrency(menu.price_cents)}
      </div>
    </li>
  );
}

function DailyMenu({
  theme,
  menus,
}: {
  theme: CartaTheme;
  menus: MenuDailyMenu[];
}) {
  if (menus.length === 0) return null;

  return (
    <section>
      <SectionTitle theme={theme}>Menú del día</SectionTitle>
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          margin: "10px 0 0",
          padding: 0,
        }}
      >
        {menus.map((m) => (
          <DailyMenuCard key={m.id} menu={m} />
        ))}
      </ul>
    </section>
  );
}

// Cover a pantalla: fondo del negocio + su marca + label + ornamento + cue de
// scroll hacia el menú. Cada pieza es opcional y su ausencia cambia el layout,
// no deja un hueco (ver `resolveCartaTheme`).
function Cover({
  theme,
  businessName,
}: {
  theme: CartaTheme;
  businessName: string;
}) {
  const layers = [
    // El velo hace legible el wordmark sobre una textura; sobre un color plano
    // sólo lo ensuciaría, así que va por tema.
    theme.cover_scrim
      ? "linear-gradient(rgba(20,23,28,0.45), rgba(20,23,28,0.6))"
      : null,
    theme.cover_texture_url ? `url(${theme.cover_texture_url})` : null,
  ].filter(Boolean);

  const wordmark = theme.wordmark_url ? (
    <Image
      src={theme.wordmark_url}
      alt={businessName}
      width={Math.round(300 * theme.wordmark_ratio)}
      height={300}
      priority
      unoptimized
      style={
        theme.figure_url
          ? {
              // Superpuesto sobre la figura (el wordmark del Golf cruza al
              // golfista por el medio).
              position: "absolute",
              left: "50%",
              top: "54%",
              transform: "translate(-50%, -50%)",
              width: "150%",
              maxWidth: "none",
              height: "auto",
            }
          : { width: "100%", height: "auto" }
      }
    />
  ) : (
    // Sin marca cargada: el nombre en la tipografía de títulos del tema.
    <div
      className={
        theme.title_style === "script" ? "carta-script" : "carta-serif-italic"
      }
      style={{ fontSize: 44, color: "#fff" }}
    >
      {businessName}
    </div>
  );

  return (
    <header
      style={{
        position: "relative",
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "56px 24px",
        color: "#fff",
        backgroundColor: "var(--carta-cover)",
        ...(layers.length > 0 ? { backgroundImage: layers.join(", ") } : {}),
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {theme.figure_url ? (
        <div
          className="m-rise"
          style={{
            ["--m-delay" as string]: "80ms",
            position: "relative",
            width: 210,
            maxWidth: "72%",
            aspectRatio: "177 / 254",
          }}
        >
          <Image
            src={theme.figure_url}
            alt=""
            aria-hidden
            fill
            priority
            unoptimized
            sizes="210px"
            style={{ objectFit: "contain" }}
          />
          {wordmark}
        </div>
      ) : (
        <div
          className="m-rise"
          style={{
            ["--m-delay" as string]: "80ms",
            width: 300,
            maxWidth: "82%",
          }}
        >
          {wordmark}
        </div>
      )}

      {theme.label && (
        <div
          className="m-rise"
          style={{
            ["--m-delay" as string]: "260ms",
            marginTop: 34,
            fontWeight: 500,
            letterSpacing: "0.3em",
            fontSize: 16,
          }}
        >
          {theme.label}
        </div>
      )}
      {theme.ornament_url && (
        <div
          className="m-rise"
          style={{ ["--m-delay" as string]: "360ms", marginTop: 16 }}
        >
          <Ornament src={theme.ornament_url} width={116} />
        </div>
      )}

      {/* Wrapper flex para centrar horizontal: la animación del óvalo usa su
          propio transform (translateY), así que el centrado NO puede depender
          de translateX o se pisan. */}
      <div
        className="m-rise"
        style={{
          ["--m-delay" as string]: "700ms",
          position: "absolute",
          bottom: 34,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <a
          href="#carta-menu"
          aria-label="Ver la carta"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 42,
            height: 62,
            borderRadius: 40,
            border: "1.5px solid rgba(255,255,255,0.7)",
            color: "#fff",
            textDecoration: "none",
            animation: "carta-bob 2.4s ease-in-out infinite",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    </header>
  );
}

export function CartaClient({
  businessName,
  tagline,
  theme,
  categories,
  beverageSuperCategoryId,
  todaysMenus,
  hours,
  timezone,
  isOpenInitial,
}: {
  businessName: string;
  tagline: string | null;
  theme: CartaTheme;
  coverImageUrl: string | null;
  logoUrl: string | null;
  categories: MenuCategory[];
  beverageSuperCategoryId: string | null;
  todaysMenus: MenuDailyMenu[];
  hours: BusinessHour[];
  timezone: string;
  isOpenInitial: boolean;
}) {
  const displayTabs = useMemo(
    () => buildDisplayTabs(categories, beverageSuperCategoryId),
    [categories, beverageSuperCategoryId],
  );
  const [isOpen, setIsOpen] = useState(isOpenInitial);
  useEffect(() => {
    const tick = () => setIsOpen(computeIsOpen(hours, timezone));
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [hours, timezone]);

  // Cada tab se apila como sección; bebidas se despliega en sus subcategorías,
  // cada una con su propio título script (Vinos Tintos, Cervezas, …).
  const sections = useMemo(() => {
    const out: { key: string; name: string; products: MenuProduct[] }[] = [];
    for (const tab of displayTabs) {
      if (tab.subcategories) {
        for (const sub of tab.subcategories) {
          out.push({
            key: `${tab.id}:${sub.name}`,
            name: sub.name,
            products: sub.products,
          });
        }
      } else {
        out.push({ key: tab.id, name: tab.name, products: tab.products });
      }
    }
    return out.filter((s) => s.products.length > 0);
  }, [displayTabs]);

  return (
    <div
      className="carta-theme"
      data-body={theme.body_style}
      style={
        {
          minHeight: "100vh",
          // Los `--ct-*` los lee `.carta-theme` en globals.css; el dark mode
          // sigue pisando los `--carta-*` por encima (spec 129, D3).
          "--ct-cover": theme.cover_bg,
          "--ct-paper": theme.paper,
          "--ct-ink": theme.ink,
          "--ct-ink-2": theme.ink_2,
          "--ct-accent": theme.accent,
          ...(theme.paper_texture_url
            ? { backgroundImage: `url(${theme.paper_texture_url})` }
            : {}),
        } as React.CSSProperties
      }
    >
      <Cover theme={theme} businessName={businessName} />

      <main
        id="carta-menu"
        style={{ maxWidth: 600, margin: "0 auto", padding: "8px 26px 100px" }}
      >
        {/* Tagline + estado, discreto */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "18px 0 4px",
            fontSize: 12.5,
            color: "var(--carta-ink-2)",
          }}
        >
          {tagline && <span style={{ fontStyle: "italic" }}>{tagline}</span>}
          {tagline && <span>·</span>}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 600,
              color: isOpen ? "var(--carta-gold)" : "var(--carta-ink-2)",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: isOpen ? "var(--carta-gold)" : "var(--carta-ink-2)",
              }}
            />
            {isOpen ? "Abierto ahora" : "Cerrado"}
          </span>
        </div>

        <Reveal>
          <DailyMenu theme={theme} menus={todaysMenus} />
        </Reveal>

        {sections.map((s) => (
          <Reveal as="section" key={s.key}>
            <SectionTitle theme={theme}>{s.name}</SectionTitle>
            <ul style={{ margin: 0, padding: 0 }}>
              {s.products.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </ul>
          </Reveal>
        ))}

        {sections.length === 0 && (
          <div
            style={{
              padding: "64px 16px",
              textAlign: "center",
              color: "var(--carta-ink-2)",
              fontSize: 14,
              fontStyle: "italic",
            }}
          >
            Sin productos para mostrar.
          </div>
        )}
      </main>
    </div>
  );
}
