/**
 * Controles táctiles de la pelea: joystick flotante, botones en arco y cartas.
 *
 * Imperativo a propósito: React dibuja la estructura una vez y esto escucha pointer
 * events directo en el DOM, mueve la perilla con transform y escribe en la captura de
 * entrada. Ningún toque provoca un render de React.
 *
 * Multitouch real: cada dedo (pointerId) es independiente y queda capturado por su zona
 * (setPointerCapture), así que se puede caminar con el pulgar izquierdo mientras el
 * derecho sostiene GUARDIA y después toca GOLPE.
 *
 * Joystick: el centro es el punto exacto donde se apoya el pulgar (nada de corregirlo hacia
 * adentro: eso daba una dirección fantasma al apoyar cerca del borde) y la base lo sigue
 * cuando el dedo se aleja más de `CORREA` radios. Las direcciones salen por ángulo
 * (`leerStick`, stick.ts): arriba incluye las diagonales y mantenerla vuelve a saltar (lo
 * resuelve el motor). Esquiva: el botón ESQUIVA, dos empujones rápidos al mismo costado o
 * dos toques quietos en el joystick (hacia atrás).
 *
 * Elementos que busca dentro de `raiz`:
 *   [data-zona="joystick"]  con  [data-joy="base"] > [data-joy="perilla"]
 *   [data-zona="botones"]   con  [data-boton="golpe"|"herramienta"|"guardia"|"dash"]
 *   [data-carta="1"|"2"]
 */
import { publicarDepuracion } from './depuracion'
import type { CapturaEntrada, Control } from './entrada'
import { crearDetectorEmpujones, leerStick, STICK_SUELTO, type DireccionesStick } from './stick'
import { vibrar } from './vibrar'

export interface OpcionesControlesTactiles {
  entrada: CapturaEntrada
  /** false con pausa, tutorial o un aviso encima: los toques no llegan al motor. */
  activo: () => boolean
}

export interface ControlesTactiles {
  /** Suelta todo y deja la perilla en reposo (pausa). */
  reiniciar(): void
  destruir(): void
}

/** Dos toques quietos en el joystick más cerca que esto (ms): esquiva hacia atrás. */
const VENTANA_DOBLE_TOQUE = 280
/** Un toque «quieto» dura menos que esto (ms) y se mueve menos de 12 px. */
const TOQUE_CORTO = 220
/** La base sigue al dedo cuando se aleja más que esto (en radios): volver para el otro lado responde enseguida. */
const CORREA = 1.3

type Direccion = keyof DireccionesStick
const DIRECCIONES: readonly Direccion[] = ['izquierda', 'derecha', 'arriba', 'abajo']

export function conectarControlesTactiles(raiz: HTMLElement, op: OpcionesControlesTactiles): ControlesTactiles {
  const limpiezas: (() => void)[] = []
  const escuchar = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    tipo: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ) => {
    el.addEventListener(tipo, fn as EventListener, { passive: false })
    limpiezas.push(() => el.removeEventListener(tipo, fn as EventListener))
  }

  // Un toque largo en Android abre el menú contextual; en iOS, la lupa o el «callout».
  escuchar(raiz, 'contextmenu', (e) => e.preventDefault())

  // ─── Joystick flotante ─────────────────────────────────────────────────────
  const zonaJoy = raiz.querySelector<HTMLElement>('[data-zona="joystick"]')
  const base = raiz.querySelector<HTMLElement>('[data-joy="base"]')
  const perilla = raiz.querySelector<HTMLElement>('[data-joy="perilla"]')

  let joyId: number | null = null
  let rect = { left: 0, top: 0 }
  let R = 56
  /** Centro de la base y el último desplazamiento del dedo, en px relativos a la zona. */
  let bx = 0
  let by = 0
  let dx = 0
  let dy = 0
  let inicio = 0
  let xIni = 0
  let yIni = 0
  let seMovio = false
  let ultimoToqueQuieto = -Infinity
  let dirs: DireccionesStick = { ...STICK_SUELTO }
  const empujones = crearDetectorEmpujones()
  publicarDepuracion('joystick', () => ({ dirs: { ...dirs }, bx, by, dx, dy, R, activo: joyId !== null }))

  /**
   * Un tick de `dash` (latch). La dirección es la horizontal que esté sostenida en ese tick;
   * sin ninguna, el motor la hace hacia atrás (esquivar).
   */
  const esquivar = () => {
    op.entrada.presionar('dash', 'joy-dash')
    op.entrada.soltar('dash', 'joy-dash')
    vibrar(12)
  }

  /** Las flechas de la base se encienden con la dirección que está leyendo (se ve que tomó la diagonal). */
  const marcarFlechas = () => {
    if (!base) return
    const activas = DIRECCIONES.filter((c) => dirs[c]).join(' ')
    if (activas) base.dataset.dir = activas
    else delete base.dataset.dir
  }

  const fijarDirecciones = (nuevas: DireccionesStick) => {
    let cambio = false
    for (const c of DIRECCIONES) {
      if (nuevas[c] === dirs[c]) continue
      cambio = true
      if (nuevas[c]) op.entrada.presionar(c, 'joy')
      else op.entrada.soltar(c, 'joy')
    }
    dirs = nuevas
    if (cambio) marcarFlechas()
  }

  /** Un punto del dedo (relativo a la zona): correa, lectura por ángulo y doble empujón. */
  const moverDedo = (x: number, y: number, ahora: number) => {
    dx = x - bx
    dy = y - by
    const d = Math.hypot(dx, dy)
    const limite = R * CORREA
    if (d > limite) {
      // La base sigue al dedo: volver para el otro lado responde al toque.
      const k = (d - limite) / d
      bx += dx * k
      by += dy * k
      dx = x - bx
      dy = y - by
    }
    if (!seMovio && Math.hypot(x - xIni, y - yIni) > 12) seMovio = true
    const nuevas = leerStick(dx, dy, R, dirs)
    fijarDirecciones(nuevas)
    const costado = nuevas.derecha ? 1 : nuevas.izquierda ? -1 : 0
    if (empujones.mover(x, costado, nuevas.arriba || nuevas.abajo, R, ahora)) esquivar()
  }

  const pintar = () => {
    if (!base || !perilla) return
    const d = Math.hypot(dx, dy)
    const k = d > R ? R / d : 1
    base.style.transform = `translate3d(${(bx - R).toFixed(1)}px, ${(by - R).toFixed(1)}px, 0)`
    perilla.style.transform = `translate3d(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px, 0)`
  }

  const reposar = () => {
    if (zonaJoy) delete zonaJoy.dataset.activo
    if (base) {
      base.style.transform = ''
      delete base.dataset.dir
    }
    if (perilla) perilla.style.transform = ''
  }

  const soltarJoystick = (ahora: number) => {
    fijarDirecciones({ ...STICK_SUELTO })
    empujones.soltar(ahora)
    joyId = null
    dx = 0
    dy = 0
    reposar()
  }

  if (zonaJoy) {
    escuchar(zonaJoy, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (joyId !== null || !op.activo()) return
      e.preventDefault()
      try {
        zonaJoy.setPointerCapture(e.pointerId)
      } catch {
        // Puntero que ya no existe: sigue igual sin captura.
      }
      const ahora = performance.now()
      joyId = e.pointerId
      const r = zonaJoy.getBoundingClientRect()
      rect = { left: r.left, top: r.top }
      R = (base?.offsetWidth || 112) / 2
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // La base aparece justo donde apoyás el pulgar: así arranca sin ninguna dirección.
      bx = x
      by = y
      dx = 0
      dy = 0
      inicio = ahora
      xIni = x
      yIni = y
      seMovio = false
      zonaJoy.dataset.activo = '1'
      // Doble toque quieto = esquiva hacia atrás. Se dispara al apoyar, sin esperar.
      if (ahora - ultimoToqueQuieto < VENTANA_DOBLE_TOQUE) {
        ultimoToqueQuieto = -Infinity
        esquivar()
      }
      pintar()
    })

    escuchar(zonaJoy, 'pointermove', (e) => {
      if (e.pointerId !== joyId) return
      e.preventDefault()
      const ahora = performance.now()
      // Los movimientos agrupados del cuadro, en orden: un empujón rápido no se pierde.
      const agrupados = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      if (agrupados.length > 1) {
        for (const pe of agrupados) moverDedo(pe.clientX - rect.left, pe.clientY - rect.top, ahora)
      } else {
        moverDedo(e.clientX - rect.left, e.clientY - rect.top, ahora)
      }
      pintar()
    })

    const alLevantar = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return
      const ahora = performance.now()
      const quieto = !seMovio && ahora - inicio < TOQUE_CORTO
      soltarJoystick(ahora)
      ultimoToqueQuieto = quieto ? ahora : -Infinity
    }
    escuchar(zonaJoy, 'pointerup', alLevantar)
    escuchar(zonaJoy, 'pointercancel', alLevantar)
    escuchar(zonaJoy, 'lostpointercapture', alLevantar)
  }

  // ─── Botones en arco (una zona grande, gana el botón más cercano) ─────────
  const zonaBotones = raiz.querySelector<HTMLElement>('[data-zona="botones"]')
  const botones = Array.from(raiz.querySelectorAll<HTMLElement>('[data-boton]'))
  const dedos = new Map<number, HTMLElement>()

  const controlDe = (b: HTMLElement): Control => b.dataset.boton as Control

  /** El botón más cercano al dedo, si está dentro de su radio × margen. */
  const botonEn = (x: number, y: number, margen: number): HTMLElement | null => {
    let mejor: HTMLElement | null = null
    let mejorD = Infinity
    for (const b of botones) {
      const r = b.getBoundingClientRect()
      const radio = r.width / 2
      const d = Math.hypot(x - (r.left + radio), y - (r.top + r.height / 2))
      if (d < radio * margen && d < mejorD) {
        mejor = b
        mejorD = d
      }
    }
    return mejor
  }

  const apretarBoton = (b: HTMLElement, id: number) => {
    op.entrada.presionar(controlDe(b), `dedo:${id}`)
    b.dataset.activo = '1'
    vibrar(controlDe(b) === 'dash' ? 12 : 8)
  }
  const soltarBoton = (b: HTMLElement, id: number) => {
    op.entrada.soltar(controlDe(b), `dedo:${id}`)
    let otro = false
    dedos.forEach((v, k) => {
      if (v === b && k !== id) otro = true
    })
    if (!otro) delete b.dataset.activo
  }

  if (zonaBotones) {
    escuchar(zonaBotones, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (!op.activo()) return
      const b = botonEn(e.clientX, e.clientY, 1.55)
      if (!b) return
      e.preventDefault()
      try {
        zonaBotones.setPointerCapture(e.pointerId)
      } catch {
        // Sin captura igual funciona mientras el dedo no salga de la zona.
      }
      dedos.set(e.pointerId, b)
      apretarBoton(b, e.pointerId)
    })
    escuchar(zonaBotones, 'pointermove', (e) => {
      const actual = dedos.get(e.pointerId)
      if (!actual) return
      e.preventDefault()
      // Deslizar el pulgar de un botón a otro cambia de botón sin levantarlo.
      const b = botonEn(e.clientX, e.clientY, 0.95)
      if (b && b !== actual) {
        soltarBoton(actual, e.pointerId)
        dedos.set(e.pointerId, b)
        apretarBoton(b, e.pointerId)
      }
    })
    const alLevantar = (e: PointerEvent) => {
      const b = dedos.get(e.pointerId)
      if (!b) return
      soltarBoton(b, e.pointerId)
      dedos.delete(e.pointerId)
    }
    escuchar(zonaBotones, 'pointerup', alLevantar)
    escuchar(zonaBotones, 'pointercancel', alLevantar)
    escuchar(zonaBotones, 'lostpointercapture', alLevantar)
  }

  // ─── Cartas de especiales ──────────────────────────────────────────────────
  const cartas = Array.from(raiz.querySelectorAll<HTMLElement>('[data-carta]'))
  const dedosCarta = new Map<number, HTMLElement>()
  for (const carta of cartas) {
    const control: Control = carta.dataset.carta === '2' ? 'especial2' : 'especial1'
    escuchar(carta, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (!op.activo()) return
      e.preventDefault()
      try {
        carta.setPointerCapture(e.pointerId)
      } catch {
        // idem
      }
      dedosCarta.set(e.pointerId, carta)
      op.entrada.presionar(control, `carta:${e.pointerId}`)
      carta.dataset.activo = '1'
    })
    const alLevantar = (e: PointerEvent) => {
      if (dedosCarta.get(e.pointerId) !== carta) return
      dedosCarta.delete(e.pointerId)
      op.entrada.soltar(control, `carta:${e.pointerId}`)
      delete carta.dataset.activo
    }
    escuchar(carta, 'pointerup', alLevantar)
    escuchar(carta, 'pointercancel', alLevantar)
    escuchar(carta, 'lostpointercapture', alLevantar)
    // Sin esto, un toque con el teclado/lector de pantalla no haría nada.
    escuchar(carta, 'click', (e) => {
      if (e.detail !== 0 || !op.activo()) return
      op.entrada.presionar(control, 'carta:teclado')
      op.entrada.soltar(control, 'carta:teclado')
    })
  }

  return {
    reiniciar() {
      const ahora = performance.now()
      if (joyId !== null) soltarJoystick(ahora)
      empujones.reiniciar()
      ultimoToqueQuieto = -Infinity
      dedos.forEach((b, id) => soltarBoton(b, id))
      dedos.clear()
      dedosCarta.forEach((c) => delete c.dataset.activo)
      dedosCarta.clear()
      for (const b of botones) delete b.dataset.activo
      reposar()
    },
    destruir() {
      for (const f of limpiezas) f()
      limpiezas.length = 0
    },
  }
}
