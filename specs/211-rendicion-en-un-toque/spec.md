# 211 · La pantalla de caja nueva: efectivo claro, rendición en un toque y correcciones ahí mismo

**Issue:** [#381](https://github.com/gachetponzellini/RestaurantOS-app/issues/381) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto (v2, reescrito el 2026-10-06). Depende de la spec 210 (v2). Es
la interfaz de ese modelo.

**Maqueta aprobada por Juan:** <https://claude.ai/artifact/UJtECquzgkA8ZqEecX8oEP>.
Las decisiones que la definieron, todas del 2026-10-06:

- Diferenciar bien los números: lo cobrado por método, y después el efectivo con el
  total a rendir y lo de cada mozo.
- Rendición estilo MaxiRest.
- La propina de tarjeta, neta.
- El detalle de todos los movimientos abajo.
- Corregir con un botón **Editar** que abre el modal que ya tenemos, sin ir al libro.
- Un turno para todo el local.

## Por qué

La tab Caja de hoy junta números que significan cosas distintas, y obliga a entender un
modelo interno para leerlos:

- "Debería haber" incluye plata que tienen los mozos.
- La propina se entrega y se devuelve.
- La rendición tiene dos formularios.
- Corregir un movimiento te manda a otra pantalla.

Esta spec ordena la pantalla en el orden en que se lee y deja cada número con un solo
significado. El modelo de la 210 es el que garantiza que esos números siempre cierren.

## Qué cambia

- **R1 · Orden de la tab Caja**, de arriba hacia abajo:
  1. **Cierre del turno**, la franja de la 209 adaptada al turno global (R6).
  2. **Cobrado en el turno:** el total y **cada método** con su barra y su cantidad. Las
     propinas van aparte.
  3. **Efectivo: dónde está.** Una barra apilada y cinco números que **siempre suman lo
     cobrado en efectivo**:
     - lo cobró la caja;
     - rendido por mozos;
     - a rendir;
     - propinas de los mozos (las de tarjeta/QR, que se quedan del efectivo);
     - deuda, sólo si hay.

     Debajo, la tabla por mozo: cobró en efectivo, su propina, entregó, a rendir y **Rendir**.
  4. **El cajón:** "Debería haber" con su cuenta línea por línea (fondo + cobrado por la
     caja + rendiciones − sangrías). Es el número que se cuenta.
  5. **Movimientos del turno** (R4).
- **R2 · Rendición estilo MaxiRest** (panel al costado que **reemplaza la tarjeta del
  cajón**, así la tabla de efectivo sigue a la vista):
  - **La cuenta:** cobró en efectivo − su propina de tarjeta/QR = **tiene que entregar**.
    Si ya entregó una parte: "Ya entregó $X. Le falta $Y".
  - **Sus cobros mesa por mesa.** Los que no son efectivo van en gris: "no se rinden".
  - **La propina en efectivo:** "ya la tiene, no entra en ninguna cuenta".
  - **Acciones:**
    - **Entregó $X justo**, el primario, en un toque.
    - **Entregó otro monto:** si es de menos, "Falta $Y, queda en su saldo"; si es de
      más, "Sobran $Y, entran al cajón".
    - **No entregó:** motivo obligatorio, queda como deuda.
  - **Si la caja le debe** (saldo negativo, 210 · R4): un solo botón, "Darle $X de propina
    del cajón".
  - **Mozo con plata de dos cajas (el caso raro, ~5%):** recién ahí el panel muestra una
    línea por caja, cada una con su "Entregó justo". En la tabla de efectivo aparece la
    marca "plata de dos cajas". **Con una sola caja, no se nombra ninguna caja.**
  - Al confirmar, los números de arriba se actualizan y se muestra "Pedro rindió $371.600.
    Ya se quedó con su propina de $8.400".
  - Se borra la tarjeta "Cobrado por empleado · rendición" y su `<details>`.
- **R3 · Glosario:** el de la 209 (`textos.ts`), más "Tiene que entregar", "Entregó",
  "Saldo", "Su propina" y "Rendido".
- **R4 · Movimientos del turno:**
  - **Tabla:** hora, tipo (Cobro / Rendición / Sangría / Ingreso / Propina / Deuda /
    Apertura), detalle (mesa o pedido · método · quién cobró), monto, **qué le hace al
    cajón** y **saldo del cajón** después de cada movimiento.
  - **Qué le hace al cajón**, una de estas:
    - `+$X` o `−$X`;
    - "A nombre de Pedro";
    - "No entra · posnet / banco";
    - "No entra · queda debiendo";
    - "Anulado".
  - El saldo de la primera fila coincide siempre con "Debería haber".
  - **Filtros:** Todo, Mueven el cajón, Cobros, Rendiciones y Sangrías, con su cantidad.
  - **Una fila corregida** muestra la marca "Corregido" con lo de antes y el motivo.
    **Una anulada** queda tachada.
  - **Cada fila tiene un botón visible:**
    - **Editar** abre el modal de corrección (R5);
    - **Ver detalle**, en lo que no se puede editar, abre el mismo modal mostrando por qué.
      Casos: cobro de un mozo que ya rindió (se anula la entrega primero), rendición
      (se corrige con otra entrega), fondo (viene del cierre anterior) y anulados.
  - "Días anteriores" lleva al libro (spec 070), que queda para el histórico.
- **R5 · Modal de corrección, reutilizado.**
  - **Se extrae `DetalleSheet`** de `libro-client.tsx` a `detalle-movimiento-sheet.tsx`,
    que se usa en la caja **y** en el libro. Usa el `Modal` compartido (convención de la
    spec 043).
  - **Campos:**
    - método;
    - monto y "De propina", con la aclaración completa: "$X incluye $Y de propina (lo de
      la cuenta es $Z)";
    - mozo atribuido; los que ya rindieron aparecen deshabilitados como "(ya rindió)";
    - caja;
    - motivo, obligatorio.
  - **Botón Corregir:** cuando no se puede guardar, dice qué falta ("Cambiá algún dato",
    "Escribí el motivo", "La propina no puede ser más que el monto").
  - **"Anular este cobro":** queda tachado y no se borra.
  - **Lo nuevo es la vista previa** antes de guardar, con `efecto_de_correccion` (210 · R6).
    Por ejemplo: "El cajón pasa de $434.000 a $416.000", "Lo que Pedro tiene que entregar
    pasa de $371.600 a $280.600" o "Pasa a la Caja Bar: deja de contar en esta caja".
  - **Al guardar,** confirma en el mismo modal y la caja se resincroniza.
- **R6 · Cierre del turno** (adapta la franja de la 209 · R1):
  - **Pasos:** ① Mesas cobradas ② Rendiciones resueltas ③ Contar las cajas. El paso ③
    muestra el estado de **cada** caja ("Bar ✓ cerrada 00:40 · falta la Principal").
  - **El primario sigue siendo el próximo paso:** "Cobrar mesa 7", "Rendir a Ana",
    "Contar la Caja Principal".
  - **Contar una caja:** el flujo ciego de la 209, igual para todas. **Sólo se habilita
    con las mesas cobradas y los mozos de esa caja resueltos.** Si no, el botón dice qué
    falta ("Falta que Pedro rinda $91.000 a la Caja Bar").
  - **Con todo en verde, "Cerrar el turno"** (`cerrar_turno_tx`): se liberan las mesas,
    se limpia la distribución y sale el papel del turno.
- **R7 · El celular del mozo: tarjeta "Tu turno"** en `/mozo`.
  - "Tenés que entregar $371.600" y **cómo sale el número**: cobraste $380.000 − tu
    propina de tarjeta $8.400. La propina en efectivo ya la tiene.
  - Lo que cobró, mesa por mesa.
  - Las mesas sin cobrar.
  - Ya rendido: "Rendiste a las 01:12, no debés nada".
  - **El mozo sale de la sesión**, nunca de un parámetro: `canVerMiTurno(role)`.
  - Se carga aparte, con Suspense, para no frenar el salón.

## Escenarios

- **El efectivo cierra.**
  - **Dado** cualquier estado del turno, **entonces** caja + rendido + a rendir +
    propinas de mozos + deuda = cobrado en efectivo.
  - El saldo de la primera fila de movimientos = "Debería haber".
- **Entregó justo.**
  - **Dado:** Pedro debe $371.600.
  - **Cuando** el encargado toca "Entregó $371.600 justo", **entonces** el cajón sube
    $371.600, Pedro queda "Rindió 01:12" y el primario pasa al siguiente.
- **Entrega parcial.**
  - **Dado:** Lucía entrega $150.000 de $182.400.
  - **Entonces** queda "Le falta $32.400", y el paso ② sigue pendiente.
- **Editar un cobro de la caja.**
  - **Dado** un cobro de la caja de $18.000 en efectivo.
  - **Cuando** se lo pasa a Tarjeta con motivo, **entonces** antes de guardar se lee "El
    cajón pasa de $434.000 a $416.000". Al guardar, la fila dice "Corregido, antes
    Efectivo (motivo)".
- **Ver detalle de un cobro bloqueado.**
  - **Dado** un cobro de Diego, que ya rindió.
  - **Entonces** la fila ofrece "Ver detalle", y el modal explica que primero se anula su entrega.
- **Cerrar el turno.**
  - **Dado:** las dos cajas están contadas y las rendiciones resueltas.
  - **Cuando** se toca "Cerrar el turno", **entonces** el salón queda libre y sale el
    papel del turno.
- **Celular del mozo.**
  - **Dado:** Pedro está logueado en `/mozo`.
  - **Entonces** ve exactamente el mismo "tiene que entregar" que el encargado, y no
    puede ver el de otro.

## Fuera de alcance

- El modelo, las RPC y la migración (spec 210).
- El conteo ciego, que ya está implementado (209).
- Rendir cupones de tarjeta.
