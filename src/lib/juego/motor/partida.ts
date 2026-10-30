/**
 * La partida: fases, rounds, reloj, KO, tiempo, la fase final «¡DEJALO AL CERO!» y el tick de
 * pelea (entrada → decisiones → movimientos → física → empuje → proyectiles → golpes → relojes →
 * KO → animación).
 *
 * Fases: presentacion → anuncio → pelea → (ko | tiempo) → entre_rounds → anuncio … y en el round
 * que define con KO: pelea → final → ko → entre_rounds → terminada.
 */
import type { ConfigPartida, EntradaJugador, Lado, LuchadorEstado, Partida } from '../tipos'
import { ENTRADA_VACIA, TPS } from '../tipos'
import type { BotonRemate } from './acciones'
import { avanzarAccion, cerrarTickAccion, iniciarRemate, REMATE_IMPACTO } from './acciones'
import { animar, normalizarMeta } from './animacion'
import { azar, crearAzar } from './azar'
import { aplicarImpacto, contactosCuerpoACuerpo } from './combate'
import { CARGA, EFECTO, ESCALA_KO, FASE, HITSTOP_KO } from './constantes'
import { enCombo, interrumpir, puedeActuar } from './cuerpo'
import { crearCerebro, entradaCpu, reiniciarCerebro } from './cpu'
import type { EstadoInterno, InternoLuchador } from './interno'
import { emitir, guardarInterno, internoDe } from './interno'
import {
  actualizarEstado,
  cargaDeInicio,
  crearEstadisticas,
  crearInternoLuchador,
  crearLuchador,
  decidir,
  fisica,
  registrarEntrada,
  reiniciarLuchador,
  relojes,
  resolverEmpuje,
  vaciarBuffer,
} from './luchador'
import { MOVIMIENTOS } from './movimientos'
import { actualizarProyectiles, desactivarProyectiles } from './proyectiles'

const LADOS = [0, 1] as const

function otro(lado: Lado): Lado {
  return lado === 0 ? 1 : 0
}

function cambiarFase(p: Partida, fase: Partida['fase']): void {
  p.fase = fase
  p.ticksFase = 0
}

function limpiarEfectos(l: LuchadorEstado, li: InternoLuchador): void {
  l.efectos.congelado = 0
  l.efectos.electrocutado = 0
  l.efectos.guardiaRota = 0
  l.efectos.aturdido = 0
  l.efectos.mareado = 0
  l.efectos.quemado = 0
  l.efectos.lento = 0
  l.efectos.curando = 0
  li.quema = null
  // Si lo tenían agarrado, lo suelta (cae); el que agarraba lo nota y termina su agarre.
  li.agarradoPor = null
  li.stun = 0
  li.stunBloqueo = false
  li.caidaDerribo = 0
  li.derribo = 0
  li.levantar = 0
}

export function crearPartida(config: ConfigPartida): Partida {
  const rondasParaGanar = Math.max(1, Math.floor(Number(config.rondasParaGanar) || 2))
  const segundos = Math.max(10, Math.floor(Number(config.segundosPorRound) || 60))
  const ticksRound = segundos * TPS
  const [id0, id1] = config.personajes
  const kit0 = MOVIMIENTOS[id0]
  const kit1 = MOVIMIENTOS[id1]
  if (!kit0 || !kit1) throw new Error(`motor: falta el kit de movimientos de «${!kit0 ? id0 : id1}»`)
  const semilla = Number.isFinite(config.semilla) ? config.semilla : 0
  const p: Partida = {
    config,
    fase: 'presentacion',
    ticksFase: 0,
    tick: 0,
    round: 1,
    tiempoRestante: ticksRound,
    turbo: false,
    rondasGanadas: [0, 0],
    luchadores: [crearLuchador(id0, 0), crearLuchador(id1, 1)],
    proyectiles: [],
    eventos: [],
    escalaTiempo: 1,
    congelamientoGolpe: 0,
    ganadorRound: null,
    ganadorPartida: null,
    estadisticas: [crearEstadisticas(), crearEstadisticas()],
  }
  const I: EstadoInterno = {
    kits: [kit0, kit1],
    meta: [normalizarMeta(config.animaciones?.[0]), normalizarMeta(config.animaciones?.[1])],
    azar: crearAzar(semilla, 1),
    luchadores: [crearInternoLuchador(p.luchadores[0].vida), crearInternoLuchador(p.luchadores[1].vida)],
    cerebros: [
      config.cpu?.[0] ? crearCerebro(0, config.dificultad, semilla, kit0.cpu.pericia?.[config.dificultad] ?? 0) : null,
      config.cpu?.[1] ? crearCerebro(1, config.dificultad, semilla, kit1.cpu.pericia?.[config.dificultad] ?? 0) : null,
    ],
    proyectiles: [],
    sigIdProyectil: 0,
    sello: 0,
    rondasParaGanar,
    ticksRound,
    segundosKO: [0, 0],
    final: null,
    koT: 0,
    ticksPelea: 0,
    duracionesRound: [],
    ultimoAcierto: [0, 0],
  }
  for (const lado of LADOS) p.luchadores[lado].carga = cargaDeInicio(I.kits[lado])
  guardarInterno(p, I)
  emitir(p, { tipo: 'presentacion' })
  I.luchadores[0].pose = 'burla'
  emitir(p, { tipo: 'burla', quien: 0 })
  for (const lado of LADOS) {
    actualizarEstado(p.luchadores[lado], I.luchadores[lado])
    animar(p, I, lado, false)
  }
  return p
}

/**
 * Un agarrado cuyo agarre ya no existe (al que agarraba le pegaron o terminó el round) se suelta
 * y cae. Así nadie queda colgado en el aire.
 */
function soltarAgarresHuerfanos(p: Partida, I: EstadoInterno): void {
  for (const lado of LADOS) {
    const li = I.luchadores[lado]
    if (li.agarradoPor === null) continue
    const a = I.luchadores[li.agarradoPor].accion
    if (a && a.agarre && a.agarre.victima === lado) continue
    li.agarradoPor = null
    const l = p.luchadores[lado]
    if (!l.enSuelo) {
      l.vy = Math.min(l.vy, 0)
      li.caidaDerribo = Math.max(li.caidaDerribo, EFECTO.derriboAereo)
    }
  }
}

/** Física y relojes sin control de los jugadores (presentación, anuncios, KO, festejo). */
function simularSinControl(p: Partida, I: EstadoInterno): void {
  for (const lado of LADOS) avanzarAccion(p, I, lado, false)
  soltarAgarresHuerfanos(p, I)
  for (const lado of LADOS) fisica(p, I, lado)
  resolverEmpuje(p, I)
  actualizarProyectiles(p, I, false)
  for (const lado of LADOS) cerrarTickAccion(p, I, lado)
  for (const lado of LADOS) relojes(p, I, lado, false)
}

function cerrarTick(p: Partida, I: EstadoInterno, avanza: boolean): void {
  for (const lado of LADOS) {
    actualizarEstado(p.luchadores[lado], I.luchadores[lado])
    animar(p, I, lado, avanza)
  }
}

function anunciar(p: Partida, I: EstadoInterno): void {
  cambiarFase(p, 'anuncio')
  const r = I.rondasParaGanar - 1
  emitir(p, { tipo: 'round', numero: p.round, final: p.rondasGanadas[0] === r && p.rondasGanadas[1] === r })
}

function nuevoRound(p: Partida, I: EstadoInterno): void {
  p.round++
  p.tiempoRestante = I.ticksRound
  p.turbo = false
  p.ganadorRound = null
  p.proyectiles.length = 0
  I.proyectiles.length = 0
  p.escalaTiempo = 1
  p.congelamientoGolpe = 0
  for (const lado of LADOS) {
    reiniciarLuchador(p.luchadores[lado], I.luchadores[lado])
    p.luchadores[lado].carga = cargaDeInicio(I.kits[lado])
    const c = I.cerebros[lado]
    if (c) reiniciarCerebro(c)
  }
  I.ticksPelea = 0
  anunciar(p, I)
}

function noquear(p: Partida, I: EstadoInterno, g: Lado, d: Lado, perfecto: boolean, vx: number, vy: number): void {
  const L = p.luchadores[d]
  const Li = I.luchadores[d]
  interrumpir(L, Li)
  limpiarEfectos(L, Li)
  Li.pose = 'ko'
  Li.poseT = 0
  const dir = L.x >= p.luchadores[g].x ? 1 : -1
  Li.vEmpuje = dir * vx
  if (vy > 0) {
    L.enSuelo = false
    L.y = Math.max(L.y, 0.5)
    L.vy = vy
  }
  emitir(p, { tipo: 'ko', ganador: g, perdedor: d, perfecto })
}

function iniciarKO(p: Partida, I: EstadoInterno, g: Lado, d: Lado): void {
  p.rondasGanadas[g]++
  p.ganadorRound = g
  I.duracionesRound.push(I.ticksPelea)
  const perfecto = I.luchadores[g].danioRecibidoRound === 0
  if (perfecto) p.estadisticas[g].rondasPerfectas++
  I.segundosKO[g] += Math.ceil(p.tiempoRestante / TPS)
  p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP_KO)
  desactivarProyectiles(I)
  if (p.rondasGanadas[g] >= I.rondasParaGanar) {
    // Define la partida con un KO: «¡DEJALO AL CERO!».
    p.ganadorPartida = g
    I.final = { ganador: g, perdedor: d, perfecto, remate: false }
    const L = p.luchadores[d]
    const Li = I.luchadores[d]
    interrumpir(L, Li)
    limpiarEfectos(L, Li)
    Li.pose = 'mareado'
    Li.poseT = 0
    Li.vEmpuje = 0
    vaciarBuffer(I.luchadores[g])
    cambiarFase(p, 'final')
    emitir(p, { tipo: 'final_disponible', ganador: g })
  } else {
    noquear(p, I, g, d, perfecto, 4.5, 6.5)
    I.koT = 0
    cambiarFase(p, 'ko')
  }
}

function verificarKO(p: Partida, I: EstadoInterno): boolean {
  const m0 = p.luchadores[0].vida <= 0
  const m1 = p.luchadores[1].vida <= 0
  if (!m0 && !m1) return false
  let perdedor: Lado = m0 ? 0 : 1
  if (m0 && m1) {
    // Doble KO en el mismo tick: sobrevive (con 1) el que venía mejor.
    const r0 = I.luchadores[0].vidaAntes / p.luchadores[0].vidaMax
    const r1 = I.luchadores[1].vidaAntes / p.luchadores[1].vidaMax
    perdedor = r0 > r1 ? 1 : r1 > r0 ? 0 : azar(I.azar) < 0.5 ? 0 : 1
    p.luchadores[otro(perdedor)].vida = 1
  }
  iniciarKO(p, I, otro(perdedor), perdedor)
  return true
}

function iniciarTiempo(p: Partida, I: EstadoInterno): void {
  const [a, b] = p.luchadores
  const ra = a.vida / a.vidaMax
  const rb = b.vida / b.vidaMax
  let g: Lado
  if (Math.abs(ra - rb) > 1e-9) g = ra > rb ? 0 : 1
  else {
    // Empate de vida: el que pegó más en el round; si no, la moneda (siempre hay ganador).
    const da = I.luchadores[0].danioHechoRound
    const db = I.luchadores[1].danioHechoRound
    g = da !== db ? (da > db ? 0 : 1) : azar(I.azar) < 0.5 ? 0 : 1
  }
  p.rondasGanadas[g]++
  p.ganadorRound = g
  I.duracionesRound.push(I.ticksPelea)
  desactivarProyectiles(I)
  if (p.rondasGanadas[g] >= I.rondasParaGanar) p.ganadorPartida = g
  cambiarFase(p, 'tiempo')
  emitir(p, { tipo: 'tiempo', ganador: g })
}

function entrarEntreRounds(p: Partida, I: EstadoInterno): void {
  cambiarFase(p, 'entre_rounds')
  p.escalaTiempo = 1
  const g = p.ganadorRound
  emitir(p, { tipo: 'fin_round', ganador: g })
  if (g === null) return
  const W = p.luchadores[g]
  const Wi = I.luchadores[g]
  interrumpir(W, Wi)
  limpiarEfectos(W, Wi)
  Wi.pose = 'victoria'
  Wi.poseT = 0
  const L = p.luchadores[otro(g)]
  const Li = I.luchadores[otro(g)]
  if (Li.pose !== 'ko') {
    interrumpir(L, Li)
    limpiarEfectos(L, Li)
    Li.pose = null
  }
}

function pasoPelea(p: Partida, I: EstadoInterno, e: readonly [EntradaJugador, EntradaJugador]): void {
  for (const lado of LADOS) registrarEntrada(p, I, lado, e[lado], !I.cerebros[lado], true)
  if (p.congelamientoGolpe > 0) {
    p.congelamientoGolpe--
    cerrarTick(p, I, false)
    return
  }
  for (const lado of LADOS) I.luchadores[lado].vidaAntes = p.luchadores[lado].vida
  for (const lado of LADOS) decidir(p, I, lado, e[lado])
  for (const lado of LADOS) avanzarAccion(p, I, lado, true)
  soltarAgarresHuerfanos(p, I)
  for (const lado of LADOS) fisica(p, I, lado)
  resolverEmpuje(p, I)
  actualizarProyectiles(p, I, true)
  for (const imp of contactosCuerpoACuerpo(p, I)) aplicarImpacto(p, I, imp)
  for (const lado of LADOS) cerrarTickAccion(p, I, lado)
  for (const lado of LADOS) relojes(p, I, lado, true)
  // El combo se corta cuando la víctima se recupera.
  for (const lado of LADOS) {
    const v = otro(lado)
    if (!enCombo(p.luchadores[v], I.luchadores[v])) p.luchadores[lado].combo = 0
  }
  if (p.tiempoRestante > 0) p.tiempoRestante--
  if (!p.turbo && p.tiempoRestante <= CARGA.turboSegundos * TPS) {
    p.turbo = true
    emitir(p, { tipo: 'turbo' })
  }
  I.ticksPelea++
  if (!verificarKO(p, I) && p.tiempoRestante <= 0) iniciarTiempo(p, I)
  cerrarTick(p, I, true)
}

function botonRemate(li: InternoLuchador): BotonRemate | null {
  if (li.buf.especial1 > 0) return 'especial1'
  if (li.buf.especial2 > 0) return 'especial2'
  if (li.buf.herramienta > 0) return 'herramienta'
  if (li.buf.golpe > 0) return 'golpe'
  return null
}

function rematar(p: Partida, I: EstadoInterno): void {
  const F = I.final
  if (!F) return
  emitir(p, { tipo: 'final_al_cero', ganador: F.ganador })
  p.estadisticas[F.ganador].finalAlCero = true
  noquear(p, I, F.ganador, F.perdedor, F.perfecto, 9, 11)
  p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP_KO)
  I.koT = 0
  cambiarFase(p, 'ko')
}

function pasoFinal(p: Partida, I: EstadoInterno, e: readonly [EntradaJugador, EntradaJugador]): void {
  const F = I.final
  for (const lado of LADOS) registrarEntrada(p, I, lado, e[lado], !I.cerebros[lado], false)
  if (p.congelamientoGolpe > 0) {
    p.congelamientoGolpe--
    cerrarTick(p, I, false)
    return
  }
  if (!F) {
    cambiarFase(p, 'ko')
    return
  }
  const g = F.ganador
  const G = p.luchadores[g]
  const Gi = I.luchadores[g]
  // El remate sale sólo con el ganador libre: si en el mismo tick del KO lo tiraron, lo congelaron
  // o lo aturdieron, espera a levantarse (antes remataba tirado en el piso, sin animación).
  if (!F.remate && p.ticksFase >= FASE.remateGracia && puedeActuar(G, Gi)) {
    const boton = botonRemate(Gi)
    if (boton) {
      vaciarBuffer(Gi)
      iniciarRemate(p, I, g, boton, p.luchadores[F.perdedor].x)
      F.remate = true
    }
  }
  if (!F.remate) decidir(p, I, g, e[g], true)
  avanzarAccion(p, I, g, false)
  soltarAgarresHuerfanos(p, I)
  const a = Gi.accion
  if (a && a.remate && a.t === REMATE_IMPACTO) rematar(p, I)
  for (const lado of LADOS) fisica(p, I, lado)
  resolverEmpuje(p, I)
  actualizarProyectiles(p, I, false)
  for (const lado of LADOS) cerrarTickAccion(p, I, lado)
  for (const lado of LADOS) relojes(p, I, lado, false)
  if (p.fase === 'final' && !F.remate && p.ticksFase >= FASE.final) {
    // No lo remató: se desploma solo.
    noquear(p, I, g, F.perdedor, F.perfecto, 0.6, 0)
    I.koT = 0
    cambiarFase(p, 'ko')
  }
  cerrarTick(p, I, true)
}

function pasoKO(p: Partida, I: EstadoInterno, e: readonly [EntradaJugador, EntradaJugador]): void {
  for (const lado of LADOS) registrarEntrada(p, I, lado, e[lado], !I.cerebros[lado], false)
  if (p.congelamientoGolpe > 0) {
    p.congelamientoGolpe--
    p.escalaTiempo = 1
    cerrarTick(p, I, false)
    return
  }
  I.koT++
  if (I.koT <= FASE.koLento) p.escalaTiempo = ESCALA_KO
  else if (I.koT <= FASE.koLento + FASE.koRampa) {
    p.escalaTiempo = ESCALA_KO + ((1 - ESCALA_KO) * (I.koT - FASE.koLento)) / FASE.koRampa
  } else p.escalaTiempo = 1
  simularSinControl(p, I)
  if (p.ticksFase >= FASE.ko) entrarEntreRounds(p, I)
  cerrarTick(p, I, true)
}

function pasoSinControl(p: Partida, I: EstadoInterno, e: readonly [EntradaJugador, EntradaJugador]): void {
  for (const lado of LADOS) registrarEntrada(p, I, lado, e[lado], !I.cerebros[lado], false)
  simularSinControl(p, I)
  switch (p.fase) {
    case 'presentacion': {
      const t = p.ticksFase
      if (t === FASE.burla) I.luchadores[0].pose = null
      if (t === FASE.presentacion - FASE.burla) {
        I.luchadores[1].pose = 'burla'
        I.luchadores[1].poseT = 0
        emitir(p, { tipo: 'burla', quien: 1 })
      }
      if (t >= FASE.presentacion) {
        I.luchadores[0].pose = null
        I.luchadores[1].pose = null
        anunciar(p, I)
      }
      break
    }
    case 'anuncio':
      if (p.ticksFase >= FASE.anuncio) {
        for (const lado of LADOS) vaciarBuffer(I.luchadores[lado])
        cambiarFase(p, 'pelea')
        emitir(p, { tipo: 'pelea' })
      }
      break
    case 'tiempo':
      if (p.ticksFase >= FASE.tiempo) entrarEntreRounds(p, I)
      break
    case 'entre_rounds':
      if (p.ticksFase >= FASE.entreRounds) {
        if (p.ganadorPartida !== null) {
          cambiarFase(p, 'terminada')
          emitir(p, { tipo: 'fin_partida', ganador: p.ganadorPartida })
        } else nuevoRound(p, I)
      }
      break
    default:
      break
  }
  cerrarTick(p, I, true)
}

export function avanzar(p: Partida, entradas: readonly [EntradaJugador, EntradaJugador]): void {
  const I = internoDe(p)
  p.tick++
  p.ticksFase++
  const e: [EntradaJugador, EntradaJugador] = [
    I.cerebros[0] ? entradaCpu(p, I, 0) : (entradas?.[0] ?? ENTRADA_VACIA),
    I.cerebros[1] ? entradaCpu(p, I, 1) : (entradas?.[1] ?? ENTRADA_VACIA),
  ]
  switch (p.fase) {
    case 'pelea':
      pasoPelea(p, I, e)
      break
    case 'final':
      pasoFinal(p, I, e)
      break
    case 'ko':
      pasoKO(p, I, e)
      break
    default:
      pasoSinControl(p, I, e)
  }
}

/** Ticks de pelea de cada round terminado (diagnóstico; lo usa el simulador). */
export function duracionesDeRounds(p: Partida): readonly number[] {
  return internoDe(p).duracionesRound
}
