/**
 * Movimientos en curso: empezar un golpe o un especial, hacerlos avanzar tick a tick (avances,
 * embestidas por el piso y por el aire, ráfagas de proyectiles, curación, agarre, eventos de
 * swing) y el remate «AL CERO».
 */
import type { ClaveAnimacion, Herramienta, Lado, Partida } from '../tipos'
import { PERSONAJES } from '../personajes'
import { contarAcierto, progresarAgarre } from './combate'
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
  const ventanasAnim = mov.animLineal
    ? []
    : mov.ventanas.length > 0
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
    contactos: mov.ventanas.map(() => 0),
    esperaVentana: mov.ventanas.map(() => 0),
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
    lanzados: 0,
    enAire: false,
    agarre: null,
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

  for (let i = 0; i < a.esperaVentana.length; i++) if (a.esperaVentana[i] > 0) a.esperaVentana[i]--
  if (!a.remate && enPelea) {
    for (const v of mov.ventanas) {
      if (!esp.embestida && a.t === Math.max(0, v.desde - 2)) {
        emitir(p, { tipo: 'swing', quien: lado, fuerza: v.fuerza, herramienta: mov.herramienta })
      }
      // Un intento por cada golpe que la ventana puede dar (el molino, la Patada del Dragón): los
      // aciertos se cuentan por contacto, y contando uno por ventana la «Precisión» pasaba de 100 %.
      if (a.t === v.desde) p.estadisticas[lado].golpesIntentados += v.golpes ?? 1
    }
  }

  if (esp.embestida) {
    const e = esp.embestida
    // La embestida aérea salta en `desde` (con su gravedad, ver luchador.fisica).
    if (e.salto && a.t === e.desde && l.enSuelo && !a.enAire && !a.detenido) {
      l.enSuelo = false
      l.y = 0
      l.vy = e.salto.vy
      li.tAire = 0
      li.tSuelo = 0
      a.enAire = true
    }
    const corre = !a.detenido && a.t >= e.desde && a.t < e.desde + e.ticks
    if (corre && (l.enSuelo || a.enAire)) {
      li.vMov = l.mira * (e.distancia / e.ticks)
      li.invulnProyectil = e.atraviesa ?? true
      if (a.t === e.desde) {
        emitir(p, { tipo: 'swing', quien: lado, fuerza: 'especial', herramienta: mov.herramienta })
        if (enPelea && mov.herramienta === 'rayo') crearRayo(p, I, lado, a.sello, a.especial === 2 ? 2 : 1)
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

  // Proyectiles: uno, o una ráfaga (uno cada `cada` ticks).
  if (esp.proyectil && esp.lanzamiento) {
    const cantidad = esp.rafaga ? esp.rafaga.cantidad : 1
    const cada = esp.rafaga ? esp.rafaga.cada : 0
    while (a.lanzados < cantidad && a.t >= esp.lanzamiento.desde + a.lanzados * cada) {
      const i = a.lanzados++
      a.lanzado = true
      if (enPelea) lanzarProyectil(p, I, lado, esp, i, a.sello)
    }
  }

  // Curación: de a pedacitos (se corta sola si le pegan: interrumpir() saca la acción). Fuera de
  // la pelea (¡TIEMPO!, KO, la fase final) no cura y el «curándose» se apaga: antes quedaba
  // prendido en el HUD hasta el round siguiente.
  if (esp.cura && !enPelea) l.efectos.curando = 0
  else if (esp.cura) {
    const c = esp.cura
    const k = a.t - c.desde
    if (k >= 0 && k < c.ticks) {
      l.efectos.curando = c.ticks - k
      if (k % c.cada === 0) {
        const n = Math.max(1, Math.ceil(c.ticks / c.cada))
        const i = k / c.cada
        const total = Math.round(l.vidaMax * c.fraccion)
        const pedazo = Math.round((total * (i + 1)) / n) - Math.round((total * i) / n)
        const real = Math.min(pedazo, l.vidaMax - l.vida)
        if (real > 0) {
          l.vida += real
          p.estadisticas[lado].curado += real
          emitir(p, { tipo: 'curacion', quien: lado, cantidad: real })
        }
        if (i === n - 1) contarAcierto(p, I, lado, a.sello)
      }
    } else if (k >= c.ticks) l.efectos.curando = 0
  }

  // Agarre en curso: lo sostiene, lo aprieta y lo tira (fuera de la pelea lo suelta sin daño).
  if (a.agarre && esp.agarre) progresarAgarre(p, I, lado, a, esp.agarre, enPelea)
}

/** Fin del tick: avanza el reloj del movimiento y lo termina si corresponde. */
export function cerrarTickAccion(p: Partida, I: EstadoInterno, lado: Lado): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const a = li.accion
  if (!a) return
  a.t++
  if ((a.mov.aereo || a.enAire) && !l.enSuelo) return
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
