# Spec 216 · La caja carga más rápido (fase 1)

**Estado:** aprobada por Juan (2026-10-08): «optimizá sin tocar el server» (sin cambiar la región de
Vercel). Issue #389.

## Problema

KCC (2026-10-08): la tab Caja tarda mucho en cargar y «editar un movimiento del período» tarda mucho en
abrir.

Medido en los logs:

- La base no es el cuello: una carga de la caja son ~26 queries y ~300 ms de base.
- ~~Las funciones de Vercel corren en **gru1** y la base en **us-east-1**: cada ronda de queries
  encadenadas cuesta ~130 ms de viaje.~~ **Corrección (2026-10-08):** las funciones corren en **iad1**,
  la misma región que la base (`regions: ["iad1"]` en cada deploy). El `region=gru1` de los runtime logs
  es el nodo de borde por donde entra el pedido desde Argentina, no donde corre la función. Cada ronda
  encadenada cuesta poco; los cambios de esta spec siguen siendo válidos (menos rondas en serie, menos
  queries repetidas) pero ganan menos de lo estimado.
- La región ya es la correcta: no hay nada que mover.

## Decisiones

- **D1:** sólo cambios de código, sin cambiar comportamiento: se paralelizan lecturas que no dependen
  entre sí.
- **D2:** el preview del efecto de una corrección **no** se toca: se verificó que no se dispara al abrir
  (el reset del estado cancela el debounce antes de los 300 ms).

## Requisitos

- **R1 · libro** (`getLibroDeMovimientos`, lo paga cada «editar movimiento»): las cajas y las rendiciones
  salen en la misma ronda que cobros y movimientos. 4 rondas → 2.
- **R2 · stats de la caja** (`/api/caja/stats`, cada 30 s por caja):
  - caja + slug del negocio en una query (2 rondas → 1);
  - `getCajaLiveStats`: caja ∥ último corte, pagos ∥ `desglose_esperado_caja` (4 → 2);
  - `getPaymentsPeriodoActual`: nombres de mozos ∥ comprobantes (4 → 3).
- **R3 · «editar»**: aviso «Abriendo el movimiento…» mientras llega el renglón.

## Fuera de alcance (fase 2)

- `saldos_mozos` / `saldo_mozo` sin ventana (362 ms promedio, picos de 5 s): necesita migración y TDD.
- Cargar en el servidor sólo la tab que se mira.
- Un endpoint de stats por negocio en vez de uno por caja.
