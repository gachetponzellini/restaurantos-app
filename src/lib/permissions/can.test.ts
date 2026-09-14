import { describe, expect, it } from "vitest";

import {
  canEmpezarComanda,
  DESCUENTO_BAJO_PCT,
  DESCUENTO_MEDIO_PCT,
  DIFERENCIA_CAJA_OK_CENTS,
  canAcceptCajaDifference,
  canAnularFactura,
  canGestionarEntidadesFiscales,
  canApplyDiscount,
  canCancelItem,
  canAssignMozo,
  canCargarPedido,
  canCargarPedidoMesa,
  canConfirmOrder,
  canCorregirCobro,
  canEditarAsistencia,
  canCrearPedidoFlash,
  canHacerCorte,
  canMakeSangria,
  canConfigureReservations,
  canManageCajas,
  canManageReservations,
  canMarkRotura,
  canMoveTable,
  canModifyPostEnvio,
  canCargarItemLibre,
  canOverrideItemPrice,
  canDecideReservation,
  canRendirMozo,
  canSeatReservation,
  canTransferTable,
  canTransitionMesa,
} from "./can";

describe("canEmpezarComanda (spec 182)", () => {
  it("empezar una comanda es de cocina: admin y encargado", () => {
    expect(canEmpezarComanda("admin")).toBe(true);
    expect(canEmpezarComanda("encargado")).toBe(true);
  });

  it("la terminal mira el tablero y entrega, pero no empieza", () => {
    expect(canEmpezarComanda("terminal")).toBe(false);
  });

  it("el mozo tampoco (ni ve el kanban)", () => {
    expect(canEmpezarComanda("mozo")).toBe(false);
    expect(canEmpezarComanda("personal")).toBe(false);
  });
});

describe("permissions / canMoveTable", () => {
  it("solo admin y encargado pueden trasladar una mesa (spec 048)", () => {
    expect(canMoveTable("admin")).toBe(true);
    expect(canMoveTable("encargado")).toBe(true);
    expect(canMoveTable("mozo")).toBe(false);
  });
});

describe("permissions / canModifyPostEnvio", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canModifyPostEnvio("admin")).toBe(true);
    expect(canModifyPostEnvio("encargado")).toBe(true);
    expect(canModifyPostEnvio("mozo")).toBe(false);
  });
});

describe("permissions / canCancelItem", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canCancelItem("admin")).toBe(true);
    expect(canCancelItem("encargado")).toBe(true);
    expect(canCancelItem("mozo")).toBe(false);
  });
});

describe("permissions / canOverrideItemPrice", () => {
  it("admin y encargado pueden, mozo y personal no", () => {
    expect(canOverrideItemPrice("admin")).toBe(true);
    expect(canOverrideItemPrice("encargado")).toBe(true);
    expect(canOverrideItemPrice("mozo")).toBe(false);
    expect(canOverrideItemPrice("personal")).toBe(false);
  });
});

describe("permissions / canCargarItemLibre", () => {
  it("admin y encargado pueden, mozo y personal no (spec 174)", () => {
    expect(canCargarItemLibre("admin")).toBe(true);
    expect(canCargarItemLibre("encargado")).toBe(true);
    expect(canCargarItemLibre("mozo")).toBe(false);
    expect(canCargarItemLibre("personal")).toBe(false);
    expect(canCargarItemLibre("terminal")).toBe(false);
  });
});

describe("permissions / canMarkRotura", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canMarkRotura("admin")).toBe(true);
    expect(canMarkRotura("encargado")).toBe(true);
    expect(canMarkRotura("mozo")).toBe(false);
  });
});

describe("permissions / canApplyDiscount", () => {
  it("admin acepta cualquier porcentaje no negativo", () => {
    expect(canApplyDiscount("admin", 0)).toBe(true);
    expect(canApplyDiscount("admin", 25)).toBe(true);
    expect(canApplyDiscount("admin", 99)).toBe(true);
  });

  it("admin rechaza descuentos negativos", () => {
    expect(canApplyDiscount("admin", -1)).toBe(false);
  });

  it("encargado de caja: borde exacto en 25% acepta", () => {
    expect(canApplyDiscount("encargado", DESCUENTO_MEDIO_PCT)).toBe(true);
    expect(canApplyDiscount("encargado", 24.99)).toBe(true);
  });

  it("encargado de caja: por encima de 25% rechaza", () => {
    expect(canApplyDiscount("encargado", 25.0001)).toBe(false);
    expect(canApplyDiscount("encargado", 30)).toBe(false);
    expect(canApplyDiscount("encargado", 100)).toBe(false);
  });

  it("mozo: borde exacto en 10% acepta", () => {
    expect(canApplyDiscount("mozo", DESCUENTO_BAJO_PCT)).toBe(true);
    expect(canApplyDiscount("mozo", 9.99)).toBe(true);
    expect(canApplyDiscount("mozo", 0)).toBe(true);
  });

  it("mozo: por encima de 10% rechaza", () => {
    expect(canApplyDiscount("mozo", 10.0001)).toBe(false);
    expect(canApplyDiscount("mozo", 11)).toBe(false);
    expect(canApplyDiscount("mozo", 25)).toBe(false);
  });
});

describe("permissions / canManageCajas", () => {
  it("solo admin puede", () => {
    expect(canManageCajas("admin")).toBe(true);
    expect(canManageCajas("encargado")).toBe(false);
    expect(canManageCajas("mozo")).toBe(false);
  });
});

describe("permissions / canHacerCorte", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canHacerCorte("admin")).toBe(true);
    expect(canHacerCorte("encargado")).toBe(true);
    expect(canHacerCorte("mozo")).toBe(false);
  });
});

describe("permissions / canCorregirCobro", () => {
  it("admin y encargado pueden, mozo y personal no", () => {
    expect(canCorregirCobro("admin")).toBe(true);
    expect(canCorregirCobro("encargado")).toBe(true);
    expect(canCorregirCobro("mozo")).toBe(false);
    expect(canCorregirCobro("personal")).toBe(false);
  });
});

describe("permissions / canAcceptCajaDifference", () => {
  it("admin acepta cualquier diferencia", () => {
    expect(canAcceptCajaDifference("admin", 0)).toBe(true);
    expect(canAcceptCajaDifference("admin", 100_000_000)).toBe(true);
    expect(canAcceptCajaDifference("admin", -100_000_000)).toBe(true);
  });

  it("encargado: borde exacto en $5000 (positivo) acepta", () => {
    expect(canAcceptCajaDifference("encargado", DIFERENCIA_CAJA_OK_CENTS)).toBe(
      true,
    );
  });

  it("encargado: borde exacto en -$5000 (faltante) acepta", () => {
    expect(
      canAcceptCajaDifference("encargado", -DIFERENCIA_CAJA_OK_CENTS),
    ).toBe(true);
  });

  it("encargado: $5000.01 rechaza (sobrante)", () => {
    expect(
      canAcceptCajaDifference("encargado", DIFERENCIA_CAJA_OK_CENTS + 1),
    ).toBe(false);
  });

  it("encargado: -$5000.01 rechaza (faltante)", () => {
    expect(
      canAcceptCajaDifference("encargado", -(DIFERENCIA_CAJA_OK_CENTS + 1)),
    ).toBe(false);
  });

  it("mozo siempre rechaza", () => {
    expect(canAcceptCajaDifference("mozo", 0)).toBe(false);
    expect(canAcceptCajaDifference("mozo", 1000)).toBe(false);
  });
});

describe("permissions / canMakeSangria", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canMakeSangria("admin")).toBe(true);
    expect(canMakeSangria("encargado")).toBe(true);
    expect(canMakeSangria("mozo")).toBe(false);
  });
});

describe("permissions / canRendirMozo", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canRendirMozo("admin")).toBe(true);
    expect(canRendirMozo("encargado")).toBe(true);
    expect(canRendirMozo("mozo")).toBe(false);
  });
});

describe("permissions / canAnularFactura", () => {
  it("admin y encargado pueden anular, mozo y personal no", () => {
    expect(canAnularFactura("admin")).toBe(true);
    expect(canAnularFactura("encargado")).toBe(true);
    expect(canAnularFactura("mozo")).toBe(false);
    expect(canAnularFactura("personal")).toBe(false);
  });
});

describe("permissions / canGestionarEntidadesFiscales", () => {
  it("el encargado factura, así que gestiona receptores; el mozo no", () => {
    expect(canGestionarEntidadesFiscales("admin")).toBe(true);
    expect(canGestionarEntidadesFiscales("encargado")).toBe(true);
    expect(canGestionarEntidadesFiscales("mozo")).toBe(false);
    expect(canGestionarEntidadesFiscales("terminal")).toBe(false);
    expect(canGestionarEntidadesFiscales("personal")).toBe(false);
  });
});

describe("permissions / canCrearPedidoFlash", () => {
  it("admin y encargado (mostrador) pueden, mozo y personal no", () => {
    expect(canCrearPedidoFlash("admin")).toBe(true);
    expect(canCrearPedidoFlash("encargado")).toBe(true);
    expect(canCrearPedidoFlash("mozo")).toBe(false);
    expect(canCrearPedidoFlash("personal")).toBe(false);
  });
});

describe("permissions / canCargarPedido", () => {
  it("admin y encargado (mostrador) pueden cargar pedidos, mozo y personal no (spec 054, fase 1)", () => {
    expect(canCargarPedido("admin")).toBe(true);
    expect(canCargarPedido("encargado")).toBe(true);
    expect(canCargarPedido("mozo")).toBe(false);
    expect(canCargarPedido("personal")).toBe(false);
  });
});

describe("permissions / canManageReservations", () => {
  it("admin, encargado y mozo pueden; personal no", () => {
    expect(canManageReservations("admin")).toBe(true);
    expect(canManageReservations("encargado")).toBe(true);
    expect(canManageReservations("mozo")).toBe(true);
    expect(canManageReservations("personal")).toBe(false);
  });

  it("sin membership (null) no puede", () => {
    expect(canManageReservations(null)).toBe(false);
  });

  it("canSeatReservation es alias de canManageReservations", () => {
    expect(canSeatReservation("mozo")).toBe(true);
    expect(canSeatReservation("personal")).toBe(false);
  });
});

describe("permissions / canConfigureReservations", () => {
  it("admin y encargado configuran; mozo y personal no", () => {
    expect(canConfigureReservations("admin")).toBe(true);
    expect(canConfigureReservations("encargado")).toBe(true);
    expect(canConfigureReservations("mozo")).toBe(false);
    expect(canConfigureReservations("personal")).toBe(false);
  });

  it("sin membership (null) no puede", () => {
    expect(canConfigureReservations(null)).toBe(false);
  });
});

// ── Spec 140 · el rol `terminal` ────────────────────────────────────────
//
// La terminal es el puesto compartido del salón, no una persona. Opera el
// salón entero (cualquier mesa, no "la suya") pero no toca nada de plata de
// supervisión: ni cortes, ni sangrías, ni correcciones, ni anulaciones.

describe("permissions / rol terminal (spec 140)", () => {
  it("opera el salón: carga pedidos de mesa, transfiere cualquier mesa y asigna mozos", () => {
    expect(canCargarPedidoMesa("terminal")).toBe(true);
    expect(canTransferTable("terminal", false, false)).toBe(true);
    expect(canAssignMozo("terminal")).toBe(true);
    expect(canManageReservations("terminal")).toBe(true);
  });

  it("transfiere sin ser origen ni reclamar para sí — a diferencia del mozo", () => {
    // El mozo necesita una de las dos; la terminal no tiene mesas propias.
    expect(canTransferTable("mozo", false, false)).toBe(false);
    expect(canTransferTable("terminal", false, false)).toBe(true);
  });

  it("no toca la plata de supervisión", () => {
    expect(canHacerCorte("terminal")).toBe(false);
    expect(canMakeSangria("terminal")).toBe(false);
    expect(canCorregirCobro("terminal")).toBe(false);
    expect(canRendirMozo("terminal")).toBe(false);
    expect(canAcceptCajaDifference("terminal", 1)).toBe(false);
    expect(canManageCajas("terminal")).toBe(false);
  });

  it("no anula ni corrige lo ya enviado", () => {
    expect(canCancelItem("terminal")).toBe(false);
    expect(canModifyPostEnvio("terminal")).toBe(false);
    expect(canMarkRotura("terminal")).toBe(false);
    expect(canOverrideItemPrice("terminal")).toBe(false);
    expect(canAnularFactura("terminal")).toBe(false);
    expect(canTransitionMesa("terminal", "ocupada", "libre")).toBe(false);
  });

  it("sí carga la venta de mostrador: el de la barra no tiene mesa", () => {
    // Decisión de Juan 2026-09-02 — en la 140 había quedado afuera. Es el mismo
    // permiso que gobierna «Venta rápida» en el plano (kiosko/barra, sin mesa).
    expect(canCargarPedido("terminal")).toBe(true);
  });

  it("pero no confirma los pedidos que entran solos ni factura por monto", () => {
    // La cola de delivery/take-away del canal digital sigue siendo del
    // encargado: decidir si un pedido online entra a cocina no es del salón.
    expect(canConfirmOrder("terminal")).toBe(false);
    expect(canCrearPedidoFlash("terminal")).toBe(false);
  });

  it("aplica el mismo descuento que el mozo, no el del encargado", () => {
    expect(canApplyDiscount("terminal", DESCUENTO_BAJO_PCT)).toBe(true);
    expect(canApplyDiscount("terminal", DESCUENTO_BAJO_PCT + 1)).toBe(false);
    expect(canApplyDiscount("terminal", DESCUENTO_MEDIO_PCT)).toBe(false);
  });

  it("no decide ni configura reservas, sólo las gestiona", () => {
    expect(canDecideReservation("terminal")).toBe(false);
    expect(canConfigureReservations("terminal")).toBe(false);
  });

  it("no cambia nada para el mozo: sigue con las reglas de su mesa", () => {
    expect(canCargarPedidoMesa("mozo")).toBe(true);
    expect(canTransferTable("mozo", true, false)).toBe(true);
    expect(canTransferTable("mozo", false, true)).toBe(true);
    expect(canAssignMozo("mozo")).toBe(false);
  });

  it("`personal` sigue sin operar nada", () => {
    expect(canCargarPedidoMesa("personal")).toBe(false);
    expect(canTransferTable("personal", true, true)).toBe(false);
    expect(canAssignMozo("personal")).toBe(false);
  });
});

// ── Spec 179 · corregir asistencias ─────────────────────────────────────
describe("permissions / canEditarAsistencia (spec 179)", () => {
  it("encargado y admin corrigen: es sueldo, mismo círculo que la caja", () => {
    expect(canEditarAsistencia("admin")).toBe(true);
    expect(canEditarAsistencia("encargado")).toBe(true);
  });

  it("mozo, personal y terminal no", () => {
    expect(canEditarAsistencia("mozo")).toBe(false);
    expect(canEditarAsistencia("personal")).toBe(false);
    // La terminal es una cuenta compartida: el rastro diría «terminal».
    expect(canEditarAsistencia("terminal")).toBe(false);
  });
});
