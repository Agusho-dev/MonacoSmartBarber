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
 * Elementos que busca dentro de `raiz`:
 *   [data-zona="joystick"]  con  [data-joy="base"] > [data-joy="perilla"]
 *   [data-zona="botones"]   con  [data-boton="golpe"|"herramienta"|"guardia"]
 *   [data-carta="1"|"2"]
 */
import type { CapturaEntrada, Control } from './entrada'
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

/** Dos toques más cerca que esto (ms) cuentan como doble toque. */
const VENTANA_DOBLE = 280
/** Un toque «quieto» dura menos que esto (ms) y se mueve menos de 12 px. */
const TOQUE_CORTO = 220
/** Para el dash por doble deslizamiento, el primer empujón tiene que ser corto (no una caminata). */
const EMPUJON_CORTO = 260

type Direccion = 'izquierda' | 'derecha' | 'arriba' | 'abajo'

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
  let rect = { left: 0, top: 0, width: 0, height: 0 }
  let R = 56
  let bx = 0
  let by = 0
  let inicio = 0
  let xIni = 0
  let yIni = 0
  let seMovio = false
  let ultimoToqueQuieto = -Infinity
  const dirs: Record<Direccion, boolean> = { izquierda: false, derecha: false, arriba: false, abajo: false }
  const apretadoEn = { izquierda: -Infinity, derecha: -Infinity }
  const soltadoEn = { izquierda: -Infinity, derecha: -Infinity }

  /**
   * Un tick de `dash` (latch). La dirección es la que esté sostenida en ese tick; sin
   * ninguna, el motor la hace hacia atrás (esquivar).
   */
  const dash = () => {
    op.entrada.presionar('dash', 'joy-dash')
    op.entrada.soltar('dash', 'joy-dash')
    vibrar(12)
  }

  const fijar = (c: Direccion, valor: boolean, ahora: number) => {
    if (dirs[c] === valor) return
    dirs[c] = valor
    if (valor) {
      op.entrada.presionar(c, 'joy')
      if (c === 'izquierda' || c === 'derecha') {
        // Doble deslizamiento al mismo lado (dos toques o un vaivén del pulgar) = dash.
        if (ahora - soltadoEn[c] < VENTANA_DOBLE) {
          soltadoEn[c] = -Infinity
          dash()
        }
        apretadoEn[c] = ahora
      }
    } else {
      op.entrada.soltar(c, 'joy')
      if (c === 'izquierda' || c === 'derecha') {
        soltadoEn[c] = ahora - apretadoEn[c] < EMPUJON_CORTO ? ahora : -Infinity
      }
    }
  }

  const aplicar = (dx: number, dy: number, ahora: number) => {
    const nx = dx / R
    const ny = dy / R
    let izq = false
    let der = false
    let arr = false
    let aba = false
    if (Math.hypot(nx, ny) > 0.2) {
      // Histéresis: entrar cuesta un poco más que salir, así no titila en el borde.
      const umbralH = dirs.izquierda || dirs.derecha ? 0.26 : 0.38
      izq = nx < -umbralH
      der = nx > umbralH
      // Arriba = saltar, con umbral generoso: también en diagonal (salto con dirección).
      arr = ny < (dirs.arriba ? -0.34 : -0.46)
      aba = ny > (dirs.abajo ? 0.42 : 0.56)
    }
    fijar('izquierda', izq, ahora)
    fijar('derecha', der, ahora)
    fijar('arriba', arr, ahora)
    fijar('abajo', aba, ahora)
  }

  const pintar = (dx: number, dy: number) => {
    if (!base || !perilla) return
    const d = Math.hypot(dx, dy)
    const k = d > R ? R / d : 1
    base.style.transform = `translate3d(${(bx - R).toFixed(1)}px, ${(by - R).toFixed(1)}px, 0)`
    perilla.style.transform = `translate3d(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px, 0)`
  }

  const reposar = () => {
    if (zonaJoy) delete zonaJoy.dataset.activo
    if (base) base.style.transform = ''
    if (perilla) perilla.style.transform = ''
  }

  const soltarJoystick = (ahora: number) => {
    fijar('izquierda', false, ahora)
    fijar('derecha', false, ahora)
    fijar('arriba', false, ahora)
    fijar('abajo', false, ahora)
    joyId = null
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
      rect = { left: r.left, top: r.top, width: r.width, height: r.height }
      R = (base?.offsetWidth || 112) / 2
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // La base aparece donde apoyás el pulgar (sin salirse de la zona).
      bx = Math.min(Math.max(x, R * 0.85), Math.max(R * 0.85, rect.width - R * 0.85))
      by = Math.min(Math.max(y, R * 0.85), Math.max(R * 0.85, rect.height - R * 0.85))
      inicio = ahora
      xIni = x
      yIni = y
      seMovio = false
      zonaJoy.dataset.activo = '1'
      // Doble toque quieto = dash hacia atrás (esquivar). Se dispara al apoyar, sin esperar.
      if (ahora - ultimoToqueQuieto < VENTANA_DOBLE) {
        ultimoToqueQuieto = -Infinity
        dash()
      }
      pintar(x - bx, y - by)
      aplicar(x - bx, y - by, ahora)
    })

    escuchar(zonaJoy, 'pointermove', (e) => {
      if (e.pointerId !== joyId) return
      e.preventDefault()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      let dx = x - bx
      let dy = y - by
      const d = Math.hypot(dx, dy)
      const limite = R * 1.3
      if (d > limite) {
        // La base sigue al dedo: volver para el otro lado responde al toque.
        const k = (d - limite) / d
        bx += dx * k
        by += dy * k
        dx = x - bx
        dy = y - by
      }
      if (!seMovio && Math.hypot(x - xIni, y - yIni) > 12) seMovio = true
      pintar(dx, dy)
      aplicar(dx, dy, performance.now())
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
    vibrar(8)
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
