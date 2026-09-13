import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminModifier = {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
  sort_order: number;
};

export type AdminModifierGroup = {
  id: string;
  name: string;
  min_selection: number;
  max_selection: number;
  is_required: boolean;
  sort_order: number;
  modifiers: AdminModifier[];
};

export type AdminProduct = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  is_available: boolean;
  is_active: boolean;
  show_online: boolean;
  sort_order: number;
  station_id: string | null;
  /** Spec 180: 2ª y 3ª comandera; null hereda de la categoría. */
  extra_station_ids: string[] | null;
  /** Spec 180: no imprime comanda aunque la categoría tenga sector. */
  sin_comanda: boolean;
  prep_time_minutes: number | null;
  modifier_groups: AdminModifierGroup[];
};

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  super_category_id: string | null;
  station_id: string | null;
  /** Spec 180: 2ª y 3ª comandera por default del rubro. */
  extra_station_ids: string[];
};

export type AdminSuperCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  icon: string;
  color: string;
  is_active: boolean;
};

export type AdminStation = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  printer_ip: string | null;
  printer_port: number;
  printer_enabled: boolean;
};

export async function getAdminCatalog(businessId: string) {
  const supabase = await createSupabaseServerClient();
  const [
    { data: superCategories },
    { data: stations },
    { data: categories },
    { data: products },
  ] = await Promise.all([
    supabase
      .from("super_categories")
      .select("id, name, slug, sort_order, icon, color, is_active")
      .eq("business_id", businessId)
      .order("sort_order"),
    supabase
      .from("stations")
      .select(
        "id, name, sort_order, is_active, printer_ip, printer_port, printer_enabled",
      )
      .eq("business_id", businessId)
      .order("sort_order"),
    supabase
      .from("categories")
      .select("id, name, slug, sort_order, is_active, super_category_id, station_id, extra_station_ids")
      .eq("business_id", businessId)
      .order("sort_order"),
    supabase
      .from("products")
      .select(
        "id, category_id, name, slug, description, price_cents, image_url, is_available, is_active, show_online, sort_order, station_id, extra_station_ids, sin_comanda, prep_time_minutes, modifier_groups(id, name, min_selection, max_selection, is_required, sort_order, modifiers(id, name, price_delta_cents, is_available, sort_order))",
      )
      .eq("business_id", businessId)
      .order("sort_order"),
  ]);

  const productsList: AdminProduct[] = (products ?? []).map((p) => ({
    id: p.id,
    category_id: p.category_id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price_cents: Number(p.price_cents),
    image_url: p.image_url,
    is_available: p.is_available,
    is_active: p.is_active,
    show_online: p.show_online,
    sort_order: p.sort_order,
    station_id: p.station_id,
    extra_station_ids: p.extra_station_ids ?? null,
    sin_comanda: p.sin_comanda ?? false,
    prep_time_minutes: p.prep_time_minutes ?? null,
    modifier_groups: (p.modifier_groups ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        id: g.id,
        name: g.name,
        min_selection: g.min_selection,
        max_selection: g.max_selection,
        is_required: g.is_required,
        sort_order: g.sort_order,
        modifiers: (g.modifiers ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => ({
            id: m.id,
            name: m.name,
            price_delta_cents: Number(m.price_delta_cents),
            is_available: m.is_available,
            sort_order: m.sort_order,
          })),
      })),
  }));

  return {
    superCategories: (superCategories ?? []) as AdminSuperCategory[],
    stations: (stations ?? []) as AdminStation[],
    categories: (categories ?? []) as AdminCategory[],
    products: productsList,
  };
}

export async function getAdminProduct(id: string): Promise<AdminProduct | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, category_id, name, slug, description, price_cents, image_url, is_available, is_active, show_online, sort_order, station_id, extra_station_ids, sin_comanda, prep_time_minutes, modifier_groups(id, name, min_selection, max_selection, is_required, sort_order, modifiers(id, name, price_delta_cents, is_available, sort_order))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    category_id: data.category_id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    price_cents: Number(data.price_cents),
    image_url: data.image_url,
    is_available: data.is_available,
    is_active: data.is_active,
    show_online: data.show_online,
    sort_order: data.sort_order,
    station_id: data.station_id,
    extra_station_ids: data.extra_station_ids ?? null,
    sin_comanda: data.sin_comanda ?? false,
    prep_time_minutes: data.prep_time_minutes ?? null,
    modifier_groups: (data.modifier_groups ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        id: g.id,
        name: g.name,
        min_selection: g.min_selection,
        max_selection: g.max_selection,
        is_required: g.is_required,
        sort_order: g.sort_order,
        modifiers: (g.modifiers ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => ({
            id: m.id,
            name: m.name,
            price_delta_cents: Number(m.price_delta_cents),
            is_available: m.is_available,
            sort_order: m.sort_order,
          })),
      })),
  };
}
