// Dónde queda el scroll del hilo cuando algo cambia de alto: el hilo mismo (el
// teclado que se abre o se cierra, girar el teléfono; en la compu, el composer
// que crece con el texto) o lo de adentro (llegó un mensaje, terminó de cargar
// una foto, el composer del celular, que flota encima, creció).
//
// - Si estabas al final, quedás al final.
// - Más arriba, si cambió el alto del hilo, queda quieto el borde de abajo (lo
//   que estaba junto al composer), como en WhatsApp: al abrir el teclado lo que
//   leías sube con él en vez de quedar tapado, y al cerrarlo baja.
// - Si cambió sólo lo de adentro, no se toca: el que lee más arriba no salta.
//
// Todo se mide con lo de ANTES del cambio. Cuando el hilo crece, el navegador
// ya recortó el scroll al nuevo máximo antes de avisar: leído en el momento,
// alguien que estaba al final parecía estar 403 px más arriba.
//
// Lógica pura: la prueban nav-tests/chat; chat-view.tsx la conecta con un
// ResizeObserver.

/** A menos de esto del final, se está al final. */
export const CERCA_DEL_FINAL_PX = 72

/** El hilo medido: scrollHeight, clientHeight y scrollTop. */
export interface MedidaDelHilo {
  alto: number
  vista: number
  scroll: number
}

/**
 * El scrollTop que va después del cambio, o null para no tocarlo. `antes` es
 * la medida de antes del cambio (todo en cero la primera vez: el chat abre
 * abajo); `ahora`, el alto y la vista de después. Para ir al final devuelve el
 * alto entero: el navegador lo lleva al máximo.
 */
export function scrollTrasCambio(antes: MedidaDelHilo, ahora: Omit<MedidaDelHilo, 'scroll'>): number | null {
  if (antes.alto - antes.scroll - antes.vista < CERCA_DEL_FINAL_PX) return ahora.alto
  if (ahora.vista !== antes.vista) return Math.max(0, antes.scroll + antes.vista - ahora.vista)
  return null
}
