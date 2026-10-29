/**
 * Contratos del juego de pelea «Corte Final» (/juego).
 *
 * El juego son cuatro piezas que se hablan SÓLO por estos tipos:
 *  - motor  (src/lib/juego/motor):  simulación pura a paso fijo, sin DOM. Es la verdad.
 *  - render (src/lib/juego/render): dibuja el mundo en un canvas + efectos visuales.
 *  - audio  (src/lib/juego/audio):  efectos y música sintetizados con WebAudio.
 *  - UI     (src/components/juego + src/app/juego): pantallas, controles, HUD y el loop.
 *
 * Coordenadas del mundo: unidades = px lógicos de una vista de 960x540.
 * `x` crece a la derecha; `y` es la ALTURA SOBRE EL PISO (0 = parado en el piso, positivo
 * = arriba). El render traduce: yPantalla = arena.suelo * VISTA_ALTO - y.
 */

/** Ticks por segundo de la simulación (paso fijo). */
export const TPS = 60
export const VISTA_ANCHO = 960
export const VISTA_ALTO = 540
/** «Carga de la máquina»: el elixir del juego. */
export const CARGA_MAX = 10

export type IdPersonaje = 'simon' | 'chipi'
export type IdArena = 'rondeau' | 'caseros' | 'pueyrredon' | 'parana'
export type Dificultad = 'facil' | 'normal' | 'dificil'
export type Lado = 0 | 1

// ─── Assets ──────────────────────────────────────────────────────────────────

/** Nombres fijos de las animaciones. Todas las hojas de barberos siguen esta plantilla. */
export const CLAVES_ANIMACION = [
  'quieto', 'caminar', 'correr', 'dash', 'guardia', 'agachado', 'saltar', 'caer',
  'golpe', 'patada', 'combo', 'herramienta1', 'herramienta2', 'especial1', 'especial2',
  'danio', 'ko', 'levantarse', 'victoria', 'burla',
] as const
export type ClaveAnimacion = (typeof CLAVES_ANIMACION)[number]

/**
 * Un cuadro dentro del atlas PNG. (ax, ay) es el punto de apoyo (centro de los pies sobre
 * el piso) en px del cuadro. TODOS los cuadros miran a la DERECHA; el render espeja.
 */
export interface CuadroAtlas {
  x: number
  y: number
  w: number
  h: number
  ax: number
  ay: number
}

export interface AnimacionAtlas {
  cuadros: CuadroAtlas[]
  /** Índices de los cuadros de contacto, en el orden en que pegan (sólo ataques). */
  impactos: number[]
}

/** /juego/personajes/<id>/atlas.json */
export interface AtlasPersonaje {
  version: 1
  personaje: IdPersonaje
  /** PNG relativo al JSON. */
  imagen: string
  /** Alto en px del cuadro 0 de «quieto»: el render escala a FichaPersonaje.alturaMundo. */
  alturaReferencia: number
  animaciones: Record<ClaveAnimacion, AnimacionAtlas>
  /** Sprites sueltos (proyectiles, objetos): 'tornado', 'sillon', etc. Pueden faltar. */
  efectos: Record<string, { cuadros: CuadroAtlas[] }>
}

/** Lo que el motor necesita saber del atlas para sincronizar golpes con dibujos. */
export type MetaAnimaciones = Record<ClaveAnimacion, { n: number; impactos: number[] }>

// ─── Catálogo (src/lib/juego/personajes.ts y arenas.ts) ──────────────────────

/** 1..10, para las barras de la pantalla de selección. */
export interface Atributos {
  fuerza: number
  velocidad: number
  defensa: number
  tecnica: number
  alcance: number
}

export type IconoEspecial = 'rayo' | 'tijera' | 'sillon' | 'spray'
export type EfectoEspecial = 'electrocuta' | 'multigolpe' | 'rompe_guardia' | 'congela'

export interface FichaEspecial {
  nombre: string
  /** Unidades de carga que consume (0..CARGA_MAX). */
  costo: number
  icono: IconoEspecial
  efecto: EfectoEspecial
  descripcion: string
}

export interface FichaPersonaje {
  id: IdPersonaje
  nombre: string
  apodo: string
  /** El barbero real (staff.id): sirve para «peleá contra tu barbero». */
  staffId: string | null
  sucursal: string
  /** Acento del personaje en toda la UI y los efectos. */
  color: string
  colorSecundario: string
  atributos: Atributos
  vidaMax: number
  /** Alto parado en el mundo (px lógicos). */
  alturaMundo: number
  herramientas: [string, string]
  especiales: [FichaEspecial, FichaEspecial]
  pasiva: { nombre: string; descripcion: string }
  frases: string[]
  rutas: { atlas: string; retrato: string; cara: string }
}

/** Un lugar de la grilla de selección para un barbero que todavía no tiene personaje. */
export interface FichaProximamente {
  nombre: string
  sucursal: string
}

export interface ArenaDef {
  id: IdArena
  nombre: string
  sucursalSlug: string
  /** null mientras no haya imagen: la arena se muestra como «Próximamente». */
  imagen: string | null
  miniatura: string | null
  /** 0..1: altura (fracción de la imagen) donde pisan los luchadores. */
  suelo: number
  /** Opcional: luces/neones de la imagen (fracciones 0..1) para destellos del render. */
  luces?: { x: number; y: number; radio: number; color: string }[]
  /** Color dominante para fondos de UI (cargando, VS). */
  tono: string
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Estado MANTENIDO de los controles en este tick (true = apretado). El motor detecta los
 * flancos (recién apretado) y guarda un buffer corto: la UI sólo reporta lo que hay.
 */
export interface EntradaJugador {
  izquierda: boolean
  derecha: boolean
  arriba: boolean
  abajo: boolean
  golpe: boolean
  herramienta: boolean
  guardia: boolean
  especial1: boolean
  especial2: boolean
  /** Esquiva explícita (botón o doble toque detectado por la UI); el motor también detecta el doble toque. */
  dash: boolean
}

export const ENTRADA_VACIA: Readonly<EntradaJugador> = Object.freeze({
  izquierda: false,
  derecha: false,
  arriba: false,
  abajo: false,
  golpe: false,
  herramienta: false,
  guardia: false,
  especial1: false,
  especial2: false,
  dash: false,
})

// ─── Estado de la partida (lo escribe SÓLO el motor) ─────────────────────────

export type FasePartida =
  | 'presentacion' // los dos entran y posan (≈1,5 s)
  | 'anuncio' // «ROUND 1» → «¡A PELEAR!»
  | 'pelea'
  | 'ko' // cámara lenta, el perdedor cae
  | 'tiempo' // se acabó el reloj
  | 'final' // «¡DEJALO AL CERO!»: ventana para el remate de la partida
  | 'entre_rounds' // festejo del ganador del round
  | 'terminada'

export type EstadoLuchador =
  | 'quieto'
  | 'caminando'
  | 'agachado'
  | 'saltando'
  | 'atacando'
  | 'guardia'
  | 'dash'
  | 'aturdido' // hitstun / blockstun
  | 'derribado'
  | 'levantandose'
  | 'congelado'
  | 'electrocutado'
  | 'guardia_rota'
  | 'mareado' // el perdedor durante la fase 'final'
  | 'ko'
  | 'victoria'
  | 'burla'

export interface LuchadorEstado {
  id: IdPersonaje
  lado: Lado
  x: number
  y: number
  vx: number
  vy: number
  /** 1 = mira a la derecha. */
  mira: 1 | -1
  enSuelo: boolean
  estado: EstadoLuchador
  anim: ClaveAnimacion
  /** Índice dentro de atlas.animaciones[anim].cuadros (el motor ya lo acotó). */
  cuadro: number
  /** Ticks desde que empezó la animación actual. */
  animTick: number
  /** Movimiento en curso (id interno del motor) o null. */
  movimiento: string | null
  vida: number
  vidaMax: number
  guardia: number
  guardiaMax: number
  /** 0..CARGA_MAX, fraccional. */
  carga: number
  /** Ticks restantes de destello blanco por golpe recibido. */
  destello: number
  /** Invulnerable a golpes (inicio del dash, levantarse). */
  invulnerable: boolean
  /** Ticks restantes de cada efecto (0 = no está). */
  efectos: {
    congelado: number
    electrocutado: number
    guardiaRota: number
    critico: number // aura breve después de meter un crítico
  }
  /** Golpes seguidos que ESTE luchador metió sin que el rival se recupere. */
  combo: number
}

export type TipoProyectil = 'tornado' | 'sillon' | 'spray' | 'rayo'

export interface ProyectilEstado {
  id: number
  tipo: TipoProyectil
  duenio: Lado
  x: number
  y: number
  vx: number
  vy: number
  mira: 1 | -1
  /** Rotación en radianes (el sillón gira). */
  rot: number
  /** Ticks de vida transcurridos. */
  edad: number
  /** Golpes que le quedan por dar. */
  golpesRestantes: number
}

export interface EstadisticasLuchador {
  danioHecho: number
  danioRecibido: number
  golpesAcertados: number
  golpesIntentados: number
  golpesBloqueados: number
  criticos: number
  especialesUsados: number
  especialesAcertados: number
  comboMax: number
  guardiasRotas: number
  congelamientos: number
  rondasPerfectas: number
  finalAlCero: boolean
}

export interface Partida {
  readonly config: ConfigPartida
  fase: FasePartida
  /** Ticks desde que empezó la fase actual. */
  ticksFase: number
  /** Ticks totales de simulación. */
  tick: number
  round: number
  /** Ticks que le quedan al reloj del round. */
  tiempoRestante: number
  /** Doble carga en el tramo final del round (como el doble elixir). */
  turbo: boolean
  rondasGanadas: [number, number]
  luchadores: [LuchadorEstado, LuchadorEstado]
  proyectiles: ProyectilEstado[]
  /**
   * Eventos acumulados por avanzar(). El motor SÓLO agrega; el loop los vacía una vez por
   * cuadro de pantalla (`p.eventos.splice(0)`) y se los pasa a render, audio y HUD.
   */
  eventos: EventoJuego[]
  /** 1 = normal; <1 = cámara lenta (el loop escala el tiempo con esto). */
  escalaTiempo: number
  /** Hitstop global restante (ticks): los luchadores no avanzan; el render sí. */
  congelamientoGolpe: number
  /** Ganador del round que acaba de terminar (null si sigue o fue empate). */
  ganadorRound: Lado | null
  ganadorPartida: Lado | null
  estadisticas: [EstadisticasLuchador, EstadisticasLuchador]
}

// ─── Eventos (motor → render, audio, HUD) ────────────────────────────────────

export type FuerzaGolpe = 'leve' | 'medio' | 'fuerte' | 'especial'
export type Herramienta =
  | 'puno'
  | 'patada'
  | 'maquina'
  | 'tijera'
  | 'peine'
  | 'rayo'
  | 'tornado'
  | 'sillon'
  | 'spray'

export type EventoJuego =
  | { tipo: 'presentacion' }
  | { tipo: 'round'; numero: number; final: boolean }
  | { tipo: 'pelea' }
  | { tipo: 'swing'; quien: Lado; fuerza: FuerzaGolpe; herramienta: Herramienta }
  | {
      tipo: 'golpe'
      atacante: Lado
      victima: Lado
      /** Punto de contacto en coordenadas del mundo. */
      x: number
      y: number
      danio: number
      critico: boolean
      bloqueado: boolean
      fuerza: FuerzaGolpe
      herramienta: Herramienta
    }
  | { tipo: 'combo'; quien: Lado; golpes: number }
  | { tipo: 'especial'; quien: Lado; numero: 1 | 2; nombre: string }
  | { tipo: 'proyectil'; quien: Lado; proyectil: TipoProyectil }
  | { tipo: 'guardia_rota'; quien: Lado; x: number; y: number }
  | { tipo: 'congelado'; quien: Lado }
  | { tipo: 'descongelado'; quien: Lado; roto: boolean }
  | { tipo: 'electrocutado'; quien: Lado }
  | { tipo: 'carga'; quien: Lado; nivel: number } // cruzó una unidad entera
  | { tipo: 'sin_carga'; quien: Lado } // apretó un especial sin carga
  | { tipo: 'turbo' }
  | { tipo: 'salto'; quien: Lado }
  | { tipo: 'aterrizaje'; quien: Lado; fuerte: boolean }
  | { tipo: 'dash'; quien: Lado }
  | { tipo: 'derribo'; quien: Lado }
  | { tipo: 'burla'; quien: Lado }
  | { tipo: 'ko'; ganador: Lado; perdedor: Lado; perfecto: boolean }
  | { tipo: 'tiempo'; ganador: Lado | null }
  | { tipo: 'final_disponible'; ganador: Lado }
  | { tipo: 'final_al_cero'; ganador: Lado }
  | { tipo: 'fin_round'; ganador: Lado | null }
  | { tipo: 'fin_partida'; ganador: Lado }

// ─── Configuración y resultado ───────────────────────────────────────────────

export interface ConfigPartida {
  personajes: [IdPersonaje, IdPersonaje]
  /** true = ese lado lo maneja la CPU (el motor genera sus entradas). */
  cpu: [boolean, boolean]
  dificultad: Dificultad
  arena: IdArena
  rondasParaGanar: number
  segundosPorRound: number
  /** Del atlas de cada luchador (ver MetaAnimaciones). */
  animaciones: [MetaAnimaciones, MetaAnimaciones]
  /** Semilla del azar (críticos, CPU): la partida es reproducible. */
  semilla: number
}

export interface DesglosePuntaje {
  total: number
  partes: { etiqueta: string; puntos: number }[]
  /** 'S' | 'A' | 'B' | 'C' | 'D' */
  rango: string
}

// ─── APIs de los módulos (los nombres de export son parte del contrato) ──────
//
//   src/lib/juego/motor/index.ts
//     export function crearPartida(config: ConfigPartida): Partida
//     export function avanzar(p: Partida, entradas: readonly [EntradaJugador, EntradaJugador]): void
//     export function calcularPuntaje(p: Partida, lado: Lado): DesglosePuntaje
//     export function metaDesdeAtlas(atlas: AtlasPersonaje): MetaAnimaciones
//
//   src/lib/juego/render/index.ts
//     export async function cargarRecursos(personajes: IdPersonaje[], arena: IdArena,
//       alProgresar?: (fraccion: number) => void): Promise<RecursosJuego>
//     export function crearRenderizador(canvas: HTMLCanvasElement, recursos: RecursosJuego,
//       opciones?: Partial<OpcionesRender>): Renderizador
//
//   src/lib/juego/audio/index.ts
//     export function crearAudio(): AudioJuego

export interface RecursosJuego {
  atlas: Partial<Record<IdPersonaje, { datos: AtlasPersonaje; imagen: CanvasImageSource }>>
  caras: Partial<Record<IdPersonaje, CanvasImageSource>>
  arena: { def: ArenaDef; imagen: CanvasImageSource }
}

export interface OpcionesRender {
  /** 'baja' apaga reflejos, sombras suaves y baja partículas (celulares lentos). */
  calidad: 'alta' | 'media' | 'baja'
  /** font-family CSS ya cargadas (next/font) para textos en el canvas. */
  fuentes: { titulo: string; numeros: string }
  numerosDeDanio: boolean
}

export interface Renderizador {
  /** Dibuja un cuadro. `eventos` = los drenados de p.eventos desde el cuadro anterior. */
  dibujar(p: Partida, eventos: readonly EventoJuego[], dtMs: number): void
  /** Tamaño CSS del canvas y devicePixelRatio (el render limita el dpr a 2). */
  redimensionar(anchoCss: number, altoCss: number, dpr: number): void
  destruir(): void
}

export type SonidoUi = 'tocar' | 'confirmar' | 'atras' | 'elegir' | 'vs' | 'error' | 'puntos'
export type TemaMusica = 'menu' | 'pelea' | 'victoria' | 'derrota'

export interface AudioJuego {
  /** Llamar en el primer toque del usuario (iOS no deja sonar antes). */
  desbloquear(): Promise<void>
  procesar(eventos: readonly EventoJuego[], p: Partida): void
  ui(sonido: SonidoUi): void
  musica(tema: TemaMusica | null): void
  /** 0..1 cada uno. */
  volumen(efectos: number, musica: number): void
  silenciar(silencio: boolean): void
  destruir(): void
}

// ─── Backend (src/lib/actions/juego.ts) ──────────────────────────────────────

/** Lo que /juego recibe del servidor al abrir (por el QR del kiosko o un link suelto). */
export interface DatosEntradaJuego {
  /** Token firmado del QR (null si entró sin QR). */
  token: string | null
  sucursal: { slug: string; nombre: string } | null
  /** Sólo el nombre de pila. */
  cliente: { nombre: string } | null
  arenaInicial: IdArena
  /** staff.id del barbero asignado en la fila, si tiene. */
  barberoAsignado: string | null
}

export interface EstadoTurnoJuego {
  estado: 'esperando' | 'atendiendo' | 'terminado' | 'desconocido'
  /** Personas adelante (null si no se sabe). */
  adelante: number | null
  /** Texto listo para mostrar («Sos el próximo», «Hay 2 antes que vos»). */
  etiqueta: string | null
  /** Nombre de pila del barbero que lo atiende o lo va a atender. */
  barbero: string | null
}

export interface PartidaParaGuardar {
  token: string | null
  sucursalSlug: string | null
  apodo: string
  personaje: IdPersonaje
  rival: IdPersonaje
  arena: IdArena
  dificultad: Dificultad
  resultado: 'victoria' | 'derrota'
  rondasGanadas: number
  rondasPerdidas: number
  puntaje: number
  comboMax: number
  criticos: number
  especiales: number
  danioHecho: number
  danioRecibido: number
  perfectos: number
  finalAlCero: boolean
  duracionSeg: number
}

export interface FilaRanking {
  puesto: number
  apodo: string
  personaje: IdPersonaje
  puntaje: number
  /** ISO. */
  fecha: string
}

export interface EstadisticaPersonaje {
  personaje: IdPersonaje
  peleas: number
  victorias: number
}

export type PeriodoRanking = 'hoy' | 'semana' | 'siempre'
