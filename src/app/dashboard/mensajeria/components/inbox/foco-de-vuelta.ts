'use client'

// El foco vuelve a lo que abrió una pantalla (la fila del chat, el ítem del
// menú, «Perfil») cuando esa pantalla se cierra. Sin esto caía en <body>: con
// el teclado o el lector de pantalla había que volver a recorrer todo desde
// arriba.
//
// Nunca a un campo de texto: con pantalla táctil, enfocarlo abre el teclado.
// Y sólo si el foco quedó perdido (en <body>, adentro de lo que se cerró o en
// algo inerte): si la persona ya está en otro lado, no se lo saca.
//
// Un ítem de un menú (el «…» de la lista abre las secciones) ya no existe al
// cerrar la pantalla: el menú se cierra al elegir. Ahí el origen es el botón
// que abrió el menú, que es adonde lo devuelve el menú mismo (Radix) cuando se
// cierra sin abrir nada.

const CAMPO = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** El botón que abrió el menú donde está `el` (Radix: aria-labelledby del menú), o null. */
function disparadorDelMenu(el: Element): HTMLElement | null {
  const id = el.closest('[role="menu"]')?.getAttribute('aria-labelledby')
  const disparador = id ? document.getElementById(id) : null
  return disparador instanceof HTMLElement ? disparador : null
}

/** Lo que tiene el foco ahora, si sirve para volver después (null si no). */
export function origenDelFoco(pantalla: Element): HTMLElement | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body || pantalla.contains(el)) return null
  const origen = disparadorDelMenu(el) ?? el
  return pantalla.contains(origen) ? null : origen
}

function focoPerdido(pantalla: Element): boolean {
  const el = document.activeElement
  return !el || el === document.body || pantalla.contains(el) || !!el.closest('[inert]')
}

/**
 * Cuando `pantalla` ya se cerró: el foco vuelve a `origen` si sigue en la
 * página, no es un campo y se puede tocar. Después del commit (una
 * microtarea): lo de abajo recién ahí deja de estar inerte.
 */
export function devolverFoco(origen: HTMLElement | null, pantalla: Element): void {
  if (!origen) return
  queueMicrotask(() => {
    if (!origen.isConnected || origen.matches(CAMPO) || origen.closest('[inert]')) return
    if (!focoPerdido(pantalla)) return
    origen.focus({ preventScroll: true })
  })
}
