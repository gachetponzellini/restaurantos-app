"use client";

import {
  CONDICION_IVA_LABEL,
  condicionesValidasPara,
  condicionIvaDefault,
} from "@/lib/afip/condicion-iva";
import { formatCuit } from "@/lib/afip/cuit";
import type { CondicionIvaReceptor, TipoComprobante } from "@/lib/afip/types";

import { FiscalEntitySearchField } from "./fiscal-entity-search-field";

// ============================================================================
// Datos del comprobante (spec 053), compartidos.
//
// Vivía embebido en el sheet del pedido, pero facturar está en tres de los
// cuatro puntos de cobro (mozo, pedido y mostrador) — el único que no factura
// es el cobro de mesa del encargado. Extraerlo es lo que permite que los tres
// pidan los mismos datos de la misma forma.
//
// Es sólo el formulario: quién llama a `emitInvoice` y cuándo lo decide el
// caller, porque el momento de facturar difiere en cada flujo.
// ============================================================================

export type ComprobanteState = {
  tipo: TipoComprobante;
  cuit: string;
  razonSocial: string;
  condicionIva: CondicionIvaReceptor;
  /**
   * Entidad fiscal elegida en el buscador (spec 150). Viaja a `emitInvoice`
   * para vincular la factura con su receptor, y el servidor la acepta sólo si
   * es del negocio y su CUIT es el que se emite: es una pista, no la verdad.
   */
  fiscalEntityId: string | null;
};

export function comprobanteInicial(): ComprobanteState {
  return {
    tipo: "factura_b",
    cuit: "",
    razonSocial: "",
    condicionIva: condicionIvaDefault("factura_a"),
    fiscalEntityId: null,
  };
}

/** CUIT válido = 11 dígitos. Factura A lo exige; B lo acepta vacío. */
export function comprobanteEsValido(state: ComprobanteState): boolean {
  if (state.tipo !== "factura_a") return true;
  return state.cuit.replace(/\D/g, "").length === 11;
}

/** Lo que espera `emitInvoice`, ya normalizado. */
export function comprobanteToInvoiceInput(state: ComprobanteState) {
  if (state.tipo !== "factura_a") return { tipoComprobante: state.tipo };
  return {
    tipoComprobante: state.tipo,
    cuitReceptor: state.cuit.replace(/\D/g, ""),
    razonSocialReceptor: state.razonSocial.trim() || undefined,
    condicionIvaReceptor: state.condicionIva,
    fiscalEntityId: state.fiscalEntityId ?? undefined,
  };
}

export function ComprobanteFields({
  slug,
  value,
  onChange,
}: {
  slug: string;
  value: ComprobanteState;
  onChange: (next: ComprobanteState) => void;
}) {
  const esA = value.tipo === "factura_a";
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <input
          type="checkbox"
          checked={esA}
          onChange={(e) =>
            onChange({
              ...value,
              tipo: e.target.checked ? "factura_a" : "factura_b",
            })
          }
          className="size-4 rounded border-foreground/20"
        />
        Factura A (empresa con CUIT)
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        {esA
          ? "Se emite Factura A al CUIT indicado."
          : "Por defecto: Factura B (consumidor final)."}
      </p>

      {esA && (
        <div className="mt-3 space-y-2.5">
          <FiscalEntitySearchField
            slug={slug}
            cuit={value.cuit}
            razonSocial={value.razonSocial}
            condicionIva={value.condicionIva}
            entidadId={value.fiscalEntityId}
            onSelect={(entidad) =>
              onChange({
                ...value,
                cuit: formatCuit(entidad.cuit),
                razonSocial: entidad.razon_social,
                condicionIva: entidad.condicion_iva,
                fiscalEntityId: entidad.id,
              })
            }
          />

          <div className="grid gap-1.5">
            <label
              htmlFor="comprobante-cuit"
              className="text-xs font-semibold text-foreground/70"
            >
              CUIT del receptor
            </label>
            <input
              id="comprobante-cuit"
              type="text"
              inputMode="numeric"
              value={value.cuit}
              onChange={(e) =>
                onChange({
                  ...value,
                  cuit: e.target.value,
                  // Cambiar el CUIT es cambiar de receptor: el vínculo con la
                  // entidad elegida deja de valer (la razón social, no — ésa
                  // se corrige sobre la misma entidad, D3).
                  fiscalEntityId: null,
                })
              }
              placeholder="11 dígitos"
              className="block h-10 w-full rounded-xl border border-border px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="grid gap-1.5">
            <label
              htmlFor="comprobante-razon"
              className="text-xs font-semibold text-foreground/70"
            >
              Razón social (opcional)
            </label>
            <input
              id="comprobante-razon"
              type="text"
              value={value.razonSocial}
              onChange={(e) =>
                onChange({ ...value, razonSocial: e.target.value })
              }
              className="block h-10 w-full rounded-xl border border-border px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-foreground/70">
              Condición IVA del receptor
            </p>
            <div className="flex flex-wrap gap-2">
              {condicionesValidasPara("factura_a").map((cond) => (
                <button
                  key={cond}
                  type="button"
                  onClick={() => onChange({ ...value, condicionIva: cond })}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    value.condicionIva === cond
                      ? "bg-primary text-white"
                      : "bg-card text-foreground/80 ring-1 ring-border"
                  }`}
                >
                  {CONDICION_IVA_LABEL[cond]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
