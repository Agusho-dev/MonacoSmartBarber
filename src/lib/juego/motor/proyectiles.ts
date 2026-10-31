/**
 * Proyectiles: el tornado de tijeras (multigolpe que arrastra), el sillón (parábola que gira y
 * después se arrastra por el piso), la nube de spray (cono corto que crece), el rayo del
 * Corte Relámpago (sólo visual: acompaña a Simón mientras corre, nunca pega) y las piezas del
 * elenco nuevo (ver movimientos.ts): rastreros (bombo, sismo), ráfagas (balas, botellas, mates),
 * bumerán (gorro), chorros (leche, agua), onda (grito), área diferida (graffiti) y la nube del
 * pañal en el piso.
 *
 * (x, y) de un proyectil es su CENTRO en el mundo (y = altura del centro sobre el piso);
 * `ancho`/`alto` del estado público son su caja actual.
 */
import type { EfectoEspecial, Herramienta, Lado, Partida, ProyectilEstado, TipoProyectil } from '../tipos'
import { HITSTUN, X_MAX, X_MIN } from './constantes'
import { aplicarImpacto, contarAcierto, danioContinuo, efectoDe, efectoNormalizado, ponerEstado } from './combate'
import { cajaCuerpo, contraPared, golpeable, inmuneAlControl, interseccion, limitar } from './cuerpo'
import type { EstadoInterno, ProyectilInterno } from './interno'
import { emitir } from './interno'
import type { Caja, DefEspecial, DefNube, DefProyectil } from './movimientos'

const DOS_PI = Math.PI * 2

const HERRAMIENTA: Record<TipoProyectil, Herramienta> = {
  tornado: 'tornado',
  sillon: 'sillon',
  spray: 'spray',
  rayo: 'rayo',
  bombo: 'bombo',
  bala: 'bala',
  graffiti: 'graffiti',
  trago: 'trago',
  botella: 'botella',
  onda: 'onda',
  gorro: 'gorro',
  pelota: 'pelota',
  leche: 'leche',
  panal: 'panal',
  nube: 'nube',
  mate: 'mate',
  agua: 'agua',
  sismo: 'sismo',
  guante: 'guante',
}

/** Distancia (centro a centro) a la que el gorro vuelve a la mano y desaparece. */
const ATRAPA_BUMERAN = 40

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

function interno(pub: ProyectilEstado, def: DefProyectil | null, especial: 1 | 2, selloAccion: number): ProyectilInterno {
  return {
    pub,
    def,
    especial,
    espera: 0,
    arrastrando: false,
    enSuelo: false,
    acerto: false,
    cosmetico: false,
    selloAccion,
    efectoTiro: undefined,
    empujeTiro: undefined,
    pegoIda: false,
    pegoVuelta: false,
    estallo: false,
    nube: null,
  }
}

/** Sale el proyectil de un especial (el tiro `indice` de la ráfaga, si es una). */
export function lanzarProyectil(p: Partida, I: EstadoInterno, lado: Lado, esp: DefEspecial, indice = 0, selloAccion = 0): void {
  const base = esp.proyectil
  if (!base) return
  const tiro = esp.rafaga?.tiros?.[indice]
  const d: DefProyectil = tiro
    ? {
        ...base,
        vx: tiro.vx ?? base.vx,
        vy: tiro.vy ?? base.vy,
        salidaX: tiro.salidaX ?? base.salidaX,
        salidaY: tiro.salidaY ?? base.salidaY,
      }
    : base
  const l = p.luchadores[lado]
  let x = l.x + l.mira * d.salidaX
  let y = l.y + d.salidaY
  let vx = l.mira * d.vx
  let vy = d.vy
  if (d.diferido) {
    x = l.x + l.mira * d.diferido.distancia
    y = d.alto / 2
    vx = 0
    vy = 0
  } else if (d.rastrero) {
    y = d.alto / 2
    vy = 0
  }
  if (d.chorro) {
    x = l.x + l.mira * (d.salidaX + d.ancho / 2)
    vx = 0
    vy = 0
  }
  const pub: ProyectilEstado = {
    id: ++I.sigIdProyectil,
    tipo: d.tipo,
    duenio: lado,
    x: limitar(x, X_MIN - 40, X_MAX + 40),
    y,
    vx,
    vy,
    mira: l.mira,
    rot: 0,
    edad: 0,
    golpesRestantes: d.golpes,
    vuelta: false,
    ancho: d.ancho,
    alto: d.alto,
  }
  const pi = interno(pub, d, esp.numero, selloAccion)
  pi.efectoTiro = tiro?.efecto
  pi.empujeTiro = tiro?.empuje
  agregar(p, I, pi)
  p.estadisticas[lado].golpesIntentados += d.golpes
  emitir(p, { tipo: 'proyectil', quien: lado, proyectil: d.tipo })
  if (d.tipo === 'bala') emitir(p, { tipo: 'disparo', quien: lado, x: pub.x, y: pub.y })
  if (d.tipo === 'sismo') emitir(p, { tipo: 'sismo', quien: lado, x: pub.x })
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
    vuelta: false,
    ancho: 60,
    alto: 60,
  }
  const pi = interno(pub, null, numero, selloAccion)
  pi.cosmetico = true
  agregar(p, I, pi)
  emitir(p, { tipo: 'proyectil', quien: lado, proyectil: 'rayo' })
}

/**
 * Dónde quedó el pañal después de crearNube. crearNube saca la nube vieja del mismo dueño y, si
 * estaba antes en la lista, todo se corre un lugar: con el índice viejo se borraba OTRO proyectil
 * (cualquiera, de los dos lados, o la nube recién creada) y el pañal se procesaba dos veces
 * (revisión del 30/oct, segunda tanda). crearNube sólo saca nubes, así que el pañal sigue en la
 * lista; como el recorrido va de atrás para adelante, con su índice nuevo se procesa bien lo que
 * queda debajo.
 */
function indiceDespuesDeNube(I: EstadoInterno, pi: ProyectilInterno): number {
  return I.proyectiles.indexOf(pi)
}

/** La nube del pañal: una sola por dueño (la nueva reemplaza a la vieja). */
function crearNube(p: Partida, I: EstadoInterno, lado: Lado, x: number, def: DefNube, especial: 1 | 2, selloAccion: number): void {
  for (let i = I.proyectiles.length - 1; i >= 0; i--) {
    const otra = I.proyectiles[i]
    if (otra.nube && otra.pub.duenio === lado) quitar(p, I, i)
  }
  const pub: ProyectilEstado = {
    id: ++I.sigIdProyectil,
    tipo: 'nube',
    duenio: lado,
    x: limitar(x, X_MIN, X_MAX),
    y: def.alto / 2,
    vx: 0,
    vy: 0,
    mira: p.luchadores[lado].mira,
    rot: 0,
    edad: 0,
    golpesRestantes: 1,
    vuelta: false,
    ancho: def.ancho,
    alto: def.alto,
  }
  const pi = interno(pub, null, especial, selloAccion)
  pi.nube = def
  agregar(p, I, pi)
  emitir(p, { tipo: 'nube', quien: lado, x: pub.x })
}

/** Al terminar un round, los proyectiles que quedan siguen su vuelo pero ya no pegan. */
export function desactivarProyectiles(I: EstadoInterno): void {
  for (const pi of I.proyectiles) pi.pub.golpesRestantes = 0
}

/** Tamaño actual: crece con la edad (spray, chorros) o salta al estallar (graffiti). */
function medir(pi: ProyectilInterno): void {
  const d = pi.def
  const q = pi.pub
  if (!d) return
  if (d.diferido) {
    q.ancho = pi.estallo ? d.diferido.ancho : d.ancho
    q.alto = pi.estallo ? d.diferido.alto : d.alto
    return
  }
  if (d.anchoFinal === undefined && d.altoFinal === undefined) {
    q.ancho = d.ancho
    q.alto = d.alto
    return
  }
  const dur = d.chorro ? d.chorro.crece : d.vida
  const f = limitar(q.edad / Math.max(1, dur), 0, 1)
  q.ancho = d.ancho + ((d.anchoFinal ?? d.ancho) - d.ancho) * f
  q.alto = d.alto + ((d.altoFinal ?? d.alto) - d.alto) * f
}

function caja(q: ProyectilEstado): Caja {
  return { x0: q.x - q.ancho / 2, x1: q.x + q.ancho / 2, y0: q.y - q.alto / 2, y1: q.y + q.alto / 2 }
}

/** El efecto de un contacto: el del tiro, el del proyectil o el de la ficha. */
function efectoDelContacto(p: Partida, pi: ProyectilInterno, d: DefProyectil): EfectoEspecial | null {
  if (pi.efectoTiro !== undefined) return pi.efectoTiro
  if (d.efecto !== undefined) return d.efecto
  return efectoNormalizado(efectoDe(p, pi.pub.duenio, pi.especial))
}

/** La nube: daña de a poco y deja LENTO a quien la pisa (sin hitstun, sin bloqueo). */
function actualizarNube(p: Partida, I: EstadoInterno, pi: ProyectilInterno, pegan: boolean): boolean {
  const def = pi.nube as DefNube
  const q = pi.pub
  if (q.edad >= def.vida) return false
  if (!pegan || q.golpesRestantes <= 0 || q.edad % def.cada !== 0) return true
  const lado = (1 - q.duenio) as Lado
  const v = p.luchadores[lado]
  const vi = I.luchadores[lado]
  if (!golpeable(v, vi, true)) return true
  const cuerpo = cajaCuerpo(v, vi)
  if (!cuerpo || !interseccion(caja(q), cuerpo)) return true
  danioContinuo(p, I, q.duenio, lado, def.danio)
  ponerEstado(p, I, lado, 'lento', def.lento)
  if (!pi.acerto) {
    pi.acerto = true
    contarAcierto(p, I, q.duenio, pi.selloAccion)
  }
  return true
}

/** Mueve los proyectiles y resuelve sus contactos. `pegan` = false fuera de la pelea. */
export function actualizarProyectiles(p: Partida, I: EstadoInterno, pegan: boolean): void {
  for (let i = I.proyectiles.length - 1; i >= 0; i--) {
    const pi = I.proyectiles[i]
    const q = pi.pub
    q.edad++

    if (pi.nube) {
      if (!actualizarNube(p, I, pi, pegan)) quitar(p, I, i)
      continue
    }

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
    const due = p.luchadores[q.duenio]

    // ─── Movimiento ───
    if (d.chorro) {
      // Sigue la mano del dueño; si al dueño le pegaron (o terminó el especial), se corta.
      const a = I.luchadores[q.duenio].accion
      if (!a || a.sello !== pi.selloAccion || q.edad >= d.vida) {
        quitar(p, I, i)
        continue
      }
      medir(pi)
      q.mira = due.mira
      q.x = due.x + due.mira * (d.salidaX + q.ancho / 2)
      q.y = due.y + d.salidaY
    } else if (d.diferido) {
      if (!pi.estallo && q.edad >= d.diferido.espera) pi.estallo = true
      medir(pi)
      q.y = q.alto / 2
      if (q.edad >= d.diferido.espera + d.diferido.activo) {
        quitar(p, I, i)
        continue
      }
    } else if (d.bumeran) {
      q.vx -= q.mira * d.bumeran.freno
      q.x += q.vx
      q.vuelta = q.vx * q.mira < 0
      if (d.giro) q.rot = (q.rot + d.giro * q.mira + DOS_PI) % DOS_PI
      if (q.vuelta && Math.abs(q.x - due.x) < ATRAPA_BUMERAN) {
        quitar(p, I, i)
        continue
      }
    } else {
      // Mientras tiene a alguien aturdido, el tornado frena y lo chupa hacia su frente (así entran
      // los seis cortes); contra la pared se queda moliendo en el lugar.
      if (pi.arrastrando && d.arrastre !== undefined) {
        if ((vi.stun > 0 || v.efectos.guardiaRota > 0) && !inmuneAlControl(vi)) {
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
      if (!d.rastrero) q.vy -= d.gravedad
      q.x += q.vx
      q.y += q.vy
      if (d.giro) q.rot = (q.rot + d.giro * q.mira + DOS_PI) % DOS_PI
      medir(pi)
      if (d.rastrero) q.y = q.alto / 2
    }

    // La onda lleva delante al que tocó, hasta la pared; ahí le pega otra vez y lo aturde. Sólo en
    // la pelea (con `pegan` y golpes por dar): si Rodrigo caía mientras la onda llevaba al rival, la
    // onda lo seguía arrastrando y aturdiendo en la fase final y el ganador no podía rematar. Tampoco
    // arrastra al que ya está inmune al control (TOPE_ENCIERRO).
    if (d.onda && pi.arrastrando) {
      const enLaOnda =
        pegan && q.golpesRestantes > 0 && vi.stun > 0 && vi.agarradoPor === null && v.enSuelo && !vi.dash && !inmuneAlControl(vi)
      if (!enLaOnda) pi.arrastrando = false
      else {
        const frente = q.x + q.mira * (q.ancho / 2 + 26)
        v.x = limitar(q.mira > 0 ? Math.max(v.x, frente) : Math.min(v.x, frente), X_MIN, X_MAX)
        vi.vEmpuje = 0
        vi.stun = Math.max(vi.stun, 4)
        vi.stunTotal = Math.max(vi.stunTotal, vi.stun)
        if (contraPared(v, q.mira) && pegan && q.golpesRestantes > 0) {
          const bloqueado = vi.stunBloqueo
          aplicarImpacto(p, I, {
            atacante: q.duenio,
            victima: victimaLado,
            danio: d.onda.danioPared,
            danioGuardia: d.danioGuardia,
            fuerza: 'especial',
            herramienta: HERRAMIENTA[d.tipo],
            hitstun: d.hitstunUltimo ?? d.hitstun,
            hitstop: d.hitstop,
            empuje: 0,
            empujeBloqueo: 0,
            origenX: q.x - q.mira * 10,
            dir: q.mira,
            x: v.x - q.mira * 20,
            y: q.y,
            probCritico: 0,
            especial: pi.especial,
            efecto: bloqueado ? null : 'aturde',
            ticksEfecto: d.onda.ticksAturdePared,
            quema: null,
            imbloqueable: false,
            accion: null,
            ventana: -1,
            proyectil: pi,
            rebotePared: false,
          })
          quitar(p, I, i)
          continue
        }
      }
    }

    // Toca el piso: se desliza (sillón), deja la nube (pañal) o desaparece.
    const medioAlto = q.alto / 2
    if (!d.rastrero && !d.diferido && !d.chorro && d.gravedad > 0 && q.y - medioAlto <= 0) {
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
        if (d.nube && pegan && q.golpesRestantes > 0) {
          crearNube(p, I, q.duenio, q.x, d.nube, pi.especial, pi.selloAccion)
          i = indiceDespuesDeNube(I, pi)
        }
        quitar(p, I, i)
        continue
      }
    }
    if (q.x < X_MIN - 140 || q.x > X_MAX + 140 || (!d.diferido && !d.chorro && q.edad >= d.vida)) {
      quitar(p, I, i)
      continue
    }

    // ─── Contactos ───
    if (!pegan || q.golpesRestantes <= 0) continue
    if (pi.espera > 0) {
      pi.espera--
      continue
    }
    if (d.diferido && !pi.estallo) continue
    if (d.bumeran && (q.vuelta ? pi.pegoVuelta : pi.pegoIda)) continue
    if (!golpeable(v, vi, true)) continue
    if (d.rastrero && !v.enSuelo) continue
    // La onda se pasa con la esquiva (todo el dash, no sólo el arranque invulnerable).
    if (d.onda && (vi.dash || pi.arrastrando)) continue
    const cuerpo = cajaCuerpo(v, vi)
    if (!cuerpo) continue
    const inter = interseccion(caja(q), cuerpo)
    if (!inter) continue

    const ultimo = q.golpesRestantes === 1
    const multi = d.golpes > 1 && !d.bumeran && !d.onda
    const efecto = efectoDelContacto(p, pi, d)
    const fuerza = ultimo ? (d.fuerzaUltimo ?? d.fuerza) : d.fuerza
    const dir: 1 | -1 = d.chorro || d.diferido ? q.mira : q.vx > 0 ? 1 : q.vx < 0 ? -1 : q.mira
    const empujeBase = pi.empujeTiro ?? d.empuje
    const sinEmpuje = d.onda || (multi && !ultimo && !d.empujaCadaGolpe)
    const resultado = aplicarImpacto(p, I, {
      atacante: q.duenio,
      victima: victimaLado,
      danio: d.danio,
      danioGuardia: d.danioGuardia,
      fuerza,
      herramienta: HERRAMIENTA[d.tipo],
      hitstun: ultimo ? (d.hitstunUltimo ?? d.hitstun) : d.hitstun || HITSTUN[fuerza],
      hitstop: d.hitstop,
      empuje: sinEmpuje ? 0 : empujeBase,
      empujeBloqueo: sinEmpuje ? 0 : empujeBase * 0.6,
      origenX: d.diferido ? due.x : q.x - q.mira * 10,
      dir,
      x: (inter.x0 + inter.x1) / 2,
      y: (inter.y0 + inter.y1) / 2,
      probCritico: 0,
      especial: pi.especial,
      efecto,
      ticksEfecto: d.ticksEfecto ?? 0,
      quema: d.quema ?? null,
      imbloqueable: !!d.imbloqueable && v.enSuelo,
      accion: null,
      ventana: -1,
      proyectil: pi,
      rebotePared: false,
    })
    q.golpesRestantes--
    pi.espera = d.intervalo
    if (d.bumeran) {
      if (q.vuelta) pi.pegoVuelta = true
      else pi.pegoIda = true
    }
    if (d.arrastre !== undefined && resultado !== 'armadura') pi.arrastrando = true
    if (d.onda && resultado !== 'armadura' && q.golpesRestantes > 0) pi.arrastrando = true
    if (d.nube) {
      crearNube(p, I, q.duenio, v.x, d.nube, pi.especial, pi.selloAccion)
      i = indiceDespuesDeNube(I, pi)
      quitar(p, I, i)
      continue
    }
    // El bumerán vuelve igual; el estallido del graffiti y el chorro se siguen viendo hasta el final.
    if (q.golpesRestantes <= 0 && !d.bumeran && !d.diferido && !d.chorro) quitar(p, I, i)
  }
}
