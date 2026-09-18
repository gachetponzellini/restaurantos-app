"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

/**
 * Interruptor (spec 205). Para estados que se prenden y apagan en el momento
 * —«disponible», «en la carta online»— donde un checkbox se lee como «tildá y
 * después guardá».
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full bg-zinc-300 transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
        "data-checked:bg-emerald-600 data-disabled:cursor-default data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-4 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-transform data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
