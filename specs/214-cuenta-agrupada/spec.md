# Spec 214 · La cuenta junta los productos repetidos

**Estado:** aprobada por Juan (2026-10-08), a partir de un pedido de la encargada de KCC. Issue #387.

## Problema

La cuenta imprime un renglón por cada carga (`order_items`). Si la mesa pide 4 gaseosas y después una
más, el papel dice `4x Gaseosa` arriba y `1x Gaseosa` abajo de todo. La encargada: «asi no se puede
controlar bien».

## Decisiones

- **D1:** se juntan los renglones del **mismo producto al mismo precio unitario**. Cantidad e importe se
  suman. Si el precio cambió entre una carga y otra, quedan separados: no se inventa un precio promedio.
- **D2:** el orden es el de la primera aparición del producto.
- **D3:** aplica a la cuenta y a la lista de ítems de cada parte de la cuenta dividida (`por_items`,
  `por_comensal`).
- **D4:** la comanda de cocina y el control de delivery/retiro no cambian. En la comanda importa qué
  salió en cada tanda.

## Requisitos

- **R1:** `agruparItemsCuenta(items)`: pura, junta por `product_name` y precio unitario
  (`line_total_cents / quantity`), conserva el orden.
- **R2:** `buildCuentaTicketLines` imprime los ítems agrupados.
- **R3:** el print-agent agrupa los ítems de cada parte antes de pasarlos a texto.

## Fuera de alcance

Pantallas (salón, caja). Esto es sólo el papel.
