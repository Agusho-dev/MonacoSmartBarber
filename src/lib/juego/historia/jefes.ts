/**
 * Modo historia (16/nov/2026): la torre del Torneo de Monaco y la fuerza de cada piso.
 *
 * Pedido: «Los bosses deben de ser más fuertes que los otros y hacerlos un poco más grandes como
 * para que se note que son bosses, la idea es que sea como un torneo del mortal kombat. El orden
 * debe de ser Nacho - Nehuen - Nico - Tony, siendo Nico y Tony los más fuertes del juego en el modo
 * historia.» Torre de 9 pisos (5 barberos y los 4 Bosses) con reintento libre.
 *
 * Todo lo de acá vale SÓLO en el modo historia: la pelea libre y el online no lo ven (el motor sólo
 * lo aplica si ConfigPartida.jefes viene puesto). Sin `@/`: el simulador lo importa desde Node
 * (scripts/juego/simulador/historia.mts mide y afina estos números).
 *
 * Cómo se lee la fuerza de un piso:
 *  - `dificultad` es la de la CPU del motor (hoy todos los pisos van con la NORMAL: CPU_BARBEROS dice
 *    por qué) y `pericia` se SUMA a la de su barbero contra una persona (periciaCpu en
 *    motor/partida.ts): + la corre hacia la dificultad de arriba, − hacia la de abajo (EstiloCpu).
 *  - Un Boss además es más grande (`escala`: sprite, caja de daño, cajas de golpe y de dónde salen
 *    sus tiros), tiene más vida, pega más y, en el torneo difícil, Nico y Tony aguantan los golpes
 *    leves mientras atacan (FUERZA_JEFES dice por qué sólo ahí).
 *  - Lo que la persona le gana a cada piso (normal, simulado): barberos 72 → 46 %, Nacho 42, Nehuen
 *    37, Nico M. 31 y Tony 27 (Nico y Tony, los más fuertes del juego en el modo historia).
 */
import type { Dificultad, IdPersonaje, ModificadorJefe } from '../tipos'

/** Los Bosses, en el orden en que aparecen en la torre (el último es el jefe final). */
export const ORDEN_JEFES = ['nacho', 'nehuen', 'nico_m', 'tony'] as const satisfies readonly IdPersonaje[]
export type IdJefe = (typeof ORDEN_JEFES)[number]

/** Cuántos barberos hay antes de los Bosses (el usuario eligió la torre de 9: 5 + 4). */
export const PISOS_BARBEROS = 5
export const TOTAL_PISOS = PISOS_BARBEROS + ORDEN_JEFES.length

export function esJefe(id: IdPersonaje): id is IdJefe {
  return (ORDEN_JEFES as readonly IdPersonaje[]).includes(id)
}

/** La CPU de un piso: la dificultad del motor y lo que se le suma (o resta) a su pericia. */
export interface CpuPiso {
  dificultad: Dificultad
  pericia: number
}

/**
 * Los 5 pisos de barberos, de abajo hacia arriba, según la dificultad que eligió el jugador para su
 * torneo. Suben despacio: el primero se le gana casi siempre y el quinto ya es una pelea pareja.
 *
 * Afinado con scripts/juego/simulador/historia.mts (16/nov) contra el «simple» y el «novato» de la meta
 * B de balance.mts (ven el ataque 14 ticks tarde), con los 17 barberos del jugador y el rival rotando
 * entre los otros 16. Metas, el promedio de los dos: normal 72, 64, 56, 50 y 46 %; fácil, 18 puntos más
 * (sin pasar de 88); difícil, 15 menos.
 *  - Los tres torneos usan la CPU NORMAL del motor y sólo corren la pericia. La base de normal contra una
 *    persona (periciaHumano − asistencia, movimientos.ts) empareja a cada rival contra el barbero del
 *    jugador; la de fácil y la de difícil (EstiloCpu.pericia) se afinaron CPU contra CPU, y contra una
 *    persona van de −0,36 a +0,22 y de −0,46 a +1,31: con la CPU fácil (+1), el mismo piso le ganaba
 *    39 % a la CPU de Simón y 100 % a la de Stefano.
 *  - Cerca de normal la pericia es muy sensible (−0,2 → 80 %, −0,1 → 59, 0 → 37, +0,1 → 26): una
 *    centésima mueve 2 a 3 puntos, por eso los pisos quedan tan juntos. Un cambio de kit o de la CPU
 *    corre estas curvas: después, volver a afinar con historia.mts --afinar.
 */
export const CPU_BARBEROS: Readonly<Record<Dificultad, readonly CpuPiso[]>> = {
  facil: [
    { dificultad: 'normal', pericia: -0.253 },
    { dificultad: 'normal', pericia: -0.211 },
    { dificultad: 'normal', pericia: -0.168 },
    { dificultad: 'normal', pericia: -0.143 },
    { dificultad: 'normal', pericia: -0.123 },
  ],
  normal: [
    { dificultad: 'normal', pericia: -0.159 },
    { dificultad: 'normal', pericia: -0.123 },
    { dificultad: 'normal', pericia: -0.089 },
    { dificultad: 'normal', pericia: -0.064 },
    { dificultad: 'normal', pericia: -0.043 },
  ],
  dificil: [
    { dificultad: 'normal', pericia: -0.093 },
    { dificultad: 'normal', pericia: -0.058 },
    { dificultad: 'normal', pericia: -0.018 },
    { dificultad: 'normal', pericia: 0.015 },
    { dificultad: 'normal', pericia: 0.048 },
  ],
}

/**
 * El tamaño de cada Boss: crece piso a piso, así el jefe final es el más grande. Igual en las tres
 * dificultades (lo que se nota a la vista no cambia con el nivel).
 */
export const ESCALA_JEFE: Readonly<Record<IdJefe, number>> = {
  nacho: 1.1,
  nehuen: 1.12,
  nico_m: 1.16,
  tony: 1.2,
}

/** Lo que cambia de un Boss según la dificultad del torneo (el tamaño va aparte, ESCALA_JEFE). */
interface FuerzaJefe {
  dificultad: Dificultad
  pericia: number
  vida: number
  danio: number
  armadura?: boolean
}

/**
 * La fuerza de cada Boss por dificultad del torneo. Nico y Tony son los más fuertes (Tony, el final,
 * todavía un poco más). Los números salen de scripts/juego/simulador/historia.mts: se afinan ahí,
 * contra las personas simuladas del balance, no a ojo (16/nov). Metas en normal: Nacho 42 %, Nehuen 37,
 * Nico M. 31 y Tony 27; en fácil, 18 puntos más, y en difícil, 15 menos (como los barberos).
 *  - La CPU normal del motor, como los pisos de barberos (CPU_BARBEROS dice por qué).
 *  - La fuerza se ve (vida, daño y tamaño) y la pericia queda negativa para compensarla: con los números
 *    de la primera versión (normal +0,1 a +0,5, vida ×1,2 a ×1,55) la persona le ganaba 6 % a Nacho, 5 a
 *    Nehuen y nunca a Nico ni a Tony.
 *  - Vida antes que daño: un round contra un Boss dura de 16 a 22 s y ninguno llega al tiempo (mucho
 *    margen contra el tope de 48 s y 25 %). Más daño acorta los rounds.
 *  - La armadura, sólo en difícil (Nico y Tony). Contra ella, el que sólo machaca GOLPE (el «simple») no
 *    tiene con qué: con armadura en normal, el simple le ganaba 5 % a Tony (el novato, 49) y con Brian y
 *    con Leo, ninguna de 64; sin armadura, 17 y 37. En fácil tampoco: ahí juega el que recién empieza.
 *  - Cada Boss pide otra cosa: Nehuen castiga al que aprieta los especiales apenas se encienden (en
 *    normal el novato le gana 17 % y el simple 57) y Tony, al que sólo machaca.
 */
export const FUERZA_JEFES: Readonly<Record<Dificultad, Readonly<Record<IdJefe, FuerzaJefe>>>> = {
  facil: {
    nacho: { dificultad: 'normal', pericia: -0.2, vida: 1.3, danio: 1.0 },
    nehuen: { dificultad: 'normal', pericia: -0.12, vida: 1.4, danio: 1.05 },
    nico_m: { dificultad: 'normal', pericia: -0.177, vida: 1.5, danio: 1.1 },
    tony: { dificultad: 'normal', pericia: -0.205, vida: 1.6, danio: 1.15 },
  },
  normal: {
    nacho: { dificultad: 'normal', pericia: -0.18, vida: 1.4, danio: 1.05 },
    nehuen: { dificultad: 'normal', pericia: -0.08, vida: 1.5, danio: 1.1 },
    nico_m: { dificultad: 'normal', pericia: -0.153, vida: 1.6, danio: 1.15 },
    tony: { dificultad: 'normal', pericia: -0.19, vida: 1.75, danio: 1.2 },
  },
  dificil: {
    nacho: { dificultad: 'normal', pericia: -0.16, vida: 1.5, danio: 1.1 },
    nehuen: { dificultad: 'normal', pericia: -0.04, vida: 1.6, danio: 1.15 },
    nico_m: { dificultad: 'normal', pericia: -0.305, vida: 1.7, danio: 1.2, armadura: true },
    tony: { dificultad: 'normal', pericia: -0.3, vida: 1.85, danio: 1.25, armadura: true },
  },
}

/** Lo que el motor necesita para un piso: la dificultad de la CPU y el refuerzo del rival. */
export interface PeleaDelPiso {
  dificultad: Dificultad
  /** Lo que va en ConfigPartida.jefes[1] (el rival; el jugador siempre es el lado 0). */
  refuerzo: ModificadorJefe
  jefe: boolean
}

/**
 * La pelea del piso `piso` (0 = el de abajo) contra `rival`, en un torneo de dificultad `dificultad`.
 * Los barberos van con un refuerzo neutro (tamaño, vida y daño de siempre): sólo cambia la pericia.
 */
export function peleaDelPiso(dificultad: Dificultad, piso: number, rival: IdPersonaje): PeleaDelPiso {
  if (esJefe(rival)) {
    const f = FUERZA_JEFES[dificultad][rival]
    return {
      dificultad: f.dificultad,
      refuerzo: { escala: ESCALA_JEFE[rival], vida: f.vida, danio: f.danio, pericia: f.pericia, armadura: f.armadura },
      jefe: true,
    }
  }
  const tabla = CPU_BARBEROS[dificultad]
  const c = tabla[Math.max(0, Math.min(tabla.length - 1, piso))]
  return { dificultad: c.dificultad, refuerzo: { escala: 1, vida: 1, danio: 1, pericia: c.pericia }, jefe: false }
}
