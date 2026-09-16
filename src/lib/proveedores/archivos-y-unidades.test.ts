import { describe, expect, it } from "vitest";

import { clasificarArchivo, esHeic, TOPE_PDF_BYTES } from "./archivos";
import { aEnvases, aUnidades, subtotalCents } from "./renglon-en-unidades";

const archivo = (name: string, type = "", size = 500_000) => ({ name, type, size });

describe("clasificarArchivo — spec 198·D1", () => {
  it("la foto normal es imagen", () => {
    expect(clasificarArchivo(archivo("factura.jpg", "image/jpeg"))).toEqual({
      ok: true,
      tipo: "imagen",
    });
  });

  /** Lo que tiraba el filtro viejo: el PDF de la factura electrónica. */
  it("el PDF entra", () => {
    expect(clasificarArchivo(archivo("lacteos.pdf", "application/pdf"))).toEqual({
      ok: true,
      tipo: "pdf",
    });
  });

  it("el PDF bajado de WhatsApp sin tipo entra por la extensión", () => {
    expect(clasificarArchivo(archivo("Factura 0003-00012.PDF", "application/octet-stream"))).toEqual({
      ok: true,
      tipo: "pdf",
    });
  });

  it("el PDF de más de 10 MB se rechaza con motivo", () => {
    const r = clasificarArchivo(archivo("pesado.pdf", "application/pdf", TOPE_PDF_BYTES + 1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/10 MB/);
  });

  /**
   * El otro caso que se tiraba callado: Chrome en Windows reporta la HEIC de un
   * iPhone con tipo vacío. Entra como imagen — si el navegador después no la
   * puede abrir, lo dice el uploader.
   */
  it("la HEIC con tipo vacío entra por la extensión", () => {
    expect(clasificarArchivo(archivo("IMG_4021.HEIC", ""))).toEqual({ ok: true, tipo: "imagen" });
    expect(esHeic(archivo("IMG_4021.HEIC", ""))).toBe(true);
    expect(esHeic(archivo("x.jpg", "image/heif"))).toBe(true);
    expect(esHeic(archivo("x.jpg", "image/jpeg"))).toBe(false);
  });

  it("lo que no es foto ni PDF se rechaza, nunca en silencio", () => {
    const r = clasificarArchivo(archivo("planilla.xlsx", "application/vnd.ms-excel"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo.length).toBeGreaterThan(0);
  });
});

describe("el renglón en kilos — spec 198·D5", () => {
  /** El escenario 6: la manteca en pan de 200 g, cargada en kilos. */
  it("2,9 kg a $7.250 son 14,5 panes de 200 g a $1.450", () => {
    expect(aEnvases("unidad", 2.9, 7_250_00, 0.2)).toEqual({
      units: 14.5,
      unitCostCents: 1_450_00,
    });
  });

  it("el subtotal es el mismo en kilos que en envases", () => {
    const { units, unitCostCents } = aEnvases("unidad", 2.9, 7_250_00, 0.2);
    expect(subtotalCents(units, unitCostCents)).toBe(21_025_00);
    expect(subtotalCents(units, unitCostCents)).toBe(Math.round(2.9 * 7_250_00));
  });

  it("la vuelta muestra lo que se tipeó", () => {
    expect(aUnidades("unidad", 14.5, 1_450_00, 0.2)).toEqual({
      cantidad: 2.9,
      precioCents: 7_250_00,
    });
  });

  it("la crema en sachet de litro", () => {
    expect(aEnvases("unidad", 12, 3_100_00, 1)).toEqual({ units: 12, unitCostCents: 3_100_00 });
  });

  it("en envase no convierte nada", () => {
    expect(aEnvases("envase", 3, 45_000_00, 5)).toEqual({ units: 3, unitCostCents: 45_000_00 });
    expect(aUnidades("envase", 3, 45_000_00, 5)).toEqual({ cantidad: 3, precioCents: 45_000_00 });
  });

  /** Sin envase la cantidad ya es unidad base: la rama que ya existía. */
  it("un insumo sin envase no convierte", () => {
    expect(aEnvases("unidad", 2.9, 7_250_00, null)).toEqual({
      units: 2.9,
      unitCostCents: 7_250_00,
    });
    expect(aEnvases("unidad", 2.9, 7_250_00, 0)).toEqual({ units: 2.9, unitCostCents: 7_250_00 });
  });

  it("el caso de oro de la 172 da lo mismo que el lector", () => {
    // 82,600 kg a $17.500, envase de 10 kg → 8,26 envases a $175.000
    expect(aEnvases("unidad", 82.6, 17_500_00, 10)).toEqual({
      units: 8.26,
      unitCostCents: 175_000_00,
    });
  });
});
