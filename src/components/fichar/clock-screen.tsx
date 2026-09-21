"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { clockPunch, type PresentEmployee } from "@/lib/rrhh/clock-actions";

import { ClockFeedback, type FeedbackState } from "./clock-feedback";
import { PresentList } from "./present-list";
import { TZ_AR } from "@/lib/timezone";

function useLiveClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("es-AR", {
      timeZone: TZ_AR,
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  useEffect(() => {
    const id = setInterval(
      () =>
        setTime(
          new Date().toLocaleTimeString("es-AR", {
            timeZone: TZ_AR,
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return time;
}

export function ClockScreen({
  slug,
  initialPresent,
}: {
  slug: string;
  initialPresent: PresentEmployee[];
}) {
  const [pin, setPin] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>({ status: "idle" });
  const [present, setPresent] = useState(initialPresent);
  const liveClock = useLiveClock();
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePinChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (feedback.status === "loading") return;
      if (feedback.status !== "idle") {
        setFeedback({ status: "idle" });
      }
      setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
    },
    [feedback.status],
  );

  // Kiosco: el input debe quedar siempre listo para el próximo PIN.
  useEffect(() => {
    if (feedback.status !== "loading") inputRef.current?.focus();
  }, [feedback.status]);

  useEffect(() => {
    if (pin.length < 4) return;

    setFeedback({ status: "loading" });

    clockPunch(slug, pin).then((r) => {
      if (!r.ok) {
        setFeedback({ status: "error", message: r.error });
      } else {
        setFeedback({ status: "success", result: r.data });
        if (r.data.type === "in") {
          setPresent((prev) => [
            ...prev,
            {
              userId: "",
              name: r.data.employeeName,
              role: "",
              clockIn: r.data.time,
            },
          ]);
        } else {
          setPresent((prev) =>
            prev.filter(
              (p) =>
                p.name.toLowerCase() !== r.data.employeeName.toLowerCase(),
            ),
          );
        }
      }
      setPin("");
      setTimeout(() => setFeedback({ status: "idle" }), 3000);
    });
  }, [pin, slug]);

  const pinSection = (
    <div className="flex flex-col items-center gap-2">
      {/* Live clock */}
      <p className="text-2xl font-bold tabular-nums text-white/90">
        {liveClock}
      </p>

      {/* Header */}
      <div className="flex items-center gap-1.5 text-zinc-400">
        <Clock className="size-3.5" />
        <span className="text-xs font-semibold uppercase tracking-wider">
          Fichada
        </span>
      </div>

      {/* PIN input */}
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoFocus
        maxLength={4}
        value={pin}
        onChange={handlePinChange}
        disabled={feedback.status === "loading"}
        placeholder="····"
        aria-label="PIN"
        className="mt-1 w-36 rounded-xl border-2 border-zinc-700 bg-zinc-900 py-2 text-center text-2xl font-bold tracking-[0.4em] text-white outline-none placeholder:text-zinc-700 focus:border-white disabled:opacity-40"
      />

      {/* Feedback */}
      <div className="h-14 w-full">
        <ClockFeedback feedback={feedback} size="md" />
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-950 text-white landscape:flex-row">
      {/* Portrait: single column. Landscape: two columns */}
      <div className="flex shrink-0 flex-col items-center justify-center p-3 landscape:h-full landscape:w-1/2">
        <div className="w-full max-w-xs">{pinSection}</div>
      </div>

      {/* Present list — below in portrait, right side in landscape. Scrollea internamente, la pantalla nunca scrollea. */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-800 p-3 landscape:h-full landscape:w-1/2 landscape:border-l landscape:border-t-0">
        <div className="mx-auto max-w-xs landscape:max-w-none">
          <PresentList present={present} />
        </div>
      </div>
    </div>
  );
}
