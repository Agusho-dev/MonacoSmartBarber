// La fecha del chat, como en WhatsApp: los separadores de día van en el hilo,
// en el flujo (no pegados arriba), y UNA pastilla flotante, debajo del
// encabezado, aparece mientras se scrollea con el día de lo que se ve arriba y
// se desvanece un segundo después de que el scroll para.
//
// Antes cada separador era sticky: el de arriba quedaba siempre a la vista,
// también quieto, encima de la primera burbuja, y le tapaba el texto a mitad
// de palabra; en la compu se veían dos fechas a la vez.
//
// Lógica pura (sin DOM ni React): qué día dice la pastilla y cuándo se ve. La
// prueban nav-tests/chat; chat-view.tsx la conecta con el scroll del hilo.

import { claveDeDia } from '../shared/use-dia-local'

/** La pastilla se va a este tiempo de que el scroll paró. */
export const PASTILLA_QUIETA_MS = 1000
/** Un scroll hasta este tiempo después de un toque, la rueda o una tecla lo hizo la persona. */
export const MARGEN_GESTO_MS = 250
/** Aire alrededor de la franja de la pastilla: un separador más cerca que esto ya es "la fecha de ahí". */
export const HOLGURA_PX = 8

function inicioDelDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function desdeClave(clave: string): Date | null {
  const [y, m, d] = clave.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/**
 * El separador de día como lo escribe WhatsApp: Hoy, Ayer, el día de la semana
 * si fue en los últimos siete días y si no la fecha ("12 de octubre", con el
 * año si no es este). Cuenta días de calendario, no tramos de 24 horas.
 * `hoy` es la clave del día del navegador (useDiaLocal): el render no lee el
 * reloj. Sin ella (en el servidor, al hidratar) va la fecha.
 */
export function etiquetaDeDia(fecha: Date, hoy: string | null): string {
  const diaDeHoy = hoy ? desdeClave(hoy) : null
  if (diaDeHoy) {
    const dias = Math.round((inicioDelDia(diaDeHoy) - inicioDelDia(fecha)) / 86_400_000)
    // Un mensaje "de mañana" es un reloj atrasado: también es de hoy.
    if (dias <= 0) return 'Hoy'
    if (dias === 1) return 'Ayer'
    if (dias < 7) {
      const semana = fecha.toLocaleDateString('es-AR', { weekday: 'long' })
      return semana.charAt(0).toUpperCase() + semana.slice(1)
    }
  }
  return fecha.toLocaleDateString(
    'es-AR',
    diaDeHoy && fecha.getFullYear() === diaDeHoy.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' },
  )
}

/** La clave del día de un mensaje (su created_at), en la hora del navegador. */
export function diaDelMensaje(createdAt: string): string {
  return claveDeDia(new Date(createdAt))
}

/** Un separador del hilo, medido: su día y dónde está su pastilla (px, en el contenido del hilo). */
export interface SeparadorMedido {
  dia: string
  arriba: number
  alto: number
}

/** Dónde queda la pastilla flotante, en px del contenido del hilo (scrollTop + su distancia al borde). */
export interface Franja {
  arriba: number
  alto: number
}

/**
 * El día que dice la pastilla flotante: el de lo que asoma debajo de ella, o
 * sea el del último separador que ya pasó por arriba. Null si no va:
 * - no hay separadores, o todavía no pasó ninguno (arriba de todo se ve el
 *   primero, en el flujo);
 * - un separador del hilo se cruza con la franja de la pastilla (con
 *   HOLGURA_PX de aire): ya hay una fecha a la vista ahí, y serían dos, una
 *   encima de la otra.
 * Los separadores van en el orden del hilo.
 */
export function diaDeLaPastilla(
  separadores: readonly SeparadorMedido[],
  franja: Franja,
  holgura: number = HOLGURA_PX,
): string | null {
  const abajo = franja.arriba + franja.alto
  let dia: string | null = null
  for (const s of separadores) {
    // De acá para abajo, todos quedan debajo de la pastilla.
    if (s.arriba >= abajo + holgura) break
    // Se cruza con la franja: esa fecha ya se ve.
    if (s.arriba + s.alto > franja.arriba - holgura) return null
    dia = s.dia
  }
  return dia
}

/** Lo que dibuja la pastilla: si se ve y qué día dice (mientras se desvanece sigue diciendo el último). */
export interface VistaPastilla {
  visible: boolean
  dia: string | null
}

export const PASTILLA_ESCONDIDA: VistaPastilla = { visible: false, dia: null }

/**
 * Cuándo se ve la pastilla. Los eventos llegan del hilo (chat-view.tsx) con
 * su `timeStamp`; el reloj se inyecta, así se prueba sin esperar.
 * - Sólo un scroll de la persona la muestra: el que sigue a un toque, a la
 *   rueda, a una tecla o a la barra de scroll (MARGEN_GESTO_MS), el que pasa
 *   con el dedo apoyado, y la inercia de un scroll que ya la mostró. El salto
 *   al final al abrir un chat, o cuando llega un mensaje, no.
 * - Se va PASTILLA_QUIETA_MS después del último scroll (con el dedo apoyado,
 *   espera a que se levante).
 * - `pintar` recibe sólo los cambios.
 */
export function crearPastilla(deps: {
  programar: (fn: () => void, ms: number) => () => void
  pintar: (vista: VistaPastilla) => void
}) {
  let vista = PASTILLA_ESCONDIDA
  let ultimoGesto = Number.NEGATIVE_INFINITY
  let tocando = false
  let activa = false
  let cancelar: (() => void) | null = null

  const fijar = (nueva: VistaPastilla) => {
    if (nueva.visible === vista.visible && nueva.dia === vista.dia) return
    vista = nueva
    deps.pintar(nueva)
  }
  const esperarQuieta = () => {
    cancelar?.()
    cancelar = deps.programar(() => {
      cancelar = null
      if (tocando) {
        esperarQuieta()
        return
      }
      activa = false
      fijar({ visible: false, dia: vista.dia })
    }, PASTILLA_QUIETA_MS)
  }

  return {
    /** La rueda, una tecla o la barra de scroll del hilo. */
    gesto(t: number) {
      ultimoGesto = t
    },
    /** Un dedo se apoya (true) o se levanta (false) sobre el hilo. */
    dedo(apoyado: boolean, t: number) {
      tocando = apoyado
      ultimoGesto = t
    },
    /**
     * El hilo scrolleó. `calcularDia` da diaDeLaPastilla en esa posición: se
     * llama sólo si el scroll cuenta (medir el hilo en cada salto al final
     * sería trabajo tirado).
     */
    scroll(t: number, calcularDia: () => string | null) {
      if (!tocando && !activa && t - ultimoGesto > MARGEN_GESTO_MS) return
      activa = true
      const dia = calcularDia()
      fijar({ visible: dia !== null, dia: dia ?? vista.dia })
      esperarQuieta()
    },
    // Otro chat es otra pastilla (chat-view la monta con la clave del chat).
    destruir() {
      cancelar?.()
      cancelar = null
    },
  }
}
