/**
 * Un luchador tick a tick: entrada (flancos, buffer, doble toque), decisiones (caminar, correr,
 * saltar, agacharse, guardia, dash, golpes, cadenas, especiales), física, empuje entre cuerpos,
 * relojes de los estados y el estado visible (`estado`, `invulnerable`).
 */
import type { EntradaJugador, EstadisticasLuchador, IdPersonaje, Lado, LuchadorEstado, Partida } from '../tipos'
import { ENTRADA_VACIA } from '../tipos'
import { PERSONAJES } from '../personajes'
import { iniciarMovimiento, intentarEspecial } from './acciones'
import { danioContinuo, sumarCarga } from './combate'
import {
  ATERRIZAJE_TICKS,
  CARGA,
  CORRER_DESDE,
  CORRER_DISTANCIA_MIN,
  DASH,
  DISTANCIA_CUERPOS,
  DOBLE_TOQUE,
  EFECTO,
  FRICCION_AIRE,
  FRICCION_SUELO,
  GRAVEDAD,
  GUARDIA,
  INMUNIDAD,
  TICKS_BUFFER,
  VEL_SALTO,
  X_INICIO,
  X_MAX,
  X_MIN,
} from './constantes'
import { dirDe, franjaEmpuje, invulnerablePorAccion, limitar, mirarA, puedeActuar, puedeActuarEnAire } from './cuerpo'
import type { BotonBuffer, EstadoControl, EstadoInterno, InternoLuchador } from './interno'
import { emitir } from './interno'
import type { DefEspecial, KitPersonaje } from './movimientos'

const ESTADOS_CONTROL: readonly EstadoControl[] = ['aturdido', 'mareado', 'quemado', 'congelado', 'electrocutado']

/** Velocidad de caminar con LENTO o MAREADO (no se suman: vale la peor). */
function multVelocidad(l: LuchadorEstado): number {
  let m = 1
  if (l.efectos.lento > 0) m = Math.min(m, EFECTO.multLento)
  if (l.efectos.mareado > 0) m = Math.min(m, EFECTO.multMareado)
  return m
}

/** Carga con la que arranca cada round (Happy hour suma). */
export function cargaDeInicio(kit: KitPersonaje): number {
  return CARGA.inicio + (kit.pasiva?.cargaInicial ?? 0)
}

const BOTONES_BUFFER: readonly BotonBuffer[] = ['golpe', 'herramienta', 'especial1', 'especial2', 'salto', 'dash']

/**
 * Arriba SOSTENIDO vuelve a saltar, como en los juegos de pelea, cuando el luchador lleva
 * esto en el piso (un respiro corto entre salto y salto). Es también lo que hace saltar a
 * quien llevó el stick a la diagonal mientras no se podía mover (aturdido, recién caído):
 * antes sólo contaba el instante en que se apretaba arriba y ese salto se perdía.
 * La CPU no lo usa: aprieta arriba dos ticks y su salto sale siempre del buffer.
 */
const RESPIRO_SALTO = 6

export function crearLuchador(id: IdPersonaje, lado: Lado): LuchadorEstado {
  const f = PERSONAJES[id]
  return {
    id,
    lado,
    x: X_INICIO[lado],
    y: 0,
    vx: 0,
    vy: 0,
    mira: lado === 0 ? 1 : -1,
    enSuelo: true,
    estado: 'quieto',
    anim: 'quieto',
    cuadro: 0,
    animTick: 0,
    movimiento: null,
    vida: f.vidaMax,
    vidaMax: f.vidaMax,
    guardia: GUARDIA.max,
    guardiaMax: GUARDIA.max,
    carga: CARGA.inicio,
    destello: 0,
    invulnerable: false,
    efectos: {
      congelado: 0,
      electrocutado: 0,
      guardiaRota: 0,
      critico: 0,
      aturdido: 0,
      mareado: 0,
      quemado: 0,
      lento: 0,
      curando: 0,
    },
    combo: 0,
  }
}

export function crearEstadisticas(): EstadisticasLuchador {
  return {
    danioHecho: 0,
    danioRecibido: 0,
    golpesAcertados: 0,
    golpesIntentados: 0,
    golpesBloqueados: 0,
    criticos: 0,
    especialesUsados: 0,
    especialesAcertados: 0,
    comboMax: 0,
    guardiasRotas: 0,
    congelamientos: 0,
    rondasPerfectas: 0,
    finalAlCero: false,
    curado: 0,
  }
}

export function crearInternoLuchador(vida: number): InternoLuchador {
  return {
    prev: { ...ENTRADA_VACIA },
    buf: { golpe: 0, herramienta: 0, especial1: 0, especial2: 0, salto: 0, dash: 0 },
    dirSalto: 0,
    dirDash: 0,
    toque: null,
    accion: null,
    stun: 0,
    stunTotal: 1,
    stunBloqueo: false,
    derribo: 0,
    levantar: 0,
    caidaDerribo: 0,
    dash: null,
    dashEspera: 0,
    aterrizaje: 0,
    aterrizajeTotal: ATERRIZAJE_TICKS,
    pateoAereo: false,
    tAdelante: 0,
    corriendo: false,
    atras: false,
    guardia: false,
    agachado: false,
    sinBloquear: GUARDIA.espera,
    vMov: 0,
    vEmpuje: 0,
    invulnProyectil: false,
    pose: null,
    poseT: 0,
    tAire: 0,
    tSuelo: RESPIRO_SALTO,
    selloStun: 0,
    selloDash: 0,
    animSello: -1,
    animClave: 'quieto',
    danioRecibidoRound: 0,
    danioHechoRound: 0,
    vidaAntes: vida,
    inmune: { aturdido: 0, mareado: 0, quemado: 0, congelado: 0, electrocutado: 0 },
    quema: null,
    agarradoPor: null,
  }
}

/** Todo a cero para un round nuevo (las estadísticas de la partida se conservan). */
export function reiniciarLuchador(l: LuchadorEstado, li: InternoLuchador): void {
  l.x = X_INICIO[l.lado]
  l.y = 0
  l.vx = 0
  l.vy = 0
  l.mira = l.lado === 0 ? 1 : -1
  l.enSuelo = true
  l.estado = 'quieto'
  l.movimiento = null
  l.vida = l.vidaMax
  l.guardia = l.guardiaMax
  l.carga = CARGA.inicio
  l.destello = 0
  l.invulnerable = false
  l.efectos.congelado = 0
  l.efectos.electrocutado = 0
  l.efectos.guardiaRota = 0
  l.efectos.critico = 0
  l.efectos.aturdido = 0
  l.efectos.mareado = 0
  l.efectos.quemado = 0
  l.efectos.lento = 0
  l.efectos.curando = 0
  l.combo = 0
  for (const b of BOTONES_BUFFER) li.buf[b] = 0
  li.toque = null
  li.accion = null
  li.stun = 0
  li.stunBloqueo = false
  li.derribo = 0
  li.levantar = 0
  li.caidaDerribo = 0
  li.dash = null
  li.dashEspera = 0
  li.aterrizaje = 0
  li.pateoAereo = false
  li.tAdelante = 0
  li.corriendo = false
  li.atras = false
  li.guardia = false
  li.agachado = false
  li.sinBloquear = GUARDIA.espera
  li.vMov = 0
  li.vEmpuje = 0
  li.invulnProyectil = false
  li.pose = null
  li.poseT = 0
  li.tAire = 0
  li.tSuelo = RESPIRO_SALTO
  li.danioRecibidoRound = 0
  li.danioHechoRound = 0
  li.vidaAntes = l.vida
  for (const e of ESTADOS_CONTROL) li.inmune[e] = 0
  li.quema = null
  li.agarradoPor = null
}

export function vaciarBuffer(li: InternoLuchador): void {
  for (const b of BOTONES_BUFFER) li.buf[b] = 0
}

/**
 * Registra la entrada del tick: flancos → buffer de TICKS_BUFFER, doble toque → dash.
 * Con `chequearCarga`, apretar un especial sin carga avisa `sin_carga` en el acto.
 */
export function registrarEntrada(
  p: Partida,
  I: EstadoInterno,
  lado: Lado,
  e: EntradaJugador,
  dobleToque: boolean,
  chequearCarga: boolean,
): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const prev = li.prev
  if (e.golpe && !prev.golpe) li.buf.golpe = TICKS_BUFFER
  if (e.herramienta && !prev.herramienta) li.buf.herramienta = TICKS_BUFFER
  for (const n of [1, 2] as const) {
    const clave = n === 1 ? 'especial1' : 'especial2'
    if (e[clave] && !prev[clave]) {
      const costo = PERSONAJES[l.id].especiales[n - 1].costo
      if (chequearCarga && l.carga + 1e-9 < costo) emitir(p, { tipo: 'sin_carga', quien: lado })
      else li.buf[clave] = TICKS_BUFFER
    }
  }
  if (e.arriba && !prev.arriba) {
    li.buf.salto = TICKS_BUFFER
    li.dirSalto = dirDe(e)
  }
  if (e.dash && !prev.dash) {
    li.buf.dash = TICKS_BUFFER
    li.dirDash = dirDe(e)
  }
  if (dobleToque) {
    for (const dir of [-1, 1] as const) {
      const ahora = dir < 0 ? e.izquierda : e.derecha
      const antes = dir < 0 ? prev.izquierda : prev.derecha
      if (ahora && !antes) {
        const t = li.toque
        if (
          t &&
          t.dir === dir &&
          t.soltado !== null &&
          p.tick - t.soltado <= DOBLE_TOQUE.maxSuelto &&
          t.soltado - t.apretado <= DOBLE_TOQUE.maxApretado
        ) {
          li.buf.dash = TICKS_BUFFER
          li.dirDash = dir
          li.toque = null
        } else li.toque = { dir, apretado: p.tick, soltado: null }
      } else if (!ahora && antes && li.toque && li.toque.dir === dir && li.toque.soltado === null) {
        li.toque.soltado = p.tick
      }
    }
  }
  prev.izquierda = e.izquierda
  prev.derecha = e.derecha
  prev.arriba = e.arriba
  prev.abajo = e.abajo
  prev.golpe = e.golpe
  prev.herramienta = e.herramienta
  prev.guardia = e.guardia
  prev.especial1 = e.especial1
  prev.especial2 = e.especial2
  prev.dash = e.dash
}

function saltar(p: Partida, I: EstadoInterno, lado: Lado, dir: -1 | 0 | 1): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  l.enSuelo = false
  l.vy = VEL_SALTO
  l.y = 0
  li.vMov = dir * I.kits[lado].saltoVx * multVelocidad(l)
  li.pateoAereo = false
  li.guardia = false
  li.agachado = false
  li.corriendo = false
  li.tAdelante = 0
  li.tAire = 0
  emitir(p, { tipo: 'salto', quien: lado })
}

function iniciarDash(p: Partida, I: EstadoInterno, lado: Lado, dirPedida: -1 | 0 | 1): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const k = I.kits[lado]
  const dir: -1 | 1 = dirPedida === 0 ? (l.mira === 1 ? -1 : 1) : dirPedida
  const adelante = dir === l.mira
  li.dash = {
    t: 0,
    total: k.dash.ticks,
    dir,
    adelante,
    dist: adelante ? k.dash.adelante : k.dash.atras,
    invul: k.dash.invulnerable ?? DASH.invulnerable,
  }
  li.selloDash++
  li.guardia = false
  li.agachado = false
  li.corriendo = false
  li.tAdelante = 0
  emitir(p, { tipo: 'dash', quien: lado })
}

/**
 * Decide qué hace el luchador con la entrada de este tick. `soloMoverse` (fase final, el que
 * ganó): camina, salta, se agacha o se cubre, pero no ataca (el remate lo maneja partida.ts).
 */
export function decidir(p: Partida, I: EstadoInterno, lado: Lado, e: EntradaJugador, soloMoverse = false): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const k = I.kits[lado]
  const rival = p.luchadores[(1 - lado) as Lado]
  if (li.pose !== null) return

  const a = li.accion
  if (a) {
    // Cadenas y cancelación en especial: sólo si el golpe TOCÓ (pegó, lo bloquearon o lo aguantó
    // una armadura), desde el contacto de la última ventana o desde que terminó. Un golpe al aire
    // se paga con su recuperación entera: si encadenaba igual, machacar GOLPE de lejos era gratis
    // (el puño al aire salía en patada y le ganaba a cualquiera que quisiera castigarlo).
    if (!soloMoverse && a.especial === 0 && !a.remate && !a.mov.aereo && a.contacto && a.t >= a.cancelDesde) {
      if (intentarEspecial(p, I, lado)) return
      const sig = a.mov.siguiente
      const boton = a.mov.boton
      if (sig && boton && li.buf[boton] > 0) {
        const mov = k.movimientos[sig]
        if (mov) {
          li.buf[boton] = 0
          iniciarMovimiento(p, I, lado, mov, 0)
        }
      }
    }
    return
  }

  if (!l.enSuelo) {
    if (!soloMoverse && puedeActuarEnAire(l, li) && !li.pateoAereo && (li.buf.golpe > 0 || li.buf.herramienta > 0)) {
      li.buf.golpe = 0
      li.buf.herramienta = 0
      li.pateoAereo = true
      const mov = k.movimientos[k.inicio.aereo]
      if (mov) iniciarMovimiento(p, I, lado, mov, 0)
    }
    return
  }

  if (!puedeActuar(l, li)) {
    li.vMov = 0
    return
  }
  mirarA(l, rival.x)

  if (!soloMoverse) {
    if (intentarEspecial(p, I, lado)) return
    if (li.buf.herramienta > 0) {
      li.buf.herramienta = 0
      const mov = k.movimientos[k.inicio.herramienta]
      if (mov) {
        iniciarMovimiento(p, I, lado, mov, 0)
        return
      }
    }
    if (li.buf.golpe > 0) {
      li.buf.golpe = 0
      const mov = k.movimientos[k.inicio.golpe]
      if (mov) {
        iniciarMovimiento(p, I, lado, mov, 0)
        return
      }
    }
    if (li.buf.dash > 0 && li.dashEspera === 0) {
      li.buf.dash = 0
      iniciarDash(p, I, lado, li.dirDash !== 0 ? li.dirDash : dirDe(e))
      return
    }
  }
  if (li.buf.salto > 0) {
    li.buf.salto = 0
    const d = dirDe(e)
    saltar(p, I, lado, d !== 0 ? d : li.dirSalto)
    return
  }
  // Arriba sostenido (el stick en la diagonal): salta apenas está libre en el piso, con la
  // dirección que tenga en este tick.
  if (e.arriba && li.tSuelo >= RESPIRO_SALTO) {
    saltar(p, I, lado, dirDe(e))
    return
  }

  const dir = dirDe(e)
  li.guardia = e.guardia
  li.agachado = e.abajo
  if (li.guardia || li.agachado) {
    li.vMov = 0
    li.tAdelante = 0
    li.corriendo = false
    li.atras = false
    return
  }
  if (dir !== 0) {
    const adelante = dir === l.mira
    const mv = multVelocidad(l)
    if (adelante) {
      li.tAdelante++
      li.corriendo = li.tAdelante >= CORRER_DESDE && Math.abs(rival.x - l.x) > CORRER_DISTANCIA_MIN
      li.vMov = dir * (li.corriendo ? k.correr : k.caminar) * mv
      li.atras = false
    } else {
      li.tAdelante = 0
      li.corriendo = false
      li.vMov = dir * k.caminarAtras * mv
      li.atras = true
    }
  } else {
    li.vMov = 0
    li.tAdelante = 0
    li.corriendo = false
    li.atras = false
  }
}

function aterrizar(p: Partida, I: EstadoInterno, lado: Lado): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  l.y = 0
  l.vy = 0
  l.enSuelo = true
  li.tAire = 0
  li.tSuelo = 0
  li.vMov = 0
  li.pateoAereo = false
  if (li.pose === 'ko') {
    emitir(p, { tipo: 'aterrizaje', quien: lado, fuerte: true })
    return
  }
  if (li.pose !== null) return
  if (li.caidaDerribo > 0) {
    li.derribo = li.caidaDerribo
    li.caidaDerribo = 0
    li.stun = 0
    emitir(p, { tipo: 'aterrizaje', quien: lado, fuerte: true })
    return
  }
  const a = li.accion
  if (a && a.mov.aereo) {
    li.accion = null
    l.movimiento = null
    li.aterrizaje = a.mov.aterrizaje ?? ATERRIZAJE_TICKS
  } else if (a && a.enAire) {
    // Embestida aérea (Patada del Dragón, Chilena): termina al aterrizar, con su recuperación.
    const emb = (a.mov as DefEspecial).embestida
    li.accion = null
    l.movimiento = null
    li.invulnProyectil = false
    // Si pegó, se recupera rápido; bloqueada o al aire, queda expuesto.
    li.aterrizaje = emb ? (a.acerto ? emb.recuperacionGolpe : emb.recuperacionBloqueo) : ATERRIZAJE_TICKS
  } else if (!a && l.efectos.congelado === 0 && li.stun === 0) {
    li.aterrizaje = ATERRIZAJE_TICKS
  }
  li.aterrizajeTotal = Math.max(1, li.aterrizaje)
  if (li.aterrizaje > 0) mirarA(l, p.luchadores[(1 - lado) as Lado].x)
  emitir(p, { tipo: 'aterrizaje', quien: lado, fuerte: false })
}

/** Posición y velocidad de un tick. */
export function fisica(p: Partida, I: EstadoInterno, lado: Lado): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  // El agarrado no se mueve solo: lo sostiene el que lo agarró (combate.progresarAgarre).
  if (li.agarradoPor !== null) {
    l.vx = 0
    return
  }
  if (l.efectos.congelado > 0) li.vMov = 0
  // Dash: avance con salida rápida y frenado (curva cuadrática).
  if (li.dash) {
    const d = li.dash
    const f = (s: number) => {
      const u = 1 - s / d.total
      return 1 - u * u
    }
    li.vMov = d.dir * d.dist * (f(d.t + 1) - f(d.t))
  }
  if (!l.enSuelo) {
    // Las embestidas aéreas caen con su propia gravedad.
    const a = li.accion
    const salto = a && a.enAire ? (a.mov as DefEspecial).embestida?.salto : undefined
    const g = salto ? salto.gravedad : GRAVEDAD
    l.y += l.vy - g / 2
    l.vy -= g
    if (l.vy <= 0) li.tAire++
    l.x += li.vMov + li.vEmpuje
    li.vEmpuje *= FRICCION_AIRE
  } else {
    l.x += li.vMov + li.vEmpuje
    li.vEmpuje *= FRICCION_SUELO
  }
  if (Math.abs(li.vEmpuje) < 0.05) li.vEmpuje = 0
  l.x = limitar(l.x, X_MIN, X_MAX)
  if (!l.enSuelo && l.y <= 0) aterrizar(p, I, lado)
  l.vx = li.vMov + li.vEmpuje
}

/** Los cuerpos no se atraviesan: si se pisan, se reparten el solape (y la pared empuja al otro). */
export function resolverEmpuje(p: Partida, I: EstadoInterno): void {
  const a = p.luchadores[0]
  const b = p.luchadores[1]
  const fa = franjaEmpuje(a, I.luchadores[0])
  const fb = franjaEmpuje(b, I.luchadores[1])
  if (!(fa.y0 < fb.y1 && fb.y0 < fa.y1)) return
  const dx = b.x - a.x
  const solape = DISTANCIA_CUERPOS - Math.abs(dx)
  if (solape <= 0) return
  const s = dx > 0 ? 1 : dx < 0 ? -1 : a.mira
  let na = a.x - (s * solape) / 2
  let nb = b.x + (s * solape) / 2
  if (na < X_MIN) {
    nb += X_MIN - na
    na = X_MIN
  } else if (na > X_MAX) {
    nb -= na - X_MAX
    na = X_MAX
  }
  if (nb < X_MIN) {
    na += X_MIN - nb
    nb = X_MIN
  } else if (nb > X_MAX) {
    na -= nb - X_MAX
    nb = X_MAX
  }
  a.x = limitar(na, X_MIN, X_MAX)
  b.x = limitar(nb, X_MIN, X_MAX)
}

/** Relojes de un tick (no corre durante el hitstop). `pelea` = recargan guardia y carga. */
export function relojes(p: Partida, I: EstadoInterno, lado: Lado, pelea: boolean): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const k = I.kits[lado]
  const ef = l.efectos
  if (li.stun > 0) {
    li.stun--
    if (li.stun === 0) li.stunBloqueo = false
  }
  // Inmunidad: corre y, al terminar un estado de control (o al romperse el hielo), arranca.
  for (const e of ESTADOS_CONTROL) if (li.inmune[e] > 0) li.inmune[e]--
  if (ef.congelado > 0) {
    ef.congelado--
    if (ef.congelado === 0) {
      li.inmune.congelado = INMUNIDAD.congelado
      emitir(p, { tipo: 'descongelado', quien: lado, roto: false })
    }
  }
  if (ef.electrocutado > 0) {
    ef.electrocutado--
    if (ef.electrocutado === 0) li.inmune.electrocutado = INMUNIDAD.electrocutado
  }
  if (ef.aturdido > 0) {
    ef.aturdido--
    if (ef.aturdido === 0) li.inmune.aturdido = INMUNIDAD.aturdido
  }
  if (ef.mareado > 0) {
    ef.mareado--
    if (ef.mareado === 0) li.inmune.mareado = INMUNIDAD.mareado
  }
  if (ef.quemado > 0) {
    // Quemado: pierde vida cada tanto (sólo en la pelea).
    const q = li.quema
    if (q && pelea) {
      q.t++
      if (q.t % q.cada === 0) danioContinuo(p, I, q.de, lado, q.danio)
    }
    ef.quemado--
    if (ef.quemado === 0) {
      li.inmune.quemado = INMUNIDAD.quemado
      li.quema = null
    }
  }
  if (ef.lento > 0) ef.lento--
  if (ef.guardiaRota > 0) {
    ef.guardiaRota--
    if (ef.guardiaRota === 0) l.guardia = Math.max(l.guardia, GUARDIA.vuelve)
  }
  if (ef.critico > 0) ef.critico--
  if (l.destello > 0) l.destello--
  if (li.derribo > 0) {
    li.derribo--
    if (li.derribo === 0) li.levantar = EFECTO.levantarse
  } else if (li.levantar > 0) li.levantar--
  if (li.dash) {
    li.dash.t++
    if (li.dash.t >= li.dash.total) {
      li.dash = null
      li.vMov = 0
      li.dashEspera = k.dash.espera ?? DASH.espera
    }
  } else if (li.dashEspera > 0) li.dashEspera--
  if (li.aterrizaje > 0) li.aterrizaje--
  for (const b of BOTONES_BUFFER) if (li.buf[b] > 0) li.buf[b]--
  if (li.sinBloquear < 100000) li.sinBloquear++
  if (!l.enSuelo) li.tSuelo = 0
  else if (li.tSuelo < 100000) li.tSuelo++
  if (li.pose !== null) li.poseT++
  if (pelea) {
    if (li.sinBloquear >= GUARDIA.espera && ef.guardiaRota === 0 && l.guardia < GUARDIA.max) {
      l.guardia = Math.min(GUARDIA.max, l.guardia + GUARDIA.regen)
    }
    sumarCarga(p, lado, ((p.turbo ? CARGA.turboMult : 1) * (k.pasiva?.multCarga ?? 1)) / CARGA.ticksPorUnidad)
  }
}

/** El estado visible y la invulnerabilidad, derivados del estado interno. */
export function actualizarEstado(l: LuchadorEstado, li: InternoLuchador): void {
  const ef = l.efectos
  if (li.pose === 'ko') l.estado = 'ko'
  else if (li.pose === 'victoria') l.estado = 'victoria'
  else if (li.pose === 'burla') l.estado = 'burla'
  else if (li.pose === 'mareado') l.estado = 'mareado'
  else if (li.agarradoPor !== null) l.estado = 'agarrado'
  else if (ef.congelado > 0) l.estado = 'congelado'
  else if (ef.electrocutado > 0) l.estado = 'electrocutado'
  else if (li.derribo > 0 || li.caidaDerribo > 0) l.estado = 'derribado'
  else if (li.levantar > 0) l.estado = 'levantandose'
  else if (ef.guardiaRota > 0) l.estado = 'guardia_rota'
  else if (li.stun > 0 || ef.aturdido > 0) l.estado = 'aturdido'
  else if (li.dash) l.estado = 'dash'
  else if (li.accion) l.estado = 'atacando'
  else if (!l.enSuelo) l.estado = 'saltando'
  else if (li.guardia) l.estado = 'guardia'
  else if (li.agachado) l.estado = 'agachado'
  else if (li.vMov !== 0) l.estado = 'caminando'
  else l.estado = 'quieto'
  l.invulnerable =
    (li.dash !== null && li.dash.t < li.dash.invul) ||
    invulnerablePorAccion(li) ||
    li.derribo > 0 ||
    li.levantar > 0 ||
    li.caidaDerribo > 0 ||
    li.pose !== null
}
