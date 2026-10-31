/**
 * Controles que tapan a un luchador. En horizontal los controles flotan sobre el lienzo (el
 * joystick abajo a la izquierda, los botones abajo a la derecha, las cartas y la carga abajo en el
 * medio): un luchador contra una pared quedaba debajo de GOLPE o del joystick. Cada cuadro se mira
 * dónde quedó cada luchador (el render lo dice: `cajasLuchadores`) y el control que lo tapa pasa a
 * translúcido (`data-tapa`, juego.css); apretado, vuelve entero. Cuando el luchador se va, vuelve.
 *
 * Por qué translúcido y no corrido: los controles no se mueven nunca de donde el pulgar los busca.
 * En las fases en que no se usan (el K.O., el festejo, el final ya decidido) se apagan del todo
 * (`data-reposo`, hud.ts) y se ve el cuerpo tirado o la cabeza pelada del ¡AL CERO!.
 *
 * Barato a propósito: las cajas de los controles se miden sólo cuando cambia la disposición
 * (`medir`); por cuadro son dos rectángulos contra ocho, y sólo se escribe un atributo cuando cambia.
 */
import type { Caja, Disposicion } from './disposicion'

/** Un rectángulo en px CSS relativo a la raíz de la pelea. */
interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Fracción del área del control tapada por un luchador para volverse translúcido, y para volver. */
const ENTRA = 0.2
const SALE = 0.08

interface Control {
  el: HTMLElement
  rect: Rect | null
  /** El joystick: sólo cuenta en reposo (con el pulgar encima, la base sigue al pulgar). */
  joystick: boolean
  tapa: boolean
}

export interface Apartado {
  /** Con la disposición nueva (y la caja del lienzo, relativa a la raíz). */
  medir(d: Disposicion): void
  /** Cajas de los luchadores en px CSS desde la esquina del lienzo (null: no se sabe). */
  actualizar(cajas: readonly (Caja | null)[] | null): void
  /** Todo a la vista (al desmontar o pausar). */
  soltar(): void
}

function interseccion(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

function area(r: Rect): number {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)
}

export function crearApartado(raiz: HTMLElement): Apartado {
  const zonaJoy = raiz.querySelector<HTMLElement>('[data-zona="joystick"]')
  const controles: Control[] = []
  const sumar = (el: HTMLElement | null, joystick = false) => {
    if (el) controles.push({ el, rect: null, joystick, tapa: false })
  }
  for (const b of raiz.querySelectorAll<HTMLElement>('[data-boton]')) sumar(b)
  for (const c of raiz.querySelectorAll<HTMLElement>('[data-carta]')) sumar(c)
  sumar(raiz.querySelector<HTMLElement>('.cf-carga'))
  sumar(zonaJoy, true)
  let lienzo: Caja | null = null

  const poner = (c: Control, tapa: boolean) => {
    if (c.tapa === tapa) return
    c.tapa = tapa
    if (tapa) c.el.dataset.tapa = ''
    else delete c.el.dataset.tapa
  }

  return {
    medir(d) {
      lienzo = d.lienzo
      const base = raiz.getBoundingClientRect()
      for (const c of controles) {
        if (c.joystick) {
          // La base en reposo: un círculo dentro de su zona (disposicion.ts).
          const x = d.joystick.x + d.joy.x
          const y = d.joystick.y + d.joy.y
          c.rect = { x0: x - d.joy.r, y0: y - d.joy.r, x1: x + d.joy.r, y1: y + d.joy.r }
          continue
        }
        const r = c.el.getBoundingClientRect()
        c.rect =
          r.width > 0 && r.height > 0
            ? { x0: r.left - base.left, y0: r.top - base.top, x1: r.right - base.left, y1: r.bottom - base.top }
            : null
      }
    },
    actualizar(cajas) {
      if (!lienzo || !cajas) return
      const L = lienzo
      const cuerpos: Rect[] = []
      for (const k of cajas) {
        if (!k || !(k.w > 0) || !(k.h > 0)) continue
        cuerpos.push({ x0: L.x + k.x, y0: L.y + k.y, x1: L.x + k.x + k.w, y1: L.y + k.y + k.h })
      }
      for (const c of controles) {
        if (!c.rect || (c.joystick && zonaJoy?.dataset.activo)) {
          poner(c, false)
          continue
        }
        const a = area(c.rect)
        if (a <= 0) continue
        let tapado = 0
        for (const cu of cuerpos) tapado = Math.max(tapado, interseccion(c.rect, cu) / a)
        poner(c, c.tapa ? tapado >= SALE : tapado >= ENTRA)
      }
    },
    soltar() {
      for (const c of controles) poner(c, false)
    },
  }
}
