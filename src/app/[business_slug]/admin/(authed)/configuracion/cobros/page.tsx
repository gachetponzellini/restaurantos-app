import { notFound } from "next/navigation";

import { CreditCard, Receipt } from "lucide-react";

import { AfipConfigForm } from "@/components/admin/settings/afip-config-form";
import { BusinessPaymentsForm } from "@/components/admin/settings/business-payments-form";
import { PaymentMethodsConfig } from "@/components/admin/settings/payment-methods-config";
import { SettingsSection } from "@/components/admin/settings/settings-section";
import { getAllPaymentMethodConfigs } from "@/lib/caja/queries";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

// Ajustes › Cobros y facturación: Mercado Pago, recargos por método de pago y
// facturación AFIP (ARCA gateway). El gate vive en el layout.
export default async function ConfiguracionCobrosPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const service = createSupabaseServiceClient();
  const methodConfigs = await getAllPaymentMethodConfigs(business.id);

  // Credencial del gateway ARCA (tabla aparte, service-role-only). Sólo se leen
  // los campos NO secretos (slug, base_url) + la presencia de la API key.
  const { data: gatewayCred } = await service
    .from("afip_gateway_credentials")
    .select("api_key, tenant_slug, base_url")
    .eq("business_id", business.id)
    .maybeSingle();
  const gateway = gatewayCred as {
    api_key: string | null;
    tenant_slug: string | null;
    base_url: string | null;
  } | null;

  const b = business as Record<string, unknown>;

  return (
    <>
      <BusinessPaymentsForm
        slug={business_slug}
        businessId={business.id}
        initial={{
          // #113 · 1: los secretos NUNCA van al cliente — sólo si están cargados.
          hasAccessToken: Boolean(business.mp_access_token),
          hasWebhookSecret: Boolean(business.mp_webhook_secret),
          mp_public_key: business.mp_public_key ?? "",
          mp_accepts_payments: business.mp_accepts_payments,
        }}
      />

      <SettingsSection
        icon={<CreditCard className="size-5" />}
        title="Métodos de pago"
        description="Configurá recargos o descuentos por método de pago. Se aplican automáticamente al cobrar."
      >
        <PaymentMethodsConfig slug={business_slug} configs={methodConfigs} />
      </SettingsSection>

      <SettingsSection
        icon={<Receipt className="size-5" />}
        title="Facturación AFIP"
        description="Configurá la emisión de comprobantes electrónicos AFIP. Necesitás CUIT y punto de venta."
      >
        <AfipConfigForm
          slug={business_slug}
          initial={{
            cuit: (b.afip_cuit as string) ?? "",
            puntoVenta: (b.afip_punto_venta as number) ?? 0,
            provider:
              (b.afip_provider as "sandbox" | "gateway") ?? "gateway",
            defaultTipo:
              (b.afip_default_tipo as
                | "factura_a"
                | "factura_b"
                | "nota_credito_a"
                | "nota_credito_b") ?? "factura_b",
            mode: (b.afip_mode as "sandbox" | "produccion") ?? "sandbox",
            enabled: Boolean(b.afip_enabled),
            autoEmit: Boolean(b.afip_auto_emit),
            // API key: sólo el flag de presencia (el secreto NUNCA va al cliente).
            hasGatewayKey: Boolean(gateway?.api_key),
            // Slug y base URL no son secretos: se pre-rellenan.
            gatewayTenantSlug: gateway?.tenant_slug ?? "",
            gatewayBaseUrl:
              gateway?.base_url ?? "https://arca-gpsf-gateway.vercel.app",
          }}
        />
      </SettingsSection>
    </>
  );
}

export const dynamic = "force-dynamic";
