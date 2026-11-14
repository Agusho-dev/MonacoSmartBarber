/**
 * Traduce los eventos del motor (EventoJuego) a sonidos y a cambios de la música. Guarda el
 * estado mínimo entre cuadros: los bucles de los proyectiles en vuelo (suenan mientras el
 * proyectil existe en `p.proyectiles` y se paneán con él), los proyectiles del elenco que siguen
 * vivos (para que el trago salpique, la botella se rompa o el graffiti estalle cuando toca), la
 * escala que sube de la curación y la tensión del «¡DEJALO AL CERO!».
 *
 * Quinta tanda (14/nov): además los bucles de dos ESTADOS (el dominio del All In y el hipnotizado),
 * que suenan exactamente mientras el estado vale más que 0; las marcas del kit (audio/kit.ts: el
 * Gigante que crece y se achica, el reaparecer de Nehuen, el papel del Despido), que suenan cuando el
 * tick del especial las cruza; el tono del motor del monopatín, que sigue su velocidad; y los
 * contadores de cada especial (qué anillo de la Orden Final va, qué herramienta de Leo es la tijera).
 */
import type { EventoJuego, FasePartida, Lado, Partida, ProyectilEstado, TipoProyectil } from '../tipos'
import { CARGA_MAX, TIEMPOS_PROYECTIL, TPS, VISTA_ANCHO } from '../tipos'
import { PERSONAJES } from '../personajes'
import { especialDe, especialEnCurso, marcasDe, rangoMonopatin, type MarcaQuinta } from './kit'
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
import {
  agarre,
  aturdido,
  bucleElenco,
  capaElenco,
  curacion,
  disparo,
  finElenco,
  graffitiEstalla,
  lanzamientoElenco,
  mareado,
  panal,
  quemado,
  sismo,
  superFlashElenco,
  swingElenco,
} from './elenco'
import {
  achicar,
  afinarMotor,
  allIn,
  aplaston,
  barridoBaja,
  bronces,
  cachetazo,
  campanitas,
  chispazo,
  clangVidrioso,
  clank,
  clickSeco,
  colaFichas,
  crack,
  crashSistema,
  crecer,
  dominio,
  errorBip,
  estallaColumna,
  estruendo,
  fiu,
  fsssEco,
  fsstHoja,
  fsstMetal,
  hipnotizado,
  hup,
  lata,
  laptop,
  manosAlPiso,
  motorMonopatin,
  naipe,
  naipeVolando,
  pasoGigante,
  pitidoApagado,
  platillo,
  pock,
  pop,
  psss,
  sello,
  shk,
  silbidoPelota,
  sollozo,
  teclado,
  theremin,
  ticMetal,
  ticTicTic,
  tinSuave,
  tingAgudo,
  tingCristalino,
  tockMetal,
  tsk,
  vibrafono,
  wahVolando,
  whooshGrave,
  whooshSube,
  whoomInverso,
  zing,
  zumbidoMetal,
  zwip,
} from './quinta'

/** Lo último que se supo de un proyectil del elenco (para sonar cuando desaparece). */
interface Seguido {
  tipo: TipoProyectil
  x: number
  edad: number
  estallo: boolean
  visto: boolean
  /** Una púa de las Espinas clavada en el piso (al irse suena el «tin»). */
  plantado: boolean
}

type ParLados<T> = [T, T]

export interface EstadoEventos {
  /** Bucles de los proyectiles en vuelo, por id del proyectil. */
  bucles: Map<number, Voz>
  tension: Voz | null
  /** Proyectiles del elenco vivos, por id. */
  seguidos: Map<number, Seguido>
  /** La curación llega de a pedacitos: cada uno suena una nota más arriba. */
  curaPaso: number
  curaHasta: number
  // ─── Quinta tanda, por lado ───
  /** El bucle del dominio del All In y el del hipnotizado (mientras el estado vale más que 0). */
  dominio: ParLados<Voz | null>
  hipnosis: ParLados<Voz | null>
  /** El especial en curso y el último tick ya revisado (las marcas del kit). */
  marcaMov: ParLados<string | null>
  marcaTick: ParLados<number>
  /** Qué anillo de la Orden Final va, cuántas herramientas de Leo salieron y cuántas columnas de código. */
  anillos: ParLados<number>
  tiros: ParLados<number>
  columnas: ParLados<number>
  /** La contra del All In de este especial ya saltó (el golpe con todo suena con la cola de fichas). */
  contra: ParLados<boolean>
  /** El que revoleó el Lanzamiento Aéreo y todavía no aterrizó (al caer, el estruendo). */
  revoleado: ParLados<boolean>
}

export function crearEstadoEventos(): EstadoEventos {
  return {
    bucles: new Map(),
    tension: null,
    seguidos: new Map(),
    curaPaso: 0,
    curaHasta: 0,
    dominio: [null, null],
    hipnosis: [null, null],
    marcaMov: [null, null],
    marcaTick: [-1, -1],
    anillos: [0, 0],
    tiros: [0, 0],
    columnas: [0, 0],
    contra: [false, false],
    revoleado: [false, false],
  }
}

/** Como mucho, tantos eventos por cuadro (una ráfaga rara no satura). */
const MAX_EVENTOS_POR_CUADRO = 32
const MAX_BUCLES = 5
/**
 * Un bucle del elenco que está por terminar (le quedan menos de estos segundos) con su proyectil
 * todavía en vuelo se empalma con uno nuevo: los bucles duran un tiempo fijo y la onda del Grito
 * vive hasta 3,8 s (más con un super flash, que congela el mundo pero no el audio) contra 2,5 s
 * de sonido, y el gorro vuelve a los ≈ 2,3 s contra 2 s: el último tramo volaba mudo.
 */
const EMPALME_S = 0.3
/** En estas fases no se oyen golpes contra el piso de proyectiles que se limpian. */
const FASES_SIN_FINALES: ReadonlySet<FasePartida> = new Set<FasePartida>(['presentacion', 'anuncio', 'terminada'])
/** Los proyectiles de la quinta tanda (sus bucles y sus finales van en quinta.ts). */
const TIPOS_QUINTA: ReadonlySet<TipoProyectil> = new Set<TipoProyectil>([
  'carta',
  'hipnosis',
  'secador',
  'aerosol',
  'codigo',
  'pelotita',
  'espina',
  'monopatin',
])
const TIPOS_ELENCO: ReadonlySet<TipoProyectil> = new Set<TipoProyectil>([
  'bombo',
  'bala',
  'graffiti',
  'trago',
  'botella',
  'onda',
  'gorro',
  'pelota',
  'leche',
  'panal',
  'nube',
  'mate',
  'agua',
  'sismo',
  'guante',
])
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

/** El swing de una herramienta de la quinta tanda. Devuelve false si no es de la tanda. */
function swingQuinta(m: Mesa, t: number, e: EventoDe<'swing'>, p: Partida, est: EstadoEventos, pan: number): boolean {
  switch (e.herramienta) {
    case 'tijera': {
      // el Corte de Precisión de Fran: el «shk» de la tijera grande (las otras tijeras, como siempre)
      const l = p.luchadores[e.quien]
      if (!l || !especialDe(l.id, l.movimiento)?.ventanas[0]?.punta) return false
      shk(m, t, pan)
      silbido(m, t, { fuerza: 'fuerte', pan })
      return true
    }
    case 'anillos':
      // cada anillo de la Orden Final, una nota más arriba
      vibrafono(m, t, pan, est.anillos[e.quien]++)
      return true
    case 'paleta':
      zwip(m, t, pan)
      return true
    case 'monopatin':
      whooshGrave(m, t, pan)
      return true
    case 'fantasma':
      fsssEco(m, t, pan)
      return true
    case 'dominio':
      silbido(m, t, { fuerza: 'especial', pan })
      return true
    case 'gigante':
    case 'despido':
      silbido(m, t, { fuerza: 'especial', pan })
      return true
    case 'lanzamiento':
    case 'ejecucion':
      silbido(m, t, { fuerza: 'medio', pan })
      return true
    default:
      return false
  }
}

function alSwing(m: Mesa, t: number, e: EventoDe<'swing'>, p: Partida, est: EstadoEventos): void {
  const pan = panLado(p, e.quien)
  if (swingQuinta(m, t, e, p, est, pan)) return
  if (swingElenco(m, t, e.herramienta, e.fuerza, pan)) return
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

/** La capa de una herramienta de la quinta tanda cuando el golpe entra. */
function capaQuinta(m: Mesa, t: number, e: EventoDe<'golpe'>, p: Partida, est: EstadoEventos, pan: number): void {
  switch (e.herramienta) {
    case 'carta':
      cachetazo(m, t, pan)
      break
    case 'dominio':
      if (est.contra[e.atacante]) colaFichas(m, t + 0.05, pan)
      break
    case 'tijera': {
      // el tijeretazo doble del Corte de Precisión (el primero es el de siempre)
      const a = p.luchadores[e.atacante]
      if (a && especialDe(a.id, a.movimiento)?.ventanas[0]?.punta) tijera(m, t + 0.07, { pan, cortes: 1, volumen: 0.7 })
      break
    }
    case 'gigante':
      pasoGigante(m, t, pan)
      break
    case 'lanzamiento':
      if (e.fuerza === 'especial') {
        whooshSube(m, t, pan)
        est.revoleado[e.victima] = true
      }
      break
    case 'secador':
      clank(m, t, pan)
      break
    case 'laptop':
      laptop(m, t, pan)
      break
    case 'ejecucion':
      if (e.fuerza === 'especial') crashSistema(m, t, pan)
      else teclado(m, t, pan)
      break
    case 'fantasma':
    case 'paleta':
      pock(m, t, pan)
      break
    case 'anillos':
      if (e.fuerza === 'especial') campanitas(m, t + 0.02, pan)
      break
    case 'espinas':
      // la clavada que pisan (el contacto es al ras del piso): «crack»
      if (e.y < 45) crack(m, t, pan)
      break
    case 'monopatin':
      chispazo(m, t, pan)
      break
    case 'despido':
      if (e.fuerza === 'especial') platillo(m, t, pan)
      else sello(m, t, pan)
      break
    default:
      break
  }
}

function alGolpe(m: Mesa, t: number, e: EventoDe<'golpe'>, p: Partida, est: EstadoEventos): void {
  const pan = panDeX(e.x)
  const lento = p.escalaTiempo < 0.99
  if (e.bloqueado) {
    const tono = p.config.personajes[e.victima] === 'chipi' ? 1.35 : 1
    bloqueo(m, t, { fuerza: e.fuerza, pan, tono })
    if (e.herramienta === 'sillon') golpeSillon(m, t, pan)
    else if (e.herramienta === 'maquina') maquina(m, t, { dur: 0.1, pan, fuerza: 0.5 })
    else if (e.herramienta === 'carta') clickSeco(m, t, pan)
    else if (e.herramienta === 'secador') ticMetal(m, t, pan)
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
      capaElenco(m, t, e.herramienta, pan)
      capaQuinta(m, t, e, p, est, pan)
  }
}

/** La capa de cada especial de la quinta tanda en el super flash (lo que no tiene su propio momento). */
function superFlashQuinta(m: Mesa, t: number, icono: string, pan: number): void {
  switch (icono) {
    case 'cartas':
      // el riffle del mazo
      for (let i = 0; i < 4; i++) naipe(m, t + 0.02 + i * 0.045, pan, 0.4)
      break
    case 'herramientas':
      ticMetal(m, t + 0.03, pan)
      ticMetal(m, t + 0.1, pan)
      break
    case 'aerosol':
      lata(m, t + 0.02, pan)
      break
    case 'ejecucion':
    case 'codigo':
      teclado(m, t + 0.02, pan)
      break
    case 'orden':
      tingAgudo(m, t + 0.03, pan)
      break
    case 'espinas':
      zing(m, t + 0.02, pan)
      break
    case 'despido':
      bronces(m, t + 0.02, pan)
      break
    default:
      break
  }
}

/** El lanzamiento de un proyectil de la quinta tanda. Devuelve false si el tipo no es de la tanda. */
function lanzamientoQuinta(m: Mesa, t: number, e: EventoDe<'proyectil'>, est: EstadoEventos, pan: number): boolean {
  switch (e.proyectil) {
    case 'carta':
      naipe(m, t, pan)
      return true
    case 'hipnosis':
      theremin(m, t, pan)
      return true
    case 'secador':
      // la del medio de la ráfaga es la tijera: suena con su clic
      fsstMetal(m, t, pan, est.tiros[e.quien]++ === 1)
      return true
    case 'aerosol':
      psss(m, t, pan)
      return true
    case 'codigo':
      // la primera columna: las manos al piso (el aviso y el estallido de cada una, en seguirElenco)
      if (est.columnas[e.quien]++ === 0) manosAlPiso(m, t, pan)
      return true
    case 'pelotita':
      pock(m, t, pan)
      return true
    case 'espina':
      fiu(m, t, pan)
      return true
    case 'monopatin':
      // arranca con su bucle (el motor), en seguirProyectiles
      return true
    default:
      return false
  }
}

/** El bucle en vuelo de un proyectil de la quinta tanda (null: ése no lleva; undefined: no es de la tanda). */
function bucleQuinta(m: Mesa, t: number, tipo: TipoProyectil, pan: number): Voz | null | undefined {
  switch (tipo) {
    case 'carta':
      return naipeVolando(m, t, pan)
    case 'hipnosis':
      return wahVolando(m, t, pan)
    case 'secador':
      return zumbidoMetal(m, t, pan)
    case 'pelotita':
      return silbidoPelota(m, t, pan)
    case 'monopatin':
      return motorMonopatin(m, t, pan)
    case 'aerosol':
    case 'codigo':
    case 'espina':
      return null
    default:
      return undefined
  }
}

/** El bucle de cualquier proyectil del elenco o de la quinta tanda (null: no lleva; undefined: ninguno de los dos). */
function bucleDe(m: Mesa, t: number, tipo: TipoProyectil, pan: number): Voz | null | undefined {
  const q = bucleQuinta(m, t, tipo, pan)
  return q !== undefined ? q : bucleElenco(m, t, tipo, pan)
}

function sonarMarca(m: Mesa, t: number, que: MarcaQuinta, pan: number): void {
  switch (que) {
    case 'crece':
      crecer(m, t, pan)
      break
    case 'paso':
      pasoGigante(m, t, pan)
      break
    case 'aplaston':
      aplaston(m, t, pan)
      break
    case 'achica':
      achicar(m, t, pan)
      break
    case 'reaparece':
      whoomInverso(m, t, pan)
      break
    case 'papel':
      fsstHoja(m, t, pan)
      break
  }
}

/**
 * Lo de la quinta tanda que no trae evento, una vez por cuadro: los bucles del dominio y del
 * hipnotizado (suenan mientras el estado vale más que 0; al despertar, el «pop») y las marcas del kit.
 */
function seguirQuinta(m: Mesa, p: Partida, est: EstadoEventos, t: number): void {
  const ahora = m.ctx.currentTime
  for (const lado of [0, 1] as const) {
    const l = p.luchadores[lado]
    if (!l) continue
    const pan = panDeX(l.x)
    const enDominio = (l.efectos.dominio ?? 0) > 0
    const vd = est.dominio[lado]
    if (enDominio && !vd) est.dominio[lado] = dominio(m, t, pan)
    else if (!enDominio && vd) {
      m.cortar(vd, 0.06)
      est.dominio[lado] = null
    } else if (vd?.pan) suavizar(vd.pan.pan, pan, ahora, 0.04)
    const enHipnosis = (l.efectos.hipnotizado ?? 0) > 0
    const vh = est.hipnosis[lado]
    if (enHipnosis && !vh) est.hipnosis[lado] = hipnotizado(m, t, pan)
    else if (!enHipnosis && vh) {
      m.cortar(vh, 0.05)
      est.hipnosis[lado] = null
      pop(m, t, pan)
    } else if (vh?.pan) suavizar(vh.pan.pan, pan, ahora, 0.04)
    // Las marcas del kit: lo que suena en un tick del especial (el Gigante, el reaparecer, el papel).
    const e = especialEnCurso(l)
    if (!e) {
      est.marcaMov[lado] = null
      est.marcaTick[lado] = -1
      continue
    }
    let previo = est.marcaTick[lado]
    // otro especial, o el mismo que vuelve a empezar (el tick volvió para atrás)
    if (l.movimiento !== est.marcaMov[lado] || l.animTick < previo) previo = -1
    est.marcaMov[lado] = l.movimiento
    for (const [tick, que] of marcasDe(e)) if (tick > previo && tick <= l.animTick) sonarMarca(m, t, que, pan)
    est.marcaTick[lado] = l.animTick
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
      alSwing(m, t, e, p, est)
      break
    case 'golpe':
      alGolpe(m, t, e, p, est)
      break
    case 'combo':
      if (e.golpes >= 2) comboTic(m, t, e.golpes, panLado(p, e.quien))
      break
    case 'especial': {
      const ficha = PERSONAJES[p.config.personajes[e.quien]]
      const icono = ficha ? ficha.especiales[e.numero - 1].icono : 'rayo'
      const pan = panLado(p, e.quien)
      superFlash(m, t, icono, pan)
      superFlashElenco(m, t, icono, pan)
      superFlashQuinta(m, t, icono, pan)
      mus.agachar(0.4, 0.55)
      // un especial nuevo: los contadores de la quinta tanda de este lado empiezan de cero
      est.anillos[e.quien] = 0
      est.tiros[e.quien] = 0
      est.columnas[e.quien] = 0
      est.contra[e.quien] = false
      break
    }
    case 'proyectil': {
      const pan = panLado(p, e.quien)
      if (!lanzamientoQuinta(m, t, e, est, pan) && !lanzamientoElenco(m, t, e.proyectil, pan)) lanzamiento(m, t, e.proyectil, pan)
      break
    }
    case 'curacion': {
      const ahora = m.ctx.currentTime
      est.curaPaso = ahora < est.curaHasta ? est.curaPaso + 1 : 0
      est.curaHasta = ahora + 0.6
      curacion(m, t, panLado(p, e.quien), est.curaPaso)
      break
    }
    case 'agarre': {
      // el de Brian; el «hup» sordo del Lanzamiento Aéreo; el «bip» de error del Agarre y Ejecución
      const a = p.luchadores[e.atacante]
      const ag = a ? especialDe(a.id, a.movimiento)?.agarre : undefined
      const pan = panLado(p, e.atacante)
      if (ag?.roba) errorBip(m, t, pan)
      else if (ag?.aire) hup(m, t, pan)
      else agarre(m, t, pan)
      mus.agachar(0.55, 0.4)
      break
    }
    case 'aturdido':
      aturdido(m, t, panLado(p, e.quien))
      break
    case 'mareado':
      mareado(m, t, panLado(p, e.quien))
      break
    case 'quemado':
      quemado(m, t, panLado(p, e.quien))
      break
    case 'nube':
      panal(m, t, panDeX(e.x))
      break
    case 'sismo':
      sismo(m, t, panDeX(e.x))
      mus.agachar(0.5, 0.45)
      break
    case 'disparo':
      disparo(m, t, panDeX(e.x))
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
      // el revoleado del Lanzamiento Aéreo cae: el estruendo grave
      if (e.fuerte && est.revoleado[e.quien]) {
        est.revoleado[e.quien] = false
        estruendo(m, t, panLado(p, e.quien))
      }
      break
    // ─── Quinta tanda (14/nov) ───
    case 'contra':
      allIn(m, t, panLado(p, e.quien))
      est.contra[e.quien] = true
      mus.agachar(0.5, 0.45)
      break
    case 'cegado':
      pitidoApagado(m, t, panLado(p, e.quien))
      break
    case 'precision':
      tingCristalino(m, t, panDeX(e.x))
      break
    case 'carga_robada':
      barridoBaja(m, t, panLado(p, e.victima))
      break
    case 'devuelto':
      pock(m, t, panDeX(e.x), true)
      clangVidrioso(m, t + 0.01, panDeX(e.x))
      break
    case 'despido':
      sollozo(m, t + 0.32, panLado(p, e.victima))
      break
    case 'pinchazo':
      tsk(m, t, panDeX(e.x))
      break
    case 'plantada':
      tockMetal(m, t, panDeX(e.x))
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

function enPantalla(x: number): boolean {
  return x > 12 && x < VISTA_ANCHO - 12
}

/**
 * Los proyectiles del elenco: el graffiti estalla a su edad, y el trago, la botella, el mate,
 * la pelota, el bombo y el guante suenan al desaparecer (caen al piso o pegan).
 */
function seguirElenco(m: Mesa, p: Partida, est: EstadoEventos, t: number): void {
  for (const s of est.seguidos.values()) s.visto = false
  for (const pr of p.proyectiles) {
    const quinta = TIPOS_QUINTA.has(pr.tipo)
    if (!TIPOS_ELENCO.has(pr.tipo) && !quinta) continue
    let s = est.seguidos.get(pr.id)
    if (!s) {
      s = { tipo: pr.tipo, x: pr.x, edad: pr.edad, estallo: false, visto: true, plantado: false }
      est.seguidos.set(pr.id, s)
      // cada columna del Terremoto avisa con su «tic-tic-tic», panneado donde aparece
      if (pr.tipo === 'codigo') ticTicTic(m, t, panDeX(pr.x), (TIEMPOS_PROYECTIL.codigoEstalla / TPS) * 0.9)
    }
    s.visto = true
    s.x = pr.x
    s.edad = pr.edad
    s.plantado = pr.plantado
    if (pr.tipo === 'codigo' && !s.estallo && pr.edad >= TIEMPOS_PROYECTIL.codigoEstalla) {
      s.estallo = true
      estallaColumna(m, t, panDeX(pr.x))
    }
    if (pr.tipo === 'graffiti' && !s.estallo && pr.edad >= TIEMPOS_PROYECTIL.graffitiEstalla) {
      s.estallo = true
      // se corta el aerosol y estalla
      const siseo = est.bucles.get(pr.id)
      if (siseo) {
        m.cortar(siseo, 0.04)
        est.bucles.delete(pr.id)
      }
      graffitiEstalla(m, t, panDeX(pr.x))
    }
  }
  const callar = FASES_SIN_FINALES.has(p.fase)
  for (const [id, s] of est.seguidos) {
    if (s.visto) continue
    est.seguidos.delete(id)
    if (callar || !enPantalla(s.x)) continue
    if (s.tipo === 'graffiti') {
      if (!s.estallo) graffitiEstalla(m, t, panDeX(s.x))
    } else if (s.tipo === 'espina') {
      // la púa clavada que se va (se apagó, la pisaron o se deshizo con su tirada): un «tin» suave
      if (s.plantado) tinSuave(m, t, panDeX(s.x))
    } else if (!TIPOS_QUINTA.has(s.tipo)) finElenco(m, t, s.tipo, panDeX(s.x))
  }
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
  seguirElenco(m, p, est, t)
  const ahora = m.ctx.currentTime
  const motor = rangoMonopatin()
  for (const pr of vivos) {
    const pan = panDeX(pr.x)
    const v = est.bucles.get(pr.id)
    if (v) {
      if (v.pan) suavizar(v.pan.pan, pan, ahora, 0.04)
      // el monopatín de Tony: el motor sube de tono con la velocidad
      if (pr.tipo === 'monopatin') afinarMotor(m, v, (Math.abs(pr.vx) - motor.desde) / (motor.hasta - motor.desde))
      // Sigue volando y su bucle se termina: otro igual que entra mientras éste se apaga. No antes
      // del segundo de vida: un bucle que la mesa cortó para hacer lugar (tope de voces) no se
      // rearma en cada cuadro, robándole el lugar a otro que a su vez se rearmaría.
      if (v.fin - ahora > EMPALME_S || ahora - v.t0 < 1 || !(TIPOS_ELENCO.has(pr.tipo) || TIPOS_QUINTA.has(pr.tipo))) continue
      if (pr.tipo === 'graffiti' && pr.edad >= TIEMPOS_PROYECTIL.graffitiEstalla) continue
      const otro = bucleDe(m, t, pr.tipo, pan)
      if (otro) {
        m.cortar(v, EMPALME_S)
        est.bucles.set(pr.id, otro)
      }
      continue
    }
    if (est.bucles.size >= MAX_BUCLES) continue
    // El spray no lleva bucle: su chorro corto ya sonó con el lanzamiento.
    if (pr.tipo === 'spray') continue
    // El graffiti que ya estalló no vuelve a sisear.
    if (pr.tipo === 'graffiti' && pr.edad >= TIEMPOS_PROYECTIL.graffitiEstalla) continue
    // Una púa ya clavada no zumba (sólo la que vuela).
    if (pr.plantado) continue
    const elenco = bucleDe(m, t, pr.tipo, pan)
    // null = ése no lleva bucle (bala, trago, botella, pelota, pañal, mate, el spray, el código, la
    // púa). Se vuelve a preguntar en cada cuadro: es un switch que no arma ningún nodo.
    if (elenco === null) continue
    const nuevo =
      elenco !== undefined
        ? elenco
        : pr.tipo === 'tornado'
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
  try {
    seguirQuinta(m, p, est, t)
  } catch {
    // idem
  }
  if (p.proyectiles.length > 0 || est.bucles.size > 0 || est.seguidos.size > 0) {
    try {
      seguirProyectiles(m, p, est, t)
    } catch {
      // idem
    }
  }
}
