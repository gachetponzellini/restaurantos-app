import { notFound } from "next/navigation";

import {
  ClipboardList,
  FileText,
  Fingerprint,
  MonitorDown,
  Printer,
  Receipt,
} from "lucide-react";

import { ClockOriginsForm } from "@/components/admin/settings/clock-origins-form";
import {
  ControlPrinterForm,
  type ControlPrinterRow,
} from "@/components/admin/settings/control-printer-form";
import {
  CuentaPrintersForm,
  type CuentaPrinterConfig,
  type FloorPlanPrinterRow,
} from "@/components/admin/settings/cuenta-printers-form";
import {
  FiscalPrintersForm,
  type CajaFiscalPrinterRow,
} from "@/components/admin/settings/fiscal-printers-form";
import { ComandasPrintingToggleForm } from "@/components/admin/settings/comandas-printing-toggle-form";
import { PrintAgentCard } from "@/components/admin/settings/print-agent-card";
import { SettingsSection } from "@/components/admin/settings/settings-section";
import {
  StationPrintersForm,
  type StationPrinterRow,
} from "@/components/admin/settings/station-printers-form";
import { listPrintAgents } from "@/lib/print-agent/credentials-actions";
import { listClockOrigins } from "@/lib/rrhh/clock-origin-actions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

// Ajustes › Operación del local: impresoras por sector (comanderas) y fichaje
// restringido a las computadoras del local. El gate vive en el layout.
export default async function ConfiguracionLocalPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const service = createSupabaseServiceClient();
  const [
    clockOrigins,
    { data: stations },
    { data: bizFlag },
    { data: floorPlans },
    { data: cajas },
    agentes,
  ] = await Promise.all([
    listClockOrigins(business.id),
    service
      .from("stations")
      .select("id, name, is_active, printer_ip, printer_port, printer_enabled")
      .eq("business_id", business.id)
      .order("sort_order"),
    service
      .from("businesses")
      .select(
        "print_agent_key_set, comandas_printer_enabled, control_printer_ip, control_printer_port, control_printer_enabled, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled",
      )
      .eq("id", business.id)
      .maybeSingle(),
    service
      .from("floor_plans")
      .select(
        "id, name, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled",
      )
      .eq("business_id", business.id)
      .order("name"),
    service
      .from("cajas")
      .select(
        "id, name, is_default, fiscal_printer_ip, fiscal_printer_port, fiscal_printer_enabled",
      )
      .eq("business_id", business.id)
      .eq("is_active", true)
      // spec 160 · esta pantalla configura la comandera fiscal de cada caja, y
      // por la Caja Mayor no sale ninguna factura: no se cobra ahí.
      // El cast: `is_administrative` (0067) todavía no está en `database.types.ts`.
      .eq("is_administrative" as "is_default", false as unknown as boolean)
      .order("sort_order"),
    listPrintAgents(business_slug),
  ]);

  const printAgentKeySet = Boolean(
    (bizFlag as { print_agent_key_set?: boolean } | null)?.print_agent_key_set,
  );
  const comandasPrintingEnabled =
    (bizFlag as { comandas_printer_enabled?: boolean } | null)
      ?.comandas_printer_enabled ?? true;
  const controlPrinter: ControlPrinterRow = {
    control_printer_ip:
      (bizFlag as ControlPrinterRow | null)?.control_printer_ip ?? null,
    control_printer_port:
      (bizFlag as ControlPrinterRow | null)?.control_printer_port ?? 9100,
    control_printer_enabled:
      (bizFlag as ControlPrinterRow | null)?.control_printer_enabled ?? true,
  };
  const cuentaPrinter: CuentaPrinterConfig = {
    cuenta_printer_ip:
      (bizFlag as CuentaPrinterConfig | null)?.cuenta_printer_ip ?? null,
    cuenta_printer_port:
      (bizFlag as CuentaPrinterConfig | null)?.cuenta_printer_port ?? 9100,
    cuenta_printer_enabled:
      (bizFlag as CuentaPrinterConfig | null)?.cuenta_printer_enabled ?? true,
  };
  // Spec 124: un negocio puede tener varias PCs con print-agent (golf: una por
  // caja, en LANs distintas). Si la lectura falla, la card cae al camino de
  // "todavía no hay ninguno" en vez de romper la página entera de configuración.
  const printAgents = agentes.ok ? agentes.data : [];

  // Las impresoras configuradas del local, para que la card pueda avisar si
  // alguna quedó fuera del alcance de TODOS los agentes. Ése es el modo de
  // fallar más caro de la spec: el papel no sale y nadie reporta nada, porque el
  // agente que no la alcanza directamente no la recibe.
  const impresorasDelLocal: { label: string; ip: string }[] = [
    ...((stations ?? []) as StationPrinterRow[])
      .filter((st) => st.printer_ip && st.printer_enabled !== false)
      .map((st) => ({ label: st.name, ip: st.printer_ip as string })),
    ...(controlPrinter.control_printer_ip &&
    controlPrinter.control_printer_enabled !== false
      ? [{ label: "Control de pedido", ip: controlPrinter.control_printer_ip }]
      : []),
    ...(cuentaPrinter.cuenta_printer_ip &&
    cuentaPrinter.cuenta_printer_enabled !== false
      ? [{ label: "Cuenta (por defecto)", ip: cuentaPrinter.cuenta_printer_ip }]
      : []),
    ...((floorPlans ?? []) as FloorPlanPrinterRow[])
      .filter(
        (fp) => fp.cuenta_printer_ip && fp.cuenta_printer_enabled !== false,
      )
      .map((fp) => ({
        label: `Cuenta · ${fp.name}`,
        ip: fp.cuenta_printer_ip as string,
      })),
    ...((cajas ?? []) as CajaFiscalPrinterRow[])
      .filter((c) => c.fiscal_printer_ip && c.fiscal_printer_enabled !== false)
      .map((c) => ({
        label: `Factura · ${c.name}`,
        ip: c.fiscal_printer_ip as string,
      })),
  ];

  return (
    <>
      <SettingsSection
        icon={<Printer className="size-5" />}
        title="Comanderas"
        description="Asigná a cada sector la IP de su impresora térmica en la red del local. Dejá la IP vacía para un sector sin comandera (no se imprime). Puerto por defecto 9100."
      >
        <ComandasPrintingToggleForm
          slug={business_slug}
          enabled={comandasPrintingEnabled}
        />
        <StationPrintersForm
          slug={business_slug}
          stations={(stations ?? []) as StationPrinterRow[]}
        />
      </SettingsSection>

      <SettingsSection
        icon={<ClipboardList className="size-5" />}
        title="Comandera de control"
        description="Además de las comandas de cocina, cada delivery y cada retiro imprime un «control de pedido» — el papel que se lleva el repartidor: el pedido completo con precios, cliente, dirección, horario de entrega y cuánta plata cobrar. Dejá la IP vacía para no imprimirlos."
      >
        <ControlPrinterForm slug={business_slug} initial={controlPrinter} />
      </SettingsSection>

      <SettingsSection
        icon={<Receipt className="size-5" strokeWidth={1.75} />}
        title="Comandera de cuentas"
        description="Dónde sale la cuenta que se le da al cliente cuando el mozo toca «Imprimir cuenta». Cada salón puede tener la suya; los que no, usan la del local."
      >
        <CuentaPrintersForm
          slug={business_slug}
          business={cuentaPrinter}
          floorPlans={(floorPlans ?? []) as FloorPlanPrinterRow[]}
        />
      </SettingsSection>

      <SettingsSection
        icon={<FileText className="size-5" strokeWidth={1.75} />}
        title="Comandera fiscal"
        description="Dónde sale la factura impresa —con el QR de ARCA— cuando el encargado toca «Imprimir factura». Es por caja: el papel fiscal tiene que salir donde está parado el que cobra."
      >
        <FiscalPrintersForm
          slug={business_slug}
          cajas={(cajas ?? []) as CajaFiscalPrinterRow[]}
        />
      </SettingsSection>

      <SettingsSection
        icon={<MonitorDown className="size-5" />}
        title="Agente de impresión"
        description="Descargá el agente ya configurado e instalalo en una PC del local que quede siempre prendida. Hace de puente entre el sistema y las comanderas de la red. Si el local tiene impresoras en redes separadas, agregá un agente por red y decile a cada uno cuáles alcanza."
      >
        <PrintAgentCard
          slug={business_slug}
          keySet={printAgentKeySet}
          agents={printAgents}
          impresoras={impresorasDelLocal}
        />
      </SettingsSection>

      <SettingsSection
        icon={<Fingerprint className="size-5" />}
        title="Fichaje desde el local"
        description="Restringí el fichaje a las computadoras del local. Agregá el rango de IP de la red interna (CIDR); sin orígenes configurados se puede fichar desde cualquier dispositivo."
      >
        <ClockOriginsForm slug={business_slug} origins={clockOrigins} />
      </SettingsSection>
    </>
  );
}

export const dynamic = "force-dynamic";
