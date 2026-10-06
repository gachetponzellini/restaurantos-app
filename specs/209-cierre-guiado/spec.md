# 209 · Cierre guiado: el próximo paso siempre a la vista, y conteo ciego

**Issue:** [#379](https://github.com/gachetponzellini/RestaurantOS-app/issues/379) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto. Juan aprobó la dirección y el conteo ciego el 2026-10-06
([análisis](../../../../wiki/analyses/2026-10-06-cierre-y-rendicion-ux.md)).

**Input:** Juan: *"hay que hacer que el proceso de cierre de caja y rendición sea
más intuitivo, que tenga mejor affordance… tiene que ser muy intuitivo y fácil de usar"*.

## Por qué

La plata cierra bien desde el epic #361. Lo que falla es el **camino** para llegar al cierre:

- **El paso final parece el único paso.** `Cerrar caja` es el botón más visible del
  board (`caja-admin-board.tsx:430-448`). Sin embargo, en la caja principal es el
  último paso de una secuencia: cobrar las mesas abiertas, rendir a los mozos
  (obligatorio desde la spec 139 / #210), contar y cerrar.
- **Los prerequisitos aparecen tarde.** Recién se ven adentro del modal, y el botón
  final queda gris sin decir por qué (`cerrar-caja-modal.tsx:122-129`).
- **Para resolverlos hay que salir.** "Ir al salón a cobrarlas" cierra el modal.
- **El modal repite información.** Repite las ventas del board y tiene un segundo
  formulario de rendición, distinto del `RendirModal` (`cerrar-caja-modal.tsx:543-725`).
- **El conteo empuja a cuadrar.** El modal muestra el esperado antes de contar y la
  franja "Te falta / Te sobra" en vivo mientras se tipea, así que se cuenta hacia el
  número.
- **El cierre termina en un toast.** El papel ya salió (`0122:277`), pero nadie lo
  dice, y el resumen archivado (spec 149) hay que ir a buscarlo.

## Qué cambia

- **R1 · Franja «Cierre del día».** Arriba de la tab Caja, siempre visible, para la
  caja principal (`barre_salon`):

  | Paso | Origen del dato | Estado y acciones |
  |---|---|---|
  | **① Mesas cobradas** | `cuentas_abiertas` | Una fila por mesa (mesa, mozo, monto). **Cobrar** lleva a `/{slug}/admin/mesa/{id}/cobrar`. |
  | **② Rendiciones** | `deben_rendir` | Muestra "N de M". Una fila por persona. **Rendir** abre el `RendirModal` (spec 211, #381). |
  | **③ Contar y cerrar** | — | Se habilita con ① y ② en verde. |

  Las cajas no principales muestran sólo ③.

  `getCierreCajaData` hoy se pide recién al abrir el modal (`operacion/actions.ts:170`).
  Pasa a cargarse con el board y a refrescarse con el mismo poll de 30 s de los stats.
- **R2 · Un solo botón primario, que es el próximo paso.** Su texto cambia según el estado:
  - "Cobrar mesa 7";
  - "Rendir a Ana" (o "Faltan 3 rendiciones" si hay varias);
  - "Contar y cerrar".

  **Nunca hay un botón deshabilitado sin un texto que diga qué falta.**
  `Sangría` e `Ingreso` pasan a acciones secundarias, de menor tamaño y sin color primario.
- **R3 · El modal de cierre es sólo para contar.**
  - Se borran el bloque "La plata del período" (queda en el board) y el formulario
    inline de rendición, con su "No entregó".
  - Si al abrir el modal aparece un bloqueante (por una carrera, porque alguien cobró
    en el medio), se muestra con su acción, igual que en R1, y no se deja contar.
- **R4 · Conteo ciego, en dos pasos.**
  1. **"Contá la plata del cajón".** Se carga el efectivo contado, o el conteo por
     billete, que se ofrece primero. **No se muestran el esperado ni la diferencia.**
     El botón es "Listo, conté".
  2. **Resultado.** Muestra **Contaste $X · Debería haber $Y · Falta $Z / Sobra $Z /
     Cuadra**. Si hay diferencia, se ofrecen dos salidas:
     - **"Volver a contar"**: vuelve al paso 1 con el conteo vacío;
     - **"Cerrar con esta diferencia"**: exige el motivo y aplica el techo del
       encargado, como hoy.

  Cada conteo descartado se guarda en `resumen.recuentos` como `[{cents, at}]`. Se
  muestra en el resumen archivado y en el papel como "Recontado: 1.º $X". No hace
  falta migración: `resumen` ya es jsonb y lo arma `cerrarCaja` (`actions.ts:513`).
- **R5 · "Contar sin cerrar" es una acción aparte.** Se saca el checkbox "Retirar
  todo el efectivo" del cierre: cerrar **siempre** retira, respetando
  `fondo_fijo_cents`. El arqueo de mitad de turno (`retirar: false`) pasa a ser
  una acción secundaria del board, con el mismo flujo ciego y el CTA "Guardar arqueo".
- **R6 · Si entró un cobro mientras contabas, no se recuenta.** Ante
  `EXPECTED_CHANGED:<n>`, `cerrarCaja` devuelve `{ code, esperado_cents,
  delta_cents }` en lugar de sólo texto (`actions.ts:586-591`). La pantalla de
  resultado se actualiza con "Entró $X en efectivo mientras contabas", recalcula
  la diferencia sobre lo ya contado y pide confirmar de nuevo.
- **R7 · Después de cerrar va el resumen, no un toast.** Se navega a
  `/{slug}/admin/caja/cierres/{corte.id}` con el banner "✓ Caja cerrada · retiraste $X".
  - El banner suma "· el papel salió por la comandera" o "· no hay comandera
    configurada", con la misma regla que `ReimprimirCierreBoton`.
  - Si se liberaron mesas, lo dice.
- **R8 · Glosario único**, en board, modal, resumen y cierres:

  | Concepto | Término único |
  |---|---|
  | Lo que debería haber | **Debería haber** |
  | Lo que hay | **Contaste** |
  | La diferencia | **Falta / Sobra / Cuadra** |
  | Las operaciones | **Cerrar caja** · **Contar sin cerrar** |

  "Corte" y "arqueo" salen de la UI, aunque siguen en el código. Los rótulos viven
  en `src/lib/caja/textos.ts` para que no vuelvan a divergir.
- **R9 · Orden del board.** De arriba hacia abajo: franja de cierre → Debería haber /
  Cobrado → rendición → movimientos.

## Decisiones

- **D1 · Alcance del conteo ciego.** Es ciego **en el momento de contar**. Durante el
  turno, el board sigue mostrando "Debería haber", porque lo necesita para operar
  (sangrías, cambio). Esto saca el feedback en vivo, que es lo que empuja a cuadrar,
  pero **no** es un control contra un encargado que quiera tapar un faltante: ese
  encargado puede mirar el board antes de abrir el modal. Para eso hacen falta
  segregación de roles o una revisión del dueño sobre `recuentos` y las diferencias.
  Queda fuera de alcance.
- **D2 · La rendición no es ciega.** El mozo ve su monto en el celular (spec 211), así
  que ocultárselo al encargado no protege nada.
- **D3 · El conteo por billete va primero**, porque es el que deja rastro
  (`denomination_count`). El total libre sigue disponible.

## Escenarios

- **Dado** que la caja principal tiene la mesa 7 abierta y 2 mozos sin rendir,
  **entonces**:
  - la franja muestra ① en rojo con "Cobrar" hacia `/admin/mesa/{id}/cobrar`;
  - ② muestra "0 de 2";
  - el botón primario dice "Cobrar mesa 7";
  - no existe ningún botón de cierre deshabilitado y mudo.
- **Dado** que ① y ② están en verde, **entonces** el botón primario es "Contar y cerrar".
- **Dado** que abro "Contar y cerrar", **entonces** no veo el esperado ni la
  diferencia hasta apretar "Listo, conté".
- **Dado** un conteo con diferencia, **cuando** aprieto "Volver a contar",
  **entonces**:
  - el input queda vacío;
  - al cerrar, el resumen archivado lista el conteo descartado.
- **Dado** que entra un cobro en efectivo de $5.000 entre "Listo, conté" y "Cerrar",
  **entonces** no se pierde lo contado: se ve "Entró $5.000 mientras contabas" y la
  diferencia recalculada.
- **Dado** un cierre exitoso, **entonces** estoy en el resumen del cierre con el banner
  y el aviso del papel.
- **Dado** una caja de bar (no principal), **entonces** la franja sólo muestra ③ y
  cierra en plena cena, como hoy (spec 130 · D9).

## Fuera de alcance

- La lógica del cierre en la base y la regla de quién rinde (spec 210, #380).
- El formulario de rendición y la vista del mozo (spec 211, #381).
- Ocultar el esperado del board.
