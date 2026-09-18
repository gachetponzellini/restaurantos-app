import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Spec 204 — la etiqueta chica en mayúsculas que encabeza una sección o un
 * campo. Una sola escala en vez de las cinco que había.
 */
export function SectionLabel({
  as: Tag = "p",
  icon,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: "p" | "span" | "label" | "h3" | "div";
  icon?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <Tag
      data-slot="section-label"
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </Tag>
  );
}
