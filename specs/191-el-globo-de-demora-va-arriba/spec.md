# 191 · El globo de demora va arriba de todas las mesas

Issue [#318](https://github.com/gachetponzellini/RestaurantOS-app/issues/318).

## El problema

El globo de demora de cocina (spec 30) se dibujaba **dentro del `<g>` de su
mesa**. En SVG no hay z-index: manda el orden del documento, así que cualquier
mesa pintada después quedaba **encima** del globo y lo cortaba al medio. Juan lo
reportó con la captura: «Parrilla · +15 min de demora» tapado por la mesa de al
lado.

Subir un `z-index` no lo arregla — dentro de un SVG no hace nada.

## La solución

El globo sale del grupo de la mesa y pasa a una **capa propia al final del
SVG**, después de todas las mesas:

- la mesa conserva sólo el punto de color, que avisa al plano cuál está
  hovereada (`onDelayHover`);
- el plano guarda `conGlobo` y dibuja `<GloboDeDemora>` como último hijo;
- la geometría (ancho, alto, el flip contra los bordes del plano) se extrajo a
  `geometriaDelGlobo`, que ahora vive a nivel de módulo.

**Efecto lateral que se arregla solo:** el globo ya no rota con la mesa — antes,
en una mesa girada, salía acostado.

## Dónde vive

`src/components/mozo/floor-plan-viewer.tsx` — `geometriaDelGlobo`,
`GloboDeDemora` y la capa en `FloorPlanViewer`.

## Test de regresión

`floor-plan-viewer.test.tsx`: con dos mesas y hover sobre el punto de la
primera, el `<g>` del globo tiene que venir **después** del de la mesa vecina en
el SVG.

## Verificación en vivo

Operación → Mesas del `demo` con 3 mesas demoradas: el globo de R20 («Cocina ·
+22 min de demora») se lee entero por encima de R18, que antes lo tapaba.
