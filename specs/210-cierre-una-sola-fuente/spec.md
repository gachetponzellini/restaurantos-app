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
2. **La plata del mozo entra al cajón cuando la entrega**, como una línea de la caja que
   la recibe ("Rendición de Pedro +$371.600"). Puede entregar en partes. Lo que no
   entregó sigue en su **saldo**, que no se pierde con ningún cierre.
3. **El turno es uno para todo el local, como en MaxiRest:**
   - cada caja se cuenta y se cierra igual;
   - **cerrar el turno** exige mesas cobradas, rendiciones resueltas y cajas contadas;
   - recién ahí libera el salón.

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
  una **entrega**: `mozo_id`, `caja_id` (donde entra la plata) y `entregado_cents`.
  Inserta, en la misma transacción, la línea `caja_movimientos(kind='rendicion', mozo_id, corte_id null)`.
- **Saldo del mozo** = su cuenta corriente. Lo calcula la función SQL `saldo_mozo(mozo_id)`:

  ```
  Σ cobros en efectivo con efectivo_de = mozo   (monto − propina: lo de la cuenta)
  − Σ propinas de sus cobros con tarjeta/QR/transferencia   (se las queda: R4)
  − Σ entregas registradas
  ```

  La propina en efectivo ya la tiene, así que no entra.
- **Entregó justo:** `entregado = saldo`. **De menos:** queda saldo, sin motivo
  obligatorio, porque es una entrega parcial y puede traer el resto. **De más:** entra
  al cajón y queda anotado como sobrante en la entrega.
- **No entregó:** se registra un `reconocimiento` de deuda (motivo obligatorio y aviso
  al dueño, como hoy). No mueve plata. El saldo sigue ahí hasta que lo entregue.
- **Anular una entrega** (motivo obligatorio): la línea de caja queda anulada y el saldo
  vuelve. Es la única forma de corregir un cobro de un mozo que ya rindió (R6).

### R4 · Propina de tarjeta/QR: neta

- El mozo **se queda su propina de lo que trae**, que es lo que hace MaxiRest: línea de
  efectivo negativa en el mismo comprobante, 722 casos en KCC. "Tiene que entregar" ya
  viene neto.
- **Si no le alcanza el efectivo** (cobró todo con tarjeta), el saldo da negativo: **la
  caja le debe**. La rendición lo resuelve con "Darle $X de propina del cajón", que es
  un `caja_movimientos(kind='propina')` como hoy (spec 177).

### R5 · El turno

- **Tabla nueva `turnos`:** `business_id`, `nombre` (Mediodía/Noche, opcional),
  `abierto_at`, `cerrado_at`, `cerrado_por` y `resumen` (jsonb para el papel). Siempre
  hay **uno abierto** por negocio, garantizado con un índice único parcial.
- **`cerrar_turno_tx`** bloquea y valida lo mismo que muestra la franja (209 · R1):
  - no quedan **cuentas de mesa abiertas** (`OPEN_TABLE_ORDERS`);
  - **todo mozo** tiene saldo 0 o deuda reconocida en este turno (`UNRESOLVED_MOZOS`);
  - **toda caja de turno** con movimientos en el turno tiene un corte posterior a su
    último movimiento (`CAJA_SIN_CONTAR`).

  Después:
  - barre el salón (libera mesas y limpia la distribución, con audit);
  - cierra el turno y abre el siguiente;
  - encola el papel del turno: cajas, rendiciones y deudas.
- **`cerrar_caja_tx`** deja de barrer el salón y de exigir rendiciones. **Todas las cajas
  cierran igual:** conteo ciego, diferencia y retiro (209). `p_barrer_salon` desaparece.
  Que la Principal ya no sea especial en el cierre no cambia que sea `is_default` para
  la comandera fiscal.

### R6 · Correcciones en la base, con vista previa

- **`corregir_pago_tx` acepta además** `attributed_mozo_id`, `caja_id` y `tip_cents`, y
  recalcula `efectivo_de` con la regla de R1.
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
  por `prefijo` + turno). Elimina la asimetría Principal/Bar.
- **D4 · Se rinde sólo el efectivo.** MaxiRest permite configurar rendir también cupones
  de tarjeta (`mxfor.rinde`). Queda fuera de alcance, y el modelo lo admite después.

## Escenarios

- **Cobro de Pedro en la Caja Bar, rendido en la Principal.**
  - **Dado:** Pedro cobra $91.000 en efectivo de una mesa, y el cobro queda en la Caja Bar.
  - **Entonces:** el "debería haber" de la Bar no cambia, y el saldo de Pedro sube $91.000.
  - **Cuando** Pedro entrega en la Principal, **entonces** sube la Principal, y ninguna
    de las dos queda descuadrada.
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
  - **Cuando** se intenta cerrar el turno, **entonces** `UNRESOLVED_MOZOS`, hasta que
    entregue o se reconozca la deuda.
- **La Bar cierra en plena cena.**
  - **Dado:** hay mesas abiertas y mozos sin rendir.
  - **Cuando** se cierra la Caja Bar, **entonces** cierra, porque su cajón sólo espera lo
    que entró ahí.
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
