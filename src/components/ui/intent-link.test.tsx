import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Se captura el `prefetch` con el que se renderiza el Link de Next: es lo único
// que este componente decide.
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean | null;
    children: React.ReactNode;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import { IntentLink } from "./intent-link";

describe("IntentLink (#371)", () => {
  it("no prefetchea al entrar en pantalla", () => {
    render(<IntentLink href="/demo/admin/reservas">Reservas</IntentLink>);
    expect(screen.getByRole("link").dataset.prefetch).toBe("false");
  });

  it.each([
    ["mouseEnter", fireEvent.mouseEnter],
    ["focus", fireEvent.focus],
    ["touchStart", fireEvent.touchStart],
  ])("con %s pasa al prefetch automático de Next", (_n, disparar) => {
    render(<IntentLink href="/demo/admin/reservas">Reservas</IntentLink>);
    disparar(screen.getByRole("link"));
    expect(screen.getByRole("link").dataset.prefetch).toBe("null");
  });

  it("no pisa los handlers del que lo usa", () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();
    render(
      <IntentLink href="/x" onMouseEnter={onMouseEnter} onFocus={onFocus}>
        X
      </IntentLink>,
    );
    fireEvent.mouseEnter(screen.getByRole("link"));
    fireEvent.focus(screen.getByRole("link"));
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledOnce();
  });
});
