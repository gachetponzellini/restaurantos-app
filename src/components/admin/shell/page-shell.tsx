import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Width = "narrow" | "default" | "wide";

const WIDTHS: Record<Width, string> = {
  narrow: "max-w-4xl",
  default: "max-w-6xl",
  wide: "max-w-[1400px]",
};

export function PageShell({
  children,
  width = "default",
  className,
}: {
  children: ReactNode;
  width?: Width;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto w-full space-y-8 px-4 py-10 sm:px-6 lg:px-10",
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  back,
  size = "default",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label?: string };
  size?: "default" | "compact";
}) {
  const titleCls =
    size === "compact"
      ? "mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
      : "mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-5xl";

  return (
    <header className="space-y-3">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} />
          {back.label ?? "Volver"}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className={titleCls}>{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm text-foreground/70">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

type SurfaceProps = ComponentPropsWithoutRef<"section"> & {
  tone?: "default" | "subtle" | "accent";
  padding?: "default" | "compact" | "flush";
};

export function Surface({
  children,
  className,
  tone = "default",
  padding = "default",
  ...rest
}: SurfaceProps) {
  return (
    <section
      {...rest}
      className={cn(
        "rounded-2xl",
        tone === "default" && "bg-card ring-1 ring-border/70",
        tone === "subtle" &&
          "bg-muted/35 ring-1 ring-border/60 backdrop-blur-sm",
        tone === "accent" &&
          "bg-primary text-primary-foreground ring-1 ring-primary",
        padding === "default" && "p-6",
        padding === "compact" && "p-5",
        padding === "flush" && "p-0",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SurfaceHeader({
  eyebrow,
  title,
  description,
  action,
  tone = "default",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p
            className={cn(
              "text-[0.65rem] font-semibold uppercase tracking-[0.14em]",
              tone === "accent" ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2
          className={cn(
            "mt-1 text-xl font-semibold tracking-tight",
            tone === "accent" ? "text-primary-foreground" : "text-foreground",
          )}
        >
          {title}
        </h2>
        {description ? (
          <p
            className={cn(
              "mt-1 max-w-xl text-sm",
              tone === "accent" ? "text-muted-foreground/70" : "text-foreground/70",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </header>
  );
}

export function SectionDivider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-border/70" />
      {label ? (
        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
      ) : null}
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}
