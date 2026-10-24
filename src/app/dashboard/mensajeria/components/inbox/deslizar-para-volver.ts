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
//   video: lo que empieza dentro de [data-sin-volver] o de un campo no cuenta;
// - el «atrás» del sistema en el iPhone (Safari y la app instalada): iOS 26
//   desliza el historial desde los primeros ~10 pt del borde de la PANTALLA y,
//   si los dos arrancaban juntos, se veían tres planos desfasados (la capa, la
//   página y la foto de la pantalla anterior). Ahí el gesto propio deja esa
//   franja (los primeros 12 px de la pantalla, medido en el simulador de iOS
//   26.3: desde 3 pt corrían los dos, desde 12 y 20 pt sólo el nuestro) y el
//   del sistema cierra la capa, porque cada capa es una entrada del historial
//   (historial-capas.ts).
//
// Con dos capas (la info. del contacto sobre el chat), sólo la de arriba toma
// el gesto.
//
// La capa, y el scroller de adentro, llevan `touch-action: pan-y`: así el
// navegador no se queda con los arrastres horizontales y el preventDefault de
// touchmove alcanza para que el hilo no scrollee mientras se arrastra.
//
// Lo que queda descubierto se ve oscurecido y el canto de la capa tiene sombra,
// como en iOS: la capa lleva la clase `wa-capa` (globals.css) y este hook le
// pone `--volver`, el progreso de 0 (en su lugar) a 1 (afuera). La lista de
// chats de abajo hace el paralaje de iOS (corrida un 30 %, sigue al dedo): lo
// publica historial-capas.ts, sin renders (globals.css, «Paralaje de la lista»).
//
// Devuelve `volverAnimado()`, para el «‹» de la pantalla: la misma salida que
// el final del gesto y después onVolver (con movimiento reducido, de una).
//
// Mientras `activo` (la capa abierta en el celular), la capa es una entrada del
// historial: el «atrás» del sistema la cierra (en iOS de una, porque el sistema
// ya animó la foto de la pantalla anterior, y lo mismo si el navegador avisa
// que ya animó el suyo; en el resto, animada) y cerrarla por la interfaz saca
// su entrada. El nombre de la entrada (#/chat) sale del atributo data-capa del
// elemento. Al cerrarse, el foco vuelve a lo que la abrió (foco-de-vuelta.ts).
//
// El transform y el will-change se limpian siempre al terminar: dejados puestos,
// cualquier `position: fixed` de adentro pasaría a medirse contra la capa.

import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { devolverFoco, origenDelFoco } from './foco-de-vuelta'
import { abrirCapa, montarHistorial, sistemaConAtrasDeslizando, type RegistroDeCapa } from './historial-capas'

const BORDE_PX = 24
// La franja del «atrás» del sistema en el iPhone, que el gesto propio le deja
// (medida desde el borde de la pantalla, no de la capa).
const FRANJA_DEL_SISTEMA_PX = 12
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
// La vuelta a su lugar en curso (después de un arrastre corto), para que una
// salida la corte: si no, al terminar el regreso le sacaba el transform a la
// capa que se estaba yendo y la salida se deshacía a mitad.
const regresos = new WeakMap<HTMLElement, () => void>()

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
// vuelta en su lugar. La lista de abajo vuelve a su lugar con la misma curva.
// Si la capa todavía está entrando, se fija donde está y se corta la entrada.
// La animación de entrada (slide-in-from-right) sólo tiene 'from': su final
// implícito pasaba a ser el transform de salida, y la capa se iba de golpe en
// el primer cuadro, sin animación, mientras la lista volvía con su curva.
function cortarEntrada(capa: HTMLElement) {
  for (const animacion of capa.getAnimations()) {
    try {
      animacion.commitStyles()
    } catch {
      // Sin caja (display: none) no hay estilos que fijar.
    }
    animacion.cancel()
  }
}

function salir(capa: HTMLElement, onVolver: () => void, registro: RegistroDeCapa | null) {
  if (capa.hasAttribute(SALIENDO)) return
  regresos.get(capa)?.()
  cortarEntrada(capa)
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
  registro?.moverLista('saliendo', 0)
  salidas.set(capa, alTerminarTransicion(capa, SALIDA_MS, terminar))
}

// Vuelve a su lugar después de un arrastre corto, y la lista con ella.
function volverASuLugar(capa: HTMLElement, registro: RegistroDeCapa) {
  cortarEntrada(capa)
  capa.style.transition = `transform ${REGRESO_MS}ms ${CURVA}, --volver ${REGRESO_MS}ms ${CURVA}`
  capa.style.transform = 'translate3d(0, 0, 0)'
  capa.style.setProperty('--volver', '0')
  registro.moverLista('volviendo', 1)
  const cortar = alTerminarTransicion(capa, REGRESO_MS, () => {
    regresos.delete(capa)
    soltarEstilos(capa)
    registro.moverLista('abierta')
  })
  regresos.set(capa, () => {
    cortar()
    regresos.delete(capa)
  })
}

type Estado = 'quieto' | 'decidiendo' | 'arrastrando'

export function useDeslizarParaVolver(
  capaRef: RefObject<HTMLElement | null>,
  activo: boolean,
  onVolver: () => void,
): () => void {
  const volver = useEffectEvent(onVolver)
  const registroRef = useRef<RegistroDeCapa | null>(null)

  // Mensajería en pantalla: el historial escucha el «atrás» del sistema (uno
  // solo para todas las capas; se apaga cuando no queda ninguna montada).
  useLayoutEffect(() => montarHistorial(), [])

  // De layout: la entrada del historial se empuja antes de que se pinte la capa
  // (iOS guarda la foto de la pantalla de abajo al empujar), y el paralaje
  // arranca en el mismo cuadro que la animación de entrada.
  useLayoutEffect(() => {
    const capa = capaRef.current
    if (!activo || !capa) return

    // Lo que tenía el foco al abrir: vuelve ahí al cerrar.
    const origen = origenDelFoco(capa)
    // En el iPhone, el «atrás» del sistema desliza desde el borde.
    const atrasDelSistema = sistemaConAtrasDeslizando()

    let estado: Estado = 'quieto'
    let x0 = 0
    let y0 = 0
    let t0 = 0
    let ultimoX = 0
    let ultimoT = 0
    let ancho = 1
    let velocidad = 0 // px/ms, suavizada

    // El «atrás» del sistema la cerró: en iOS el sistema ya mostró la foto de
    // la pantalla de abajo, así que se cierra de una (con flushSync, el cuadro
    // siguiente ya es esa pantalla), y lo mismo si el navegador avisa que ya
    // animó el suyo (yaAnimado); en el resto, con la misma salida del gesto.
    const cerrarPorElSistema = (yaAnimado: boolean) => {
      if (capa.hasAttribute(SALIENDO)) return
      estado = 'quieto'
      if (atrasDelSistema || yaAnimado || reducirMovimiento()) {
        regresos.get(capa)?.()
        flushSync(() => volver())
        soltarEstilos(capa)
        return
      }
      salir(capa, () => volver(), registro)
    }
    const registro = abrirCapa(capa.dataset.capa ?? '', cerrarPorElSistema)
    registroRef.current = registro

    const alTocar = (e: TouchEvent) => {
      if (regresos.has(capa) || capa.hasAttribute(SALIENDO)) return
      // Un segundo dedo a mitad del arrastre: la capa vuelve a su lugar. Si sólo
      // se cortaba el estado, quedaba trabada a mitad de camino con transform,
      // will-change y --volver puestos (la rama de dos dedos de alMover no
      // llegaba a correr).
      if (estado === 'arrastrando') {
        estado = 'quieto'
        volverASuLugar(capa, registro)
        return
      }
      estado = 'quieto'
      if (e.touches.length !== 1 || !registro.arriba()) return
      const t = e.touches[0]
      // La franja del sistema es de la pantalla; la del gesto, de la capa.
      if (atrasDelSistema && t.clientX < FRANJA_DEL_SISTEMA_PX) return
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
        if (estado === 'arrastrando') volverASuLugar(capa, registro)
        estado = 'quieto'
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
        // Con el teclado abierto, volver lo cierra, como en WhatsApp. Si no, lo de
        // abajo se veía corrido hacia arriba (el viewport visual del teclado):
        // las filas del medio y la barra flotando sobre el teclado, sin «Chats».
        const enfocado = document.activeElement
        if (enfocado instanceof HTMLElement && capa.contains(enfocado) && enfocado.matches('input, textarea, [contenteditable="true"]')) {
          enfocado.blur()
        }
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
      const progreso = Math.min(1, x / ancho)
      capa.style.transform = `translate3d(${x}px, 0, 0)`
      capa.style.setProperty('--volver', String(progreso))
      registro.moverLista('arrastrando', 1 - progreso)
    }

    const alSoltar = (e: TouchEvent) => {
      if (estado === 'decidiendo') {
        estado = 'quieto'
        return
      }
      if (estado !== 'arrastrando') return
      estado = 'quieto'
      const xFinal = e.changedTouches[0]?.clientX ?? ultimoX
      const dx = Math.max(0, xFinal - x0)
      // Un tirón cuenta sólo si el dedo seguía moviéndose al soltar.
      const tiron = e.timeStamp - ultimoT < 80 && velocidad > 0.5 && dx > 40
      if (dx < UMBRAL_PX && !tiron) {
        volverASuLugar(capa, registro)
        return
      }
      salir(capa, () => volver(), registro)
    }

    const alCancelar = () => {
      if (estado === 'arrastrando') volverASuLugar(capa, registro)
      estado = 'quieto'
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
      regresos.get(capa)?.()
      salidas.get(capa)?.()
      salidas.delete(capa)
      capa.removeAttribute(SALIENDO)
      soltarEstilos(capa)
      registroRef.current = null
      // Se cerró (por la interfaz o por el sistema) o se desmontó: su entrada
      // se va (historial-capas.ts decide si hace falta volver atrás).
      registro.quitar()
      devolverFoco(origen, capa)
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
    salir(capa, onVolver, registroRef.current)
  }
}
