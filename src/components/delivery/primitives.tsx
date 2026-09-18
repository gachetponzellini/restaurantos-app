import { FadeImage } from "@/components/motion/fade-image";

export function ImageTile({
  src,
  alt,
  className = "",
  style,
  radius = 12,
  sizes,
  priority,
}: {
  src?: string | null;
  alt?: string;
  tone?: string;
  className?: string;
  style?: React.CSSProperties;
  radius?: number;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div
      className={className}
      style={{
        borderRadius: radius,
        position: "relative",
        overflow: "hidden",
        // Fondo neutro mientras baja la foto (el FadeImage entra fundido).
        background: src ? "var(--hairline)" : undefined,
        ...style,
      }}
    >
      {src && (
        <FadeImage
          src={src}
          alt={alt ?? ""}
          fill
          sizes={sizes ?? "120px"}
          priority={priority}
          className="object-cover"
        />
      )}
    </div>
  );
}

export function StatusDot({ status }: { status: "open" | "busy" | "closed" }) {
  const c =
    status === "open"
      ? "var(--fresh)"
      : status === "busy"
        ? "#C78A3B"
        : "#B94A2A";
  const label =
    status === "open" ? "Abierto" : status === "busy" ? "Demorado" : "Cerrado";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: c,
          display: "inline-block",
        }}
      />
      <span style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}>
        {label}
      </span>
    </span>
  );
}

export const I = {
  plus: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  minus: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  ),
  close: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  chevLeft: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevRight: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  chevDown: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  check: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  bag: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 7h12l-1 13H7L6 7z" />
      <path d="M9 7a3 3 0 016 0" />
    </svg>
  ),
  clock: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  moto: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <path d="M9 17h6l1-6h3" />
      <path d="M4 9h4l3 4" />
    </svg>
  ),
  pin: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <path d="M12 22s7-6.5 7-12a7 7 0 00-14 0c0 5.5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  store: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1-5h16l1 5M3 9v11h18V9M3 9h18" />
      <path d="M8 13h4v5H8z" />
    </svg>
  ),
  whatsapp: (c = "#1FAF53", s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={c}>
      <path d="M12 2a10 10 0 00-8.6 15l-1.3 5 5.1-1.4A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3a8.2 8.2 0 116.9 3.7zm4.7-6.2c-.3-.1-1.5-.8-1.8-.9-.2-.1-.4-.1-.6.1s-.7.9-.8 1c-.1.2-.3.2-.6.1s-1.1-.4-2.1-1.3a7.9 7.9 0 01-1.5-1.8c-.2-.3 0-.4.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5s-.6-1.5-.8-2c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 00-.7.3c-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7 1.8 2.8 4.4 3.9 2.6.8 3.1.7 1.5-.6 1.7-1.2.2-1.1.2-1.2-.2-.2-.5-.3z" />
    </svg>
  ),
};
