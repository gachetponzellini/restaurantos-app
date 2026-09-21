// Issue #113 · 1 — el Access Token de Mercado Pago no vuelve al browser.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/admin/business-actions", () => ({ updateBusinessPayments: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { BusinessPaymentsForm } from "./business-payments-form";

describe("BusinessPaymentsForm · secretos de sólo escritura (#113)", () => {
  it("con token cargado: input vacío, dice «cargado» y MP figura conectado", () => {
    render(
      <BusinessPaymentsForm
        slug="demo"
        businessId="b1"
        initial={{
          hasAccessToken: true,
          hasWebhookSecret: true,
          mp_public_key: "APP_USR-public",
          mp_accepts_payments: true,
        }}
      />,
    );
    const secretos = screen.getAllByPlaceholderText(/cargado/i);
    expect(secretos).toHaveLength(2); // Access Token + Webhook Secret
    for (const input of secretos) expect(input).toHaveValue("");
    expect(screen.getByText(/conectado/i)).toBeInTheDocument();
  });
});
