# 190 · El plano muestra el día entero, sin slider de hora

Issue [#317](https://github.com/gachetponzellini/RestaurantOS-app/issues/317).
Sigue a la [189](../189-reservas-abre-en-el-plano/), que puso el plano de
entrada.

## El problema

El plano contestaba «cómo queda el salón **a las 21**»: un slider de hora, y las
mesas repintándose al barrer la línea de tiempo. Con el plano como vista de
entrada eso se volvió un peaje: para saber qué hay reservado hoy había que
recorrer el día con el pulgar, y cada posición mostraba **una sola foto** — una
reserva de mediodía y una de noche en la misma mesa no se veían nunca juntas.

Un servicio normal tiene **una reserva por mesa y por turno**. Pedirle al
encargado que barra una línea de tiempo para encontrarlas era hacerle buscar lo
que se puede mostrar de una.

## La solución

**El día entero entra en el dibujo.**

1. `reservasDelDia(reservas, mesas, {turno, timezone})` reemplaza a
   `estadoDeMesasEn`: cada mesa lleva **todas** sus reservas vivas del día,
   ordenadas por hora. `pendiente` sigue ganando sobre `reservada`.
2. **La hora es lo que no se cae.** El renglón de la mesa es `HH:MM · Np`; si no
   entra, queda `HH:MM` pelado. Antes se caía la hora y quedaban los cubiertos —
   al revés de lo que se va a buscar al plano.
3. **Con más de una reserva, el segundo renglón avisa `+N más`** en vez del
   nombre: el plano no esconde la segunda. La ficha de la mesa muestra entonces
   los **chips de hora** para pasar de una a otra.
4. **Los turnos son filtro, no recorrido.** `Todo el día` (default) · Mediodía ·
   Tarde · Noche, cada uno con su contador (`conteoPorTurno`). Al costado, cuántas
   reservas se están viendo.
5. Las genéricas (sin mesa) se filtran por el mismo turno.

### Lo que se fue

`horasDelDia`, `horaInicial`, `momentoDe` y `estadoDeMesasEn` existían sólo para
alimentar el slider. Con ellas se fue el prop `horasPlano` y la lectura de
settings/servicios que la página hacía únicamente para calcularlo.

## Dónde vive

| Qué | Dónde |
|---|---|
| Reglas puras + turnos | `src/lib/reservations/plano-del-dia.ts` |
| Tests | `src/lib/reservations/plano-del-dia.test.ts` |
| Chips de turno, ficha multi-reserva | `src/components/reservations/plano-del-dia.tsx` |
| Limpieza del prop | `reservas-workspace.tsx`, `admin/(authed)/reservas/page.tsx` |

## Verificación en vivo

Seed operativo recargado en el **cloud** y en el **local** (`demo`). Como Sofía:
el plano abre con las 5 reservas del día (`T5 12:30 · 3p Carolina`, `R01 12:00
Sofía`, `R05 13:00`, `R11 20:30 · 6p Florencia`, `R03 21:00 Laura`); con una
segunda reserva cargada en R01 la mesa pasa a `12:00 / +1 más` y la ficha ofrece
los chips `12:00` · `21:00`; el filtro «Mediodía» deja 3 y saca el `+1 más`.
