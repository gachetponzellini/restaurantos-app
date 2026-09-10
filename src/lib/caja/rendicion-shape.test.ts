import { describe, expectTypeOf, it } from "vitest";

import type { ActionResult } from "@/lib/actions";

// `import type` a propósito: verificamos la FORMA del contrato sin ejecutar la
// action (que toca la DB) ni arrastrar sus deps server-only al test. Las
// aserciones de `expectTypeOf` las valida `pnpm typecheck` (tsc --noEmit cubre
// `**/*.ts`); bajo `vitest run` son no-ops que pasan.
import type { registrarRendicionMozo } from "./actions";
import type { MozoRendicion } from "./types";

type RendicionResult = Awaited<ReturnType<typeof registrarRendicionMozo>>;

describe("registrarRendicionMozo — forma del ActionResult (spec 39, FR-014)", () => {
  it("el resultado es un ActionResult con la fila y la propina pagada", () => {
    // spec 177 · Parte B — la rendición además paga la propina del período, y
    // devolver cuánto es lo que deja al modal decirlo sin volver a consultar.
    expectTypeOf<RendicionResult>().toEqualTypeOf<
      ActionResult<{
        rendicion: MozoRendicion;
        propina_pagada_cents: number;
      }>
    >();
  });

  it("la rama de éxito incluye la fila mutada tipada (no void/null)", () => {
    type SuccessData = Extract<RendicionResult, { ok: true }>["data"];
    expectTypeOf<SuccessData["rendicion"]>().toEqualTypeOf<MozoRendicion>();
  });
});
