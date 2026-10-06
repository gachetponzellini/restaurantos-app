# 211 · Rendición en un toque, y el mozo sabe cuánto entregar

**Issue:** [#381](https://github.com/gachetponzellini/RestaurantOS-app/issues/381) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto. Juan aprobó el 2026-10-06 "Entregó justo" en un toque, la
vista del mozo y que el mozo que sólo cobró con tarjeta siga rindiendo
([análisis](../../../../wiki/analyses/2026-10-06-cierre-y-rendicion-ux.md)).

## Por qué

- **El caso más común cuesta lo mismo que el raro.** Que el mozo entregue justo
  igual obliga a tipear el monto (`RendirModal`, `rendicion-en-caja.tsx:534`).
- **El mozo que sólo cobró con tarjeta "rinde $0"** con un botón "Cerrar período".
  En realidad lo que pasa es que **se le da la propina de tarjeta del cajón**, y la
  pantalla no lo dice así.
- **El bloqueo no lleva a ningún lado.** "Tiene mesa 5, mesa 7 sin cobrar" no tiene
  link a las mesas (`mesas-sin-cobrar.ts:63-66`).
- **Cosas escondidas.** El historial de rendiciones, la reimpresión y la asignación
  caja↔usuario viven en un `<details>` (`rendicion-en-caja.tsx:144-165`).
- **El mozo no sabe cuánto tiene que entregar.** El número lo ve sólo el encargado, y
  la discusión se da en el mostrador.

## Qué cambia

- **R1 · Un solo formulario de rendición:** el `RendirModal`. Lo usan la franja de la
  spec 209 y la sección del board. El formulario inline del modal de cierre se borra
  en la spec 209.
- **R2 · "Entregó justo" en un toque.**
  - Arriba del modal: **"Tiene que entregar $X"**, con el detalle de propina como hoy.
  - Botón primario grande: **"Entregó $X justo"**. Registra `delivered = expected`,
    por canal si hay varios.
  - Debajo, **"Entregó otro monto"**: abre los inputs actuales (uno por canal) con
    Falta / Sobra / Cuadra y el motivo obligatorio.
  - **"No entregó"** pasa a ser una tercera acción, de menor peso (texto).
- **R3 · Mozo sin efectivo.** Cuando `efectivo_cents = 0`, el modal se llama **"Cerrar el
  turno de Ana"**:
  - con propina a pagarle, el CTA es **"Darle $P de propina y cerrar"**;
  - sin propina, **"Cerrar su turno"**.

  Sigue siendo una fila de `mozo_rendiciones`: el mozo sólo-tarjeta **sigue rindiendo**
  (decisión de Juan). Lo que cambia es el texto y que se resuelve en un toque.
- **R4 · El bloqueo lleva a la mesa.** Cada mesa del cartel es un link a
  `/{slug}/admin/mesa/{id}/cobrar`.
- **R5 · Nada escondido.**
  - **"Rendiciones anteriores"** pasa a ser un link a la página nueva
    `/{slug}/admin/caja/rendiciones`, con la tabla actual e "Imprimir". Usa el mismo
    gate que los cierres (`canHacerCorte`).
  - **La asignación caja↔usuario** se muda a la configuración de cajas
    (`/admin/caja`, sólo admin), donde está el resto de la configuración.
- **R6 · El mozo ve su turno en el celular.** En `/{slug}/mozo`, una tarjeta "Tu turno":
  - "Tenés que entregar **$X** en efectivo" (el mismo `getRendicionPendienteMozo` del
    encargado: tiene que ser el mismo número);
  - la propina: "$P de propina te dan en caja" (tarjeta/QR) y "$E ya la tenés en
    efectivo";
  - "Mesas sin cobrar: 5, 7", si hay;
  - después de rendir: "Rendiste a las 01:12 · entregaste $X". Si figura **no
    entregó**: "Quedó pendiente: $X".

  El mozo id sale de la sesión y **nunca** de un parámetro. Se agrega el permiso
  `canVerMiTurno(role)` en `can.ts` (mozo y encargado). La tarjeta se carga
  aparte (Suspense) para no frenar el salón del mozo (ver
  [perf percibida](../../../../wiki/analyses/perf-percibida-operacion-mozo.md)).
- **R7 · Glosario** de la spec 209 · R8, aplicado a la rendición:

  | Concepto | Término |
  |---|---|
  | Lo que debería entregar | **Tiene que entregar** (encargado) · **Tenés que entregar** (mozo) |
  | Lo que entregó | **Entregó** |
  | La diferencia | **Falta / Sobra / Cuadra** |

## Escenarios

- **Dado** un mozo con $45.000 a rendir, **cuando** el encargado toca "Entregó $45.000
  justo", **entonces** queda rendido, sin tipear nada.
- **Dado** que entregó $44.000, **cuando** el encargado toca "Entregó otro monto" y
  carga $44.000, **entonces** ve "Falta $1.000" y no puede registrar sin motivo.
- **Dado** un mozo que sólo cobró con tarjeta con $3.000 de propina, **entonces** el
  modal dice "Darle $3.000 de propina y cerrar", y al confirmarlo se registran la
  rendición y el movimiento `propina`.
- **Dado** un mozo con la mesa 5 sin cobrar, **entonces** "mesa 5" es un link a su cobro.
- **Dado** el mozo Diego logueado, **entonces** ve en `/mozo` exactamente el mismo
  "tiene que entregar" que ve el encargado, y no puede ver el de otro mozo.

## Fuera de alcance

- Que el mozo **declare** desde el celular lo que entrega. Puede ser una fase
  posterior: hoy la rendición la registra el encargado.
- Las reglas de quién rinde (spec 210).
