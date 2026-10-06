"use client";

import { useState } from "react";
import { toast } from "sonner";

import { signInCustomer, signUpCustomer } from "@/lib/auth/customer-auth";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 52,
  borderRadius: 12,
  border: "1px solid var(--hairline-2)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 15,
  padding: "0 16px",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink-2)",
  marginBottom: 6,
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--red, #e53e3e)",
  marginTop: 4,
};

type Mode = "login" | "signup";

interface Props {
  business_slug: string;
  next: string;
}

export function CustomerAuthForm({ business_slug, next }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // H-04: con Confirm email activo el alta no abre sesión; avisamos y listo.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const validate = (
    email: string,
    password: string,
    phone: string,
  ): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.email = "Ingresá un email válido.";
    if (!password) errors.password = "Ingresá tu contraseña.";
    if (mode === "signup" && password && password.length < 8)
      errors.password = "La contraseña debe tener al menos 8 caracteres.";
    if (mode === "signup") {
      const digits = phone.replace(/\D/g, "");
      if (!phone || digits.length < 8)
        errors.phone = "Ingresá un teléfono válido.";
    }
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement)
      .value;
    const phone =
      mode === "signup"
        ? (form.elements.namedItem("phone") as HTMLInputElement).value
        : "";

    const errors = validate(email, password, phone);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const input = { business_slug, email, password, phone, next };
      if (mode === "login") {
        const result = await signInCustomer(input);
        if (result && !result.ok) toast.error(result.error);
      } else {
        const result = await signUpCustomer(input);
        if (!result.ok) toast.error(result.error);
        else if (result.data.status === "confirm_email")
          setPendingEmail(result.data.email);
      }
    } catch (err) {
      if (
        err instanceof Error &&
        "digest" in err &&
        typeof err.digest === "string" &&
        err.digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      console.error(err);
      toast.error("No pudimos completar la operación, probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = (newMode: Mode) => {
    setMode(newMode);
    setFieldErrors({});
    setPendingEmail(null);
  };

  if (pendingEmail) {
    return (
      <div
        role="status"
        style={{
          border: "1px solid var(--hairline-2)",
          borderRadius: 12,
          padding: 20,
          color: "var(--ink)",
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        <p style={{ margin: 0 }}>
          Te mandamos un mail a <strong>{pendingEmail}</strong> para confirmar
          la cuenta. Cuando lo confirmes, ingresá con tu email y contraseña.
        </p>
        <button
          type="button"
          onClick={() => toggleMode("login")}
          style={{
            marginTop: 16,
            minHeight: 44,
            padding: "0 16px",
            borderRadius: 10,
            border: "1px solid var(--hairline-2)",
            background: "var(--bg)",
            color: "var(--ink)",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Ir a ingresar
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Toggle */}
      <div
        style={{
          display: "flex",
          gap: 4,
          background: "var(--hairline)",
          borderRadius: 10,
          padding: 4,
          marginBottom: 24,
        }}
      >
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => toggleMode(m)}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 7,
              border: "none",
              background: mode === m ? "var(--bg)" : "transparent",
              color: mode === m ? "var(--ink)" : "var(--ink-3)",
              fontSize: 14,
              fontWeight: mode === m ? 600 : 400,
              cursor: "pointer",
              boxShadow:
                mode === m ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s",
            }}
          >
            {m === "login" ? "Ingresar" : "Crear cuenta"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: 16 }}>
        <div>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            style={inputStyle}
          />
          {fieldErrors.email && (
            <p style={errorStyle}>{fieldErrors.email}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" style={labelStyle}>
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            style={inputStyle}
          />
          {fieldErrors.password && (
            <p style={errorStyle}>{fieldErrors.password}</p>
          )}
        </div>

        {mode === "signup" && (
          <div>
            <label htmlFor="phone" style={labelStyle}>
              Teléfono
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="Ej: 11 1234-5678"
              style={inputStyle}
            />
            {fieldErrors.phone && (
              <p style={errorStyle}>{fieldErrors.phone}</p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            height: 54,
            borderRadius: 12,
            background: "var(--ink)",
            color: "var(--bg)",
            border: "none",
            fontSize: 15,
            fontWeight: 600,
            cursor: submitting ? "wait" : "pointer",
            marginTop: 4,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting
            ? "Cargando…"
            : mode === "login"
              ? "Ingresar"
              : "Crear cuenta"}
        </button>
      </form>
    </div>
  );
}
