# 197 · El PIN del fichaje se tipea

Issue [#322](https://github.com/gachetponzellini/RestaurantOS-app/issues/322).

## El problema

El diálogo **«Marcar asistencia»** (Operación → Fichaje) era un numpad de
botones y nada más: sin input, sin foco útil, sin teclado.

Al abrirlo, el foco se iba a la **✕ de cerrar** — el primer focuseable del
popup — y ahí se quedaba. Tipear `1 2 3 4` no movía un casillero: había que
apuntar los cuatro dígitos con el mouse, uno por uno, en una pantalla de
escritorio con el teclado a diez centímetros.

El kiosco de `/fichar` ya lo tenía resuelto desde siempre (un `<input>` con
`autoFocus` que acepta teclado). El diálogo del panel se había quedado atrás.

## La solución

El **popup mismo** es el que tiene el foco y el que escucha el teclado:

```tsx
<DialogContent ref={popupRef} initialFocus={popupRef} tabIndex={-1}
               onKeyDown={handleKeyDown}>
```

Dígito → carga, `Backspace` → borra. Con modificador (`⌘`/`Ctrl`/`Alt`) no se
intercepta nada, así que los atajos del navegador siguen vivos.

### Por qué el foco va al popup y no a un input

Un `<input>` invisible era la otra opción, y es la que usa el kiosco. Acá no
sirve por dos razones:

1. **En tablet abriría el teclado en pantalla**, tapando medio diálogo — cuando
   el numpad ya está ahí abajo, que es justamente para lo que existe.
2. **El foco se mueve.** Si el foco tiene que estar en un input y el dedo toca
   un botón del numpad, se va; de ahí en adelante el teclado deja de escribir.
   Escuchando en el popup, la tecla llega igual desde cualquier descendiente.

**El numpad ya no se queda con el foco** (`onMouseDown` + `preventDefault`).
Además de mantener el teclado vivo, eso arregla un detalle viejo: tocabas un
dígito con el dedo, apretabas `Enter` sin querer y el botón todavía focuseado
repetía esa misma tecla.

**El casillero que sigue queda marcado** (`PinDisplay`, prop `active`). Es la
única señal de que el diálogo está esperando que tipees: sin un cursor que
parpadee, un cuadrado con anillo es lo que dice «escribí acá».

## Dónde vive

- `src/components/admin/local/fichaje-tab.tsx` — el foco y el `onKeyDown`.
- `src/components/fichar/numpad.tsx` — los botones no roban el foco.
- `src/components/fichar/pin-display.tsx` — el casillero activo.

El kiosco `/fichar` no se toca: ya andaba.

## Verificación en vivo

`demo` con el rol real de **Sofía (encargada)**, Operación → Fichaje →
«Marcar asistencia»:

- Abre con el foco en el popup (`data-slot="dialog-content"`), no en la ✕.
- `1 2 3` cargan tres casilleros, `Backspace` deja dos.
- Tocar `4` con el mouse **no** mueve el foco: los tres `4` que siguen entran
  por teclado y Ramón Cocina ficha entrada.
- El PIN de salida (`4444`) entero por teclado → «Salida registrada».
