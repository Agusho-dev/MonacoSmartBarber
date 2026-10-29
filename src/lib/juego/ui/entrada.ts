/**
 * Captura de los controles del jugador (lado 0). Teclado, joystick, botones y cartas
 * escriben acá; el loop lee UNA vez por tick con `tomar()`.
 *
 *  - Cada control puede estar sostenido por varias «fuentes» a la vez (la tecla J y un
 *    dedo en GOLPE): se suelta recién cuando no queda ninguna. Un pointercancel suelta
 *    sólo lo suyo y no corta lo que sostiene el teclado.
 *  - LATCH: un toque que empieza y termina entre dos ticks igual llega al motor como
 *    apretado durante un tick. Pasa seguido: un toque rápido dura 30–60 ms y, con la
 *    cámara lenta del K.O. o un cuadro largo, el loop puede hacer cero pasos en el medio.
 */
import type { EntradaJugador } from '../tipos'

export type Control = keyof EntradaJugador

export const CONTROLES: readonly Control[] = [
  'izquierda',
  'derecha',
  'arriba',
  'abajo',
  'golpe',
  'herramienta',
  'guardia',
  'especial1',
  'especial2',
  'dash',
]

export interface CapturaEntrada {
  presionar(control: Control, fuente: string): void
  soltar(control: Control, fuente: string): void
  /** Suelta todo lo que sostiene una fuente (un dedo que se cancela). */
  soltarFuente(fuente: string): void
  /** Pausa, blur, cambio de pestaña: nada queda trabado. */
  soltarTodo(): void
  /** El estado de ESTE tick (sostenido o tocado desde el tick anterior). Objeto nuevo cada vez. */
  tomar(): EntradaJugador
  /** El último especial que se apretó: para sacudir la carta correcta con `sin_carga`. */
  ultimoEspecial(): 1 | 2 | null
}

export function crearCapturaEntrada(): CapturaEntrada {
  const fuentes = {} as Record<Control, Set<string>>
  const tocado = {} as Record<Control, boolean>
  for (const c of CONTROLES) {
    fuentes[c] = new Set()
    tocado[c] = false
  }
  let ultimoEsp: 1 | 2 | null = null

  return {
    presionar(control, fuente) {
      const s = fuentes[control]
      if (s.has(fuente)) return
      s.add(fuente)
      tocado[control] = true
      if (control === 'especial1') ultimoEsp = 1
      else if (control === 'especial2') ultimoEsp = 2
    },
    soltar(control, fuente) {
      fuentes[control].delete(fuente)
    },
    soltarFuente(fuente) {
      for (const c of CONTROLES) fuentes[c].delete(fuente)
    },
    soltarTodo() {
      for (const c of CONTROLES) {
        fuentes[c].clear()
        tocado[c] = false
      }
    },
    tomar() {
      const e = {} as EntradaJugador
      for (const c of CONTROLES) {
        e[c] = fuentes[c].size > 0 || tocado[c]
        tocado[c] = false
      }
      return e
    },
    ultimoEspecial() {
      return ultimoEsp
    },
  }
}

// ─── Teclado (compu) ─────────────────────────────────────────────────────────

/** A/D o flechas, W/espacio saltar, S agacharse, J golpe, K herramienta, L guardia, U/I especiales, Shift dash. */
const TECLAS: Readonly<Record<string, Control>> = {
  KeyA: 'izquierda',
  ArrowLeft: 'izquierda',
  KeyD: 'derecha',
  ArrowRight: 'derecha',
  KeyW: 'arriba',
  ArrowUp: 'arriba',
  Space: 'arriba',
  KeyS: 'abajo',
  ArrowDown: 'abajo',
  KeyJ: 'golpe',
  KeyK: 'herramienta',
  KeyL: 'guardia',
  KeyU: 'especial1',
  KeyI: 'especial2',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
}

function esCampoDeTexto(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

export interface OpcionesTeclado {
  /** false con la pausa o un aviso encima: las teclas no llegan al motor. */
  activo: () => boolean
  /** Esc o P. */
  alPausa: () => void
}

export function conectarTeclado(entrada: CapturaEntrada, op: OpcionesTeclado): () => void {
  const alBajar = (e: KeyboardEvent) => {
    if (esCampoDeTexto(e.target)) return
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault()
      if (!e.repeat) op.alPausa()
      return
    }
    const control = TECLAS[e.code]
    if (!control || !op.activo()) return
    // Sin esto, el espacio y las flechas mueven la página o «tocan» el botón con foco.
    e.preventDefault()
    if (e.repeat) return
    entrada.presionar(control, `tecla:${e.code}`)
  }
  const alSubir = (e: KeyboardEvent) => {
    const control = TECLAS[e.code]
    if (control) entrada.soltar(control, `tecla:${e.code}`)
  }
  const alPerderFoco = () => entrada.soltarTodo()

  window.addEventListener('keydown', alBajar)
  window.addEventListener('keyup', alSubir)
  window.addEventListener('blur', alPerderFoco)
  return () => {
    window.removeEventListener('keydown', alBajar)
    window.removeEventListener('keyup', alSubir)
    window.removeEventListener('blur', alPerderFoco)
  }
}
