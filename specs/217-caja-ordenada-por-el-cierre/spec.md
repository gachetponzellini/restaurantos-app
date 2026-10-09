# Spec 217 · La caja ordenada por el cierre del turno

**Estado:** aprobada por Juan (2026-10-08) sobre la maqueta «Caja reordenada». Issue #390.

## Problema

La tab Caja muestra todo en una columna y la información está dispersa:

- Los mozos con «Rendir» aparecen dos veces (paso 2 del cierre y la tabla de «Efectivo: dónde está»).
- «Contar la caja» está arriba; lo que hay que contar (El cajón) está tres secciones más abajo.
- Sangría e Ingreso están arriba de todo, lejos de los movimientos que crean.
- Ventas por método y ventas por origen son dos cortes del mismo total, separados por otras secciones,
  y empujan lo operativo para abajo.

La encargada usa la caja **sobre todo para cerrar** (Juan, 2026-10-08).

## Decisiones

- **D1 · el cierre es el eje.** Los tres pasos (Mesas cobradas · Rendiciones · Contar las cajas) son
  pestañas: tocar un paso muestra su contenido. Al entrar se abre el paso que falta (cobrar → 1, rendir →
  2, contar o cerrar → 3); después de una acción vuelve a seguir al que falta.
- **D2 · paso 1:** la lista «Por cobrar» de hoy (con «Cobrar» y, en las cerradas, «Anular»).
- **D3 · paso 2:** la **única** tabla de mozos, de todas las cajas del turno: cobró en efectivo, su
  propina, entregó, tiene que entregar, y el botón (Rendir / Darle la propina / Debe · ver / Rindió).
  Arriba, dónde está el efectivo del turno (en el cajón · en manos de los mozos · propinas · deuda).
  Los resueltos se ven como «Rindió», sin botón.
- **D4 · paso 3:** una tarjeta por caja con lo que debería haber, de dónde sale (el desglose de
  `desglose_esperado_caja`) y «Contar la caja X». Si esa caja no se puede contar todavía, el botón está
  apagado **y dice por qué** (mesas sin cobrar, mozos sin rendir en esa caja). Una caja contada dice
  «Contada».
- **D5 · el único primario arriba es «Cerrar el turno»**, cuando todo está listo (con su confirmación de
  hoy). «Contar» vive en el paso 3.
- **D6 · arriba:** el selector de cajas con lo que debería haber en cada cajón, el período y «cierres
  anteriores». Se va el encabezado de la caja (nombre + «Activa»).
- **D7 · movimientos** a lo ancho, con **Sangría** e **Ingreso** en su encabezado.
- **D8 · ventas del período**, plegado: total, cobros y propina en la línea; adentro, por medio de pago
  y por origen lado a lado.
- **D9 · se van:** la tarjeta «Cobrado en el período» (pasa a Ventas), «Efectivo: dónde está» (pasa al
  paso 2) y el cajón rosa (pasa al paso 3, sin rosa).
- **D10 · sin cambios de datos ni de reglas:** mismas queries, mismas actions, mismos modales (Rendir,
  Contar, Sangría, Ingreso, Editar).

## Requisitos

- **R1:** `efectivoDelTurno(saldos, directoCents)`: pura; reparte el efectivo en caja directo, rendido,
  a rendir, propinas y deuda (la cuenta que hoy hace `EfectivoDeLaCaja`).
- **R2:** `pasoAbierto(proximo)` y `porQueNoSeCuenta(caja, estado)`: puras.
- **R3:** `CierreDelTurno` con pestañas y los tres paneles; recibe stats y cobros por caja del tablero.
- **R4:** tablero: selector con «debería haber», movimientos con Sangría/Ingreso, Ventas plegado;
  sin `EfectivoDeLaCaja` ni `CajonCard` sueltos.

## Fuera de alcance

Las pantallas `/admin/caja` y `/admin/caja/movimientos`. El modal de Rendir y el de Contar.
