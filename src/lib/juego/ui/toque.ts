/**
 * Botones que tienen que responder con un pulgar apoyado (en el stick, en el VS, o haciendo lo que
 * pide el tutorial: «Apoyá el pulgar izquierdo donde quieras y deslizá»).
 *
 * Con un dedo apoyado, Chrome NO genera `click` para el toque de un segundo dedo: es un puntero
 * táctil no primario, y el click sólo sale del primario (Pointer Events). Llegan su `pointerdown` y
 * su `pointerup`, pero un botón con `onClick` no hace nada. Por eso «Omitir» y «Siguiente» del
 * tutorial, la pausa y el error de la pelea no respondían con el pulgar en el stick.
 *
 * `alTocar(accion)` devuelve las props del botón: mantiene `onClick` (mouse, teclado, lector de
 * pantalla y el primer dedo, que siguen igual) y suma `onPointerDown`/`onPointerUp`, que actúan SÓLO
 * con un puntero táctil no primario que se apoyó y se levantó sobre el mismo botón (como un click:
 * si el dedo se sale del botón, no pasa nada). Si algún navegador además genera el click de ese
 * toque, se ignora: una sola acción por toque.
 *
 * Ojo: el pulgar que quedó apoyado tiene el touch-action de donde se apoyó. Si la capa del botón
 * deja panear (pan-y), al moverlo Chrome empieza un paneo y corta TODOS los punteros: las capas que
 * se tocan con un pulgar apoyado van con touch-action: none (ver `Capa`, capa.tsx).
 */
import type { MouseEvent as EventoMouse, PointerEvent as EventoPuntero } from 'react'

/** Tras actuar por el pointerup, cuánto se ignora un click del mismo botón (el del mismo toque). */
const IGNORAR_CLICK_MS = 400

/** Punteros no primarios que se apoyaron en cada botón (por elemento: sobrevive a los renders). */
const apoyados = new WeakMap<Element, Set<number>>()
/** Cuándo actuó cada botón por un pointerup (para ignorar el click del mismo toque). */
const actuoEn = new WeakMap<Element, number>()

function esSegundoDedo(e: EventoPuntero<Element>): boolean {
  return e.pointerType === 'touch' && !e.isPrimary
}

/** Lo que el dedo se puede correr del botón y que siga siendo un toque (como el «slop» de un tap). */
const MARGEN_PX = 12

function adentro(el: Element, x: number, y: number): boolean {
  const r = el.getBoundingClientRect()
  return x >= r.left - MARGEN_PX && x <= r.right + MARGEN_PX && y >= r.top - MARGEN_PX && y <= r.bottom + MARGEN_PX
}

export interface PropsDeToque {
  onClick: (e: EventoMouse<HTMLElement>) => void
  onPointerDown: (e: EventoPuntero<HTMLElement>) => void
  onPointerUp: (e: EventoPuntero<HTMLElement>) => void
  onPointerCancel: (e: EventoPuntero<HTMLElement>) => void
}

/**
 * Props para un botón que tiene que andar también con un segundo dedo (ver el encabezado):
 * `<button {...alTocar(() => hacer())}>`. Un botón deshabilitado no recibe nada (el navegador no
 * le manda pointer events), así que no hace falta chequearlo. `accion` recibe el botón: el submit de
 * un form lo usa para pedir `boton.form.requestSubmit()` sin leer un ref durante el render.
 */
export function alTocar(accion: (boton: HTMLElement) => void): PropsDeToque {
  return {
    onClick: (e) => {
      const t = actuoEn.get(e.currentTarget)
      if (t !== undefined && performance.now() - t < IGNORAR_CLICK_MS) return
      accion(e.currentTarget)
    },
    onPointerDown: (e) => {
      if (!esSegundoDedo(e)) return
      const el = e.currentTarget
      let s = apoyados.get(el)
      if (!s) {
        s = new Set()
        apoyados.set(el, s)
      }
      s.add(e.pointerId)
    },
    onPointerUp: (e) => {
      if (!esSegundoDedo(e)) return
      const el = e.currentTarget
      const s = apoyados.get(el)
      if (!s || !s.delete(e.pointerId)) return
      if (!adentro(el, e.clientX, e.clientY)) return
      actuoEn.set(el, performance.now())
      accion(el)
    },
    onPointerCancel: (e) => {
      apoyados.get(e.currentTarget)?.delete(e.pointerId)
    },
  }
}
