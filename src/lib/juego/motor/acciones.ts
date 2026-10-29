/**
 * Movimientos en curso: empezar un golpe o un especial, hacerlos avanzar tick a tick (avances,
 * embestida, lanzamiento de proyectiles, eventos de swing) y el remate «AL CERO».
 */
import type { ClaveAnimacion, Herramienta, Lado, Partida } from '../tipos'
import { PERSONAJES } from '../personajes'
import { SUPER_FLASH } from './constantes'
import { finVentanas, mirarA } from './cuerpo'
import type { Accion, EstadoInterno } from './interno'
import { emitir } from './interno'
import type { DefEspecial, DefMovimiento } from './movimientos'
import { crearRayo, lanzarProyectil } from './proyectiles'

const SIN_CANCEL = 1e9
/** Tick del remate en el que el perdedor sale volando. */
export const REMATE_IMPACTO = 12

export function iniciarMovimiento(
  p: Partida,
  I: EstadoInterno,
  lado: Lado,
  mov: DefMovimiento,
  especial: 0 | 1 | 2,
  remate = false,
): Accion {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const esp = mov as DefEspecial
  const ventanasAnim =
    mov.ventanas.length > 0
      ? mov.ventanas.map((v) => ({ desde: v.desde, ticks: v.ticks }))
      : esp.lanzamiento
        ? [{ desde: esp.lanzamiento.desde, ticks: esp.lanzamiento.ticks }]
        : []
  const a: Accion = {
    mov,
    especial,
    t: 0,
    total: mov.total,
    resueltas: mov.ventanas.map(() => false),
    contacto: false,
    acerto: false,
    cancelDesde: especial || remate ? SIN_CANCEL : finVentanas(mov),
    ventanasAnim,
    cuadrosImpacto: null,
    detenido: false,
    lanzado: false,
    contoAcierto: false,
    remate,
    avanceRemate: 0,
    sello: ++I.sello,
  }
  li.accion = a
  l.movimiento = mov.id
  li.dash = null
  li.guardia = false
  li.agachado = false
  li.corriendo = false
  li.tAdelante = 0
  li.atras = false
  if (l.enSuelo) li.vMov = 0
  return a
}

/**
 * Si hay un especial en el buffer: con carga, lo tira (super flash: el mundo se congela
 * SUPER_FLASH ticks); sin carga, avisa `sin_carga` y no pasa nada más.
 */
export function intentarEspecial(p: Partida, I: EstadoInterno, lado: Lado): boolean {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  for (const n of [1, 2] as const) {
    const clave = n === 1 ? 'especial1' : 'especial2'
    if (li.buf[clave] <= 0) continue
    li.buf[clave] = 0
    const ficha = PERSONAJES[l.id].especiales[n - 1]
    if (l.carga + 1e-9 < ficha.costo) {
      emitir(p, { tipo: 'sin_carga', quien: lado })
      continue
    }
    l.carga = Math.max(0, l.carga - ficha.costo)
    iniciarMovimiento(p, I, lado, I.kits[lado].especiales[n - 1], n)
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, SUPER_FLASH)
    p.estadisticas[lado].especialesUsados++
    emitir(p, { tipo: 'especial', quien: lado, numero: n, nombre: ficha.nombre })
    return true
  }
  return false
}

/** Lo que hace el movimiento en este tick (antes de buscar contactos). */
export function avanzarAccion(p: Partida, I: EstadoInterno, lado: Lado, enPelea: boolean): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const a = li.accion
  if (!a) return
  const mov = a.mov
  const esp = mov as DefEspecial

  if (!a.remate && enPelea) {
    for (const v of mov.ventanas) {
      if (!esp.embestida && a.t === Math.max(0, v.desde - 2)) {
        emitir(p, { tipo: 'swing', quien: lado, fuerza: v.fuerza, herramienta: mov.herramienta })
      }
      if (a.t === v.desde) p.estadisticas[lado].golpesIntentados++
    }
  }

  if (esp.embestida) {
    const e = esp.embestida
    const corre = !a.detenido && a.t >= e.desde && a.t < e.desde + e.ticks
    if (corre && l.enSuelo) {
      li.vMov = l.mira * (e.distancia / e.ticks)
      li.invulnProyectil = true
      if (a.t === e.desde) {
        emitir(p, { tipo: 'swing', quien: lado, fuerza: 'especial', herramienta: mov.herramienta })
        if (enPelea) crearRayo(p, I, lado, a.sello, a.especial === 2 ? 2 : 1)
      }
    } else {
      li.vMov = 0
      li.invulnProyectil = false
    }
  } else if (l.enSuelo) {
    if (a.remate) li.vMov = a.t < REMATE_IMPACTO ? a.avanceRemate : 0
    else if (mov.avance && a.t >= mov.avance.desde && a.t < mov.avance.hasta) li.vMov = l.mira * mov.avance.vel
    else li.vMov = 0
  }

  if (esp.proyectil && esp.lanzamiento && !a.lanzado && a.t >= esp.lanzamiento.desde) {
    a.lanzado = true
    if (enPelea) lanzarProyectil(p, I, lado, esp)
  }
}

/** Fin del tick: avanza el reloj del movimiento y lo termina si corresponde. */
export function cerrarTickAccion(p: Partida, I: EstadoInterno, lado: Lado): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const a = li.accion
  if (!a) return
  a.t++
  if (a.mov.aereo && !l.enSuelo) return
  if (a.t >= a.total || a.mov.aereo) {
    li.accion = null
    l.movimiento = null
    li.vMov = 0
    li.invulnProyectil = false
  }
}

export type BotonRemate = 'golpe' | 'herramienta' | 'especial1' | 'especial2'

/** El remate de la fase final: anima el golpe elegido y se acerca si quedó lejos. */
export function iniciarRemate(p: Partida, I: EstadoInterno, lado: Lado, boton: BotonRemate, haciaX: number): Accion {
  const kit = I.kits[lado]
  let anim: ClaveAnimacion = 'combo'
  let herramienta: Herramienta = 'patada'
  if (boton === 'herramienta') {
    anim = 'herramienta1'
    herramienta = kit.movimientos[kit.inicio.herramienta]?.herramienta ?? 'maquina'
  } else if (boton === 'especial1' || boton === 'especial2') {
    const n = boton === 'especial1' ? 0 : 1
    anim = kit.especiales[n].anim
    herramienta = kit.especiales[n].herramienta
  }
  const mov: DefEspecial = {
    id: 'remate',
    numero: 1,
    anim,
    herramienta,
    ventanas: [],
    total: 36,
    lanzamiento: { desde: REMATE_IMPACTO, ticks: 4 },
  }
  const l = p.luchadores[lado]
  mirarA(l, haciaX)
  const a = iniciarMovimiento(p, I, lado, mov, 0, true)
  const dist = Math.abs(haciaX - l.x)
  a.avanceRemate = dist > 120 ? (l.mira * (dist - 95)) / REMATE_IMPACTO : 0
  emitir(p, { tipo: 'swing', quien: lado, fuerza: 'especial', herramienta })
  return a
}
