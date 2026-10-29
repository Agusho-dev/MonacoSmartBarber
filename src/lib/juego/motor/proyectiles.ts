/**
 * Proyectiles: el tornado de tijeras (multigolpe que arrastra), el sillón (parábola que gira y
 * después se arrastra por el piso), la nube de spray (cono corto que crece) y el rayo del
 * Corte Relámpago (sólo visual: acompaña a Simón mientras corre, nunca pega).
 *
 * (x, y) de un proyectil es su CENTRO en el mundo (y = altura del centro sobre el piso).
 */
import type { Herramienta, Lado, Partida, ProyectilEstado, TipoProyectil } from '../tipos'
import { HITSTUN, X_MAX, X_MIN } from './constantes'
import { aplicarImpacto, efectoDe } from './combate'
import { cajaCuerpo, golpeable, interseccion, limitar } from './cuerpo'
import type { EstadoInterno, ProyectilInterno } from './interno'
import { emitir } from './interno'
import type { Caja, DefEspecial, DefProyectil } from './movimientos'

const DOS_PI = Math.PI * 2

const HERRAMIENTA: Record<TipoProyectil, Herramienta> = {
  tornado: 'tornado',
  sillon: 'sillon',
  spray: 'spray',
  rayo: 'rayo',
}

function agregar(p: Partida, I: EstadoInterno, pi: ProyectilInterno): void {
  I.proyectiles.push(pi)
  p.proyectiles.push(pi.pub)
}

function quitar(p: Partida, I: EstadoInterno, indice: number): void {
  const pi = I.proyectiles[indice]
  I.proyectiles.splice(indice, 1)
  const j = p.proyectiles.indexOf(pi.pub)
  if (j >= 0) p.proyectiles.splice(j, 1)
}

/** Sale el proyectil de un especial (en el tick de lanzamiento). */
export function lanzarProyectil(p: Partida, I: EstadoInterno, lado: Lado, esp: DefEspecial): void {
  const d = esp.proyectil
  if (!d) return
  const l = p.luchadores[lado]
  const pub: ProyectilEstado = {
    id: ++I.sigIdProyectil,
    tipo: d.tipo,
    duenio: lado,
    x: limitar(l.x + l.mira * d.salidaX, X_MIN - 40, X_MAX + 40),
    y: l.y + d.salidaY,
    vx: l.mira * d.vx,
    vy: d.vy,
    mira: l.mira,
    rot: 0,
    edad: 0,
    golpesRestantes: d.golpes,
  }
  agregar(p, I, {
    pub,
    def: d,
    especial: esp.numero,
    espera: 0,
    arrastrando: false,
    enSuelo: false,
    acerto: false,
    cosmetico: false,
    selloAccion: 0,
  })
  p.estadisticas[lado].golpesIntentados += d.golpes
  emitir(p, { tipo: 'proyectil', quien: lado, proyectil: d.tipo })
}

/** El rayo que acompaña a la embestida (Corte Relámpago). */
export function crearRayo(p: Partida, I: EstadoInterno, lado: Lado, selloAccion: number, numero: 1 | 2): void {
  const l = p.luchadores[lado]
  const pub: ProyectilEstado = {
    id: ++I.sigIdProyectil,
    tipo: 'rayo',
    duenio: lado,
    x: l.x + l.mira * 20,
    y: l.y + 105,
    vx: l.vx,
    vy: 0,
    mira: l.mira,
    rot: 0,
    edad: 0,
    golpesRestantes: 0,
  }
  agregar(p, I, {
    pub,
    def: null,
    especial: numero,
    espera: 0,
    arrastrando: false,
    enSuelo: false,
    acerto: false,
    cosmetico: true,
    selloAccion,
  })
  emitir(p, { tipo: 'proyectil', quien: lado, proyectil: 'rayo' })
}

/** Al terminar un round, los proyectiles que quedan siguen su vuelo pero ya no pegan. */
export function desactivarProyectiles(I: EstadoInterno): void {
  for (const pi of I.proyectiles) pi.pub.golpesRestantes = 0
}

function tamanio(pi: ProyectilInterno): { ancho: number; alto: number } {
  const d = pi.def
  if (!d) return { ancho: 60, alto: 60 }
  if (d.anchoFinal === undefined && d.altoFinal === undefined) return { ancho: d.ancho, alto: d.alto }
  const f = limitar(pi.pub.edad / Math.max(1, d.vida), 0, 1)
  return {
    ancho: d.ancho + ((d.anchoFinal ?? d.ancho) - d.ancho) * f,
    alto: d.alto + ((d.altoFinal ?? d.alto) - d.alto) * f,
  }
}

function caja(pi: ProyectilInterno): Caja {
  const t = tamanio(pi)
  const q = pi.pub
  return { x0: q.x - t.ancho / 2, x1: q.x + t.ancho / 2, y0: q.y - t.alto / 2, y1: q.y + t.alto / 2 }
}

/** Mueve los proyectiles y resuelve sus contactos. `pegan` = false fuera de la pelea. */
export function actualizarProyectiles(p: Partida, I: EstadoInterno, pegan: boolean): void {
  for (let i = I.proyectiles.length - 1; i >= 0; i--) {
    const pi = I.proyectiles[i]
    const q = pi.pub
    q.edad++

    if (pi.cosmetico || !pi.def) {
      const due = p.luchadores[q.duenio]
      const a = I.luchadores[q.duenio].accion
      const esp = a?.mov as DefEspecial | undefined
      const corre =
        !!a && a.sello === pi.selloAccion && !a.detenido && !!esp?.embestida && a.t < esp.embestida.desde + esp.embestida.ticks
      if (!corre || q.edad > 60) {
        quitar(p, I, i)
        continue
      }
      q.x = due.x + due.mira * 20
      q.y = due.y + 105
      q.vx = due.vx
      q.mira = due.mira
      q.rot = (q.rot + 0.9) % DOS_PI
      continue
    }

    const d: DefProyectil = pi.def
    const victimaLado = (1 - q.duenio) as Lado
    const v = p.luchadores[victimaLado]
    const vi = I.luchadores[victimaLado]

    // Movimiento. Mientras tiene a alguien aturdido, el tornado frena y lo chupa hacia su frente
    // (así entran los seis cortes); contra la pared se queda moliendo en el lugar.
    if (pi.arrastrando && d.arrastre !== undefined) {
      if (vi.stun > 0 || v.efectos.guardiaRota > 0) {
        q.vx = q.mira * d.arrastre
        const objetivo = q.x + q.vx + q.mira * 16
        const tope = Math.abs(q.vx) + 4
        v.x = limitar(v.x + limitar(objetivo - v.x, -tope, tope), X_MIN, X_MAX)
        const pared = q.mira > 0 ? v.x >= X_MAX - 0.5 : v.x <= X_MIN + 0.5
        if (pared && Math.abs(v.x - q.x) < 40) q.vx = 0
      } else {
        pi.arrastrando = false
        q.vx = q.mira * d.vx
      }
    }
    q.vy -= d.gravedad
    q.x += q.vx
    q.y += q.vy
    if (d.giro) q.rot = (q.rot + d.giro * q.mira + DOS_PI) % DOS_PI

    const medioAlto = tamanio(pi).alto / 2
    if (d.gravedad > 0 && q.y - medioAlto <= 0) {
      if (d.desliza) {
        q.y = medioAlto
        q.vy = 0
        if (!pi.enSuelo) {
          pi.enSuelo = true
          q.vx *= 0.55
        } else q.vx *= 0.9
        if (Math.abs(q.vx) < 0.8) {
          quitar(p, I, i)
          continue
        }
      } else {
        quitar(p, I, i)
        continue
      }
    }
    if (q.x < X_MIN - 140 || q.x > X_MAX + 140 || q.edad >= d.vida) {
      quitar(p, I, i)
      continue
    }

    // Contactos.
    if (!pegan || q.golpesRestantes <= 0) continue
    if (pi.espera > 0) {
      pi.espera--
      continue
    }
    if (!golpeable(v, vi, true)) continue
    const cuerpo = cajaCuerpo(v, vi)
    if (!cuerpo) continue
    const inter = interseccion(caja(pi), cuerpo)
    if (!inter) continue

    const ultimo = q.golpesRestantes === 1
    const multi = d.golpes > 1
    const efecto = efectoDe(p, q.duenio, pi.especial)
    const fuerza = ultimo ? (d.fuerzaUltimo ?? d.fuerza) : d.fuerza
    const dir: 1 | -1 = q.vx > 0 ? 1 : q.vx < 0 ? -1 : q.mira
    const resultado = aplicarImpacto(p, I, {
      atacante: q.duenio,
      victima: victimaLado,
      danio: d.danio,
      danioGuardia: d.danioGuardia,
      fuerza,
      herramienta: HERRAMIENTA[d.tipo],
      hitstun: ultimo ? (d.hitstunUltimo ?? d.hitstun) : d.hitstun || HITSTUN[fuerza],
      hitstop: d.hitstop,
      empuje: multi && !ultimo ? 0 : d.empuje,
      empujeBloqueo: multi && !ultimo ? 0 : d.empuje * 0.6,
      origenX: q.x - q.mira * 10,
      dir,
      x: (inter.x0 + inter.x1) / 2,
      y: (inter.y0 + inter.y1) / 2,
      probCritico: 0,
      especial: pi.especial,
      efecto: efecto === 'multigolpe' ? null : efecto,
      accion: null,
      ventana: -1,
      proyectil: pi,
      rebotePared: false,
    })
    q.golpesRestantes--
    pi.espera = d.intervalo
    if (d.arrastre !== undefined && resultado !== 'armadura') pi.arrastrando = true
    if (q.golpesRestantes <= 0) quitar(p, I, i)
  }
}
