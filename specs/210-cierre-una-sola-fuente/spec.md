# 210 · La plata del mozo es del mozo hasta que la entrega (modelo de caja v2)

**Issue:** [#380](https://github.com/gachetponzellini/RestaurantOS-app/issues/380) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto (v2, reescrito el 2026-10-06). Reemplaza la v1 de esta spec
("una sola fuente en la base"), cuyo alcance queda adentro de esta versión.

**Input y decisiones de Juan (2026-10-06):**

- *"No podemos tener problemas de cuentas, tiene que dar todo perfecto"*.
- *"Tiene que ser muy sólido el sistema y simplificarle la vida a la encargada"*.
- Cobro de una mesa que registra la encargada: la plata es del mozo de la mesa (se mantiene la spec 140 · D5).
- La propina de tarjeta/QR el mozo **se la queda de lo que trae**: entrega el neto.
- *"Habría que copiar de MaxiRest, tendría que ser la misma lógica"*: un turno para todo el local, y cada caja se cuenta igual.
- *"Hay dos cajas y son independientes: a la hora de cobrar ponen a qué caja va la plata, y si se confunden después lo corrigen"*. Y además: *"en el 95% de los casos los mozos van a tener sólo una caja"*.
- *"No tiene sentido que te deje cerrar una caja sin haber rendido todo"*.

Relevamiento de MaxiRest con datos de KCC:
[`maxirest/cajas-y-turnos.md`](../../../../wiki/negocio/competencia/maxirest/cajas-y-turnos.md#verificación-con-datos-reales-de-kcc-2026-10-06).
Maqueta aprobada: <https://claude.ai/artifact/UJtECquzgkA8ZqEecX8oEP>.

## Por qué

Hoy el efectivo que cobra un mozo **entra al "debería haber" de la caja en el momento
del cobro**, aunque esté en su bolsillo. Recién llega al cajón cuando rinde, y la
rendición no dice a qué caja. Mientras haya una sola caja y nadie cierre antes de que
rindan, da bien. Si no, se rompe. Verificado en vivo el 2026-10-06 en `demo` local:

- **Dos cajas:** la plata de mozos cobrada en la Caja Bar se rinde en el cierre de la
  Principal. Sobra en una y falta en la otra.
- **Una caja que cierra antes de las rendiciones** (la Bar no las pide) da por retirada
  plata que nunca estuvo en el cajón.
- **"Rendir no cambia el total":** la pantalla tiene que explicar que la plata "pasa de
  una columna a otra". No se entiende.
- **La propina de tarjeta:** el mozo entrega $X, se le devuelven $Y del cajón, y el cajón
  sube X−Y. Son dos números para un solo intercambio.

Además, todo lo de la v1 sigue vigente:

- El esperado y la regla de "quién debe rendir" están duplicados entre TS y SQL.
- Hay validaciones que sólo existen en TS.
- `retiro_cents` se recalcula en TS.

## El modelo

Tres reglas. Cada una cierra un hueco de los de arriba.

1. **El cajón espera sólo la plata que físicamente tiene.** El efectivo que cobró un mozo
   queda **a su nombre** y no suma al "debería haber" de ninguna caja.
2. **La plata del mozo entra al cajón cuando la entrega, en la caja que se eligió en el
   cobro.** Queda como una línea de esa caja ("Rendición de Pedro +$371.600"). Puede
   entregar en partes. Lo que no entregó sigue en su **saldo por caja**, que no se pierde
   con ningún cierre. Las cajas son independientes: la plata de una nunca termina en la otra.
3. **Una caja no cierra con plata pendiente, y el turno es uno para todo el local, como en
   MaxiRest:**
   - cada caja se cuenta y se cierra igual, pero **sólo con las mesas cobradas y todo lo
     de esa caja rendido**, o con la deuda reconocida;
   - **cerrar el turno** exige todas las cajas cerradas;
   - recién ahí libera el salón y saca el papel del turno.

Con esto, los números de efectivo **siempre** cierran:
`cobrado en efectivo = lo cobró la caja + rendido + a rendir + propinas de los mozos + deudas`.

## Qué cambia

### R1 · Quién tiene la plata, fijado al cobrar

- `payments` suma `efectivo_de uuid null` (FK `users`, con el scope de `business_id`).
- Un trigger `BEFORE INSERT` lo completa con la **misma** regla que hoy decide quién
  rinde (`mozos_que_deben_rendir`):
  - **el mozo atribuido**, si el cobro es en efectivo y ese mozo rinde;
  - **`null`** en cualquier otro caso: la plata entró al cajón.
- Se fija en el momento del cobro y no se recalcula después. Cambiar la asignación de
  operadores no reescribe la historia, y la regla vive en un solo lugar.

### R2 · El "debería haber" de una caja

`efectivo_esperado_caja` (SQL, única fuente; se borra la copia en TS) pasa a ser:

```
apertura (fondo que quedó del corte anterior)
+ cobros en efectivo de esta caja con efectivo_de IS NULL   (monto con propina)
+ rendiciones entregadas en esta caja                       (caja_movimientos kind='rendicion')
+ ingresos − sangrías
− propinas pagadas del cajón                                (sólo el caso de R4)
```

### R3 · La rendición es una entrega

- `registrar_rendicion_tx` deja de calcular un "esperado del período". Ahora registra
  una **entrega**: `mozo_id`, `caja_id` y `entregado_cents`. **La caja de la entrega es
  la de los cobros:** el mozo entrega a cada caja lo que cobró para ella.
  Inserta, en la misma transacción, la línea `caja_movimientos(kind='rendicion', mozo_id, corte_id null)`.
- **Saldo del mozo, por caja** = su cuenta corriente con esa caja. Lo calcula la función
  SQL `saldo_mozo(mozo_id, caja_id)`:

  ```
  Σ cobros en efectivo de esa caja con efectivo_de = mozo   (monto − propina: lo de la cuenta)
  − Σ propinas de sus cobros con tarjeta/QR/transferencia de esa caja   (se las queda: R4)
  − Σ entregas en esa caja
  ```

  **En el 95% de los casos el mozo tiene saldo en una sola caja.** Para la pantalla,
  entonces, es un solo número. El desglose por caja sólo se muestra cuando tiene en dos
  (spec 211 · R2).

  La propina en efectivo ya la tiene, así que no entra.
- **Entregó justo:** `entregado = saldo`. **De menos:** queda saldo, sin motivo
  obligatorio, porque es una entrega parcial y puede traer el resto. **De más:** entra
  al cajón y queda anotado como sobrante en la entrega.
- **No entregó:** se registra un `reconocimiento` de deuda (motivo obligatorio y aviso
  al dueño, como hoy). No mueve plata. El saldo sigue ahí hasta que lo entregue.
- **Anular una entrega** (motivo obligatorio): la línea de caja queda anulada y el saldo
  vuelve. Es la única forma de corregir un cobro de un mozo que ya rindió (R6).

### R4 · Propina de tarjeta/QR: neta

- El mozo **se queda su propina de lo que trae para la misma caja del cobro**, que es lo que hace MaxiRest: línea de
  efectivo negativa en el mismo comprobante, 722 casos en KCC. "Tiene que entregar" ya
  viene neto.
- **Si no le alcanza el efectivo** (cobró todo con tarjeta), el saldo da negativo: **la
  caja le debe**. La rendición lo resuelve con "Darle $X de propina del cajón", que es
  un `caja_movimientos(kind='propina')` como hoy (spec 177).

### R5 · El turno

- **Tabla nueva `turnos`:** `business_id`, `nombre` (Mediodía/Noche, opcional),
  `abierto_at`, `cerrado_at`, `cerrado_por` y `resumen` (jsonb para el papel). Siempre
  hay **uno abierto** por negocio, garantizado con un índice único parcial.
- **`cerrar_caja_tx`** bloquea la caja y valida, en la base:
  - no quedan **cuentas de mesa abiertas** (`OPEN_TABLE_ORDERS`), porque se podrían
    cobrar en esta caja;
  - **ningún mozo tiene saldo pendiente en esta caja**: o lo entregó, o tiene la deuda
    reconocida con motivo (`UNRENDERED_MOZOS`).
- **`cerrar_turno_tx`** valida que **toda caja de turno** con movimientos en el turno tenga
  un corte posterior a su último movimiento (`CAJA_SIN_CONTAR`). Las mesas y los mozos ya
  están resueltos, porque ninguna caja cerró sin eso.

  Después:
  - barre el salón (libera mesas y limpia la distribución, con audit);
  - cierra el turno y abre el siguiente;
  - encola el papel del turno: cajas, rendiciones y deudas.
- **`cerrar_caja_tx`** deja de barrer el salón: eso pasa a `cerrar_turno_tx`. **Todas las
  cajas cierran igual**, con las mismas dos condiciones de arriba: conteo ciego, diferencia y retiro (209). `p_barrer_salon` desaparece.
  Que la Principal ya no sea especial en el cierre no cambia que sea `is_default` para
  la comandera fiscal.

### R6 · Correcciones en la base, con vista previa

- **`corregir_pago_tx` acepta además** `attributed_mozo_id`, `caja_id` y `tip_cents`, y
  recalcula `efectivo_de` con la regla de R1. Es el camino para **"se confundieron de
  caja"**: el cobro pasa a la otra caja y, con él, el saldo del mozo.
- **Guarda nueva (`MOZO_YA_RINDIO`):** si el cobro **sale de** un mozo, o **pasa a** un
  mozo, que ya entregó en este turno, se rechaza. Para corregirlo primero se anula su
  entrega (R3).
- **La propina no puede superar el monto** (`TIP_EXCEEDS_AMOUNT`).
- **RPC `efecto_de_correccion(payment_id | movimiento_id, cambios)`**, sólo lectura.
  Devuelve el "debería haber" de cada caja afectada y el saldo de cada mozo afectado,
  **antes y después**. Calcula con las mismas funciones de R2 y R3: lo que muestra la
  vista previa es lo que va a quedar.

### R7 · Validaciones duras en la base (de la v1)

- **Cierre y entrega:** nota obligatoria con diferencia (`NOTES_REQUIRED`). Techo del
  encargado (`DIFFERENCE_OVER_LIMIT`), leyendo el rol del actor en `business_users`.
- **Entrega con mesa del mozo sin cobrar** (`MOZO_HAS_OPEN_TABLES`).
- **`retiro_cents` sale de `cerrar_caja_tx`.**
- TS conserva estas validaciones para dar feedback inmediato, pero la que decide es la base.

### R8 · Pasaje sin descuadre

- **Cada negocio tiene `caja_modelo_v2_desde timestamptz`.** La migración lo deja en `null`.
- **Se activa sola al cerrarse el próximo turno**, porque en ese momento no hay plata de
  mozos en el aire: todos rindieron o tienen la deuda reconocida, y las cajas están contadas.
- **Los cobros anteriores a esa fecha** siguen con la regla vieja y `efectivo_de` queda `null`.
- **Las deudas reconocidas con el modelo viejo** se migran como saldo inicial del mozo.
- **Los cierres archivados no se recalculan**, porque guardan su esperado y su resumen.

## Decisiones

- **D1 · Fijar `efectivo_de` al cobrar** en lugar de recalcularlo. Hoy la regla de
  "quién rinde" depende de las asignaciones de operador y se evalúa al leer, y por eso
  existe la duplicación TS/SQL. Fijada al cobrar, el pasado no cambia y la regla vive
  en un solo lugar.
- **D2 · Saldo corrido por mozo** en vez de una "rendición por período". Es la cuenta
  corriente del mozo: nunca se pierde un peso entre cierres y la entrega parcial sale
  gratis. MaxiRest tiene la estructura (`mxrenmov`, "Rend Parcial").
- **D3 · Turno global, conteo por caja**, como MaxiRest (`mxpaa` turno único, `mxrcj`
  por `prefijo` + turno). Elimina la asimetría Principal/Bar. **Ninguna caja cierra con
  plata pendiente** (decisión de Juan): se revierte la spec 130 · D9 ("la Bar cierra en
  plena cena"), que en el Golf nunca se usó (la segunda caja no tiene ningún cierre).
- **D4 · Se rinde sólo el efectivo.** MaxiRest permite configurar rendir también cupones
  de tarjeta (`mxfor.rinde`). Queda fuera de alcance, y el modelo lo admite después.

## Escenarios

- **Mozo con plata de las dos cajas.**
  - **Dado:** Pedro cobra $91.000 en efectivo de una mesa con la caja «Bar» elegida, y
    $280.600 netos para la Principal.
  - **Entonces:** el "debería haber" de ninguna de las dos cambia, y su saldo es $91.000
    en la Bar y $280.600 en la Principal.
  - **Cuando** entrega, **entonces** cada monto sube su caja, y ninguna queda descuadrada.
- **Se confundieron de caja.**
  - **Dado:** el cobro de $91.000 debía ir a la Principal.
  - **Cuando** se corrige la caja (con motivo), **entonces** el saldo de Pedro pasa de la
    Bar a la Principal. La vista previa lo dice antes de guardar.
- **Una caja con plata pendiente no cierra.**
  - **Dado:** Pedro tiene $91.000 de la Bar sin entregar.
  - **Cuando** se intenta cerrar la Bar, **entonces** `UNRENDERED_MOZOS`.
  - **Cuando** Pedro entrega, o se le reconoce la deuda, **entonces** la Bar cierra con lo
    que hay en su cajón.
- **Propina de tarjeta neta.**
  - **Dado:** Pedro cobró $380.000 en efectivo (cuentas) y tiene $8.400 de propina con tarjeta.
  - **Entonces:** tiene que entregar $371.600.
  - **Cuando** entrega justo, **entonces** el cajón sube $371.600 y no hay ningún
    movimiento de propina.
- **Mozo que sólo cobró con tarjeta.**
  - **Dado:** cobró sólo con tarjeta y tiene $3.000 de propina.
  - **Entonces:** el saldo es −$3.000. La rendición ofrece "Darle $3.000 del cajón", y el
    cajón baja $3.000.
- **Entrega parcial.**
  - **Dado:** Lucía debe $182.400 y entrega $150.000.
  - **Entonces:** el cajón sube $150.000 y su saldo queda en $32.400.
  - **Cuando** se intenta cerrar esa caja, **entonces** `UNRENDERED_MOZOS`, hasta que
    entregue o se reconozca la deuda.
- **Mesa abierta.**
  - **Dado:** queda la mesa 7 con la cuenta abierta.
  - **Cuando** se intenta cerrar cualquier caja, **entonces** `OPEN_TABLE_ORDERS`, con la
    mesa nombrada.
- **Cerrar el turno.**
  - **Dado:** las dos cajas están cerradas y no entró nada después.
  - **Cuando** se cierra el turno, **entonces** se libera el salón y sale el papel.
  - **Si** entró un cobro en una caja después de su cierre, **entonces** `CAJA_SIN_CONTAR`.
- **Corregir un cobro de un mozo que ya rindió.**
  - **Dado:** Diego ya rindió.
  - **Cuando** se intenta corregir un cobro suyo, **entonces** `MOZO_YA_RINDIO`.
  - **Cuando** se anula su entrega, **entonces** se puede corregir y volver a rendir.
- **Vista previa de una corrección.**
  - **Dado:** la Mesa 12 pasa de Pedro a Lucía.
  - **Entonces:** `efecto_de_correccion` devuelve el saldo de Pedro bajando y el de Lucía
    subiendo en el mismo monto, sin tocar ninguna caja.
- **Pasaje al modelo nuevo.**
  - **Dado:** un negocio en el modelo viejo.
  - **Cuando** cierra el turno, **entonces** `caja_modelo_v2_desde` queda fijado. Los
    cobros siguientes usan `efectivo_de`, y los anteriores no se tocan.

## Fuera de alcance

- La interfaz (spec 211).
- Rendir cupones de tarjeta (D4).
- Turnos programados por horario: el turno se cierra a mano.
