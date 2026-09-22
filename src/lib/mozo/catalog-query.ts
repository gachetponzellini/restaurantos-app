import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Catálogo proyectado para la pantalla de toma de pedido del mozo.
 *
 * Diferencias contra `getMenu` (cliente público):
 * - No carga `daily_menus` (ese viaje aparte via `daily-menus-query.ts`).
 * - No carga `business_hours` ni `todayDow` (la operación de salón es 24/7).
 * - Filtra `is_active=true` + `is_available=true` en products.
 * - Excluye modifiers con `is_available=false`.
 * - Trae `super_categories` del business + cada `category` con su
 *   `super_category_id`. La UI del mozo agrupa los chips por supercategoría
 *   en lugar de la heurística client-side anterior (migración 0031).
 */

export type CatalogModifier = {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  sort_order: number;
};

export type CatalogModifierGroup = {
  id: string;
  name: string;
  min_selection: number;
  max_selection: number;
  is_required: boolean;
  /** Spec 207: opciones = variantes con precio final. */
  is_variant: boolean;
  sort_order: number;
  modifiers: CatalogModifier[];
};

export type CatalogProduct = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  sort_order: number;
  /** Spec 068: `products.show_online` — si el producto se vende por la carta
   *  pública. Alimenta el filtro de la carta online del buscador; NO es un
   *  filtro duro (el duro es `is_active` + `is_available`, abajo). */
  show_online: boolean;
  modifier_groups: CatalogModifierGroup[];
};

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  super_category_id: string | null;
  products: CatalogProduct[];
};

export type CatalogSuperCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  icon: string;
  color: string;
};

export type CatalogForMozo = {
  superCategories: CatalogSuperCategory[];
  categories: CatalogCategory[];
};

export async function getCatalogForMozo(
  businessId: string,
): Promise<CatalogForMozo> {
  const supabase = createSupabaseServiceClient();

  const [{ data: superCats }, { data: categories }, { data: products }] =
    await Promise.all([
      supabase
        .from("super_categories")
        .select("id, name, slug, sort_order, icon, color")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("categories")
        .select("id, name, slug, sort_order, super_category_id")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("products")
        .select(
          "id, category_id, name, description, price_cents, image_url, sort_order, show_online, modifier_groups(id, name, min_selection, max_selection, is_required, is_variant, sort_order, modifiers(id, group_id, name, price_delta_cents, is_available, sort_order))",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("sort_order"),
    ]);

  const productsList: CatalogProduct[] = (products ?? [])
    .map((p) => ({
      id: p.id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      price_cents: Number(p.price_cents),
      image_url: p.image_url,
      sort_order: p.sort_order,
      show_online: p.show_online ?? true,
      modifier_groups: (p.modifier_groups ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => ({
          id: g.id,
          name: g.name,
          min_selection: g.min_selection,
          max_selection: g.max_selection,
          is_required: g.is_required,
          is_variant: g.is_variant ?? false,
          sort_order: g.sort_order,
          modifiers: (g.modifiers ?? [])
            .filter((m) => m.is_available)
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((m) => ({
              id: m.id,
              group_id: g.id,
              name: m.name,
              price_delta_cents: Number(m.price_delta_cents),
              sort_order: m.sort_order,
            })),
        })),
    }))
    // Spec 207: un producto con variantes sin ningún gusto prendido es un
    // producto apagado — el mozo no lo ve, igual que con `is_available`.
    .filter(
      (p) =>
        !p.modifier_groups.some(
          (g) => g.is_variant && g.modifiers.length === 0,
        ),
    );

  const cats: CatalogCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    sort_order: c.sort_order,
    super_category_id: c.super_category_id,
    products: productsList.filter((p) => p.category_id === c.id),
  }));

  const sups: CatalogSuperCategory[] = (superCats ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    sort_order: s.sort_order,
    icon: s.icon,
    color: s.color,
  }));

  return { superCategories: sups, categories: cats };
}
