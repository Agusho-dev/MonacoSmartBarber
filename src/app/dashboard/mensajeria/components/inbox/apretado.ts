// El resaltado de "apretado" de las filas de Mensajería en lo táctil
// (23/oct/2026). Con :active, en el iPhone la fila donde se apoyaba el dedo
// quedaba resaltada durante todo el scroll: la captura de la app instalada
// mostraba una fila gris mientras la lista corría debajo del dedo. Como en
// iOS, el resaltado:
// - aparece recién a los DEMORA_APRETADO_MS con el dedo apoyado: un scroll que
//   arranca rápido no llega a pintarlo;
// - se va apenas el dedo scrollea. El navegador manda pointercancel cuando se
//   queda con el gesto para scrollear; por las dudas también cuentan el dedo
//   que se corrió más de TOLERANCIA_APRETADO_PX (un arrastre que el navegador
//   no scrollea, como el de volver deslizando desde el borde) y cualquier
//   scroll de la página;
// - se va al soltar. Si el toque fue más corto que la demora, la fila destella
//   DESTELLO_APRETADO_MS para que el toque igual se vea (iOS resalta la celda
//   tocada aunque el dedo no se haya quedado), y se apaga sola.
// Con el mouse no hace nada: ahí resalta el hover.
//
// No pasa por React: es un atributo (data-apretada) que se pone y se saca en el
// elemento, y el CSS lo pinta con `data-[apretada]:…`. Las filas van con memo y
// no se vuelven a dibujar por esto. Se usa así:
//   <button onPointerDown={apretarAlTocar} className="… data-[apretada]:bg-…">

import type { PointerEvent as ReactPointerEvent } from 'react'

/** Lo que espera el dedo apoyado antes de resaltar (el "tap timeout" de Android). */
export const DEMORA_APRETADO_MS = 100
/** Más que esto desde donde se apoyó, el dedo ya no está tocando: está arrastrando. */
export const TOLERANCIA_APRETADO_PX = 10
/** El destello de un toque más corto que la demora. */
export const DESTELLO_APRETADO_MS = 150
const ATRIBUTO = 'data-apretada'

// El gesto en curso de cada elemento, para cortarlo si llega otro toque.
const enCurso = new WeakMap<HTMLElement, () => void>()

/** ¿El dedo se corrió tanto desde donde se apoyó que ya no es un toque? */
export function seCorrioElDedo(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > TOLERANCIA_APRETADO_PX
}

/** El onPointerDown de un elemento que se resalta al apretarlo con el dedo. */
export function apretarAlTocar(e: ReactPointerEvent<HTMLElement>): void {
  if (e.pointerType === 'mouse' || !e.isPrimary) return
  const el = e.currentTarget
  // Un toque nuevo sobre el mismo elemento (por ejemplo, durante el destello) arranca de cero.
  enCurso.get(el)?.()
  const id = e.pointerId
  const x0 = e.clientX
  const y0 = e.clientY
  let pintado = false
  let reloj = window.setTimeout(() => {
    pintado = true
    el.setAttribute(ATRIBUTO, '')
  }, DEMORA_APRETADO_MS)

  const dejarDeEscuchar = () => {
    window.clearTimeout(reloj)
    window.removeEventListener('pointermove', alMover, true)
    window.removeEventListener('pointerup', alSoltar, true)
    window.removeEventListener('pointercancel', alCancelar, true)
    window.removeEventListener('scroll', terminar, true)
  }
  const terminar = () => {
    dejarDeEscuchar()
    el.removeAttribute(ATRIBUTO)
    if (enCurso.get(el) === terminar) enCurso.delete(el)
  }
  const alMover = (ev: PointerEvent) => {
    if (ev.pointerId === id && seCorrioElDedo(ev.clientX - x0, ev.clientY - y0)) terminar()
  }
  const alCancelar = (ev: PointerEvent) => {
    if (ev.pointerId === id) terminar()
  }
  const alSoltar = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (pintado) {
      terminar()
      return
    }
    // Más corto que la demora: un destello, que se apaga solo (ya sin escuchar
    // el scroll: el toque terminó y lo que pase después no lo corta).
    dejarDeEscuchar()
    el.setAttribute(ATRIBUTO, '')
    reloj = window.setTimeout(terminar, DESTELLO_APRETADO_MS)
  }

  enCurso.set(el, terminar)
  // Se escucha en la ventana (y en captura): el pointerup y el pointercancel
  // llegan aunque el elemento haya quedado inerte debajo de una capa, y el
  // scroll de cualquier contenedor (no burbujea) se ve en la captura.
  window.addEventListener('pointermove', alMover, { capture: true, passive: true })
  window.addEventListener('pointerup', alSoltar, true)
  window.addEventListener('pointercancel', alCancelar, true)
  window.addEventListener('scroll', terminar, { capture: true, passive: true })
}
