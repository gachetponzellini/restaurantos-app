"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Minus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import {
  autoResolvedModifierIds,
  choicesDeltaCents,
  initialOptionIndex,
  pruneBlockedSelections,
  type DailyMenuSelection,
  type DailyMenuSelections,
  type MenuStep,
} from "@/lib/mozo/daily-menu-steps";
import {
  deshacerEnPaso,
  elegirEnPaso,
  lineasValenIgual,
  lineasVacias,
  pasosDelBloque,
  proximaLineaDe,
  redimensionar,
  totalDelBloqueCents,
  type Linea,
  type PasoAgrupado,
} from "@/lib/mozo/daily-menu-lineas";
import {
  isSingleChoiceGroup,
  missingSelections,
  type ComboModifier,
} from "@/lib/orders/combo-modifiers";
import type {
  DailyMenuChoiceGroup,
  DailyMenuComponent,
  DailyMenuForMozo,
} from "@/lib/mozo/daily-menus-query";
import { moveSelection } from "@/lib/mozo/product-search";
import { gridNextIndex, indexFromDigit } from "@/lib/ui/roving";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";

/** Cuántos menús se ofrecen de un toque en el primer paso. Más que eso, con +. */
const CANTIDADES = [1, 2, 3, 4, 5, 6, 7, 8];
/** Columnas de esa grilla. Vive acá porque el teclado la necesita tanto como el
 *  layout: si el `grid-cols-N` y este número se separan, ↓ deja de bajar una
 *  fila (#279). */
const CANTIDAD_COLUMNAS = 4;

/**
 * Asistente de carga del menú del día (specs 072 · 074 · 083 · 118 · 155).
 *
 * Un paso por decisión: primero la entrada, después el principal… y un paso
 * final para confirmar. Se entra con la primera opción **enfocada de verdad**
 * (roving tabindex), ↓/↑ mueven, Enter elige y avanza, `1`–`9` eligen por
 * posición, ← vuelve. Mismo criterio de teclado que el buscador de productos
 * (specs 055/066): clamp sin wrap-around, fila seleccionada siempre a la vista.
 *
 * ── Varios menús por vuelta de mesa (spec 155) ─────────────────────────────
 *
 * El estado dejó de ser **una** selección más una cantidad al final: ahora son
 * **N líneas**, una por menú, y la cantidad abre el asistente (D1). Cada paso
 * se pregunta para las N líneas de una — la bebida de los cuatro, después el
 * principal de los cuatro—, que es como se toma el pedido parado en la mesa.
 * Antes «cantidad 4» eran cuatro menús IDÉNTICOS y había que recorrer el
 * asistente entero cuatro veces; la encargada de golf lo dijo corto: *«no me
 * deja poner dos de una»*.
 *
 * Con **una** línea el recorrido es el de siempre: un paso está entero o vacío,
 * así que los contadores no se muestran, elegir avanza y ← vuelve con lo
 * elegido marcado. Es el caso más frecuente y no se puede regresionar.
 *
 * El reparto entre líneas es **arbitrario a propósito** (D3): nadie captura
 * quién pidió qué, y tanto la comanda como el total son invariantes ante cómo
 * se reparta. Por eso acá no hay «Comensal 1 / Comensal 2» por ningún lado.
 *
 * ── El paso actual se DERIVA, no se guarda ─────────────────────────────────
 *
 * No hay `stepIndex`: el paso es el primero que todavía tiene líneas sin
 * resolver (`pasosDelBloque` + el primero con `faltan > 0`). Elegir puede hacer
 * aparecer o desaparecer pasos —los ravioles no llevan guarnición—, y un índice
 * guardado quedaría apuntando a otro lado.
 *
 * Sobre ese cursor derivado van dos overrides chicos:
 *  - `pasoForzado`: el ← y el «cambiar» del resumen abren un paso YA resuelto
 *    sin borrar nada, para poder pisarlo viendo lo que había.
 *  - `saltados`: un grupo de modificadores opcional nunca se «resuelve» solo
 *    —«ninguno» es una respuesta válida—, así que se cierra con «Seguir».
 */
export function DailyMenuWizard({
  menu,
  onClose,
  onAdd,
  embedded = false,
}: {
  menu: DailyMenuForMozo | null;
  onClose: () => void;
  /**
   * Un array por menú, cada uno con sus `selected_choices` (spec 155 · D6). El
   * caller pushea N ítems de `quantity: 1`, que es lo que `enviarComanda` ya
   * espera: un ítem con `quantity: 4` y un solo set de opciones es justamente
   * lo que no alcanzaba.
   */
  onAdd: (menu: DailyMenuForMozo, lineas: DailyMenuSelection[][]) => void;
  /** Embebido en un panel: el overlay se scopea al contenedor (`absolute`) en
   *  vez de cubrir todo el viewport (`fixed`). */
  embedded?: boolean;
}) {
  const [lineas, setLineas] = useState<Linea[]>(() => lineasVacias(1));
  /** ¿Ya pasó el paso de cantidad? Con `false` el asistente lo está mostrando. */
  const [cantidadLista, setCantidadLista] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  /** Paso ya resuelto que se abrió para corregir (← o «cambiar»). */
  const [pasoForzado, setPasoForzado] = useState<string | null>(null);
  /** Pasos opcionales que el usuario cerró con «Seguir» sin elegir nada. */
  const [saltados, setSaltados] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo(() => menu?.choice_groups ?? [], [menu]);

  // Los pasos dependen de lo elegido en CADA línea (specs 074/083): una opción
  // puede sacar un grupo del medio —«los ravioles no llevan guarnición»— y con
  // varias líneas puede aplicar sólo a algunas. Se recalcula en vivo.
  const pasos = useMemo(
    () => pasosDelBloque(groups, lineas),
    [groups, lineas],
  );
  const pendiente = useMemo(
    () => pasos.find((p) => sigueAbierto(p, saltados)) ?? null,
    [pasos, saltados],
  );
  const forzado = useMemo(
    () => (pasoForzado ? (pasos.find((p) => p.clave === pasoForzado) ?? null) : null),
    [pasos, pasoForzado],
  );
  const paso = forzado ?? pendiente;

  const vista: "cantidad" | "paso" | "confirm" = !cantidadLista
    ? "cantidad"
    : paso
      ? "paso"
      : "confirm";

  const esBloque = lineas.length > 1;

  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEscapeToClose(onClose, !!menu);

  // Cada menú abre limpio, desde el paso de cantidad.
  useEffect(() => {
    if (!menu) return;
    setLineas(lineasVacias(1));
    setCantidadLista(false);
    setActiveIndex(0);
    setPasoForzado(null);
    setSaltados(new Set());
  }, [menu?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foco real al entrar a un paso y al moverse con las flechas (FR-002/003).
  // En el paso final va al botón «Agregar»: Enter agrega.
  useEffect(() => {
    if (!menu) return;
    const t = setTimeout(() => {
      if (vista === "confirm") {
        submitRef.current?.focus({ preventScroll: true });
        return;
      }
      const el = optionRefs.current[activeIndex];
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => clearTimeout(t);
  }, [menu?.id, vista, paso?.clave, activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!menu) return null;

  const fixedComponents = menu.components.filter((c) => c.kind !== "choice");
  const totalBloque = totalDelBloqueCents(menu.price_cents, lineas);

  /** Los modificadores que una línea eligió para el producto de un grupo. */
  const modsDeLinea = (i: number, choiceGroupId: string): ComboModifier[] =>
    lineas[i]?.get(choiceGroupId)?.modifiers ?? [];

  /**
   * Entra a un paso dejando el foco donde corresponde: en lo que ya estaba
   * elegido si volvemos sobre él, si no en la primera opción.
   */
  const enfocarPaso = (destino: PasoAgrupado | null, conLineas: Linea[]) => {
    if (!destino) {
      setActiveIndex(0);
      return;
    }
    // Con varias líneas «lo elegido» no es uno solo, así que se entra por
    // arriba: el reparto es arbitrario y no hay una fila privilegiada (D3).
    const referencia = conLineas.length === 1 ? conLineas[0] : null;
    if (destino.step.kind === "choice") {
      setActiveIndex(
        referencia ? initialOptionIndex(destino.step.group, referencia) : 0,
      );
      return;
    }
    if (destino.step.kind === "modifiers") {
      const chosen = referencia?.get(destino.step.choiceGroupId)?.modifier_ids ?? [];
      const i = destino.step.group.modifiers.findIndex((m) => chosen.includes(m.id));
      setActiveIndex(i >= 0 ? i : 0);
      return;
    }
    setActiveIndex(0);
  };

  /**
   * Aplica lo elegido y suelta el override para que el cursor derivado siga
   * solo: al siguiente paso pendiente, o al resumen si ya está todo.
   *
   * Un paso COMPLETO que se abrió para corregir no puede simplemente sumar
   * —`elegirEnPaso` no inventa una quinta línea—, así que la elección **pisa**
   * la última: deshacer y volver a elegir. Con una línea eso es exactamente
   * «cambiar de opción», que es lo que el asistente hace desde siempre.
   */
  const aplicar = (destino: PasoAgrupado, seleccion: DailyMenuSelection) => {
    const base = destino.faltan === 0 ? deshacerEnPaso(lineas, destino) : lineas;
    const elegidas = elegirEnPaso(base, destino, seleccion);
    // `elegirEnPaso` no poda: una guarnición que dejó de aplicar quedaría en la
    // línea y `choicesDeltaCents` la cobraría (spec 074 · FR-004). Nunca puede
    // quedar una elección de un grupo inactivo.
    const next = elegidas.map((l) =>
      enOrdenDelMenu(groups, pruneBlockedSelections(groups, l) as Linea),
    );
    setLineas(next);
    setPasoForzado(null);
    // El paso que sigue sale de la lista NUEVA: elegir pudo agregar o sacar
    // pasos, y el foco tiene que entrar donde corresponde en esa lista.
    const siguientes = pasosDelBloque(groups, next);
    const siguiente = siguientes.find((p) => sigueAbierto(p, saltados)) ?? null;
    // Si seguimos en el MISMO paso —la vuelta de bebidas no terminó— el foco se
    // queda donde está: volver a la primera opción después de cada elección
    // obliga a bajar de nuevo para repetir la que se acaba de elegir.
    if (siguiente?.clave !== destino.clave) enfocarPaso(siguiente, next);
  };

  const choose = (group: DailyMenuChoiceGroup, option: DailyMenuComponent) => {
    if (!paso || !option.product_id) return;
    aplicar(paso, {
      choice_group_id: group.choice_group_id,
      choice_group_label: group.label,
      product_id: option.product_id,
      product_name: option.product_name ?? option.label,
      extra_price_cents: option.extra_price_cents ?? 0,
      modifier_ids: [],
    });
  };

  /**
   * Marcar / desmarcar un modificador (spec 083).
   *
   * Obligatorio de a uno: reemplaza y avanza. El resto sólo marca — el paso se
   * cierra con «Seguir» (FR-003).
   *
   * A qué línea le toca: la próxima sin resolver. Si ya resolvieron todas,
   * la última que eligió, que es corregir y no agregar un menú más.
   *
   * ⚠️ Con varias líneas, un grupo de VARIAS opciones da **una por menú**: al
   * marcar la primera, la línea queda resuelta y el siguiente toque le cae a la
   * que sigue. Es coherente con el reparto por vuelta (D3) pero no permite dos
   * salsas en el mismo menú dentro de un bloque; con una sola línea funciona
   * como siempre.
   */
  const toggleModifier = (
    destino: PasoAgrupado,
    step: Extract<MenuStep, { kind: "modifiers" }>,
    modifier: ComboModifier,
  ) => {
    const ownIds = new Set(step.group.modifiers.map((m) => m.id));
    const tieneDelGrupo = (i: number) =>
      modsDeLinea(i, step.choiceGroupId).some((m) => ownIds.has(m.id));
    const pendienteIdx = proximaLineaDe(destino, lineas);
    const conElección = destino.lineas.filter(tieneDelGrupo);
    const i =
      pendienteIdx >= 0
        ? pendienteIdx
        : (conElección[conElección.length - 1] ?? destino.lineas[0]);
    if (i == null) return;

    const current = lineas[i]?.get(step.choiceGroupId);
    if (!current) return;
    const chosen = current.modifiers ?? [];
    const single = isSingleChoiceGroup(step.group);
    const yaEsta = chosen.some((m) => m.id === modifier.id);

    let next: ComboModifier[];
    if (single) {
      // Uno solo de ESTE grupo; lo de los otros grupos del producto no se toca.
      next = [...chosen.filter((m) => !ownIds.has(m.id)), modifier];
    } else if (yaEsta) {
      next = chosen.filter((m) => m.id !== modifier.id);
    } else {
      const enEsteGrupo = chosen.filter((m) => ownIds.has(m.id)).length;
      if (enEsteGrupo >= step.group.max_selection) return; // tope: no hace nada
      next = [...chosen, modifier];
    }

    const out = lineas.map((l) => new Map(l) as Linea);
    out[i]!.set(step.choiceGroupId, {
      ...current,
      modifiers: next,
      modifier_ids: next.map((m) => m.id),
    });
    setLineas(out);
    setPasoForzado(null);

    if (single) {
      const siguientes = pasosDelBloque(groups, out);
      const siguiente = siguientes.find((p) => sigueAbierto(p, saltados)) ?? null;
      if (siguiente?.clave !== destino.clave) enfocarPaso(siguiente, out);
    }
  };

  /** Cerrar un paso opcional sin (o sin más) elecciones: el «Seguir». */
  const seguir = (destino: PasoAgrupado) => {
    setSaltados((s) => new Set(s).add(destino.clave));
    setPasoForzado(null);
    const resto = pasos.find(
      (p) => p.clave !== destino.clave && sigueAbierto(p, saltados),
    );
    enfocarPaso(resto ?? null, lineas);
  };

  /** Confirmar la cantidad y arrancar la vuelta de mesa. */
  const confirmarCantidad = (n: number) => {
    const next = redimensionar(lineas, n);
    setLineas(next);
    setCantidadLista(true);
    setPasoForzado(null);
    const siguientes = pasosDelBloque(groups, next);
    enfocarPaso(siguientes.find((p) => sigueAbierto(p, saltados)) ?? null, next);
  };

  /**
   * Volver.
   *
   * A mitad de una vuelta —ya marcó dos bebidas de cuatro— el ← deshace la
   * última, que es el «me equivoqué en la tercera». Si no, abre el paso
   * resuelto anterior **sin borrar nada**, para poder pisarlo viendo lo que
   * había. Con una sola línea el primer caso no existe (un paso está entero o
   * vacío), así que el ← es exactamente el de siempre.
   */
  const goBack = () => {
    if (vista === "cantidad") {
      onClose();
      return;
    }
    if (paso && paso.resueltas > 0 && paso.faltan > 0) {
      setLineas(deshacerEnPaso(lineas, paso));
      return;
    }
    const hasta =
      vista === "confirm"
        ? pasos.length
        : Math.max(0, pasos.findIndex((p) => p.clave === paso?.clave));
    const previo = pasos
      .slice(0, hasta)
      .reverse()
      .find((p) => p.resueltas > 0 || saltados.has(p.clave));
    if (previo) {
      // Volver sobre un paso que se había salteado lo vuelve a poner en juego.
      setSaltados((s) => {
        const next = new Set(s);
        next.delete(previo.clave);
        return next;
      });
      setPasoForzado(previo.clave);
      enfocarPaso(previo, lineas);
      return;
    }
    setPasoForzado(null);
    setCantidadLista(false);
    setActiveIndex(Math.min(lineas.length, CANTIDADES.length) - 1);
  };

  const editarPaso = (clave: string) => {
    const destino = pasos.find((p) => p.clave === clave);
    if (!destino) return;
    setSaltados((s) => {
      const next = new Set(s);
      next.delete(clave);
      return next;
    });
    setPasoForzado(clave);
    enfocarPaso(destino, lineas);
  };

  const editarCantidad = () => {
    setCantidadLista(false);
    setPasoForzado(null);
    setActiveIndex(Math.min(lineas.length, CANTIDADES.length) - 1);
  };

  const handleAdd = () => {
    // Los grupos obligatorios de una sola opción nunca se mostraron (serían un
    // paso con una sola salida), pero el validador del server los exige igual.
    // Van por línea: cada menú manda los suyos.
    onAdd(
      menu,
      lineas.map((linea) => {
        const auto = autoResolvedModifierIds(groups, linea);
        return [...linea.values()].map((sel) => {
          const extra = auto.get(sel.choice_group_id) ?? [];
          if (extra.length === 0) return sel;
          return {
            ...sel,
            modifier_ids: [...new Set([...sel.modifier_ids, ...extra])],
          };
        });
      }),
    );
  };

  /** Cuántas líneas del paso quedaron abajo del mínimo del grupo. */
  const sinMinimo =
    paso?.step.kind === "modifiers"
      ? paso.lineas.filter(
          (i) =>
            missingSelections(
              (paso.step as Extract<MenuStep, { kind: "modifiers" }>).group,
              modsDeLinea(
                i,
                (paso.step as Extract<MenuStep, { kind: "modifiers" }>)
                  .choiceGroupId,
              ).map((m) => m.id),
            ) > 0,
        ).length
      : 0;

  /** Lo que falta del grupo para la línea que está en juego (texto de a uno). */
  const faltanMods =
    paso?.step.kind === "modifiers" && !esBloque
      ? missingSelections(
          paso.step.group,
          modsDeLinea(0, paso.step.choiceGroupId).map((m) => m.id),
        )
      : 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    // Focus-trap: Tab/Shift+Tab ciclan dentro del panel (igual que ProductModal).
    if (e.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input, select, textarea, [href]',
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (typing) return;

    // En la grilla de la cantidad el ← es un movimiento, no un «volver»: lo
    // resuelve la rama de abajo, que sólo cae al `goBack` en el borde izquierdo.
    if (e.key === "Backspace" || (e.key === "ArrowLeft" && vista !== "cantidad")) {
      e.preventDefault();
      goBack();
      return;
    }

    // ── Paso de cantidad: los mismos atajos, sobre la grilla de números ──
    if (vista === "cantidad") {
      const length = CANTIDADES.length;
      // Es una grilla, no una lista: ↓/↑ mueven de fila y ←/→ de a uno, en
      // orden de lectura (mismo `gridNextIndex` del selector de método de
      // pago, spec 075). Salirse por un borde no hace nada —clamp, como en el
      // resto del asistente— salvo el ← desde la primera celda, que es el
      // «volver» de siempre y cierra (#279).
      const move = gridNextIndex(activeIndex, e.key, length, CANTIDAD_COLUMNAS);
      if (move) {
        e.preventDefault();
        if (move.kind === "index") setActiveIndex(move.index);
        else if (e.key === "ArrowLeft") goBack();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveIndex(length - 1);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setLineas((ls) => redimensionar(ls, Math.min(99, ls.length + 1)));
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        setLineas((ls) => redimensionar(ls, Math.max(1, ls.length - 1)));
        return;
      }
      const byDigit = indexFromDigit(e.key, length);
      if (byDigit !== null) {
        e.preventDefault();
        confirmarCantidad(CANTIDADES[byDigit]!);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (target.getAttribute("role") !== "radio") return;
        e.preventDefault();
        confirmarCantidad(CANTIDADES[activeIndex] ?? lineas.length);
      }
      return;
    }

    if (!paso) {
      // Paso final: Enter agrega (lo hace el foco en el botón). Nada más.
      return;
    }

    // El paso de modificadores se navega igual que uno del menú: las flechas y
    // los dígitos son los mismos, sólo cambia qué hace elegir (FR-002/003).
    if (paso.step.kind === "modifiers") {
      const step = paso.step;
      const length = step.group.modifiers.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => moveSelection(i, 1, length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => moveSelection(i, -1, length));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveIndex(length - 1);
        return;
      }
      const byDigit = indexFromDigit(e.key, length);
      if (byDigit !== null) {
        e.preventDefault();
        const modifier = step.group.modifiers[byDigit];
        if (modifier) toggleModifier(paso, step, modifier);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const role = target.getAttribute("role");
        if (role !== "radio" && role !== "checkbox") return;
        e.preventDefault();
        const modifier = step.group.modifiers[activeIndex];
        if (!modifier) return;
        // Segundo Enter sobre lo que ya elegiste = «Seguir» (spec 118).
        //
        // Los grupos opcionales o de varias no se cierran solos (FR-003), así
        // que después de elegir hay que salir del paso — y el Enter, que es
        // donde la mano ya está, **desmarcaba**: dos Enter seguidos y volvías a
        // cero sin enterarte. Ahora el segundo avanza, que es lo que se espera
        // de un asistente. Para desmarcar quedan el dígito y el click.
        const yaElegido = modsDeLinea(
          proximaLineaDe(paso, lineas) >= 0
            ? proximaLineaDe(paso, lineas)
            : (paso.lineas[paso.lineas.length - 1] ?? 0),
          step.choiceGroupId,
        ).some((m) => m.id === modifier.id);
        if (yaElegido && sinMinimo === 0) {
          seguir(paso);
          return;
        }
        toggleModifier(paso, step, modifier);
      }
      return;
    }

    if (paso.step.kind === "choice") {
      const step = paso.step;
      const length = step.group.options.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => moveSelection(i, 1, length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => moveSelection(i, -1, length));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveIndex(length - 1);
        return;
      }
      const byDigit = indexFromDigit(e.key, length);
      if (byDigit !== null) {
        e.preventDefault();
        const option = step.group.options[byDigit];
        if (option) choose(step.group, option);
        return;
      }
      // Enter/Espacio sobre una opción: elegir y avanzar. Se maneja acá en vez
      // de dejar la activación nativa del `<button>` para que el `preventDefault`
      // corte el click y no haya doble disparo, y para que sólo aplique estando
      // parado en una opción (no en el botón de cerrar del header).
      if (e.key === "Enter" || e.key === " ") {
        if (target.getAttribute("role") !== "radio") return;
        e.preventDefault();
        const option = step.group.options[activeIndex];
        if (option) choose(step.group, option);
      }
    }
  };

  const stepLabel =
    vista === "cantidad"
      ? "¿Cuántos menús?"
      : !paso
        ? "Confirmá el menú"
        : paso.step.kind === "choice"
          ? paso.step.group.label
          : paso.step.kind === "modifiers"
            ? `${paso.step.group.name} · ${paso.step.productName}`
            : "Confirmá el menú";

  /** Para cuáles de las N líneas es este paso, cuando no es para todas (D4). */
  const alcance = paso ? paraQuienes(paso, lineas, groups) : null;

  // Cantidad + los pasos del bloque + confirmar.
  const totalPasos = pasos.length + 2;
  const indiceActual =
    vista === "cantidad"
      ? 0
      : vista === "confirm"
        ? totalPasos - 1
        : 1 + Math.max(0, pasos.findIndex((p) => p.clave === paso?.clave));

  return (
    <div
      onClick={onClose}
      className={`${embedded ? "absolute" : "fixed"} inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm`}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={`${menu.name} — ${stepLabel}`}
        className={`flex w-full max-w-md ${embedded ? "max-h-full" : "max-h-[92dvh]"} flex-col rounded-t-3xl bg-card shadow-2xl`}
      >
        {/* ── Header: dónde estoy y qué estoy decidiendo ── */}
        <div className="shrink-0 border-b border-border/60 px-3 pb-3 pt-2.5">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={goBack}
              aria-label={vista === "cantidad" ? "Cerrar" : "Paso anterior"}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700">
                {menu.name}
              </p>
              <h3 className="truncate font-heading text-lg font-extrabold leading-tight text-foreground">
                {stepLabel}
              </h3>
              {/* El contador de la vuelta. Sin esta línea el mozo cuenta cuatro
                  menús, ve un paso que pide dos, y parece un bug (D4). */}
              {esBloque && vista === "paso" && paso && (
                <p className="truncate text-[11px] font-semibold text-muted-foreground">
                  {paso.faltan > 0
                    ? `Faltan ${paso.faltan} de ${paso.lineas.length}`
                    : `Listos los ${paso.lineas.length}`}
                  {alcance && ` · ${alcance}`}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="mt-2 flex items-center gap-2 pl-1">
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPasos }, (_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === indiceActual
                      ? "w-5 bg-emerald-600"
                      : i < indiceActual
                        ? "w-1.5 bg-emerald-300"
                        : "w-1.5 bg-border"
                  }`}
                />
              ))}
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">
              Paso {indiceActual + 1} de {totalPasos}
            </span>
          </div>
        </div>

        {/* ── Cuerpo ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {vista === "cantidad" ? (
            <CantidadStep
              cantidad={lineas.length}
              activeIndex={activeIndex}
              optionRefs={optionRefs}
              onPick={confirmarCantidad}
              onHover={setActiveIndex}
            />
          ) : paso?.step.kind === "choice" ? (
            <ChoiceStep
              step={paso.step}
              paso={paso}
              lineas={lineas}
              esBloque={esBloque}
              activeIndex={activeIndex}
              optionRefs={optionRefs}
              onChoose={(opt) => choose((paso.step as Extract<MenuStep, { kind: "choice" }>).group, opt)}
              onHover={setActiveIndex}
            />
          ) : paso?.step.kind === "modifiers" ? (
            <ModifierStep
              step={paso.step}
              paso={paso}
              lineas={lineas}
              esBloque={esBloque}
              activeIndex={activeIndex}
              optionRefs={optionRefs}
              onToggle={(m) =>
                toggleModifier(
                  paso,
                  paso.step as Extract<MenuStep, { kind: "modifiers" }>,
                  m,
                )
              }
              onHover={setActiveIndex}
            />
          ) : (
            <ConfirmStep
              pasos={pasos}
              lineas={lineas}
              esBloque={esBloque}
              precioMenuCents={menu.price_cents}
              fixedComponents={fixedComponents}
              onEditPaso={editarPaso}
              onEditCantidad={editarCantidad}
            />
          )}
        </div>

        {/* ── Pie: total + acción del paso ── */}
        <div className="shrink-0 border-t border-border bg-card px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {vista === "cantidad" ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-full ring-1 ring-border">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() =>
                    setLineas((ls) => redimensionar(ls, Math.max(1, ls.length - 1)))
                  }
                  className="flex h-11 w-11 items-center justify-center text-foreground/80 active:bg-muted/50"
                  aria-label="Menos"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center text-sm font-bold tabular-nums">
                  {lineas.length}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() =>
                    setLineas((ls) => redimensionar(ls, Math.min(99, ls.length + 1)))
                  }
                  className="flex h-11 w-11 items-center justify-center text-foreground/80 active:bg-muted/50"
                  aria-label="Más"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <Button
                type="button"
                size="xl"
                onClick={() => confirmarCantidad(lineas.length)}
                className="flex-1"
              >
                Seguir
              </Button>
            </div>
          ) : paso?.step.kind === "choice" ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {esBloque && paso.faltan > 0
                  ? `Elegí ${paso.faltan} más`
                  : "Elegí una opción para seguir"}
              </p>
              <p className="text-base font-extrabold text-emerald-700 tabular-nums">
                {formatCurrency(totalBloque)}
              </p>
            </div>
          ) : paso?.step.kind === "modifiers" ? (
            isSingleChoiceGroup(paso.step.group) ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {esBloque && paso.faltan > 0
                    ? `Elegí ${paso.faltan} más`
                    : "Elegí una opción para seguir"}
                </p>
                <p className="text-base font-extrabold text-emerald-700 tabular-nums">
                  {formatCurrency(totalBloque)}
                </p>
              </div>
            ) : (
              // Opcional o de varias: «ninguno» y «dos» son respuestas válidas,
              // así que el paso lo cierra el usuario (FR-003).
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {sinMinimo > 0
                    ? esBloque
                      ? `Faltan ${sinMinimo} de ${paso.lineas.length}`
                      : `Elegí ${faltanMods} para seguir`
                    : `Total ${formatCurrency(totalBloque)}`}
                </p>
                <Button
                  ref={submitRef}
                  type="button"
                  size="xl"
                  disabled={sinMinimo > 0}
                  onClick={() => seguir(paso)}
                  className="shrink-0"
                >
                  Seguir
                </Button>
              </div>
            )
          ) : (
            <Button
              ref={submitRef}
              type="button"
              size="xl"
              onClick={handleAdd}
              className="w-full justify-between"
            >
              <span className="text-base font-semibold">
                {esBloque ? `Agregar ${lineas.length} menús` : "Agregar"}
              </span>
              <span className="text-base font-bold tabular-nums">
                {formatCurrency(totalBloque)}
              </span>
            </Button>
          )}

          {embedded && (
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              {vista === "cantidad"
                ? "1-8 cuántos · ←→↑↓ mover · +/− ajustar · Enter seguir"
                : vista === "paso"
                  ? "↑↓ moverse · 1-9 elegir directo · Enter confirmar · ← volver"
                  : "Enter agregar · ← volver"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Primer paso: cuántos menús se cargan de una (spec 155 · D1).
 *
 * Antes la cantidad estaba al final, porque una sola línea no necesita saberla
 * antes. Con N líneas el número define todo lo que viene, así que abre el
 * asistente. Con **1** —el caso más frecuente— es un toque y el resto del
 * recorrido queda idéntico al de siempre.
 */
function CantidadStep({
  cantidad,
  activeIndex,
  optionRefs,
  onPick,
  onHover,
}: {
  cantidad: number;
  activeIndex: number;
  optionRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  onPick: (n: number) => void;
  onHover: (i: number) => void;
}) {
  return (
    <>
      <p className="mb-2 px-1 text-xs text-muted-foreground">
        Se preguntan las opciones de todos juntos, por vuelta de mesa.
      </p>
      <div
        role="radiogroup"
        aria-label="Cuántos menús"
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${CANTIDAD_COLUMNAS}, minmax(0, 1fr))`,
        }}
      >
        {CANTIDADES.map((n, i) => {
          const isActive = i === activeIndex;
          const isChosen = n === cantidad;
          return (
            <button
              key={n}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isChosen}
              aria-label={`${n} ${n === 1 ? "menú" : "menús"}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onPick(n)}
              onMouseEnter={() => onHover(i)}
              className={`flex h-16 items-center justify-center rounded-2xl text-xl font-extrabold tabular-nums transition focus:outline-none active:scale-[0.97] ${
                isChosen
                  ? "bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500"
                  : isActive
                    ? "bg-card text-foreground ring-2 ring-emerald-400"
                    : "bg-muted/50 text-foreground/80 ring-1 ring-border/60"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Un grupo de opciones del menú, para las N líneas que lo piden.
 *
 * Con varias, cada opción muestra **cuántas veces** se eligió: se toca
 * `Gaseosa` dos veces, `Agua` una, `Vino` una, y el contador queda a la vista
 * (D2). Con una sola línea es la fila de siempre, con su tilde.
 */
function ChoiceStep({
  step,
  paso,
  lineas,
  esBloque,
  activeIndex,
  optionRefs,
  onChoose,
  onHover,
}: {
  step: Extract<MenuStep, { kind: "choice" }>;
  paso: PasoAgrupado;
  lineas: Linea[];
  esBloque: boolean;
  activeIndex: number;
  optionRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  onChoose: (opt: DailyMenuComponent) => void;
  onHover: (i: number) => void;
}) {
  const veces = new Map<string, number>();
  for (const i of paso.lineas) {
    const pid = lineas[i]?.get(step.group.choice_group_id)?.product_id;
    if (pid) veces.set(pid, (veces.get(pid) ?? 0) + 1);
  }

  return (
    <ul role="radiogroup" aria-label={step.group.label} className="space-y-1.5">
      {step.group.options.map((opt, i) => {
        const isActive = i === activeIndex;
        const cuenta = opt.product_id ? (veces.get(opt.product_id) ?? 0) : 0;
        const isChosen = cuenta > 0;
        return (
          <li key={opt.id}>
            <button
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isChosen}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChoose(opt)}
              onMouseEnter={() => onHover(i)}
              className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition focus:outline-none active:scale-[0.99] ${
                isChosen
                  ? "bg-emerald-50 ring-2 ring-emerald-500"
                  : isActive
                    ? "bg-card ring-2 ring-emerald-400"
                    : "bg-muted/50 ring-1 ring-border/60"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                  isChosen
                    ? "bg-emerald-600 text-white"
                    : "bg-card text-muted-foreground ring-1 ring-border"
                }`}
              >
                {isChosen ? (
                  esBloque ? (
                    cuenta
                  ) : (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  )
                ) : (
                  i + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {opt.product_name ?? opt.label}
                </span>
                {opt.description && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                )}
              </span>
              {opt.extra_price_cents > 0 && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-800">
                  +{formatCurrency(opt.extra_price_cents)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Un grupo de modificadores del producto elegido (spec 083).
 *
 * Es la misma fila que las opciones del menú a propósito: el mozo ya sabe cómo
 * se maneja. Lo único que cambia es el `role` —radio cuando hay que elegir uno,
 * checkbox cuando se puede elegir varios o ninguno— y que en el segundo caso el
 * paso se cierra con «Seguir» en vez de avanzar solo.
 */
function ModifierStep({
  step,
  paso,
  lineas,
  esBloque,
  activeIndex,
  optionRefs,
  onToggle,
  onHover,
}: {
  step: Extract<MenuStep, { kind: "modifiers" }>;
  paso: PasoAgrupado;
  lineas: Linea[];
  esBloque: boolean;
  activeIndex: number;
  optionRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  onToggle: (m: ComboModifier) => void;
  onHover: (i: number) => void;
}) {
  const single = isSingleChoiceGroup(step.group);
  const ownIds = new Set(step.group.modifiers.map((m) => m.id));

  // Cuántas veces se eligió cada modificador a lo largo de las líneas del paso.
  const veces = new Map<string, number>();
  for (const i of paso.lineas) {
    for (const id of lineas[i]?.get(step.choiceGroupId)?.modifier_ids ?? []) {
      if (ownIds.has(id)) veces.set(id, (veces.get(id) ?? 0) + 1);
    }
  }
  // El tope es por línea: con la línea en juego llena, lo no elegido se apaga.
  const enJuego = esBloque
    ? 0
    : step.group.modifiers.filter((m) => (veces.get(m.id) ?? 0) > 0).length;

  return (
    <>
      {!single && (
        <p className="mb-2 px-1 text-xs text-muted-foreground">
          {step.group.min_selection > 0
            ? `Elegí ${step.group.min_selection}`
            : "Opcional"}
          {step.group.max_selection > 1 && ` · hasta ${step.group.max_selection}`}
          {esBloque && " · uno por menú"}
        </p>
      )}
      <ul
        role={single ? "radiogroup" : "group"}
        aria-label={step.group.name}
        className="space-y-1.5"
      >
        {step.group.modifiers.map((m, i) => {
          const isActive = i === activeIndex;
          const cuenta = veces.get(m.id) ?? 0;
          const isChosen = cuenta > 0;
          // Con el tope cubierto, lo no elegido se apaga: un botón que existe y
          // no hace nada es peor que decir que ya no se puede.
          const topeCubierto =
            !single && !isChosen && enJuego >= step.group.max_selection;
          return (
            <li key={m.id}>
              <button
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role={single ? "radio" : "checkbox"}
                aria-checked={isChosen}
                disabled={topeCubierto}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onToggle(m)}
                onMouseEnter={() => onHover(i)}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition focus:outline-none active:scale-[0.99] disabled:opacity-40 ${
                  isChosen
                    ? "bg-emerald-50 ring-2 ring-emerald-500"
                    : isActive
                      ? "bg-card ring-2 ring-emerald-400"
                      : "bg-muted/50 ring-1 ring-border/60"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                    isChosen
                      ? "bg-emerald-600 text-white"
                      : "bg-card text-muted-foreground ring-1 ring-border"
                  }`}
                >
                  {isChosen ? (
                    esBloque ? (
                      cuenta
                    ) : (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    )
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                  {m.name}
                </span>
                {m.price_delta_cents > 0 && (
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-800">
                    +{formatCurrency(m.price_delta_cents)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Paso final: qué incluye, qué se eligió (editable) y a cuánto queda.
 *
 * Los grupos salen de los pasos y no del menú entero: así lista exactamente los
 * que aplican con lo elegido —un grupo bloqueado no aparece como «Guarnición:
 * ninguna», sencillamente no está (FR-007)— y tocar uno vuelve a ese paso.
 *
 * Con varias líneas el resumen es **por vuelta**, no por menú: «Bebida: 2
 * Gaseosa · 1 Agua». Listar «Menú 1 / Menú 2» sugeriría que la app sabe quién
 * pidió qué, y no lo sabe ni lo pretende (D3).
 */
function ConfirmStep({
  pasos,
  lineas,
  esBloque,
  precioMenuCents,
  fixedComponents,
  onEditPaso,
  onEditCantidad,
}: {
  pasos: PasoAgrupado[];
  lineas: Linea[];
  esBloque: boolean;
  precioMenuCents: number;
  fixedComponents: DailyMenuComponent[];
  onEditPaso: (clave: string) => void;
  onEditCantidad: () => void;
}) {
  const grupos = pasos.filter(
    (p): p is PasoAgrupado & { step: Extract<MenuStep, { kind: "choice" }> } =>
      p.step.kind === "choice",
  );

  return (
    <div className="space-y-4">
      {esBloque && (
        <button
          type="button"
          onClick={onEditCantidad}
          className="flex w-full items-center gap-3 rounded-2xl bg-emerald-50 px-3 py-2.5 text-left ring-1 ring-emerald-200 transition active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <span className="min-w-0 flex-1 text-[15px] font-semibold text-emerald-900">
            {lineas.length} menús
          </span>
          <span className="shrink-0 text-xs font-semibold text-emerald-700">
            cambiar
          </span>
        </button>
      )}

      {fixedComponents.length > 0 && (
        <section>
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Incluye
          </p>
          <ul className="mt-1.5 space-y-1">
            {fixedComponents.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2 ring-1 ring-border/60"
              >
                <Check
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                  strokeWidth={3}
                />
                <span className="min-w-0 text-sm text-foreground/80">
                  {c.kind === "product" && c.product_name
                    ? `${c.label}: ${c.product_name}`
                    : c.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grupos.length > 0 && (
        <section>
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            Elegiste
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {grupos.map((p) => {
              const g = p.step.group;
              const veces = new Map<string, number>();
              for (const i of p.lineas) {
                const sel = lineas[i]?.get(g.choice_group_id);
                if (sel)
                  veces.set(
                    sel.product_name,
                    (veces.get(sel.product_name) ?? 0) + 1,
                  );
              }
              const detalle = esBloque
                ? [...veces]
                    .map(([nombre, c]) => `${c} ${nombre}`)
                    .join(" · ")
                : ([...veces.keys()][0] ?? "—");
              const extra = p.lineas.reduce(
                (acc, i) =>
                  acc + (lineas[i]?.get(g.choice_group_id)?.extra_price_cents ?? 0),
                0,
              );
              return (
                <li key={p.clave}>
                  <button
                    type="button"
                    onClick={() => onEditPaso(p.clave)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-left ring-1 ring-border transition active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        {g.label}
                      </span>
                      <span className="block truncate text-[15px] font-semibold text-foreground">
                        {detalle || "—"}
                      </span>
                    </span>
                    {extra > 0 && (
                      <span className="shrink-0 text-xs font-bold tabular-nums text-amber-800">
                        +{formatCurrency(extra)}
                      </span>
                    )}
                    <span className="shrink-0 text-xs font-semibold text-emerald-700">
                      cambiar
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* El desglose sólo cuando las líneas NO valen lo mismo (D5): con
          adicionales por opción, resumirlo como un precio por N sería mentir
          sobre plata en la pantalla donde se decide qué se cobra. */}
      {esBloque && !lineasValenIgual(lineas) && (
        <section>
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Cómo suma
          </p>
          <ul className="mt-1.5 space-y-1">
            {agruparPorImporte(precioMenuCents, lineas).map(
              ({ importe, cuantos }) => (
                <li
                  key={importe}
                  className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm ring-1 ring-border/60"
                >
                  <span className="text-foreground/70 tabular-nums">
                    {cuantos} × {formatCurrency(importe)}
                  </span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCurrency(importe * cuantos)}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Las líneas juntadas por lo que sale cada una, para el desglose del resumen. */
function agruparPorImporte(
  precioMenuCents: number,
  lineas: Linea[],
): { importe: number; cuantos: number }[] {
  const porImporte = new Map<number, number>();
  for (const linea of lineas) {
    const importe = precioMenuCents + choicesDeltaCents(linea);
    porImporte.set(importe, (porImporte.get(importe) ?? 0) + 1);
  }
  return [...porImporte]
    .sort((a, b) => b[0] - a[0])
    .map(([importe, cuantos]) => ({ importe, cuantos }));
}

/**
 * ¿El asistente todavía tiene que mostrar este paso?
 *
 * Lo normal es «mientras le falten líneas». La excepción son los grupos de
 * modificadores opcionales o de varias opciones (spec 083 · FR-003): marcar uno
 * los deja «resueltos» para el motor, pero «ninguno» y «dos» también son
 * respuestas válidas, así que el paso lo cierra el usuario con «Seguir» — si
 * no, marcar la primera salsa saltaría de paso sin dejar elegir la segunda.
 */
function sigueAbierto(paso: PasoAgrupado, saltados: ReadonlySet<string>): boolean {
  if (saltados.has(paso.clave)) return false;
  if (paso.faltan > 0) return true;
  return (
    paso.step.kind === "modifiers" && !isSingleChoiceGroup(paso.step.group)
  );
}

/**
 * Las elecciones de una línea, en el orden en que el encargado definió los
 * grupos del menú.
 *
 * Pisar una elección la borra y la vuelve a poner, y un `Map` manda al final lo
 * que se re-inserta: sin esto, corregir el principal lo dejaría después del
 * postre en `selected_choices` y en el resumen. El orden del menú es el que se
 * lee en la comanda.
 */
function enOrdenDelMenu(groups: DailyMenuChoiceGroup[], linea: Linea): Linea {
  const out = new Map() as Linea;
  for (const g of groups) {
    const sel = linea.get(g.choice_group_id);
    if (sel) out.set(g.choice_group_id, sel);
  }
  // Una elección de un grupo que ya no está en el menú no se pierde: va al final.
  for (const [k, v] of linea) if (!out.has(k)) out.set(k, v);
  return out;
}

/**
 * «para 2 Milanesa»: para cuáles de las N líneas es este paso, cuando no es
 * para todas (spec 155 · D4).
 *
 * Sin la aclaración el mozo cuenta cuatro menús, ve un paso que pide dos, y
 * parece un bug. `null` cuando el paso aplica a todas, que es lo normal.
 */
function paraQuienes(
  paso: PasoAgrupado,
  lineas: Linea[],
  groups: DailyMenuChoiceGroup[],
): string | null {
  if (lineas.length < 2 || paso.lineas.length >= lineas.length) return null;
  // Los modificadores ya saben de qué producto cuelgan.
  if (paso.step.kind === "modifiers") {
    return `para ${paso.lineas.length} ${paso.step.productName}`;
  }
  if (paso.step.kind !== "choice") return null;
  const fuente = grupoQueCondiciona(groups, paso.step.group);
  if (!fuente) return null;
  const cuenta = new Map<string, number>();
  for (const i of paso.lineas) {
    const sel = lineas[i]?.get(fuente);
    if (sel) cuenta.set(sel.product_name, (cuenta.get(sel.product_name) ?? 0) + 1);
  }
  if (cuenta.size === 0) return null;
  return `para ${[...cuenta].map(([n, c]) => `${c} ${n}`).join(" y ")}`;
}

/**
 * De qué grupo depende éste, por cualquiera de los dos mecanismos que conviven:
 * la condición del grupo (spec 087) o el `blocks_choice_group_ids` de la opción
 * del grupo fuente (spec 074).
 */
function grupoQueCondiciona(
  groups: DailyMenuChoiceGroup[],
  group: DailyMenuChoiceGroup,
): string | null {
  if (group.applies_when_group_id) return group.applies_when_group_id;
  const fuente = groups.find(
    (g) =>
      g.choice_group_id !== group.choice_group_id &&
      g.options.some((o) =>
        (o.blocks_choice_group_ids ?? []).includes(group.choice_group_id),
      ),
  );
  return fuente?.choice_group_id ?? null;
}
