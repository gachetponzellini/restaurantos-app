import { describe, expect, it } from "vitest";

import {
  ModifierGroupInput,
  ProductInput,
  StationPrinterInput,
  warnGarnishModifierGroups,
} from "./schemas";

describe("ModifierGroupInput — Punto de cocción", () => {
  const puntoDeCoccion: ModifierGroupInput = {
    name: "Punto de cocción",
    min_selection: 1,
    max_selection: 1,
    is_required: true,
    sort_order: 0,
    modifiers: [
      { name: "Jugoso", price_delta_cents: 0, is_available: true, sort_order: 0 },
      { name: "A punto", price_delta_cents: 0, is_available: true, sort_order: 1 },
      { name: "Cocido", price_delta_cents: 0, is_available: true, sort_order: 2 },
    ],
  };

  it("acepta un grupo válido de punto de cocción", () => {
    const result = ModifierGroupInput.safeParse(puntoDeCoccion);
    expect(result.success).toBe(true);
  });

  it("es obligatorio y de selección única", () => {
    const result = ModifierGroupInput.safeParse(puntoDeCoccion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_required).toBe(true);
      expect(result.data.min_selection).toBe(1);
      expect(result.data.max_selection).toBe(1);
    }
  });

  it("los 3 modificadores tienen price_delta_cents = 0", () => {
    const result = ModifierGroupInput.safeParse(puntoDeCoccion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modifiers).toHaveLength(3);
      for (const m of result.data.modifiers) {
        expect(m.price_delta_cents).toBe(0);
      }
    }
  });

  it("rechaza max_selection < min_selection", () => {
    const bad = { ...puntoDeCoccion, min_selection: 2, max_selection: 1 };
    const result = ModifierGroupInput.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("warnGarnishModifierGroups", () => {
  it('devuelve warning si un grupo se llama "Guarnición"', () => {
    const groups: ModifierGroupInput[] = [
      {
        name: "Guarnición",
        min_selection: 1,
        max_selection: 1,
        is_required: true,
        sort_order: 0,
        modifiers: [
          { name: "Papas fritas", price_delta_cents: 0, is_available: true, sort_order: 0 },
        ],
      },
    ];
    const warnings = warnGarnishModifierGroups(groups);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Guarnición");
  });

  it('devuelve warning si un grupo se llama "Guarniciones" (case-insensitive)', () => {
    const groups: ModifierGroupInput[] = [
      {
        name: "guarniciones",
        min_selection: 0,
        max_selection: 3,
        is_required: false,
        sort_order: 0,
        modifiers: [],
      },
    ];
    const warnings = warnGarnishModifierGroups(groups);
    expect(warnings).toHaveLength(1);
  });

  it("no genera warning para grupos normales", () => {
    const groups: ModifierGroupInput[] = [
      {
        name: "Punto de cocción",
        min_selection: 1,
        max_selection: 1,
        is_required: true,
        sort_order: 0,
        modifiers: [
          { name: "Jugoso", price_delta_cents: 0, is_available: true, sort_order: 0 },
        ],
      },
    ];
    const warnings = warnGarnishModifierGroups(groups);
    expect(warnings).toHaveLength(0);
  });
});

describe("StationPrinterInput — config de comandera por sector (spec 28)", () => {
  it("acepta IPv4 válida + puerto", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "192.168.10.50",
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.printer_ip).toBe("192.168.10.50");
      expect(r.data.printer_port).toBe(9100);
    }
  });

  it("acepta hostname válido", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "comandera-cocina.local",
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(true);
  });

  // Spec 181 · D3 — una impresora USB no tiene IP: es un nombre para el
  // spooler de la compu donde corre el agente.
  it("acepta un destino local `local:NOMBRE` (spec 181)", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "local:CONTROL-T1",
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(true);
  });

  it("un `local:` sin nombre, o con separadores de ruta, no pasa", () => {
    for (const malo of ["local:", "local:C:\\x", "local:a/b", "local: "]) {
      expect(
        StationPrinterInput.safeParse({
          printer_ip: malo,
          printer_port: 9100,
          printer_enabled: true,
        }).success,
        malo,
      ).toBe(false);
    }
  });

  it("recorta espacios alrededor de la IP", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "  192.168.10.50  ",
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.printer_ip).toBe("192.168.10.50");
  });

  it("normaliza IP vacía a null (sector sin impresora)", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "",
      printer_port: 9100,
      printer_enabled: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.printer_ip).toBeNull();
  });

  it("acepta printer_ip null", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: null,
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.printer_ip).toBeNull();
  });

  it("rechaza IPv4 con octeto fuera de rango", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "192.168.10.300",
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un host con caracteres inválidos", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "no es una ip",
      printer_port: 9100,
      printer_enabled: true,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza todo lo que no sea IP privada de LAN (SSRF cloud→red, security review #8)", () => {
    for (const host of [
      // loopback, metadata cloud / link-local, unspecified y multicast
      "127.0.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      // IPs públicas (allowlist private-only)
      "8.8.8.8",
      "1.1.1.1",
      "203.0.113.5",
      // nombres de loopback y formas de IP "empaquetada" (hex/octal)
      "localhost",
      "0x7f.0.0.1",
      "0177.0.0.1",
    ]) {
      const r = StationPrinterInput.safeParse({
        printer_ip: host,
        printer_port: 9100,
        printer_enabled: true,
      });
      expect(r.success, `${host} debería rechazarse`).toBe(false);
    }
  });

  it("sigue aceptando IPs privadas de LAN (donde viven las comanderas)", () => {
    for (const ip of ["192.168.10.50", "10.0.0.5", "172.16.4.20"]) {
      const r = StationPrinterInput.safeParse({
        printer_ip: ip,
        printer_port: 9100,
        printer_enabled: true,
      });
      expect(r.success, `${ip} debería aceptarse`).toBe(true);
    }
  });

  it("aplica el default de puerto 9100 cuando no viene", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "192.168.10.50",
      printer_enabled: true,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.printer_port).toBe(9100);
  });

  it("rechaza puerto fuera de 1–65535", () => {
    expect(
      StationPrinterInput.safeParse({
        printer_ip: "192.168.10.50",
        printer_port: 70000,
        printer_enabled: true,
      }).success,
    ).toBe(false);
    expect(
      StationPrinterInput.safeParse({
        printer_ip: "192.168.10.50",
        printer_port: 0,
        printer_enabled: true,
      }).success,
    ).toBe(false);
  });

  it("rechaza puerto no entero", () => {
    const r = StationPrinterInput.safeParse({
      printer_ip: "192.168.10.50",
      printer_port: 9100.5,
      printer_enabled: true,
    });
    expect(r.success).toBe(false);
  });
});
