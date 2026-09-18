import { cn } from "@/lib/utils";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  encargado: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  mozo: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  terminal: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  personal: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  encargado: "Encargado",
  mozo: "Mozo",
  terminal: "Terminal",
  personal: "Personal",
};

export function RoleBadge({
  role,
  size = "sm",
  className,
}: {
  role: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold capitalize",
        size === "xs"
          ? "px-1.5 py-0.5 text-[0.6rem]"
          : "px-2 py-0.5 text-[0.7rem]",
        ROLE_COLORS[role] ?? "bg-muted text-foreground/80 ring-1 ring-border",
        className,
      )}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

export function roleBadgeColor(role: string): string {
  return (
    ROLE_COLORS[role] ?? "bg-muted text-foreground/80 ring-1 ring-border"
  );
}
