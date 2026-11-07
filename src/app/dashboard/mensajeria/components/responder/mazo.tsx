'use client'

// El mazo de «Por responder» (6/nov/2026): la tarjeta de arriba se arrastra
// con el dedo (o el mouse) y las dos de atrás esperan debajo, más chicas. En
// el celular la tarjeta es la pantalla entera (7/nov/2026): las de atrás se
// ven recién cuando se la arrastra, y crecen a su lugar mientras se va.
//
// - Derecha: lo que diga la tarjeta (mandar el borrador, escribir, abrir el
//   chat). Izquierda: «Listo». Pasado el umbral (110 px) o con un tirón rápido
//   (más exigente a la derecha: ahí sale un mensaje), se va volando; si no,
//   vuelve con un rebote.
// - Mientras se arrastra, la tarjeta gira apenas, los sellos ENVIAR / LISTO se
//   prenden (--pr-der / --pr-izq) y la de atrás va subiendo a su lugar
//   (--pr-avance en la raíz). Todo por estilos, sin renders: el dedo manda.
// - El gesto decide a los 8 px: si es sobre todo vertical, es scroll de la
//   charla y no se toca. Lo que empieza en un link, un campo o una fila de
//   chips ([data-sin-arrastre], que scrollea de costado) no arrastra.
//   `touch-action: pan-y` en la carta y en cada cosa que scrollea adentro: el
//   navegador se queda con lo vertical y nos deja lo horizontal.
// - Los bordes de la pantalla son del sistema (el «atrás» de iOS y de
//   Android): un toque que arranca a menos de 16 px de un costado no arrastra.
//   El «volver» propio de la capa no corre sobre la tarjeta (data-sin-volver):
//   para volver están el «‹» de la tarjeta y el «atrás» del sistema.

import {
  forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export type Direccion = 'derecha' | 'izquierda' | 'abajo'

export interface MazoRef {
  /** Saca la tarjeta de arriba volando, como si se la hubiera deslizado. */
  lanzar: (dir: Direccion) => void
  /** «No se puede»: la tarjeta tiembla. */
  sacudir: () => void
}

const UMBRAL_PX = 110
const DECIDIR_PX = 8
/** La franja de cada costado de la pantalla que es del gesto del sistema. */
const BORDE_DEL_SISTEMA_PX = 16
// Un tirón rápido también suelta la tarjeta, pero mandar pide más que descartar:
// a la derecha sale un mensaje a un cliente (probado: un arrastre de 60 px rápido
// alcanzaba para mandar). A la izquierda alcanza con menos.
const TIRON = {
  derecha: { velocidad: 0.95, distancia: 80 },
  izquierda: { velocidad: 0.55, distancia: 40 },
} as const

interface Arrastre {
  id: number
  x0: number
  y0: number
  dx: number
  dy: number
  modo: 'pendiente' | 'arrastrando'
  muestras: { t: number; x: number }[]
}

function sinMovimiento(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const Mazo = forwardRef<MazoRef, {
  /** Las tarjetas, la de arriba primero (se dibujan hasta tres). */
  ids: string[]
  render: (id: string, posicion: number) => ReactNode
  /** ¿Se puede soltar para ese lado? false = vuelve y tiembla. */
  puedeSoltar: (id: string, dir: Direccion) => boolean
  /** La tarjeta ya se fue (terminó la animación): quien llama la saca de `ids`. */
  onSoltada: (id: string, dir: Direccion) => void
  /** Cruzó el umbral (para la vibración en Android). */
  onUmbral?: () => void
  className?: string
}>(function Mazo({ ids, render, puedeSoltar, onSoltada, onUmbral, className }, ref) {
  const raiz = useRef<HTMLDivElement>(null)
  const arriba = useRef<HTMLDivElement>(null)
  const arrastre = useRef<Arrastre | null>(null)
  const saliendo = useRef(false)
  const pasoUmbral = useRef(false)
  const idArriba = ids[0] ?? null

  // Al cambiar la de arriba, todo vuelve a reposo (la de atrás ya está en su lugar).
  useLayoutEffect(() => {
    const r = raiz.current
    if (!r) return
    r.style.setProperty('--pr-avance', '0')
    delete r.dataset.soltando
    saliendo.current = false
  }, [idArriba])

  const aplicar = useCallback((dx: number, dy: number) => {
    const el = arriba.current
    const r = raiz.current
    if (!el || !r) return
    el.style.transform = `translate3d(${dx}px, ${dy * 0.18}px, 0) rotate(${dx * 0.055}deg)`
    const avance = Math.min(1, Math.abs(dx) / UMBRAL_PX)
    r.style.setProperty('--pr-avance', avance.toFixed(3))
    el.style.setProperty('--pr-der', dx > 0 ? avance.toFixed(3) : '0')
    el.style.setProperty('--pr-izq', dx < 0 ? avance.toFixed(3) : '0')
    const cruzo = avance >= 1
    if (cruzo && !pasoUmbral.current) onUmbral?.()
    pasoUmbral.current = cruzo
  }, [onUmbral])

  const reposo = useCallback(() => {
    const el = arriba.current
    const r = raiz.current
    if (!el || !r) return
    const desde = el.style.transform || 'translate3d(0,0,0)'
    r.dataset.soltando = ''
    r.style.setProperty('--pr-avance', '0')
    el.style.setProperty('--pr-der', '0')
    el.style.setProperty('--pr-izq', '0')
    el.style.transform = ''
    if (!sinMovimiento()) {
      el.animate(
        [{ transform: desde }, { transform: 'translate3d(0,0,0) rotate(0deg)' }],
        { duration: 420, easing: 'cubic-bezier(0.2, 1.35, 0.35, 1)' },
      )
    }
    window.setTimeout(() => {
      if (!saliendo.current && raiz.current) delete raiz.current.dataset.soltando
    }, 440)
  }, [])

  const sacudir = useCallback(() => {
    const el = arriba.current
    if (!el || sinMovimiento()) return
    el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-12px) rotate(-1deg)' },
        { transform: 'translateX(10px) rotate(0.8deg)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 420, easing: 'ease-out' },
    )
  }, [])

  const lanzar = useCallback((dir: Direccion) => {
    const el = arriba.current
    const r = raiz.current
    const id = ids[0]
    if (!el || !r || !id || saliendo.current) return
    if (!puedeSoltar(id, dir)) {
      reposo()
      sacudir()
      return
    }
    saliendo.current = true
    r.dataset.soltando = ''
    r.style.setProperty('--pr-avance', '1')
    el.style.setProperty('--pr-der', dir === 'derecha' ? '1' : '0')
    el.style.setProperty('--pr-izq', dir === 'izquierda' ? '1' : '0')
    const terminar = () => onSoltada(id, dir)
    if (sinMovimiento()) {
      terminar()
      return
    }
    const ancho = r.clientWidth || window.innerWidth
    const desde = el.style.transform || 'translate3d(0,0,0)'
    const hasta = dir === 'abajo'
      ? 'translate3d(0, 140px, 0) scale(0.86)'
      : `translate3d(${(dir === 'derecha' ? 1 : -1) * (ancho + 180)}px, 60px, 0) rotate(${dir === 'derecha' ? 22 : -22}deg)`
    const anim = el.animate(
      [{ transform: desde, opacity: 1 }, { transform: hasta, opacity: dir === 'abajo' ? 0 : 1 }],
      { duration: dir === 'abajo' ? 240 : 320, easing: 'cubic-bezier(0.32, 0.6, 0.4, 1)', fill: 'forwards' },
    )
    anim.onfinish = terminar
    anim.oncancel = terminar
  }, [ids, onSoltada, puedeSoltar, reposo, sacudir])

  useImperativeHandle(ref, () => ({ lanzar, sacudir }), [lanzar, sacudir])

  const alApretar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (saliendo.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.pointerType !== 'mouse' && (e.clientX < BORDE_DEL_SISTEMA_PX || e.clientX > window.innerWidth - BORDE_DEL_SISTEMA_PX)) return
    // Los botones de la tarjeta (la burbuja del borrador) sí arrastran: con la
    // captura del puntero, el clic no llega a dispararse después de un arrastre.
    if ((e.target as Element).closest('[data-sin-arrastre], a, input, textarea, select')) return
    arrastre.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, modo: 'pendiente', muestras: [{ t: e.timeStamp, x: e.clientX }] }
  }

  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = arrastre.current
    if (!a || a.id !== e.pointerId) return
    a.dx = e.clientX - a.x0
    a.dy = e.clientY - a.y0
    if (a.modo === 'pendiente') {
      if (Math.abs(a.dy) > DECIDIR_PX && Math.abs(a.dy) > Math.abs(a.dx)) {
        arrastre.current = null // scroll de la charla
        return
      }
      if (Math.abs(a.dx) < DECIDIR_PX) return
      a.modo = 'arrastrando'
      e.currentTarget.setPointerCapture(e.pointerId)
      raiz.current?.setAttribute('data-arrastrando', '')
      // Arrancar a mover sin el salto de los 8 px de la decisión.
      a.x0 += Math.sign(a.dx) * DECIDIR_PX
      a.dx = e.clientX - a.x0
    }
    e.preventDefault()
    a.muestras.push({ t: e.timeStamp, x: e.clientX })
    if (a.muestras.length > 6) a.muestras.shift()
    aplicar(a.dx, a.dy)
  }

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>, cancelado = false) => {
    const a = arrastre.current
    if (!a || a.id !== e.pointerId) return
    arrastre.current = null
    raiz.current?.removeAttribute('data-arrastrando')
    pasoUmbral.current = false
    if (a.modo !== 'arrastrando') return
    if (cancelado) {
      reposo()
      return
    }
    const primera = a.muestras[0]
    const ultima = a.muestras[a.muestras.length - 1]
    const dt = Math.max(1, ultima.t - primera.t)
    const velocidad = (ultima.x - primera.x) / dt
    const reglas = a.dx > 0 ? TIRON.derecha : TIRON.izquierda
    const tiron = Math.abs(velocidad) > reglas.velocidad && Math.sign(velocidad) === Math.sign(a.dx) && Math.abs(a.dx) > reglas.distancia
    if (Math.abs(a.dx) >= UMBRAL_PX || tiron) {
      lanzar(a.dx > 0 ? 'derecha' : 'izquierda')
    } else {
      reposo()
    }
  }

  return (
    <div ref={raiz} className={cn('pr-mazo relative isolate', className)}>
      {ids.slice(0, 3).map((id, i) => {
        const deArriba = i === 0
        return (
          <div
            key={id}
            ref={deArriba ? arriba : undefined}
            data-posicion={i}
            // El arrastre de la tarjeta no es el «volver» de la capa (deslizar-para-volver.ts).
            data-sin-volver={deArriba ? '' : undefined}
            aria-hidden={deArriba ? undefined : true}
            inert={!deArriba}
            onPointerDown={deArriba ? alApretar : undefined}
            onPointerMove={deArriba ? alMover : undefined}
            onPointerUp={deArriba ? (e) => alSoltar(e) : undefined}
            onPointerCancel={deArriba ? (e) => alSoltar(e, true) : undefined}
            className={cn(
              'pr-carta absolute inset-0 touch-pan-y select-none [-webkit-touch-callout:none]',
              deArriba ? 'z-30 cursor-grab active:cursor-grabbing' : i === 1 ? 'z-20' : 'z-10',
            )}
          >
            {render(id, i)}
          </div>
        )
      })}
    </div>
  )
})
