# 207 · Tareas

- [x] Migración `0131_la_pizza_tiene_gustos.sql` (`is_variant`) + aplicada al cloud + `database.types.ts` actualizado a mano (`pnpm db:types` no linkea desde acá — ver nota)
- [x] R1 test rojo `schemas.test.ts` → refine en `ModifierGroupInput` / `ProductInput` (+ a lo sumo un grupo variante por producto, `superRefine` con path)
- [x] R2 test rojo `variantes.test.ts` → `src/lib/catalog/variantes.ts` (`grupoVariante`, `rangoDePrecio`, `etiquetaDePrecio`, `filasDeCarta`, `estaAgotado`)
- [x] Selects: `menu.ts`, `mozo/catalog-query.ts`, `admin/catalog-query.ts` traen `is_variant`
- [x] R3 `product-modal.tsx`, `product-sheet.tsx`, `product-card.tsx`, `product-results-list.tsx`
- [x] R4 `carta-client.tsx` una fila por gusto
- [x] R5 agotado: producto sin ningún gusto prendido se ve agotado (`estaAgotado`) en carta/card, y el mozo no lo lista (hallazgo de code-review, no estaba en la spec original)
- [x] R6 `modifier-groups-editor.tsx` (switch «Variantes con precio final», fija 1-1 obligatorio) + `product-actions.ts` persiste el flag
- [x] `pnpm typecheck && pnpm test` — 406 archivos, 3812 tests, verde
- [x] Datos kcc (OK de Juan, 2026-09-21): producto "Pizza" $16.000 + grupo
      "Gusto" (Muzarella +0, Napolitana +2.000, Especial +6.000, Veggie +6.000);
      los 4 productos viejos desactivados (`is_active=false`)
- [x] Verificado en vivo, rol público real, https://restaurant.mithandir.com/kcc/carta:
      4 filas con precio final correcto, ninguna tachada

**Nota:** `pnpm db:types` pide `supabase link` (no configurado en este entorno);
se generó con `supabase gen types --project-id` y, al fallar igual por falta de
token, se agregó `is_variant` a mano en `database.types.ts` acorde a la
migración aplicada. Revisar con `pnpm db:types` la próxima vez que haya sesión
de `supabase login`.
