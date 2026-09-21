"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CreditCard } from "lucide-react";

import {
  SectionField,
  SettingsSection,
} from "@/components/admin/settings/settings-section";
import { SaveBar } from "@/components/admin/settings/settings-form-primitives";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { updateBusinessPayments } from "@/lib/admin/business-actions";
import { cn } from "@/lib/utils";

const Schema = z.object({
  mp_access_token: z.string().max(300).optional(),
  mp_public_key: z.string().max(300).optional(),
  mp_webhook_secret: z.string().max(300).optional(),
  mp_accepts_payments: z.boolean(),
});

type Values = z.infer<typeof Schema>;

/**
 * #113 · 1: los secretos (Access Token, Webhook Secret) son de sólo escritura.
 * El server manda sólo si están cargados; el input arranca vacío y guardarlo
 * vacío deja el valor como estaba (ver `planPaymentsUpdate`).
 */
export function BusinessPaymentsForm({
  slug,
  businessId,
  initial,
}: {
  slug: string;
  businessId: string;
  initial: {
    hasAccessToken: boolean;
    hasWebhookSecret: boolean;
    mp_public_key: string;
    mp_accepts_payments: boolean;
  };
}) {
  const defaults: Values = {
    mp_access_token: "",
    mp_webhook_secret: "",
    mp_public_key: initial.mp_public_key,
    mp_accepts_payments: initial.mp_accepts_payments,
  };
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: defaults,
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      const r = await updateBusinessPayments({
        business_slug: slug,
        ...values,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Configuración guardada.");
      // Los secretos no se vuelven a mostrar: el campo queda vacío y el
      // `router.refresh()` trae el «cargado» nuevo.
      form.reset({ ...values, mp_access_token: "", mp_webhook_secret: "" });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const mpEnabled = form.watch("mp_accepts_payments");
  const mpAccess = form.watch("mp_access_token");
  const mpPublic = form.watch("mp_public_key");
  const mpReady = Boolean((initial.hasAccessToken || mpAccess) && mpPublic);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <SettingsSection
          icon={<CreditCard className="size-5" strokeWidth={1.75} />}
          title="Mercado Pago"
          description="Conectá tu cuenta para cobrar online. Si no lo activás, solo aceptás efectivo."
          aside={<MpStatusPill enabled={mpEnabled} ready={mpReady} />}
        >
          <FormField
            control={form.control}
            name="mp_accepts_payments"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={field.value}
                    onClick={() => field.onChange(!field.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition",
                      field.value
                        ? "border-zinc-900 bg-zinc-900 text-zinc-50"
                        : "border-zinc-200 bg-white hover:border-zinc-300",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        Aceptar Mercado Pago en el checkout
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-xs",
                          field.value ? "text-zinc-400" : "text-zinc-500",
                        )}
                      >
                        Requiere completar Access Token y Public Key abajo.
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className={cn(
                        "relative flex h-6 w-11 shrink-0 items-center rounded-full transition",
                        field.value ? "bg-emerald-400" : "bg-zinc-300",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute size-5 rounded-full bg-white shadow-sm transition",
                          field.value ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </button>
                </FormControl>
              </FormItem>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="mp_access_token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Token</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={
                        initial.hasAccessToken ? "•••••••• (cargado)" : "APP_USR-..."
                      }
                      autoComplete="new-password"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    {initial.hasAccessToken
                      ? "Secreto · no se muestra. Dejalo vacío para mantener el cargado."
                      : "Secreto · se usa server-side para crear el pago."}
                  </p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mp_public_key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Public Key</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="APP_USR-..."
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    Pública · viaja al cliente.
                  </p>
                </FormItem>
              )}
            />
          </div>

          <details className="group rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-900">
              Avanzado · Webhook (opcional)
            </summary>
            <div className="mt-4 space-y-3">
              <p className="text-xs text-zinc-600">
                Solo hace falta en producción para cubrir pestañas cerradas. Si
                el cliente vuelve al menú después de pagar, el pedido se
                actualiza solo.
              </p>
              <FormField
                control={form.control}
                name="mp_webhook_secret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook Secret</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={
                          initial.hasWebhookSecret
                            ? "•••••••• (cargado · vacío = no cambia)"
                            : "Clave secreta del webhook"
                        }
                        autoComplete="new-password"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                    <SectionField
                      label="URL a registrar en MP"
                      hint="Pegá esto en el campo URL del webhook."
                    >
                      <code className="block break-all rounded-lg bg-white px-3 py-2 text-[0.7rem] text-zinc-700 ring-1 ring-zinc-200">
                        {origin}/api/mp/webhook?business_id={businessId}
                      </code>
                    </SectionField>
                  </FormItem>
                )}
              />
            </div>
          </details>
        </SettingsSection>

        <SaveBar
          dirty={form.formState.isDirty}
          submitting={submitting}
          onDiscard={() => form.reset(defaults)}
        />
      </form>
    </Form>
  );
}

// ——— MP status pill ———
function MpStatusPill({ enabled, ready }: { enabled: boolean; ready: boolean }) {
  if (enabled && ready) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="size-3" />
        Conectado
      </span>
    );
  }
  if (enabled && !ready) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
        <AlertTriangle className="size-3" />
        Faltan claves
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-600 ring-1 ring-zinc-200">
      Desactivado
    </span>
  );
}
