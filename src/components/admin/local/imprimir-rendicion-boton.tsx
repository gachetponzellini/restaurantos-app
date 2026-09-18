"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { imprimirRendicion } from "@/lib/caja/rendicion-print-actions";
import { Button } from "@/components/ui/button";

/**
 * El papel de una rendición, a pedido (spec 178 · D1).
 *
 * No es optimista **a propósito**, igual que el del cierre: manda papel a una
 * impresora del local, y un «listo» que después no salió es peor que medio
 * segundo de espera. Misma frontera que la plata (spec 21).
 */
export function ImprimirRendicionBoton({
  slug,
  rendicionId,
  mozoName,
}: {
  slug: string;
  rendicionId: string;
  mozoName: string;
}) {
  const [enviando, startTransition] = useTransition();
  const [listo, setListo] = useState(false);

  return (
    <Button
      type="button"
      variant={listo ? "secondary" : "default"}
      size="sm"
      disabled={enviando}
      aria-label={`Imprimir rendición de ${mozoName}`}
      title={listo ? "Reimprimir" : "Imprimir el ticket"}
      onClick={() =>
        startTransition(async () => {
          const res = await imprimirRendicion(rendicionId, slug);
          if (res.ok) {
            setListo(true);
            toast.success(
              res.data.reimpresion
                ? `Rendición de ${mozoName} mandada de nuevo a la comandera.`
                : `Rendición de ${mozoName} mandada a la comandera.`,
            );
          } else {
            toast.error(res.error);
          }
        })
      }
    >
      <Printer className="size-3.5" />
      {enviando ? "Mandando…" : listo ? "Reimprimir" : "Imprimir"}
    </Button>
  );
}
