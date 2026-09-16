# 199 · Se carga el total, no el precio

**Issue:** [#324](https://github.com/gachetponzellini/RestaurantOS-app/issues/324) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-16)

**Depende de**: [`198`](../198-la-carga-manual-habla-en-kilos/spec.md) (el renglón
en kilos, `InputNumeroAR`, «cómo viene»), [`173`](../173-cargar-compra-en-pantalla-propia/spec.md)
(la regla de que el Enter no guarda).

---

## Por qué

**Input — Rocío, encargada del Golf, 2026-09-16 11:05**, probando la 198 media hora
después de subida. Audio de WhatsApp, transcripto local:

> *«Yo cargo manteca, tengo 5 kilos, y yo pongo el total que tengo acá, que me salen
> 58 mil pesos, y ahí me suma 290 mil — o sea me está poniendo el precio del kilo.
> [...] Me tengo que tomar el trabajo de ir a la calcu para dividir la cantidad que
> me vino por lo que me salió. ¿No hay una manera de que lo haga solo? Yo quiero
> cargar la cantidad que me vino, lo que me salió, y listo, y que después haga sola
> la división.»*

> *«Estaría bueno que con el Enter se pueda correr también, aparte del tabulador, y
> como para también darle el ok final.»*

**Juan:** *«que muestre los dos números y listo — serían tres números: la cantidad,
el precio unitario y el total. El precio unitario que sólo lo muestre, que se calcula
con los otros dos.»*

### El error de diseño, dicho entero

La 198 dejó el renglón como **cantidad × precio**, y el precio como campo. Es la
forma del dato, no la del papel: una factura de lácteos imprime la cantidad y **el
importe de la línea**, y el precio unitario —si está— es el número chico que nadie
mira. Rocío tipeó lo que tenía delante, el total, en el único campo de plata que
había, y el sistema lo multiplicó por cinco.

No es un error de la usuaria. Es el mismo que la 172·D1 ya había resuelto para el
lector —*«el modelo transcribe; la aritmética decide»*—, y que el editor manual no
aplicó: **se carga lo que está impreso, y la cuenta la hace el código.**

## Las decisiones

**D1 · Se tipean dos números: cantidad y total. El precio unitario se muestra.**

Tres números en la fila, en el orden en que se leen en el papel: cantidad, precio
unitario, total. Sólo el primero y el último son campos; el del medio es
`total ÷ cantidad` y está en gris, para que se vea que no se escribe.

**D2 · El total tipeado es el que se muestra; el precio del envase se redondea.**

Lo guardado sigue siendo envases y precio de UN envase (165·D5), porque es lo que
la RPC propaga al costo del insumo — el contrato no cambia. El precio del envase
es `round(total ÷ envases)` en centavos enteros, así que cuando la división no es
exacta, `envases × precio` puede diferir del total en unos centavos:

    10.000 $ por 3 kg de manteca (Pan 200g)
      envases = 15, precio del envase = round(1.000.000 ¢ / 15) = 66.667 ¢
      15 × 66.667 = 1.000.005 ¢ → $10.000,05

La pantalla **muestra el total que se tipeó** —$10.000, lo que dice el papel— y la
suma del detalle suma esos totales. Los centavos de diferencia quedan en el costo
del envase, que es un precio unitario y se redondea como cualquier precio unitario.

**D3 · Enter avanza; Enter sobre el botón guarda.**

Dentro del detalle, Enter hace lo que Tab: cantidad → total → cantidad del renglón
siguiente. Desde el último total, lleva el foco al botón «Cargar compra», y **un
Enter ahí guarda**.

Es un ajuste a la regla de la 173 —*«el Enter no guarda»*—, no una marcha atrás. La
razón de esa regla era que un Enter parado en el importe guardaba la compra sin
renglones, sin número y con la lectura corriendo: guardar tenía que pasar en el
único lugar donde la persona está mirando lo que va a pasar. **Con el foco sobre el
botón, la persona está mirando exactamente eso.** Un Enter en cualquier campo sigue
sin guardar nunca.

**D4 · La pantalla de revisión de la lectura hace lo mismo.**

Hoy tiene envases y precio del envase como campos, con el mismo problema esperando
a que la API key ande. Pasa a envases y total, con el precio del envase calculado.

## Alcance

- `renglon-en-unidades.ts` — `precioDelEnvaseDesdeTotal` y `precioUnitarioCents`,
  puros.
- `renglones-editor.tsx` — cantidad y total como campos, el precio en gris, los
  totales tipeados en estado paralelo, y Enter para avanzar.
- `revision-lectura.tsx` — envases y total como campos.
- `cargar-compra-client.tsx` — el Enter sobre el botón «Cargar compra» deja de
  estar bloqueado.

## Qué NO entra

- **Guardar el total de la línea en la base.** Es derivable salvo centavos (D2), y
  una columna nueva sería una segunda fuente del mismo número.
- **Enter para agregar un renglón nuevo.** El botón «Agregar insumo» está a un Tab.

## Escenarios de aceptación

1. **Dado** 5 kg de manteca y un total de $58.000, **entonces** el renglón muestra
   $11.600 el kg y el total queda en $58.000 — no $290.000.
2. **Dado** que se cambia la cantidad a 4 kg con el total ya puesto, **entonces** el
   total se queda y el precio pasa a $14.500 el kg.
3. **Dado** un total que no divide exacto (3 kg por $10.000), **entonces** se muestra
   $3.333,33 el kg y el total sigue diciendo $10.000.
4. **Dado** «Pan 200g» como «cómo viene», **entonces** 25 panes por $58.000 muestran
   $2.320 el pan, y lo guardado es lo mismo que en kg.
5. **Dado** Enter en la cantidad, **entonces** el foco va al total; Enter en el total
   del último renglón lleva el foco a «Cargar compra».
6. **Dado** Enter en el importe o en cualquier campo, **entonces** no se guarda.
7. **Dado** el foco sobre «Cargar compra», **entonces** Enter guarda.

## Verificación

**Implementada y verificada el 2026-09-16**, media hora después del audio.
`pnpm typecheck` limpio y la suite entera en verde: **3.334 tests**, 10 nuevos.

**Las cuentas, puras** (5 casos): 5 kg por $58.000 son $11.600 el kg; lo guardado
son 25 panes a $2.320 que suman **exacto** $58.000; en kg o en panes se guarda lo
mismo; 3 kg por $10.000 muestran $3.333,33 y el envase queda redondeado al centavo
con la diferencia acotada (D2); y sin cantidad no hay precio —`null`, no cero—.

**El componente, con Testing Library** (`renglones-editor.test.tsx`, 5 casos): la
fila de Rocío tipeada en el editor de verdad llega a `onChange` como
`{ units: 25, unit_cost_cents: 232000 }`; cambiar la cantidad a 4 kg deja el total
en «58.000» y pasa el precio a $14.500; el precio no es un `<input>`; Enter en la
cantidad lleva al total; y Enter en el último total lleva el foco a «Cargar
compra» **sin disparar el submit**.

**En vivo, como Sofía (encargada) sobre `demo`, stack local**, con el teclado de
verdad: manteca, «5» y **Enter** → el foco pasó solo al total; «58.000» → la fila
dice **$11.600/kg**, «Entran 5 kg · 25 × Pan 200g a $2.320 c/u» y la suma del
detalle **$58.000**. El segundo Enter dejó el foco en el total porque «Cargar
compra» estaba deshabilitado («Elegí el proveedor») — un botón deshabilitado no
toma foco, que es lo correcto. Ese tramo, con el botón habilitado, lo cubre el test
del componente.

### Lo que queda pendiente

**La pantalla de revisión de la lectura (D4)** está cubierta por typecheck pero no
en vivo: sólo aparece con una lectura, y la `ANTHROPIC_API_KEY` del entorno sigue
devolviendo 401.
