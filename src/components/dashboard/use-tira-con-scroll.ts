'use client'

// Una tira de pestañas con scroll horizontal (las del encabezado en el celular,
// las de Turnos): la marcada siempre a la vista y los bordes desvanecidos del
// lado en que hay más pestañas.
//
// La marcada se trae moviendo el scrollLeft de la TIRA. Nada de scrollIntoView:
// mueve también todos los ancestros con scroll y en el celular ya corrió la
// página entera de costado.

import { useLayoutEffect, useRef, type FocusEvent, type UIEvent } from 'react'

const BORDE_PX = 24

/** Desvanece los bordes que tienen más contenido (con una máscara, sin re-render). */
export function aplicarBordes(tira: HTMLElement, borde: number = BORDE_PX): void {
  const max = tira.scrollWidth - tira.clientWidth
  const izq = max > 1 && tira.scrollLeft > 1
  const der = max > 1 && tira.scrollLeft < max - 1
  // El navegador normaliza el texto de la máscara al leerla: el estado se anota aparte.
  const estado = `${izq ? 'i' : ''}${der ? 'd' : ''}${borde}`
  if (tira.dataset.bordes === estado) return
  tira.dataset.bordes = estado
  let mascara = ''
  if (izq && der) mascara = `linear-gradient(to right, transparent 0, #000 ${borde}px, #000 calc(100% - ${borde}px), transparent 100%)`
  else if (izq) mascara = `linear-gradient(to right, transparent 0, #000 ${borde}px)`
  else if (der) mascara = `linear-gradient(to right, #000 calc(100% - ${borde}px), transparent 100%)`
  tira.style.maskImage = mascara
  tira.style.setProperty('-webkit-mask-image', mascara)
}

function movimientoReducido(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * Centra `marcada` en la tira (sin pasarse de los extremos). Con `siempre` en
 * false sólo se mueve si la marcada no se ve entera (fuera de los bordes
 * desvanecidos).
 */
function llevarALaVista(tira: HTMLElement, marcada: HTMLElement, suave: boolean, siempre: boolean): void {
  const max = tira.scrollWidth - tira.clientWidth
  if (max <= 1) return
  const desde = marcada.offsetLeft
  const hasta = desde + marcada.offsetWidth
  if (!siempre && desde >= tira.scrollLeft + BORDE_PX && hasta <= tira.scrollLeft + tira.clientWidth - BORDE_PX) return
  const destino = Math.max(0, Math.min(max, Math.round(desde + marcada.offsetWidth / 2 - tira.clientWidth / 2)))
  if (Math.abs(destino - tira.scrollLeft) < 1) return
  tira.scrollTo({ left: destino, behavior: suave ? 'smooth' : 'auto' })
}

/**
 * `marcada`: la pestaña marcada (el hijo con `data-marcada` en el DOM).
 * `conjunto`: identifica las pestañas de la tira; si cambia (otro grupo), la
 * marcada se trae de un salto en vez de deslizarse.
 *
 * La tira tiene que ser `position: relative` (el offsetLeft de las pestañas se
 * mide contra ella).
 */
export function useTiraConScroll<T extends HTMLElement = HTMLDivElement>(marcada: string | null, conjunto: string) {
  const ref = useRef<T>(null)
  const conjuntoVistoRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const tira = ref.current
    if (!tira) return
    const mismoConjunto = conjuntoVistoRef.current === conjunto
    conjuntoVistoRef.current = conjunto
    const el = marcada ? tira.querySelector<HTMLElement>('[data-marcada]') : null
    if (el) llevarALaVista(tira, el, mismoConjunto && !movimientoReducido(), true)
    aplicarBordes(tira)
  }, [marcada, conjunto])

  // Cambios de tamaño (girar el teléfono, la fuente que termina de cargar):
  // los bordes se recalculan y la marcada vuelve a la vista si quedó afuera.
  useLayoutEffect(() => {
    const tira = ref.current
    if (!tira || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const el = tira.querySelector<HTMLElement>('[data-marcada]')
      if (el) llevarALaVista(tira, el, false, false)
      aplicarBordes(tira)
    })
    ro.observe(tira)
    for (const hijo of Array.from(tira.children)) ro.observe(hijo)
    return () => ro.disconnect()
  }, [conjunto])

  const onScroll = (e: UIEvent<T>) => aplicarBordes(e.currentTarget)

  // Con el teclado (Tab), la pestaña enfocada también se trae a la vista:
  // Chrome no corre la tira para mostrar un elemento que ya se ve en parte, y
  // el foco quedaba cortado contra el avatar o el borde desvanecido.
  const onFocus = (e: FocusEvent<T>) => {
    const tira = e.currentTarget
    const enfocado = e.target
    if (!(enfocado instanceof HTMLElement) || !enfocado.matches(':focus-visible')) return
    const pestana = enfocado.closest<HTMLElement>('a,button')
    if (pestana && tira.contains(pestana)) llevarALaVista(tira, pestana, !movimientoReducido(), false)
  }

  return { ref, onScroll, onFocus }
}
