/**
 * Estado interno del motor: lo que la simulación necesita y que no es parte del contrato
 * (buffers de entrada, movimiento en curso, cerebros de la CPU, proyectiles con sus datos).
 *
 * Vive en un WeakMap colgado de la Partida, así el objeto público queda con la forma exacta de
 * tipos.ts (el render, el HUD y el audio no ven nada raro) y se libera solo con la partida.
 */
import type {
  ClaveAnimacion,
  EfectoEspecial,
  EntradaJugador,
  EventoJuego,
  Lado,
  MetaAnimaciones,
  Partida,
  ProyectilEstado,
} from '../tipos'
import type { Azar } from './azar'
import { MAX_EVENTOS } from './constantes'
import type { Cerebro } from './cpu'
import type { DefMovimiento, DefNube, DefProyectil, KitPersonaje } from './movimientos'

export type BotonBuffer = 'golpe' | 'herramienta' | 'especial1' | 'especial2' | 'salto' | 'dash'
export type Pose = 'burla' | 'victoria' | 'mareado' | 'ko'

export interface VentanaAnim {
  desde: number
  ticks: number
}

/** Un movimiento en curso (golpe, herramienta, especial o el remate del final). */
export interface Accion {
  mov: DefMovimiento
  /** 0 = normal; 1 o 2 = especial. */
  especial: 0 | 1 | 2
  /** Tick del movimiento (0 = el primero). */
  t: number
  total: number
  /** Por ventana: ya hizo todos sus contactos (golpe, bloqueo o armadura). */
  resueltas: boolean[]
  /** Por ventana multigolpe: contactos hechos y ticks hasta poder volver a pegar. */
  contactos: number[]
  esperaVentana: number[]
  contacto: boolean
  acerto: boolean
  /** Desde qué tick se puede encadenar el siguiente o cancelar en especial. */
  cancelDesde: number
  /** Ventanas que usa la animación (en los especiales que tiran algo, la pose de lanzamiento). */
  ventanasAnim: VentanaAnim[]
  /** Cuadros de impacto ya calculados para esta animación (los llena animacion.ts). */
  cuadrosImpacto: number[] | null
  /** La embestida chocó: deja de correr y de pegar. */
  detenido: boolean
  lanzado: boolean
  contoAcierto: boolean
  /** El remate «AL CERO» de la fase final (no pega: es una animación con consecuencia). */
  remate: boolean
  avanceRemate: number
  /** Identificador único (la animación y la CPU lo usan para saber que es otro movimiento). */
  sello: number
  /** Proyectiles que ya salieron (ráfagas). */
  lanzados: number
  /** El especial saltó (embestida aérea): sigue hasta aterrizar. */
  enAire: boolean
  /** Agarre en curso: a quién tiene y hace cuánto. */
  agarre: { victima: Lado; t: number } | null
}

export interface ProyectilInterno {
  pub: ProyectilEstado
  def: DefProyectil | null
  especial: 1 | 2
  /** Ticks hasta que puede volver a pegar. */
  espera: number
  arrastrando: boolean
  enSuelo: boolean
  acerto: boolean
  /** El rayo del Corte Relámpago: no pega, acompaña al que corre. */
  cosmetico: boolean
  /** Sello del especial que lo tiró (un especial acierta una sola vez aunque tire varios). */
  selloAccion: number
  /** Efecto de este tiro de la ráfaga (undefined = el del proyectil o la ficha). */
  efectoTiro: EfectoEspecial | null | undefined
  empujeTiro: number | undefined
  /** Bumerán: ya pegó en la ida / en la vuelta. */
  pegoIda: boolean
  pegoVuelta: boolean
  /** Área diferida: ya estalló. */
  estallo: boolean
  /** Es una nube en el piso (la deja el pañal). */
  nube: DefNube | null
}

export interface DashEnCurso {
  t: number
  total: number
  dir: -1 | 1
  adelante: boolean
  dist: number
  /** Ticks invulnerable al principio. */
  invul: number
}

/** Estados de control con inmunidad a sí mismos al terminar (no se encadenan infinito). */
export type EstadoControl = 'aturdido' | 'mareado' | 'quemado' | 'congelado' | 'electrocutado'

export interface InternoLuchador {
  /** Entrada del tick anterior (para detectar flancos). */
  prev: EntradaJugador
  /** Ticks que le quedan a cada botón en el buffer (0 = no hay). */
  buf: Record<BotonBuffer, number>
  dirSalto: -1 | 0 | 1
  dirDash: -1 | 0 | 1
  toque: { dir: -1 | 1; apretado: number; soltado: number | null } | null
  accion: Accion | null
  /** Hitstun o blockstun restante. */
  stun: number
  stunTotal: number
  stunBloqueo: boolean
  derribo: number
  levantar: number
  /** Cayendo después de un golpe en el aire: al tocar el piso queda tirado tantos ticks. */
  caidaDerribo: number
  dash: DashEnCurso | null
  dashEspera: number
  aterrizaje: number
  aterrizajeTotal: number
  pateoAereo: boolean
  tAdelante: number
  corriendo: boolean
  atras: boolean
  guardia: boolean
  agachado: boolean
  sinBloquear: number
  /** Velocidad propia (caminar, correr, dash, embestida, salto). */
  vMov: number
  /** Velocidad recibida (golpes); frena sola. */
  vEmpuje: number
  invulnProyectil: boolean
  pose: Pose | null
  poseT: number
  /** Ticks desde el punto más alto del salto. */
  tAire: number
  /** Ticks seguidos en el piso (0 en el aire): el respiro antes de volver a saltar con arriba sostenido. */
  tSuelo: number
  selloStun: number
  selloDash: number
  animSello: number
  animClave: ClaveAnimacion
  danioRecibidoRound: number
  danioHechoRound: number
  vidaAntes: number
  /** Ticks de inmunidad a cada estado de control (después de salir de él). */
  inmune: Record<EstadoControl, number>
  /** La quemadura en curso (efectos.quemado cuenta los ticks): cuánto y cada cuánto, y de quién. */
  quema: { cada: number; danio: number; de: Lado; t: number } | null
  /** Lo tiene agarrado ese lado (el Agarre de Brian). */
  agarradoPor: Lado | null
  /**
   * Ticks de pelea seguidos sin poder actuar (sin contar el hitstop ni los super flash; ver
   * `sinControl` en cuerpo.ts). Desde TOPE_ENCIERRO.inmuneDesde queda inmune al control.
   */
  sinControl: number
}

export interface EstadoFinal {
  ganador: Lado
  perdedor: Lado
  perfecto: boolean
  remate: boolean
}

export interface EstadoInterno {
  kits: [KitPersonaje, KitPersonaje]
  meta: [MetaAnimaciones, MetaAnimaciones]
  azar: Azar
  luchadores: [InternoLuchador, InternoLuchador]
  cerebros: [Cerebro | null, Cerebro | null]
  proyectiles: ProyectilInterno[]
  sigIdProyectil: number
  sello: number
  rondasParaGanar: number
  ticksRound: number
  /** Segundos que le quedaban al reloj en cada KO ganado (puntaje). */
  segundosKO: [number, number]
  final: EstadoFinal | null
  /** Ticks de la fase ko desde que terminó el hitstop (cámara lenta). */
  koT: number
  /** Ticks de pelea del round actual y de los terminados (diagnóstico y simulador). */
  ticksPelea: number
  duracionesRound: number[]
  /** Sello del último especial que contó como acertado, por lado. */
  ultimoAcierto: [number, number]
}

const INTERNOS = new WeakMap<Partida, EstadoInterno>()

export function guardarInterno(p: Partida, i: EstadoInterno): void {
  INTERNOS.set(p, i)
}

export function internoDe(p: Partida): EstadoInterno {
  const i = INTERNOS.get(p)
  if (!i) throw new Error('motor: esa partida no la creó crearPartida()')
  return i
}

export function internoSiExiste(p: Partida): EstadoInterno | null {
  return INTERNOS.get(p) ?? null
}

/** El motor sólo agrega eventos; el loop los drena. Con tope por si nadie los drena. */
export function emitir(p: Partida, ev: EventoJuego): void {
  p.eventos.push(ev)
  if (p.eventos.length > MAX_EVENTOS) p.eventos.splice(0, p.eventos.length - MAX_EVENTOS)
}
