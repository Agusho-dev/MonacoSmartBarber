/**
 * Lectura del joystick táctil, en puro (sin DOM: se prueba con Node).
 *
 * 1) `leerStick`: de un desplazamiento del pulgar (dx, dy en px, y hacia abajo) a las cuatro
 *    direcciones, por SECTORES ANGULARES (8 direcciones) con histéresis.
 *     - Manda el ÁNGULO, no el recorrido. Antes los umbrales eran px fijos por eje: la misma
 *       diagonal saltaba con el pulgar a fondo y no saltaba a medio camino (hacían falta 35°
 *       a 0,8 R y 67° a 0,5 R), y caminar a fondo con el pulgar torcido 21° ya saltaba.
 *     - Arriba incluye las diagonales (de 33° a 147° sobre la horizontal): salto con
 *       dirección. Los costados son más anchos que un octavo (±33°): caminar con el pulgar un
 *       poco torcido no salta. Medido con el motor real (revisión del 30/oct): caminando con el
 *       pulgar a 24° y un vaivén de ±4°, con 30° saltaba solo en 27 de 30 corridas (y, como
 *       arriba sostenida vuelve a saltar, saltaba una y otra vez); con 33°, en ninguna. Una
 *       diagonal de 35° o más sigue saltando siempre.
 *     - Abajo pide más (38°): agacharse frena la caminata, y el pulgar que camina para atrás
 *       tiende a caerse. Agacharse a propósito (45° o más) sale igual.
 *     - Las diagonales llevan dirección hasta 67,5° (un octavo); más vertical es salto recto.
 *     - Para salir de un sector hay que pasarse 7–8° del borde: no titila en el límite. Arriba
 *       se suelta apenas el pulgar baja de 26° (antes, de 22°): volver a caminar un poco torcido
 *       corta el salto repetido.
 *     - Arriba y abajo piden un poco más de recorrido que caminar: el temblor al apoyar el
 *       pulgar no salta.
 *
 * 2) `crearDetectorEmpujones`: dos empujones rápidos al mismo costado = esquiva (dash), aunque
 *    el pulgar no vuelva al centro. Mira el x ABSOLUTO del dedo (la base flotante se mueve con
 *    él): un empujón termina cuando el dedo vuelve hacia adentro una fracción del radio (o el
 *    stick sale de ese costado) y el siguiente empieza cuando vuelve a salir otro tanto.
 */

export interface DireccionesStick {
  izquierda: boolean
  derecha: boolean
  arriba: boolean
  abajo: boolean
}

export const STICK_SUELTO: Readonly<DireccionesStick> = Object.freeze({
  izquierda: false,
  derecha: false,
  arriba: false,
  abajo: false,
})

/** Zona muerta, en fracción del radio: para entrar y para volver al centro. */
const MUERTA_ENTRA = 0.22
const MUERTA_SALE = 0.15
/** Recorrido mínimo para arriba o abajo (fracción del radio). */
const VERTICAL_MIN = 0.34
/** Grados sobre la horizontal para que cuente arriba (entrar, salir). */
const ARRIBA_ENTRA = 33
const ARRIBA_SALE = 26
/** Lo mismo para abajo (agacharse frena: pide más). */
const ABAJO_ENTRA = 38
const ABAJO_SALE = 30
/** Grados sobre la horizontal hasta los que el costado todavía cuenta (entrar, salir). */
const HORIZONTAL_ENTRA = 67.5
const HORIZONTAL_SALE = 75.5

export function leerStick(dx: number, dy: number, radio: number, antes: Readonly<DireccionesStick>): DireccionesStick {
  const d = Math.hypot(dx, dy) / Math.max(1, radio)
  const habia = antes.izquierda || antes.derecha || antes.arriba || antes.abajo
  if (!(d >= (habia ? MUERTA_SALE : MUERTA_ENTRA))) return { ...STICK_SUELTO }
  // Elevación: 0° = costado puro, 90° = arriba o abajo puro.
  const elevacion = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
  const haciaArriba = dy < 0
  const verticalAntes = haciaArriba ? antes.arriba : antes.abajo
  const vertical = verticalAntes
    ? elevacion > (haciaArriba ? ARRIBA_SALE : ABAJO_SALE)
    : elevacion > (haciaArriba ? ARRIBA_ENTRA : ABAJO_ENTRA) && d >= VERTICAL_MIN
  const haciaDerecha = dx > 0
  const costadoAntes = haciaDerecha ? antes.derecha : antes.izquierda
  const costado = dx !== 0 && elevacion < (costadoAntes ? HORIZONTAL_SALE : HORIZONTAL_ENTRA)
  return {
    izquierda: costado && !haciaDerecha,
    derecha: costado && haciaDerecha,
    arriba: vertical && haciaArriba,
    abajo: vertical && !haciaArriba,
  }
}

// ─── Doble empujón = esquiva ────────────────────────────────────────────────

/** Lo que tiene que volver el dedo hacia adentro para que el empujón cuente como soltado (fracción del radio). */
const RETRAER = 0.32
/** Lo que tiene que volver a salir desde el punto más adentro para que sea un empujón nuevo. */
const REEMPUJAR = 0.32
/** El primer empujón tiene que ser corto: si fue una caminata, no hay esquiva (ms). */
const EMPUJON_CORTO = 300
/** Entre soltar el primero y arrancar el segundo (ms). */
const VENTANA_DOBLE = 320

export interface DetectorEmpujones {
  /**
   * Un movimiento del dedo: `x` absoluto en px, `costado` que lee el stick (-1, 0, 1) y si está
   * arriba o abajo. Devuelve true cuando se completa un doble empujón (hay que esquivar).
   */
  mover(x: number, costado: -1 | 0 | 1, vertical: boolean, radio: number, ahora: number): boolean
  /** El dedo se levantó: el empujón en curso termina (el siguiente toque todavía puede ser el segundo). */
  soltar(ahora: number): void
  /** Olvida todo (pausa). */
  reiniciar(): void
}

interface Empujon {
  costado: -1 | 1
  /** Posición «hacia afuera» (costado · x): el pico y el valle de este empujón. */
  pico: number
  valle: number
  inicio: number
  suelto: boolean
  /** false si este empujón fue el segundo de una esquiva (no arranca otra). */
  cuenta: boolean
}

export function crearDetectorEmpujones(): DetectorEmpujones {
  let actual: Empujon | null = null
  let previo: { costado: -1 | 1; inicio: number; fin: number } | null = null

  const terminar = (ahora: number) => {
    if (!actual || actual.suelto) return
    actual.suelto = true
    previo = actual.cuenta ? { costado: actual.costado, inicio: actual.inicio, fin: ahora } : null
  }

  const empezar = (costado: -1 | 1, u: number, ahora: number): boolean => {
    const p = previo
    const doble =
      p !== null && p.costado === costado && ahora - p.fin <= VENTANA_DOBLE && p.fin - p.inicio <= EMPUJON_CORTO
    actual = { costado, pico: u, valle: u, inicio: ahora, suelto: false, cuenta: !doble }
    previo = null
    return doble
  }

  return {
    mover(x, costado, vertical, radio, ahora) {
      // Arriba o abajo de por medio (un salto en diagonal y vuelta a caminar) no es una esquiva.
      if (vertical) {
        actual = null
        previo = null
        return false
      }
      if (costado === 0) {
        terminar(ahora)
        actual = null
        return false
      }
      const u = costado * x
      if (!actual || actual.costado !== costado) {
        terminar(ahora)
        return empezar(costado, u, ahora)
      }
      const R = Math.max(1, radio)
      if (actual.suelto) {
        if (u - actual.valle >= REEMPUJAR * R) return empezar(costado, u, ahora)
        if (u < actual.valle) actual.valle = u
        return false
      }
      if (u > actual.pico) actual.pico = u
      else if (actual.pico - u >= RETRAER * R) {
        terminar(ahora)
        actual.valle = u
      }
      return false
    },
    soltar(ahora) {
      terminar(ahora)
      actual = null
    },
    reiniciar() {
      actual = null
      previo = null
    },
  }
}
