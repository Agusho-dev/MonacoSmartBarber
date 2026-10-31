'use client'

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

/**
 * Marca `data-desborda` en el elemento mientras su contenido no entra (scrollHeight > clientHeight),
 * y lo vuelve a medir cuando cambia de tamaño él o alguno de sus hijos directos. Sirve para que una
 * capa o un scroller deje panear (pan-y) SÓLO cuando hay algo que desplazar: el resto del tiempo va
 * con touch-action: none (ver Capa).
 */
export function useDesborde(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => {
      // 1 px de tolerancia: el redondeo del alto no es un desborde.
      if (el.scrollHeight > el.clientHeight + 1) el.dataset.desborda = ''
      else delete el.dataset.desborda
    }
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    for (const hijo of Array.from(el.children)) obs.observe(hijo)
    return () => obs.disconnect()
  }, [ref])
}

/**
 * Capa a pantalla completa sobre la pelea (pausa, tutorial, error) que se puede tocar con un pulgar
 * apoyado en el stick.
 *
 * Va con touch-action: none (`.cf-capa--fija`, juego.css): con pan-y, un pulgar apoyado en la capa
 * que se movía —lo que pide el paso 1 del tutorial, «deslizá»— empezaba un paneo, Chrome mandaba
 * pointercancel y no entregaba más toques de NINGÚN dedo (ni «Siguiente» ni, al volver a la pelea,
 * el stick o los botones) hasta levantarlos todos. Y el touch-action de un toque se fija al apoyar
 * el dedo: si después la capa se va y vuelve la pelea, ese pulgar sigue con el de la capa.
 *
 * Si el contenido no entra (letra agrandada, un celular muy chico), la capa marca `data-desborda` y
 * vuelve a pan-y para poder desplazarlo: sin eso, los botones de abajo quedarían fuera de alcance.
 * En horizontal, la pausa y el tutorial van en dos columnas para entrar enteros desde 568×320.
 */
export function Capa({
  className,
  rol = 'dialog',
  titulo,
  children,
}: {
  /** Clases extra (`cf-capa--tutorial`). */
  className?: string
  rol?: 'dialog' | 'alertdialog'
  /** id del título (aria-labelledby). */
  titulo: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDesborde(ref)
  return (
    <div
      ref={ref}
      className={`cf-capa cf-capa--fija${className ? ` ${className}` : ''}`}
      role={rol}
      aria-modal="true"
      aria-labelledby={titulo}
    >
      {children}
    </div>
  )
}
