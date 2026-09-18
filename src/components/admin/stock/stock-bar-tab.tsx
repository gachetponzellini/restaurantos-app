/**
 * Spec 205 · D12: la tabla y los modales de la tab Bar pasaron a
 * `stock-list.tsx` / `stock-bar-add-modal.tsx` (mismo patrón que Bebidas y
 * Cocina). Este archivo sólo sobrevive por el tipo — `catalog-shell.tsx` lo
 * importa y ese archivo no se toca en esta spec (regla del encargo).
 */
export type BarStockCandidate = {
  id: string;
  name: string;
  categoryName: string | null;
};
