'use client'

// Lo que se ve con el teclado virtual abierto (iOS y Android).
//
// Con el teclado abierto, iOS no achica el viewport de layout (en la app
// instalada sigue midiendo 812 px de alto): achica el viewport VISUAL, lo que
// queda arriba del teclado, y lo corre hacia abajo para mostrar el campo
// enfocado. En el iPhone 17 Pro, con el composer del chat enfocado, mide 409 px
// con offsetTop 403. Una capa `fixed inset-0` se mide contra el de layout, así
// que su parte de arriba queda fuera de la pantalla: el encabezado del chat
// quedaba en y = −403 mientras se escribía. Chrome de Android hace lo mismo
// desde la versión 108, y `dvh` no se entera del teclado en ninguno de los dos.
//
// useViewportConTeclado() dice dónde está lo que se ve mientras hay un teclado
// abierto, en px del viewport de layout (los de `position: fixed`): lo que se
// ponga con top = arriba y height = alto queda entero arriba del teclado (el
// encabezado a la vista, lo de abajo pegado al teclado). Sin teclado, null.
// Se sigue a lo que se ve y no a cuánto se supone que corre iOS: con <html> en
// overflow hidden (mientras hay una capa abierta, globals.css) puede correrlo
// o dejarlo arriba y tapar lo de abajo, y en los dos casos lo que se acomoda
// con estos números queda justo en lo que se ve.
//
// Es la idea de useTecladoVirtual de Tex (src/components/tex/chat/hooks.ts):
// sólo en pantallas táctiles y con más de 80 px. Pero compara el ALTO del
// viewport visual con el de layout, no lo que queda tapado abajo: con el
// viewport corrido 403 px, el teclado no tapa nada del de layout (lo de abajo
// del de layout queda justo arriba del teclado) y esa cuenta da 0.
//
// Se lee con useSyncExternalStore (resize y scroll del viewport visual), con el
// snapshot guardado: se mide en cada evento y no en cada dibujo, y mientras
// los números no cambian es el mismo objeto (React no vuelve a dibujar).

import { useSyncExternalStore } from 'react'

/** Lo que se ve con el teclado abierto, en px del viewport de layout. */
export interface ViewportConTeclado {
  /** Dónde empieza (visualViewport.offsetTop). */
  arriba: number
  /** Cuánto mide: lo que queda arriba del teclado (visualViewport.height). */
  alto: number
}

/** Lo que hace falta medir; separado del navegador para probar la cuenta. */
export interface MedidasDelViewport {
  /** El alto del viewport de layout. */
  altoLayout: number
  /** visualViewport.height */
  alto: number
  /** visualViewport.offsetTop */
  arriba: number
  /** visualViewport.scale: el zoom con dos dedos. */
  escala: number
  /** ¿El puntero principal es un dedo? (pointer: coarse) */
  tactil: boolean
}

/**
 * Lo que el viewport visual puede achicarse sin que sea un teclado: la barra
 * de Safari que aparece y se esconde, o la de atajos de un iPad con teclado
 * físico.
 */
export const MINIMO_TECLADO_PX = 80

/** El cálculo, sin navegador: dónde está lo que se ve si hay un teclado abierto. */
export function viewportConTeclado(m: MedidasDelViewport): ViewportConTeclado | null {
  // En una compu el zoom del trackpad también achica el viewport visual, y no
  // es un teclado.
  if (!m.tactil) return null
  // Con zoom de dos dedos el viewport visual se achica y se corre sin
  // teclado: si la capa lo persiguiera, se volvería a acomodar en cada
  // movimiento y el zoom no serviría para nada.
  if (Math.abs(m.escala - 1) > 0.01) return null
  if (!(m.alto > 0) || m.altoLayout - m.alto <= MINIMO_TECLADO_PX) return null
  return { arriba: Math.max(0, m.arriba), alto: m.alto }
}

// El snapshot: se mide al suscribirse y con cada evento del viewport visual, y
// el dibujo lo lee de acá. Leer el viewport visual puede forzar un layout, y el
// chat se vuelve a dibujar con cada letra que se escribe.
let tactil: MediaQueryList | null = null
let medido: ViewportConTeclado | null = null
let suscriptos = 0

function medir() {
  const vv = window.visualViewport
  tactil ??= window.matchMedia('(pointer: coarse)')
  const ahora = vv
    ? viewportConTeclado({
        // El alto del viewport de layout es el del <html> (el bloque inicial),
        // que el teclado no toca. innerHeight sola no sirve: en iOS es el alto
        // del viewport VISUAL (con el teclado abierto en la app instalada midió
        // 409, no 812). El mayor de los dos cubre a un navegador que haga al revés.
        altoLayout: Math.max(window.innerHeight, document.documentElement.clientHeight),
        alto: vv.height,
        arriba: vv.offsetTop,
        escala: vv.scale,
        tactil: tactil.matches,
      })
    : null
  // El mismo objeto mientras no cambie nada: useSyncExternalStore compara por
  // referencia, y uno nuevo en cada medida sería un dibujo de más.
  if (ahora && medido && ahora.arriba === medido.arriba && ahora.alto === medido.alto) return
  medido = ahora
}

function leer(): ViewportConTeclado | null {
  // Sin nadie suscripto no llegan los eventos: el primer dibujo mide.
  if (suscriptos === 0) medir()
  return medido
}

function suscribir(avisar: () => void): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  suscriptos++
  medir()
  // resize: se abre, se cierra o cambia el teclado. scroll: el viewport visual
  // se corre (al enfocar un campo, o al arrastrar con el teclado abierto).
  const alCambiar = () => {
    medir()
    avisar()
  }
  vv.addEventListener('resize', alCambiar)
  vv.addEventListener('scroll', alCambiar)
  return () => {
    suscriptos--
    vv.removeEventListener('resize', alCambiar)
    vv.removeEventListener('scroll', alCambiar)
  }
}

const sinSuscripcion = () => () => {}
const sinTeclado = () => null

/**
 * Dónde está lo que se ve con el teclado virtual abierto (null sin teclado,
 * en el servidor y al hidratar). Con `activo` en false no escucha nada y da
 * null: quien sólo lo necesita con su capa a la vista no se vuelve a dibujar
 * por el teclado de otra pantalla.
 */
export function useViewportConTeclado(activo = true): ViewportConTeclado | null {
  return useSyncExternalStore(activo ? suscribir : sinSuscripcion, activo ? leer : sinTeclado, sinTeclado)
}
