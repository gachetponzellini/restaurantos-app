"use client";

import { useState } from "react";

import { CustomerSearchField } from "@/components/mozo/customer-search-field";
import type { ClienteMatch } from "@/lib/admin/customers-actions";

/**
 * Bloque «cliente» de los tres flujos de carga (spec 068, FR-001).
 *
 * Buscador de clientes + teléfono, con la regla de la [spec 067] adentro:
 * **elegido un cliente del CRM, su teléfono no se edita**. El teléfono es la
 * clave con la que se lo identifica (`upsert` por `(business_id, phone)`);
 * editarlo con un cliente elegido no le cambia el teléfono a ese cliente,
 * apunta a otro y crea uno nuevo en silencio. «Quitar» suelta la identidad.
 *
 * Esa regla se escribió **tres veces el mismo día** (walk-in, cargar pedido,
 * nueva reserva) antes de existir este componente. Ahora vive en un solo lado.
 *
 * **Controlado**: `name` y `phone` los tiene el caller, porque ya los tiene
 * (react-hook-form en el walk-in, `useState` en los otros dos). Lo que vive
 * acá adentro es *qué cliente está elegido*, que es de lo que depende la regla.
 */
export function CustomerFields({
  slug,
  name,
  phone,
  onNameChange,
  onPhoneChange,
  onPick,
  onClear,
  autoFocus = false,
  nameLabel = "Cliente (opcional)",
  phoneLabel = "Teléfono (opcional · entra al CRM)",
  idPrefix = "cliente",
  labelClassName = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
  inputClassName = "h-12 w-full rounded-xl border border-border bg-card px-3 text-base",
}: {
  slug: string;
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  /** Eligió un cliente del CRM. El caller prellena lo que necesite (el sheet de
   *  cargar pedido además usa el id para traer las direcciones guardadas). */
  onPick?: (cliente: ClienteMatch) => void;
  /** Soltó la identidad. El caller limpia lo suyo (direcciones, etc). */
  onClear?: () => void;
  /** Spec 068 FR-002: al abrir mesa / nueva reserva el foco arranca acá. */
  autoFocus?: boolean;
  nameLabel?: string;
  phoneLabel?: string;
  idPrefix?: string;
  labelClassName?: string;
  inputClassName?: string;
}) {
  const [picked, setPicked] = useState<ClienteMatch | null>(null);

  const handleName = (value: string) => {
    onNameChange(value);
    // Escribir a mano es dejar de ser ese cliente del CRM.
    if (picked) {
      setPicked(null);
      onClear?.();
    }
  };

  const handlePick = (c: ClienteMatch) => {
    setPicked(c);
    onNameChange(c.name?.trim() || "");
    onPhoneChange(c.phone ?? "");
    onPick?.(c);
  };

  /**
   * Soltar el cliente: se limpia el teléfono —su identidad— y el nombre queda
   * como texto libre. Actualizarle el teléfono a un cliente es una operación de
   * CRM y vive en su ficha, no en el camino caliente de cargar.
   */
  const quitar = () => {
    setPicked(null);
    onPhoneChange("");
    onClear?.();
  };

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-nombre`} className={labelClassName}>
          {nameLabel}
        </label>
        <div className="mt-1">
          <CustomerSearchField
            id={`${idPrefix}-nombre`}
            slug={slug}
            value={name}
            onChange={handleName}
            onPick={handlePick}
            autoFocus={autoFocus}
            inputClassName={`${inputClassName} pl-9`}
          />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${idPrefix}-telefono`} className={labelClassName}>
            {picked ? "Teléfono · del cliente elegido" : phoneLabel}
          </label>
          {picked && (
            <button
              type="button"
              onClick={quitar}
              className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 underline underline-offset-2 transition hover:text-foreground/80"
            >
              Quitar
            </button>
          )}
        </div>
        <input
          id={`${idPrefix}-telefono`}
          value={phone}
          readOnly={!!picked}
          aria-readonly={!!picked}
          onChange={(e) => onPhoneChange(e.target.value)}
          className={`mt-1 ${inputClassName}${
            picked ? " cursor-not-allowed bg-muted text-foreground/70" : ""
          }`}
          placeholder="+54 9 …"
          inputMode="tel"
        />
      </div>
    </>
  );
}
