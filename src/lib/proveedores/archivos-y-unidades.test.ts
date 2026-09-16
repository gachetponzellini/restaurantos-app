import { describe, expect, it } from "vitest";

import { clasificarArchivo, esHeic, TOPE_PDF_BYTES } from "./archivos";
import {
  aEnvases,
  aUnidades,
  precioDelEnvaseDesdeTotal,
  precioUnitarioCents,
  subtotalCents,
} from "./renglon-en-unidades";

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

/**
 * Spec 199 — «pongo 5 kilos y el total, 58 mil, y me suma 290 mil».
 */
describe("se carga el total, no el precio — spec 199", () => {
  it("5 kg por $58.000 son $11.600 el kg, no $290.000", () => {
    expect(precioUnitarioCents(58_000_00, 5)).toBe(11_600_00);
  });

  it("lo guardado: 25 panes de 200 g a $2.320, que suman exacto $58.000", () => {
    const { units } = aEnvases("unidad", 5, 0, 0.2);
    const precio = precioDelEnvaseDesdeTotal(58_000_00, units);
    expect(units).toBe(25);
    expect(precio).toBe(2_320_00);
    expect(subtotalCents(units, precio)).toBe(58_000_00);
  });

  it("en kg o en envases se guarda lo mismo", () => {
    const enKg = precioDelEnvaseDesdeTotal(58_000_00, aEnvases("unidad", 5, 0, 0.2).units);
    const enPanes = precioDelEnvaseDesdeTotal(58_000_00, aEnvases("envase", 25, 0, 0.2).units);
    expect(enKg).toBe(enPanes);
    // y el pan se muestra a $2.320
    expect(precioUnitarioCents(58_000_00, 25)).toBe(2_320_00);
  });

  /**
   * D2 · la división que no es exacta. El precio del envase se redondea al
   * centavo y el recalculado queda a centavos del total: por eso la pantalla
   * muestra el total tipeado.
   */
  it("3 kg por $10.000: $3.333,33 el kg, y el envase redondeado al centavo", () => {
    expect(precioUnitarioCents(10_000_00, 3)).toBe(3_333_33);
    const units = aEnvases("unidad", 3, 0, 0.2).units;
    const precio = precioDelEnvaseDesdeTotal(10_000_00, units);
    expect(precio).toBe(66_667);
    expect(Math.abs(subtotalCents(units, precio) - 10_000_00)).toBeLessThanOrEqual(units);
  });

  it("sin cantidad no hay precio que mostrar, ni envase que cobrar", () => {
    expect(precioUnitarioCents(58_000_00, 0)).toBeNull();
    expect(precioDelEnvaseDesdeTotal(58_000_00, 0)).toBe(0);
  });
});
