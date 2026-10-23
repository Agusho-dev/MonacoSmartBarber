'use client'

// Volver deslizando desde el borde izquierdo, como en iOS: la app instalada no
// tiene botón de atrás y en WhatsApp así se vuelve del chat a la lista, o de la
// info. del contacto al chat. Un toque que arranca a 24 px o menos del borde y
// se arrastra hacia la derecha mueve la pantalla con el dedo; al soltar, si pasó
// los 80 px (o fue un tirón rápido) termina de irse y vuelve; si no, vuelve a su
// lugar.
//
// No le gana a:
// - el scroll vertical: decide recién a los 10 px y sólo si el gesto es sobre
//   todo horizontal y hacia la derecha;
// - seleccionar texto: un toque largo (más de 400 ms antes de moverse), o con
//   texto ya seleccionado, no es volver;
// - el carrusel de respuestas rápidas, los campos y los controles de audio y
//   video: lo que empieza dentro de [data-sin-volver] o de un campo no cuenta.
//
// La capa, y el scroller de adentro, llevan `touch-action: pan-y`: así el
// navegador no se queda con los arrastres horizontales y el preventDefault de
// touchmove alcanza para que el hilo no scrollee mientras se arrastra.
//
// Lo que queda descubierto se ve oscurecido y el canto de la capa tiene sombra,
// como en iOS: la capa lleva la clase `wa-capa` (globals.css) y este hook le
// pone `--volver`, el progreso de 0 (en su lugar) a 1 (afuera).
//
// Devuelve `volverAnimado()`, para el «‹» de la pantalla: la misma salida que
// el final del gesto y después onVolver (con movimiento reducido, de una).
//
// El transform y el will-change se limpian siempre al terminar: dejados puestos,
// cualquier `position: fixed` de adentro pasaría a medirse contra la capa.

import { useEffect, useEffectEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'

const BORDE_PX = 24
const DECIDIR_PX = 10
const UMBRAL_PX = 80
const TOQUE_LARGO_MS = 400
const EXCLUIDOS = '[data-sin-volver], input, textarea, select, video, audio, [contenteditable="true"]'
const CURVA = 'cubic-bezier(0.2, 0.9, 0.3, 1)'
const SALIDA_MS = 220
const REGRESO_MS = 200
// La capa mientras termina de irse (por el gesto o por el «‹»): no arranca
// otro gesto ni otra salida.
const SALIENDO = 'data-saliendo'

// La salida en curso de cada capa, para cortarla si el hook se apaga a mitad.
const salidas = new WeakMap<HTMLElement, () => void>()

function reducirMovimiento(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function soltarEstilos(capa: HTMLElement) {
  capa.style.transition = ''
  capa.style.transform = ''
  capa.style.willChange = ''
  capa.style.removeProperty('--volver')
}

// Al terminar la transición del transform de la capa (o a los ms + 120, por si
// el evento no llega). Las transiciones de los hijos también burbujean hasta
// acá, y la de --volver también: se filtran por target y propiedad. Devuelve
// con qué cortar la espera.
function alTerminarTransicion(capa: HTMLElement, ms: number, hecho: () => void): () => void {
  let listo = false
  const fin = (e?: TransitionEvent) => {
    if (e && (e.target !== capa || e.propertyName !== 'transform')) return
    if (listo) return
    listo = true
    capa.removeEventListener('transitionend', fin)
    window.clearTimeout(reloj)
    hecho()
  }
  const reloj = window.setTimeout(fin, ms + 120)
  capa.addEventListener('transitionend', fin)
  return () => {
    listo = true
    capa.removeEventListener('transitionend', fin)
    window.clearTimeout(reloj)
  }
}

// Termina de irse hacia la derecha y vuelve. Con flushSync la pantalla se
// esconde antes de limpiar el transform: si no, se veía un cuadro de la capa de
// vuelta en su lugar.
function salir(capa: HTMLElement, onVolver: () => void) {
  const terminar = () => {
    salidas.delete(capa)
    flushSync(onVolver)
    soltarEstilos(capa)
    capa.removeAttribute(SALIENDO)
  }
  capa.setAttribute(SALIENDO, '')
  if (reducirMovimiento()) {
    terminar()
    return
  }
  capa.style.transition = `transform ${SALIDA_MS}ms ${CURVA}, --volver ${SALIDA_MS}ms ${CURVA}`
  capa.style.willChange = 'transform'
  // Medir después de poner la transición: la lectura fija el punto de partida.
  const ancho = capa.getBoundingClientRect().width
  capa.style.transform = `translate3d(${ancho}px, 0, 0)`
  capa.style.setProperty('--volver', '1')
  salidas.set(capa, alTerminarTransicion(capa, SALIDA_MS, terminar))
}

type Estado = 'quieto' | 'decidiendo' | 'arrastrando' | 'volviendo'

export function useDeslizarParaVolver(
  capaRef: RefObject<HTMLElement | null>,
  activo: boolean,
  onVolver: () => void,
): () => void {
  const volver = useEffectEvent(onVolver)

  useEffect(() => {
    const capa = capaRef.current
    if (!activo || !capa) return

    let estado: Estado = 'quieto'
    let x0 = 0
    let y0 = 0
    let t0 = 0
    let ultimoX = 0
    let ultimoT = 0
    let ancho = 1
    let velocidad = 0 // px/ms, suavizada
    let cortarRegreso: (() => void) | null = null

    const volverASuLugar = () => {
      estado = 'volviendo'
      capa.style.transition = `transform ${REGRESO_MS}ms ${CURVA}, --volver ${REGRESO_MS}ms ${CURVA}`
      capa.style.transform = 'translate3d(0, 0, 0)'
      capa.style.setProperty('--volver', '0')
      cortarRegreso = alTerminarTransicion(capa, REGRESO_MS, () => {
        cortarRegreso = null
        soltarEstilos(capa)
        estado = 'quieto'
      })
    }

    const alTocar = (e: TouchEvent) => {
      if (estado === 'volviendo' || capa.hasAttribute(SALIENDO)) return
      estado = 'quieto'
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX - capa.getBoundingClientRect().left > BORDE_PX) return
      if ((e.target as Element | null)?.closest?.(EXCLUIDOS)) return
      x0 = ultimoX = t.clientX
      y0 = t.clientY
      t0 = ultimoT = e.timeStamp
      velocidad = 0
      estado = 'decidiendo'
    }

    const alMover = (e: TouchEvent) => {
      if (estado !== 'decidiendo' && estado !== 'arrastrando') return
      if (e.touches.length !== 1) {
        // Entró un segundo dedo: no es volver.
        if (estado === 'arrastrando') volverASuLugar()
        else estado = 'quieto'
        return
      }
      const t = e.touches[0]
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      if (estado === 'decidiendo') {
        if (Math.abs(dx) < DECIDIR_PX && Math.abs(dy) < DECIDIR_PX) return
        const seleccion = window.getSelection()
        const esVolver =
          dx > 0 &&
          dx > Math.abs(dy) * 1.2 &&
          e.timeStamp - t0 < TOQUE_LARGO_MS &&
          (!seleccion || seleccion.isCollapsed)
        if (!esVolver) {
          estado = 'quieto'
          return
        }
        estado = 'arrastrando'
        ancho = capa.getBoundingClientRect().width || 1
        capa.style.transition = 'none'
        capa.style.willChange = 'transform'
      }
      if (e.cancelable) e.preventDefault()
      const dt = e.timeStamp - ultimoT
      if (dt > 0) velocidad = 0.8 * ((t.clientX - ultimoX) / dt) + 0.2 * velocidad
      ultimoX = t.clientX
      ultimoT = e.timeStamp
      const x = Math.max(0, dx)
      capa.style.transform = `translate3d(${x}px, 0, 0)`
      capa.style.setProperty('--volver', String(Math.min(1, x / ancho)))
    }

    const alSoltar = (e: TouchEvent) => {
      if (estado === 'decidiendo') {
        estado = 'quieto'
        return
      }
      if (estado !== 'arrastrando') return
      const xFinal = e.changedTouches[0]?.clientX ?? ultimoX
      const dx = Math.max(0, xFinal - x0)
      // Un tirón cuenta sólo si el dedo seguía moviéndose al soltar.
      const tiron = e.timeStamp - ultimoT < 80 && velocidad > 0.5 && dx > 40
      if (dx < UMBRAL_PX && !tiron) {
        volverASuLugar()
        return
      }
      estado = 'quieto'
      salir(capa, () => volver())
    }

    const alCancelar = () => {
      if (estado === 'arrastrando') volverASuLugar()
      else if (estado === 'decidiendo') estado = 'quieto'
    }

    capa.addEventListener('touchstart', alTocar, { passive: true })
    capa.addEventListener('touchmove', alMover, { passive: false })
    capa.addEventListener('touchend', alSoltar)
    capa.addEventListener('touchcancel', alCancelar)
    return () => {
      capa.removeEventListener('touchstart', alTocar)
      capa.removeEventListener('touchmove', alMover)
      capa.removeEventListener('touchend', alSoltar)
      capa.removeEventListener('touchcancel', alCancelar)
      cortarRegreso?.()
      salidas.get(capa)?.()
      salidas.delete(capa)
      capa.removeAttribute(SALIENDO)
      soltarEstilos(capa)
    }
  }, [capaRef, activo])

  // El «‹»: sale igual que al soltar el gesto. Fuera del celular, o con la
  // capa sin montar, vuelve de una.
  return () => {
    const capa = capaRef.current
    if (!activo || !capa?.isConnected) {
      onVolver()
      return
    }
    if (capa.hasAttribute(SALIENDO)) return
    salir(capa, onVolver)
  }
}
