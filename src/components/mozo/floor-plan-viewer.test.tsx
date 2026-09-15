import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DELAY_COLORS } from "@/lib/comandas/mesa-demora";
import type { FloorTable } from "@/lib/reservations/types";

import { FloorPlanViewer, type TableExtra } from "./floor-plan-viewer";

const plan = {
  width: 500,
  height: 500,
  background_image_url: null,
  background_opacity: 100,
};

function makeTable(p: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    floor_plan_id: "fp1",
    label: "12",
    seats: 4,
    shape: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: "active",
    created_at: "2026-06-25T00:00:00Z",
    operational_status: "ocupada",
    ...p,
  };
}

/** Puntos de demora presentes (circles pintados con un color de nivel ≥ 1). */
function delayDots(container: HTMLElement): Element[] {
  const colors = DELAY_COLORS.slice(1); // sacamos el nivel 0 ("")
  return Array.from(container.querySelectorAll("circle")).filter((c) =>
    colors.includes(c.getAttribute("fill") ?? ""),
  );
}

describe("FloorPlanViewer — punto de demora (spec 30)", () => {
  it("dibuja el punto del nivel sin tocar el fill de estado", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 3, excessMinutes: 35, station: "Parrilla" } },
    };
    const { container } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );

    // Punto nivel 3 (rojo) presente.
    expect(
      container.querySelector(`circle[fill="${DELAY_COLORS[3]}"]`),
    ).not.toBeNull();
    // La mesa conserva su fill de estado (ocupada = verde), no se repinta.
    expect(container.querySelector('rect[fill="#d1fae5"]')).not.toBeNull();
  });

  it("sin demora (sin delayLevel) no dibuja punto", () => {
    const { container } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable()]}
        extras={{ t1: {} }}
      />,
    );
    expect(delayDots(container)).toHaveLength(0);
  });

  it("nivel 0 explícito tampoco pinta punto (margen de gracia)", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 0, excessMinutes: 5, station: "Cocina" } },
    };
    const { container } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );
    expect(delayDots(container)).toHaveLength(0);
  });

  it("en paint mode no muestra el punto de demora", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 4, excessMinutes: 50, station: "Parrilla" } },
    };
    const { container } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable()]}
        extras={extras}
        paintMode
      />,
    );
    expect(delayDots(container)).toHaveLength(0);
  });

  it("al hacer hover sobre el punto muestra sector + minutos de demora", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 3, excessMinutes: 23, station: "Parrilla" } },
    };
    const { container, queryByText } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );
    // Sin hover no hay tooltip…
    expect(queryByText("Parrilla")).toBeNull();
    // …al pararse encima del punto aparece con el sector + el exceso real.
    const dot = container.querySelector(`circle[fill="${DELAY_COLORS[3]}"]`);
    expect(dot).not.toBeNull();
    fireEvent.mouseEnter(dot!);
    expect(queryByText("Parrilla")).not.toBeNull();
    expect(queryByText("+23 min de demora")).not.toBeNull();
  });

  // Spec 193 — en SVG no hay z-index: manda el orden de pintado. El globo
  // dibujado dentro del `<g>` de su mesa quedaba tapado por la mesa de al lado.
  it("el globo se pinta después de todas las mesas, no adentro de la suya", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 3, excessMinutes: 23, station: "Parrilla" } },
    };
    const { container, getByText } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable(), makeTable({ id: "t2", label: "13", x: 120 })]}
        extras={extras}
      />,
    );
    fireEvent.mouseEnter(
      container.querySelector(`circle[fill="${DELAY_COLORS[3]}"]`)!,
    );

    const svg = container.querySelector("svg")!;
    const hijos = [...svg.children];
    const globo = getByText("Parrilla").closest("g")!;
    const mesaVecina = getByText("13").closest("g")!;
    const indiceDe = (el: Element) =>
      hijos.findIndex((h) => h === el || h.contains(el));

    expect(indiceDe(globo)).toBeGreaterThan(indiceDe(mesaVecina));
  });
});

describe("FloorPlanViewer — el mozo de la mesa", () => {
  it("escribe el nombre ADENTRO de la mesa, no un círculo con iniciales", () => {
    const extras: Record<string, TableExtra> = {
      t1: { mozoLabel: "Juan B.", mozoColor: "#6366f1", mozoInk: "#4338ca" },
    };
    const { container, getByText } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );

    const nombre = getByText("Juan B.");
    const y = Number(nombre.getAttribute("y"));
    // Adentro del dibujo (la mesa va de y=0 a y=100), no colgando abajo: ahí
    // se mezclaba con la mesa de la fila siguiente.
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(100);
    // Y debajo del número, que sigue siendo el renglón que manda.
    expect(y).toBeGreaterThan(Number(getByText("12").getAttribute("y")));
    // Con el color del mozo, el mismo que su punto en la leyenda.
    expect(nombre.getAttribute("fill")).toBe("#4338ca");
    // El badge viejo (círculo con las iniciales) no está más.
    expect(container.querySelector('circle[fill="#6366f1"]')).toBeNull();
  });

  it("en una mesa chica recorta el nombre en vez de desbordarla", () => {
    const extras: Record<string, TableExtra> = { t1: { mozoLabel: "Antonella" } };
    const { getByText, queryByText } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable({ width: 35, height: 35 })]}
        extras={extras}
      />,
    );

    // 35 pt de ancho (las del Jardín de KCC) no dan para "Antonella".
    expect(queryByText("Antonella")).toBeNull();
    expect(getByText("Anton…")).not.toBeNull();
  });

  it("una mesa girada no deja el nombre acostado", () => {
    const extras: Record<string, TableExtra> = { t1: { mozoLabel: "Sofía" } };
    const { getByText } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable({ rotation: 90 })]}
        extras={extras}
      />,
    );

    // El nombre cuelga del grupo que ubica la mesa, no del que la rota.
    const grupo = getByText("Sofía").closest("g")!;
    expect(grupo.getAttribute("transform")).not.toContain("rotate");
  });

  it("mesa sin mozo asignado: sin rótulo", () => {
    const { container } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable()]}
        extras={{ t1: {} }}
      />,
    );
    // Sólo el label de la mesa; ningún texto extra colgando abajo.
    const textos = Array.from(container.querySelectorAll("text")).map(
      (t) => t.textContent,
    );
    expect(textos).toEqual(["12"]);
  });
});

describe("FloorPlanViewer — tap fuera de una mesa", () => {
  it("el fondo avisa al padre; la mesa abre la mesa y no cuenta como fondo", () => {
    const onTableClick = vi.fn();
    const onBackgroundClick = vi.fn();
    const { container } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable()]}
        onTableClick={onTableClick}
        onBackgroundClick={onBackgroundClick}
      />,
    );

    // Tocar el plano al aire = "salir de lo que estoy haciendo".
    fireEvent.click(container.querySelector("svg")!);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(onTableClick).not.toHaveBeenCalled();

    // Tocar la mesa NO burbujea: si lo hiciera, el mismo gesto abriría la mesa
    // y cerraría el panel que acaba de abrir.
    fireEvent.click(container.querySelector("svg > g")!);
    expect(onTableClick).toHaveBeenCalledTimes(1);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });
});
