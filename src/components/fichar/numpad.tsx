"use client";

import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

export function Numpad({
  onDigit,
  onDelete,
  disabled,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map((key, i) => {
        if (key === "") return <div key={`empty-${i}`} />;
        const isDelete = key === "⌫";
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            // El numpad no se queda con el foco: quien lo tiene es el diálogo,
            // que es el que escucha el teclado. Si no, después de tocar un
            // dígito con el dedo, el Enter del teclado repetía esa misma tecla.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (isDelete ? onDelete() : onDigit(key))}
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-2xl text-3xl font-semibold transition-all active:scale-95 disabled:opacity-40",
              isDelete
                ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                : "bg-zinc-800 text-white hover:bg-zinc-700",
            )}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
