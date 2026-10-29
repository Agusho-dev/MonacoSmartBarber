/**
 * Geometría y condiciones de un luchador: cajas de daño y de empuje, si puede actuar, si se
 * le puede pegar, si bloquea. Funciones puras sobre el estado (no emiten eventos).
 */
import type { EntradaJugador, LuchadorEstado } from '../tipos'
import { PERSONAJES } from '../personajes'
import {
  CUERPO_AGACHADO,
  CUERPO_AIRE,
  CUERPO_ANCHO,
  EMPUJE_CAJA,
  X_MAX,
  X_MIN,
} from './constantes'
import type { Accion, InternoLuchador } from './interno'
import type { Caja, DefEspecial, DefMovimiento } from './movimientos'

export function limitar(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function dirDe(e: EntradaJugador): -1 | 0 | 1 {
  if (e.izquierda && !e.derecha) return -1
  if (e.derecha && !e.izquierda) return 1
  return 0
}

export function altoParado(l: LuchadorEstado): number {
  return PERSONAJES[l.id].alturaMundo - 10
}

/** Caja de daño en coordenadas del mundo, o null si no se le puede pegar (tirado, cayendo). */
export function cajaCuerpo(l: LuchadorEstado, li: InternoLuchador): Caja | null {
  if (li.derribo > 0 || li.levantar > 0 || li.caidaDerribo > 0 || li.pose === 'ko') return null
  if (!l.enSuelo) {
    const m = CUERPO_AIRE.ancho / 2
    return { x0: l.x - m, x1: l.x + m, y0: l.y, y1: l.y + CUERPO_AIRE.alto }
  }
  if (li.agachado) {
    const m = CUERPO_AGACHADO.ancho / 2
    return { x0: l.x - m, x1: l.x + m, y0: 0, y1: CUERPO_AGACHADO.alto }
  }
  const m = CUERPO_ANCHO / 2
  return { x0: l.x - m, x1: l.x + m, y0: 0, y1: altoParado(l) }
}

/** Franja vertical de la caja de empuje. */
export function franjaEmpuje(l: LuchadorEstado, li: InternoLuchador): { y0: number; y1: number } {
  if (l.enSuelo && (li.derribo > 0 || li.pose === 'ko')) return { y0: 0, y1: EMPUJE_CAJA.tirado }
  if (!l.enSuelo) return { y0: l.y + EMPUJE_CAJA.aireDesde, y1: l.y + EMPUJE_CAJA.aireHasta }
  if (li.agachado) return { y0: 0, y1: EMPUJE_CAJA.agachado }
  return { y0: 0, y1: EMPUJE_CAJA.parado }
}

/** Caja de golpe de una ventana, espejada según hacia dónde mira. */
export function cajaGolpe(l: LuchadorEstado, c: Caja): Caja {
  const x0 = l.mira === 1 ? l.x + c.x0 : l.x - c.x1
  const x1 = l.mira === 1 ? l.x + c.x1 : l.x - c.x0
  return { x0, x1, y0: l.y + c.y0, y1: l.y + c.y1 }
}

export function interseccion(a: Caja, b: Caja): Caja | null {
  const x0 = Math.max(a.x0, b.x0)
  const x1 = Math.min(a.x1, b.x1)
  const y0 = Math.max(a.y0, b.y0)
  const y1 = Math.min(a.y1, b.y1)
  if (x0 >= x1 || y0 >= y1) return null
  return { x0, x1, y0, y1 }
}

/** Libre en el piso: puede empezar cualquier cosa. */
export function puedeActuar(l: LuchadorEstado, li: InternoLuchador): boolean {
  return (
    l.enSuelo &&
    li.pose === null &&
    li.accion === null &&
    li.stun === 0 &&
    li.dash === null &&
    li.derribo === 0 &&
    li.levantar === 0 &&
    li.caidaDerribo === 0 &&
    li.aterrizaje === 0 &&
    l.efectos.congelado === 0 &&
    l.efectos.electrocutado === 0 &&
    l.efectos.guardiaRota === 0
  )
}

/** En el aire y sin nada encima: puede tirar la patada voladora. */
export function puedeActuarEnAire(l: LuchadorEstado, li: InternoLuchador): boolean {
  return (
    !l.enSuelo &&
    li.pose === null &&
    li.accion === null &&
    li.stun === 0 &&
    li.caidaDerribo === 0 &&
    l.efectos.congelado === 0 &&
    l.efectos.electrocutado === 0
  )
}

/** El rival lo tiene a merced: le está pegando o no puede moverse. */
export function enCombo(l: LuchadorEstado, li: InternoLuchador): boolean {
  return (
    (li.stun > 0 && !li.stunBloqueo) ||
    l.efectos.congelado > 0 ||
    l.efectos.electrocutado > 0 ||
    l.efectos.guardiaRota > 0 ||
    li.caidaDerribo > 0
  )
}

export function golpeable(l: LuchadorEstado, li: InternoLuchador, esProyectil: boolean): boolean {
  if (l.invulnerable || li.pose !== null) return false
  if (esProyectil && li.invulnProyectil) return false
  return true
}

/** ¿Bloquea un golpe que viene desde `origenX`? Guardia de frente, parado o agachado. */
export function bloquea(l: LuchadorEstado, li: InternoLuchador, origenX: number): boolean {
  if (!l.enSuelo || li.pose !== null) return false
  if (l.efectos.congelado > 0 || l.efectos.electrocutado > 0 || l.efectos.guardiaRota > 0) return false
  if (li.derribo > 0 || li.levantar > 0 || li.caidaDerribo > 0 || li.accion !== null || li.dash !== null) return false
  const enGuardia = li.stun > 0 ? li.stunBloqueo : li.guardia
  if (!enGuardia) return false
  const dx = origenX - l.x
  return Math.abs(dx) < 4 || dx * l.mira > 0
}

/** Deja al luchador sin movimiento en curso (lo golpearon, lo congelaron, terminó el round). */
export function interrumpir(l: LuchadorEstado, li: InternoLuchador): void {
  li.accion = null
  l.movimiento = null
  li.dash = null
  li.guardia = false
  li.agachado = false
  li.vMov = 0
  li.aterrizaje = 0
  li.corriendo = false
  li.tAdelante = 0
  li.atras = false
  li.invulnProyectil = false
}

export function contraPared(l: LuchadorEstado, dir: number): boolean {
  return dir > 0 ? l.x >= X_MAX - 1 : l.x <= X_MIN + 1
}

export function mirarA(l: LuchadorEstado, x: number): void {
  const dx = x - l.x
  if (dx > 0.5) l.mira = 1
  else if (dx < -0.5) l.mira = -1
}

/** Último tick de la última ventana activa (o de la pose de lanzamiento). */
export function finVentanas(mov: DefMovimiento): number {
  let fin = 0
  for (const v of mov.ventanas) fin = Math.max(fin, v.desde + v.ticks)
  const esp = mov as DefEspecial
  if (esp.lanzamiento) fin = Math.max(fin, esp.lanzamiento.desde + esp.lanzamiento.ticks)
  return fin
}

export function primeraVentana(mov: DefMovimiento): number {
  let ini = Number.MAX_SAFE_INTEGER
  for (const v of mov.ventanas) ini = Math.min(ini, v.desde)
  const esp = mov as DefEspecial
  if (esp.lanzamiento) ini = Math.min(ini, esp.lanzamiento.desde)
  return ini === Number.MAX_SAFE_INTEGER ? 0 : ini
}

/** Alcance de un movimiento medido de centro a centro (caja + medio cuerpo del rival). */
export function alcanceDe(mov: DefMovimiento): number {
  const esp = mov as DefEspecial
  let x = 0
  for (const v of mov.ventanas) x = Math.max(x, v.caja.x1)
  if (esp.embestida) x += esp.embestida.distancia
  if (esp.proyectil) x = Math.max(x, 700)
  return x + CUERPO_ANCHO / 2
}

export function enRecuperacion(a: Accion): boolean {
  return a.t >= finVentanas(a.mov)
}
