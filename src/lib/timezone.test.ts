import { describe, expect, it } from "vitest";

import { formatFechaAR } from "./timezone";

// Una columna `date` (ej. `invoices.cae_vencimiento`) llega como "YYYY-MM-DD".
// `new Date("2026-08-20")` es medianoche UTC = 19/08 21:00 en AR: formatearla
// como instante la corría un día para atrás — en el ticket fiscal impreso.
describe("formatFechaAR", () => {
  it("una fecha sin hora es ese día, en cualquier zona del proceso", () => {
    expect(formatFechaAR("2026-08-20")).toBe("20/08/2026");
  });

  it("un timestamp se muestra en día argentino", () => {
    expect(formatFechaAR("2026-08-21T02:30:00Z")).toBe("20/08/2026"); // 23:30 AR del 20
    expect(formatFechaAR("2026-08-14T00:00:00-03:00")).toBe("14/08/2026");
  });

  it("basura o vacío → cadena vacía", () => {
    expect(formatFechaAR("")).toBe("");
    expect(formatFechaAR("no-es-fecha")).toBe("");
  });
});
