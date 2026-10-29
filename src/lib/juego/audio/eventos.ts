/**
 * Traduce los eventos del motor (EventoJuego) a sonidos y a cambios de la música. Guarda el
 * estado mínimo entre cuadros: los bucles de los proyectiles en vuelo (suenan mientras el
 * proyectil existe en `p.proyectiles` y se paneán con él) y la tensión del «¡DEJALO AL CERO!».
 */
import type { EventoJuego, Lado, Partida, ProyectilEstado } from '../tipos'
import { CARGA_MAX, TPS, VISTA_ANCHO } from '../tipos'
import { PERSONAJES } from '../personajes'
import type { Mesa, Voz } from './mesa'
import { limitar, suavizar } from './mesa'
import type { Musica } from './musica'
import {
  aterrizaje,
  bloqueo,
  brilloCritico,
  capaHerramienta,
  dash,
  derribo,
  impacto,
  maquina,
  peine,
  salto,
  silbido,
  tijera,
} from './golpes'
import {
  alCero,
  congelar,
  deshielo,
  electrico,
  golpeSillon,
  guardiaRota,
  lanzamiento,
  puffSpray,
  rotura,
  sillonVolando,
  spray,
  superFlash,
  torbellino,
  zap,
} from './poderes'
import { aPelear, burla, carga, comboTic, finRound, gong, ko, presentacion, sinCarga, tension, tiempo, turbo } from './anuncios'

export interface EstadoEventos {
  /** Bucles de los proyectiles en vuelo, por id del proyectil. */
  bucles: Map<number, Voz>
  tension: Voz | null
}

export function crearEstadoEventos(): EstadoEventos {
  return { bucles: new Map(), tension: null }
}

/** Como mucho, tantos eventos por cuadro (una ráfaga rara no satura). */
const MAX_EVENTOS_POR_CUADRO = 32
const MAX_BUCLES = 4
const FASES_SIN_TENSION: ReadonlySet<Partida['fase']> = new Set<Partida['fase']>([
  'presentacion',
  'anuncio',
  'pelea',
  'entre_rounds',
  'terminada',
])

function panDeX(x: number): number {
  return limitar((x / VISTA_ANCHO - 0.5) * 1.2, -0.7, 0.7)
}

function panLado(p: Partida, lado: Lado): number {
  const l = p.luchadores[lado]
  return l ? panDeX(l.x) : 0
}

/** El lado que maneja una persona (0 si son dos humanos; null si juegan dos CPU). */
function ladoHumano(p: Partida): Lado | null {
  if (!p.config.cpu[0]) return 0
  if (!p.config.cpu[1]) return 1
  return null
}

function cortarTension(m: Mesa, est: EstadoEventos, fundido: number): void {
  if (est.tension) m.cortar(est.tension, fundido)
  est.tension = null
}

type EventoDe<T extends EventoJuego['tipo']> = Extract<EventoJuego, { tipo: T }>

function alSwing(m: Mesa, t: number, e: EventoDe<'swing'>, p: Partida): void {
  const pan = panLado(p, e.quien)
  switch (e.herramienta) {
    case 'maquina':
      maquina(m, t, { dur: e.fuerza === 'especial' ? 0.45 : 0.28, pan, fuerza: 0.8 })
      silbido(m, t, { fuerza: 'medio', pan })
      break
    case 'tijera':
      tijera(m, t, { pan })
      silbido(m, t, { fuerza: 'leve', pan })
      break
    case 'peine':
      peine(m, t, { pan })
      silbido(m, t, { fuerza: 'leve', pan })
      break
    case 'rayo':
      // Corte Relámpago: la máquina cargada cruzando la pantalla.
      maquina(m, t, { dur: 0.32, pan, fuerza: 1 })
      electrico(m, t, { dur: 0.32, pan, fuerza: 0.7 })
      silbido(m, t, { fuerza: 'especial', pan })
      break
    case 'spray':
      // Fijación Extrema puede ser un proyectil o una caja de golpe: el chorro suena igual.
      spray(m, t, { pan, dur: 0.5 })
      break
    case 'tornado':
    case 'sillon':
      silbido(m, t, { fuerza: 'especial', pan })
      break
    default:
      silbido(m, t, { fuerza: e.fuerza, pan })
  }
}

function alGolpe(m: Mesa, t: number, e: EventoDe<'golpe'>, p: Partida): void {
  const pan = panDeX(e.x)
  const lento = p.escalaTiempo < 0.99
  if (e.bloqueado) {
    const tono = p.config.personajes[e.victima] === 'chipi' ? 1.35 : 1
    bloqueo(m, t, { fuerza: e.fuerza, pan, tono })
    if (e.herramienta === 'sillon') golpeSillon(m, t, pan)
    else if (e.herramienta === 'maquina') maquina(m, t, { dur: 0.1, pan, fuerza: 0.5 })
    return
  }
  switch (e.herramienta) {
    case 'sillon':
      golpeSillon(m, t, pan)
      if (e.critico) brilloCritico(m, t, pan)
      break
    case 'rayo':
      impacto(m, t, { fuerza: 'especial', critico: e.critico, pan, lento })
      zap(m, t, pan)
      break
    case 'tornado':
      impacto(m, t, { fuerza: 'leve', critico: e.critico, pan, lento })
      tijera(m, t, { pan, cortes: 1, volumen: 0.5 })
      break
    case 'spray':
      impacto(m, t, { fuerza: 'leve', critico: e.critico, pan, lento })
      puffSpray(m, t, pan)
      break
    default:
      impacto(m, t, { fuerza: e.fuerza, critico: e.critico, pan, lento })
      capaHerramienta(m, t, e.herramienta, pan)
  }
}

function alCargar(m: Mesa, t: number, e: EventoDe<'carga'>, p: Partida): void {
  // La carga de la CPU no suena: serían dos «ding» por segundo que no le dicen nada al jugador.
  if (p.config.cpu[e.quien]) return
  const ficha = PERSONAJES[p.config.personajes[e.quien]]
  const lista = ficha ? ficha.especiales.some((s) => s.costo === e.nivel) : false
  carga(m, t, { nivel: e.nivel, lista, llena: e.nivel >= CARGA_MAX, pan: panLado(p, e.quien) * 0.5 })
}

function uno(m: Mesa, mus: Musica, e: EventoJuego, p: Partida, est: EstadoEventos, t: number): void {
  switch (e.tipo) {
    case 'presentacion':
      presentacion(m, t)
      break
    case 'round':
      mus.superficie(0.6)
      mus.intensidad(e.final ? 1 : 0)
      gong(m, t, e.final)
      break
    case 'pelea':
      aPelear(m, t)
      break
    case 'swing':
      alSwing(m, t, e, p)
      break
    case 'golpe':
      alGolpe(m, t, e, p)
      break
    case 'combo':
      if (e.golpes >= 2) comboTic(m, t, e.golpes, panLado(p, e.quien))
      break
    case 'especial': {
      const ficha = PERSONAJES[p.config.personajes[e.quien]]
      const icono = ficha ? ficha.especiales[e.numero - 1].icono : 'rayo'
      superFlash(m, t, icono, panLado(p, e.quien))
      mus.agachar(0.4, 0.55)
      break
    }
    case 'proyectil':
      lanzamiento(m, t, e.proyectil, panLado(p, e.quien))
      break
    case 'guardia_rota':
      guardiaRota(m, t, panDeX(e.x))
      mus.agachar(0.6, 0.4)
      break
    case 'congelado':
      congelar(m, t, panLado(p, e.quien))
      break
    case 'descongelado':
      if (e.roto) rotura(m, t, { pan: panLado(p, e.quien), brillo: 1.15, grave: false })
      else deshielo(m, t, panLado(p, e.quien))
      break
    case 'electrocutado':
      electrico(m, t, { dur: 40 / TPS, pan: panLado(p, e.quien), fuerza: 0.9 })
      break
    case 'carga':
      alCargar(m, t, e, p)
      break
    case 'sin_carga':
      if (!p.config.cpu[e.quien]) sinCarga(m, t)
      break
    case 'turbo':
      turbo(m, t)
      mus.intensidad(2)
      break
    case 'salto':
      salto(m, t, panLado(p, e.quien))
      break
    case 'aterrizaje':
      aterrizaje(m, t, panLado(p, e.quien), e.fuerte)
      break
    case 'dash':
      dash(m, t, panLado(p, e.quien))
      break
    case 'derribo':
      derribo(m, t, panLado(p, e.quien))
      break
    case 'burla':
      burla(m, t, panLado(p, e.quien))
      break
    case 'ko':
      ko(m, t, e.perfecto)
      mus.bajoAgua()
      break
    case 'tiempo':
      tiempo(m, t)
      mus.bajoAgua()
      break
    case 'final_disponible':
      cortarTension(m, est, 0.05)
      est.tension = tension(m, t)
      break
    case 'final_al_cero':
      cortarTension(m, est, 0.05)
      alCero(m, t, panLado(p, e.ganador))
      break
    case 'fin_round': {
      const humano = ladoHumano(p)
      if (e.ganador !== null && humano !== null) finRound(m, t, e.ganador === humano)
      break
    }
    case 'fin_partida':
      cortarTension(m, est, 0.3)
      break
  }
}

function existe(lista: readonly ProyectilEstado[], id: number): ProyectilEstado | null {
  for (const pr of lista) if (pr.id === id) return pr
  return null
}

/** Cada proyectil en vuelo tiene su bucle; se panea con él y se apaga cuando desaparece. */
function seguirProyectiles(m: Mesa, p: Partida, est: EstadoEventos, t: number): void {
  const vivos = p.proyectiles
  for (const [id, v] of est.bucles) {
    if (!existe(vivos, id)) {
      m.cortar(v, 0.12)
      est.bucles.delete(id)
    }
  }
  const ahora = m.ctx.currentTime
  for (const pr of vivos) {
    const pan = panDeX(pr.x)
    const v = est.bucles.get(pr.id)
    if (v) {
      if (v.pan) suavizar(v.pan.pan, pan, ahora, 0.04)
      continue
    }
    if (est.bucles.size >= MAX_BUCLES) continue
    // El spray no lleva bucle: su chorro corto ya sonó con el lanzamiento.
    if (pr.tipo === 'spray') continue
    const nuevo =
      pr.tipo === 'tornado'
        ? torbellino(m, t, pan)
        : pr.tipo === 'sillon'
          ? sillonVolando(m, t, pan)
          : electrico(m, t, { dur: 1.5, pan, fuerza: 0.6 })
    if (nuevo) est.bucles.set(pr.id, nuevo)
  }
}

export function procesarEventos(
  m: Mesa,
  mus: Musica,
  eventos: readonly EventoJuego[],
  p: Partida,
  est: EstadoEventos,
): void {
  const t = m.ahora()
  const n = Math.min(eventos.length, MAX_EVENTOS_POR_CUADRO)
  for (let i = 0; i < n; i++) {
    try {
      uno(m, mus, eventos[i], p, est, t)
    } catch {
      // Un sonido roto no corta el resto del cuadro.
    }
  }
  // Red de seguridad: si la partida siguió sin pasar por el remate ni por fin_partida.
  if (est.tension && FASES_SIN_TENSION.has(p.fase)) cortarTension(m, est, 0.3)
  if (p.proyectiles.length > 0 || est.bucles.size > 0) {
    try {
      seguirProyectiles(m, p, est, t)
    } catch {
      // idem
    }
  }
}
