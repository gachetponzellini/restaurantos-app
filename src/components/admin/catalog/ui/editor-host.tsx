"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  CLOSED,
  goBack,
  neighbors,
  openLinked,
  openRoot,
  stepTo,
  type EditorRef,
  type EditorState,
} from "@/lib/catalog/editor-nav";

/**
 * Dueño del editor abierto en el catálogo (spec 205 · D6). Vive en el shell, no
 * en cada tab: así el editor de una categoría puede abrir el de un producto, y
 * el de un producto el de un insumo, sin importar en qué tab se está.
 */

export type CatalogEntityKind =
  | "product"
  | "category"
  | "superCategory"
  | "menu"
  | "station"
  | "ingredient";

export type CatalogEditorRef = EditorRef & { kind: CatalogEntityKind };

/** Lo que recibe cada editor concreto: su entidad + la navegación resuelta. */
export type CatalogEditorProps = {
  id: string | null;
  section?: string;
  /** Para crear: datos iniciales (ej. la categoría del filtro activo). */
  draft?: Record<string, unknown>;
  nav: {
    index: number;
    total: number;
    onPrev?: () => void;
    onNext?: () => void;
  } | null;
  back: { label: string; onBack: () => void } | null;
  onClose: () => void;
  /** Abre otro editor apilando éste («Volver»). */
  openLinked: (ref: CatalogEditorRef) => void;
  /** Recién creado: pasa a editar la entidad nueva sin cerrar. */
  onCreated: (id: string) => void;
};

type Api = {
  /** Abre desde una lista; `listIds` es la lista filtrada que recorre ‹ ›. */
  open: (ref: CatalogEditorRef, listIds?: readonly string[]) => void;
  /** Abre el editor vacío para crear. */
  create: (kind: CatalogEntityKind, draft?: Record<string, unknown>) => void;
  openLinked: (ref: CatalogEditorRef) => void;
  current: CatalogEditorRef | null;
};

const Ctx = createContext<Api | null>(null);

export function useCatalogEditor(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("useCatalogEditor fuera de CatalogEditorHost");
  return api;
}

const NEW = "__new__";

export function CatalogEditorHost({
  editors,
  labelOf,
  children,
}: {
  editors: Partial<
    Record<CatalogEntityKind, ComponentType<CatalogEditorProps>>
  >;
  /** Nombre de una entidad, para «Volver a X». */
  labelOf: (ref: CatalogEditorRef) => string;
  children: ReactNode;
}) {
  const [state, setState] = useState<EditorState>(CLOSED);
  const [list, setList] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown> | undefined>();

  const open = useCallback(
    (ref: CatalogEditorRef, listIds: readonly string[] = []) => {
      setList(listIds);
      setDraft(undefined);
      setState(openRoot(ref));
    },
    [],
  );
  const create = useCallback(
    (kind: CatalogEntityKind, d?: Record<string, unknown>) => {
      setList([]);
      setDraft(d);
      setState(openRoot({ kind, id: NEW }));
    },
    [],
  );
  const link = useCallback((ref: CatalogEditorRef) => {
    setState((s) => openLinked(s, ref));
  }, []);

  const current = state.current as CatalogEditorRef | null;
  const api = useMemo<Api>(
    () => ({ open, create, openLinked: link, current }),
    [open, create, link, current],
  );

  let editor: ReactNode = null;
  if (current) {
    const Editor = editors[current.kind];
    const isRoot = state.stack.length === 0;
    const n = isRoot && current.id !== NEW ? neighbors(list, current.id) : null;
    const prev = state.stack[state.stack.length - 1] as
      | CatalogEditorRef
      | undefined;
    if (Editor) {
      editor = (
        <Editor
          key={`${current.kind}:${current.id}`}
          id={current.id === NEW ? null : current.id}
          section={current.section}
          draft={current.id === NEW ? draft : undefined}
          nav={
            n && n.index >= 0
              ? {
                  index: n.index,
                  total: n.total,
                  onPrev: n.prev
                    ? () => setState((s) => stepTo(s, n.prev!))
                    : undefined,
                  onNext: n.next
                    ? () => setState((s) => stepTo(s, n.next!))
                    : undefined,
                }
              : null
          }
          back={
            prev
              ? {
                  label: labelOf(prev),
                  onBack: () => setState((s) => goBack(s)),
                }
              : null
          }
          onClose={() => setState(CLOSED)}
          openLinked={link}
          onCreated={(id) =>
            setState((s) =>
              s.current ? { ...s, current: { ...s.current, id } } : s,
            )
          }
        />
      );
    }
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {editor}
    </Ctx.Provider>
  );
}
