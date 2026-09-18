import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/daily-menus/product-picker", () => ({
  ProductPicker: ({ value }: { value: { name: string } | null }) => (
    <div data-testid="product-picker">{value?.name ?? "sin producto"}</div>
  ),
}));
vi.mock("@/components/admin/catalog/image-uploader", () => ({
  ImageUploader: () => <div data-testid="image-uploader" />,
}));
const { createDailyMenuMock, updateDailyMenuMock } = vi.hoisted(() => ({
  createDailyMenuMock: vi.fn(async (_slug: string, _payload: unknown) => ({
    ok: true,
    data: { id: "m1" },
  })),
  updateDailyMenuMock: vi.fn(
    async (_slug: string, _id: string, _payload: unknown) => ({
      ok: true,
      data: { id: "m1" },
    }),
  ),
}));
vi.mock("@/lib/daily-menus/daily-menu-actions", () => ({
  createDailyMenu: createDailyMenuMock,
  updateDailyMenu: updateDailyMenuMock,
  deleteDailyMenu: vi.fn(async () => ({ ok: true, data: null })),
  toggleDailyMenuAvailability: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import { DailyMenuForm } from "./daily-menu-form";
import { isOnTodaysCarta } from "./daily-menu-bits";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";

/**
 * Días con atajos, «se ofrece en» como chips y el guardado del menú del día
 * (spec 205 · D8). Extraído a `daily-menu-fields.tsx`; este test cubre lo
 * nuevo, sin repetir lo que ya prueba `daily-menu-form.test.tsx` (reordenar
 * componentes, spec 076/087/148/175).
 */

const MENU: AdminDailyMenu = {
  id: "m1",
  name: "Menú ejecutivo",
  slug: "ejecutivo",
  description: null,
  price_cents: 1500000, // $15.000
  image_url: null,
  available_days: [1, 2, 3, 4, 5],
  is_active: true,
  is_available: true,
  sort_order: 0,
  display_context: "both",
  is_suggestion: false,
  components: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      label: "Entrada",
      description: null,
      sort_order: 0,
      kind: "text",
      product_id: null,
      choice_group_id: null,
      choice_group_label: null,
      product_name: null,
      product_image_url: null,
      extra_price_cents: 0,
      product_modifier_groups: [],
      ignored_modifier_group_ids: [],
    },
  ],
  choice_groups: [],
};

afterEach(() => vi.restoreAllMocks());

describe("días del menú · atajos (spec 205 · D8)", () => {
  const dayChip = (label: string) =>
    screen
      .getAllByRole("button", { name: label })
      .find((b) => b.getAttribute("aria-pressed") !== null)!;

  it("«Lunes a viernes» prende L-V y apaga sábado y domingo", () => {
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" menu={MENU} />);

    fireEvent.click(screen.getByRole("button", { name: "Fin de semana" }));
    expect(dayChip("Sáb")).toHaveAttribute("aria-pressed", "true");
    expect(dayChip("Lun")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Lunes a viernes" }));
    expect(dayChip("Lun")).toHaveAttribute("aria-pressed", "true");
    expect(dayChip("Vie")).toHaveAttribute("aria-pressed", "true");
    expect(dayChip("Sáb")).toHaveAttribute("aria-pressed", "false");
    expect(dayChip("Dom")).toHaveAttribute("aria-pressed", "false");
  });

  it("«Todos» prende los siete días", () => {
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" menu={MENU} />);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    for (const d of ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]) {
      expect(dayChip(d)).toHaveAttribute("aria-pressed", "true");
    }
  });
});

describe("se ofrece en · chips (spec 205 · D8)", () => {
  it("arranca con Salón y Carta online prendidos (display_context=both)", () => {
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" menu={MENU} />);
    expect(
      screen.getByRole("button", { name: "Salón (mozo)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Carta online" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("apagar uno deja sólo el otro prendido", () => {
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" menu={MENU} />);
    fireEvent.click(screen.getByRole("button", { name: "Carta online" }));
    expect(
      screen.getByRole("button", { name: "Salón (mozo)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Carta online" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("no deja apagar los dos: el segundo click no hace nada", () => {
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" menu={MENU} />);
    fireEvent.click(screen.getByRole("button", { name: "Carta online" }));
    fireEvent.click(screen.getByRole("button", { name: "Salón (mozo)" }));
    expect(
      screen.getByRole("button", { name: "Salón (mozo)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("guardar el menú del día · pesos a centavos (spec 205 · D5/D8)", () => {
  it("actualizar manda el precio en centavos, sin tocar el resto del payload", async () => {
    updateDailyMenuMock.mockClear();
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" menu={MENU} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(updateDailyMenuMock).toHaveBeenCalled());
    const [slug, id, payload] = updateDailyMenuMock.mock.calls[0];
    expect(slug).toBe("golf-jcr");
    expect(id).toBe("m1");
    expect((payload as { price_cents: number }).price_cents).toBe(1500000);
  });

  it("crear arranca en $0 y manda el nombre que se escribió", async () => {
    createDailyMenuMock.mockClear();
    render(<DailyMenuForm slug="golf-jcr" businessId="b1" />);

    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Menú del mediodía" },
    });
    // La página muestra el slug al lado del nombre (slugPlacement="inline"),
    // sin autogenerarlo — a diferencia del editor en modal, que lo esconde en
    // «Avanzado» y sí lo arma solo.
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "menu-mediodia" },
    });
    // El menú nuevo arranca con un componente de texto vacío; el schema pide
    // que tenga nombre.
    fireEvent.change(screen.getByPlaceholderText("Milanesa con puré"), {
      target: { value: "Plato del día" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    await waitFor(() => expect(createDailyMenuMock).toHaveBeenCalled());
    const [, payload] = createDailyMenuMock.mock.calls[0];
    const p = payload as { name: string; price_cents: number };
    expect(p.name).toBe("Menú del mediodía");
    expect(p.price_cents).toBe(0);
  });
});

describe("isOnTodaysCarta (spec 205 · D8)", () => {
  it("true sólo si está activo, disponible y hoy es uno de sus días", () => {
    expect(isOnTodaysCarta(MENU, 2)).toBe(true); // martes, está en [1..5]
    expect(isOnTodaysCarta(MENU, 6)).toBe(false); // sábado, no está
    expect(isOnTodaysCarta({ ...MENU, is_active: false }, 2)).toBe(false);
    expect(isOnTodaysCarta({ ...MENU, is_available: false }, 2)).toBe(false);
  });
});
