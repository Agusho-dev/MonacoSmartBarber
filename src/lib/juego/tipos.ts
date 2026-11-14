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

export type IdPersonaje =
  | 'simon'
  | 'chipi'
  | 'nico_u'
  | 'fabri'
  | 'luciano'
  | 'gabriel'
  | 'guillermo'
  | 'rodrigo'
  | 'joaquin'
  | 'nahuel'
  | 'lucas'
  | 'stefano'
  | 'brian'
  // Quinta tanda (14/nov): los cuatro barberos de Paraná y Pueyrredón…
  | 'chino'
  | 'fran'
  | 'lautaro'
  | 'leo'
  // …y los dueños, que sólo eligen los dueños (el pase: ver personajes.ts).
  | 'nacho'
  | 'nehuen'
  | 'nico_m'
  | 'tony'
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
  /**
   * Sprites sueltos (proyectiles, objetos): 'tornado', 'sillon', etc. y los de EFECTOS_ATLAS.
   * TODOS opcionales: el render dibuja cada proyectil con su sprite si existe (girando con
   * `rot`) y si no, con un dibujo propio. Nada depende de que exista.
   */
  efectos: Record<string, { cuadros: CuadroAtlas[] }>
}

/**
 * Sprites sueltos que se pueden sacar de las hojas de los barberos nuevos (todos opcionales).
 * 'pocion' es la bebida de Fabri, 'vaso' el de Guillermo, 'roca' las piedras del sismo de Brian.
 *
 * Quinta tanda (14/nov), los que trae cada atlas.json nuevo: 'carta' (el naipe de las Cartas
 * Malditas de Chino), 'tijeras' (las tijeras grandes del Corte de Precisión de Fran), 'secador',
 * 'tijera' y 'aerosol' (lo que tira Leo y la lata del Spray; 'tijera' se llama igual que la de Simón:
 * el render busca primero en el atlas del dueño), 'laptop' (el Laptopazo de Nacho), 'paleta' y
 * 'pelotita' (la paleta y la pelota de pádel de Nehuen; no se llama 'pelota' para no mezclarse con la
 * de fútbol de Nahuel, porque el render también busca en el atlas del rival). Lautaro no trae ninguno.
 * 'pua' (una púa de las Espinas de Nico M., la punta a la derecha: el render la rota según el vuelo),
 * 'monopatin' (el de Tony volando, horizontal) y 'despido' (el papel del Despido Final, legible).
 */
export const EFECTOS_ATLAS = [
  'bombo', 'guante', 'pocion', 'graffiti', 'botella', 'vaso', 'gorro', 'pelota', 'panal', 'mamadera', 'mate', 'roca',
  'carta', 'tijeras', 'secador', 'tijera', 'aerosol', 'laptop', 'paleta', 'pelotita',
  'pua', 'monopatin', 'despido',
] as const
export type EfectoAtlas = (typeof EFECTOS_ATLAS)[number]

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

export type IconoEspecial =
  | 'rayo'
  | 'tijera'
  | 'sillon'
  | 'spray'
  | 'bombo'
  | 'navaja'
  | 'cura'
  | 'guante'
  | 'moto'
  | 'pistola'
  | 'break'
  | 'graffiti'
  | 'trago'
  | 'botella'
  | 'baile'
  | 'grito'
  | 'gorro'
  | 'dragon'
  | 'pelota'
  | 'chilena'
  | 'mamadera'
  | 'panal'
  | 'mate'
  | 'termo'
  | 'agarre'
  | 'sismo'
  // Quinta tanda (14/nov), uno por especial nuevo (ninguno se repite con los 26 de antes).
  /** Chino: Cartas Malditas (tres naipes en abanico). */
  | 'cartas'
  /** Chino: All In / Dominio (la contra). */
  | 'dominio'
  /** Fran: Lentes Hipnóticos. */
  | 'lentes'
  /** Fran: Corte de Precisión (la tijera grande). */
  | 'corte'
  /** Lautaro: Gigante. */
  | 'gigante'
  /** Lautaro: Lanzamiento Aéreo (el agarre que también agarra en el aire). */
  | 'lanzamiento'
  /** Leo: Lanzamiento de Herramientas (secadores y tijeras que apuntan). */
  | 'herramientas'
  /** Leo: Spray Cegador. */
  | 'aerosol'
  /** Nacho: Agarre y Ejecución (el brazo de código). */
  | 'ejecucion'
  /** Nacho: Terremoto de Código (las columnas que avanzan). */
  | 'codigo'
  /** Nehuen: Desaparecer. */
  | 'fantasma'
  /** Nehuen: Smash de Pádel (la paleta que devuelve los tiros). */
  | 'padel'
  /** Nico M.: Orden Final (los anillos dorados que cruzan la pantalla). */
  | 'orden'
  /** Nico M.: Espinas (las púas que quedan clavadas en el piso). */
  | 'espinas'
  /** Tony: Monopatín (el monopatín eléctrico que acelera). */
  | 'monopatin'
  /** Tony: Despido Final (el papel y la patada voladora). */
  | 'despido'
export type EfectoEspecial =
  | 'electrocuta'
  | 'multigolpe'
  | 'rompe_guardia'
  | 'congela'
  /** Estrellas: no se mueve ≈1 s. */
  | 'aturde'
  /** Siempre crítico. */
  | 'critico'
  /** Se cura él (de a pedacitos; se corta si le pegan). */
  | 'cura'
  /** Lo tira al piso. */
  | 'derriba'
  /** Mareado: no puede cubrirse y camina lento. */
  | 'marea'
  /** Quemado: daño por segundo. */
  | 'quema'
  /** Empuje enorme. */
  | 'empuja'
  /** Deja una nube en el piso que daña de a poco y hace caminar lento. */
  | 'nube'
  /** Agarre: imbloqueable, corto; no agarra en el aire. */
  | 'agarre'
  /** Va por el piso: imbloqueable de pie, se salta. */
  | 'sismo'
  /**
   * Contra (el All In de Chino): mientras arma el dominio, el golpe o el tiro que le iba a pegar se
   * anula y sale la embestida con todo. En el contacto no hace nada (lo hace su pieza, `contra`).
   */
  | 'contra'
  /** Hipnotizado: camina hacia el que lo hipnotizó sin poder hacer nada (los Lentes de Fran). */
  | 'hipnotiza'
  /** Con la punta del golpe, siempre crítico (el Corte de Precisión de Fran; lo hace su pieza, `punta`). */
  | 'precision'
  /** Cegado: no puede pegar, tirar especiales ni esquivar, pero camina, salta y se cubre (el Spray de Leo). */
  | 'ciega'
  /** Devuelve los tiros del rival (el Smash de Nehuen; lo hace su pieza, `devuelve`). */
  | 'devuelve'
  /**
   * Trampa (las Espinas de Nico M.): lo que no pega queda clavado en el piso y tira al que lo pisa. En
   * el contacto directo no hace nada propio (lo hace su pieza, `trampa`).
   */
  | 'trampa'

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
  /**
   * El retrato es una «portada» del dueño (pixel art con texto en la ropa, scripts/juego/portada.py):
   * la UI no lo espeja nunca (`espejarRetrato`, personajes.ts). Sin el campo se espeja como siempre.
   */
  retratoFijo?: boolean
  /**
   * Personaje de un dueño o jerárquico (pedido del dueño: «que sean sólo seleccionables por nosotros
   * 4; la idea es que los clientes jueguen con los barberos»). Lo ve y lo elige sólo el celular que
   * tiene el pase de dueños (Configuración → «Corte Final» → «Jugar como dueño»; src/lib/juego/pase.ts
   * y ui/pase-duenos.ts), en el grupo «Dueños» de la selección, fuera del filtro por sucursal. Para
   * un cliente no existe: ni en la grilla, ni de rival por defecto, ni en «Próximamente». Una pelea
   * contra la CPU con uno de ellos no se guarda (ni ranking ni estadísticas de los barberos: lo
   * frenan la pantalla del resultado y `guardarPartidaJuego`); online se puede usar. Sin el campo,
   * cualquiera lo elige. Ayudantes en personajes.ts (`IDS_PARA_CLIENTES`, `IDS_SOLO_DUENOS`,
   * `idsVisibles`, `esSoloDuenos`, `peleaConDuenos`).
   */
  soloDuenos?: true
  rutas: {
    atlas: string
    retrato: string
    cara: string
    /**
     * Los sprites pelados del remate «¡AL CERO!» (scripts/juego/generar_rapado.py): `atlas` es el
     * rapado.json de al lado del atlas, y `retrato`/`cara` los webp pelados. null mientras no
     * existan: nadie los pide (ni el render ni la UI) y el remate sólo hace volar pelo.
     */
    rapado: { atlas: string; retrato: string; cara: string } | null
  }
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
  | 'agarrado' // lo tienen agarrado: el render lo dibuja con la anim 'danio', levantado y temblando
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
    /** Estrellas: no puede moverse (el Bombo, el Grito). */
    aturdido: number
    /** No puede cubrirse y camina lento (el Trago Mareador). */
    mareado: number
    /** Daño por segundo (el Termo de Agua Caliente). */
    quemado: number
    /** Camina lento (la nube del Pañalazo). */
    lento: number
    /** Se está curando (la Curación de Fabri). */
    curando: number
    /**
     * Hipnotizado (los Lentes de Fran): camina hacia el que lo hipnotizó sin poder hacer nada; al
     * llegar a ≈ 95 px se queda quieto un instante y se despierta. Lo despierta también el primer golpe
     * limpio. Es un estado de control: cuenta para el tope del encierro. Quinta tanda (14/nov).
     */
    hipnotizado: number
    /**
     * Cegado (el Spray de Leo): no puede pegar, tirar especiales ni esquivar; camina, salta, se agacha
     * y se cubre. Se le pasa con el primer golpe limpio. No es encierro (tiene el control).
     */
    cegado: number
    /**
     * Arma el dominio (el All In de Chino): los ticks que le quedan a la ventana de la contra. Mientras
     * sea > 0, el que le pegue o le tire algo se come la contra. Vuelve a 0 cuando la contra salta (el
     * evento 'contra') o se termina la ventana. Lo pone la acción, no un golpe.
     */
    dominio: number
  }
  /** Golpes seguidos que ESTE luchador metió sin que el rival se recupere. */
  combo: number
}

/**
 * Tiempos de proyectiles que el render necesita para dibujarlos (ticks de `edad`).
 * graffitiEstalla: el graffiti (Graffiti Slam) aparece pintado y estalla a esa edad; antes no
 * pega. Al estallar, `ancho`/`alto` pasan del mural al área de la explosión.
 * codigoEstalla: cada columna del Terremoto de Código de Nacho (quinta tanda) sube como código ese
 * rato y recién ahí revienta el piso y pega (`ancho`/`alto` pasan al estallido, como el graffiti).
 * Los lee el motor (el kit), el render y el audio: se cambian acá y los tres lo siguen.
 */
export const TIEMPOS_PROYECTIL = { graffitiEstalla: 30, codigoEstalla: 12 } as const

export type TipoProyectil =
  | 'tornado'
  | 'sillon'
  | 'spray'
  | 'rayo'
  | 'bombo'
  | 'bala'
  | 'graffiti'
  | 'trago'
  | 'botella'
  | 'onda'
  | 'gorro'
  | 'pelota'
  | 'leche'
  | 'panal'
  | 'nube'
  | 'mate'
  | 'agua'
  | 'sismo'
  | 'guante'
  // Quinta tanda (14/nov).
  /** Un naipe de las Cartas Malditas (Chino): recto, gira con `rot`; salen tres a tres alturas. */
  | 'carta'
  /** La mirada de los Lentes Hipnóticos (Fran): anillos a la altura de los ojos que se agrandan (`ancho`). */
  | 'hipnosis'
  /** Lo que tira Leo (Lanzamiento de Herramientas): recto, apunta al salir (`vy`); secador o tijera por la paridad del `id`. */
  | 'secador'
  /** La nube del Spray Cegador (Leo): un chorro que nace en la lata y crece. */
  | 'aerosol'
  /** Una columna del Terremoto de Código (Nacho): área fija que estalla a TIEMPOS_PROYECTIL.codigoEstalla. */
  | 'codigo'
  /** La pelota de pádel del Smash (Nehuen): recta y rápida. */
  | 'pelotita'
  /**
   * Una púa de las Espinas (Nico M.): vuela en arco; la que toca el piso sin pegar se clava
   * (ProyectilEstado.plantado) y queda un rato, quieta, esperando que la pisen.
   */
  | 'espina'
  /** El monopatín eléctrico de Tony: sale lento y acelera (`vx` crece en vuelo hasta un tope). */
  | 'monopatin'

export interface ProyectilEstado {
  id: number
  tipo: TipoProyectil
  /**
   * El que lo tiró. Desde la quinta tanda puede CAMBIAR en vuelo: el Smash de Pádel de Nehuen se lo
   * devuelve al que lo tiró (evento 'devuelto') y desde ahí es de Nehuen (pega al otro, cuenta para él).
   */
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
  /** Bumerán (el gorro) de regreso hacia el que lo tiró. */
  vuelta: boolean
  /**
   * Caja ACTUAL en px del mundo, centrada en (x, y). Los chorros, las ondas, las nubes y el
   * graffiti se dibujan de este tamaño (cambia con la edad).
   */
  ancho: number
  alto: number
  /**
   * Clavado en el piso (una púa de las Espinas de Nico M., quinta tanda): quieto, `vx` = `vy` = 0, con
   * la caja de la trampa; sólo le pega al que lo pisa. `edad` sigue contando: se apaga cuando la trampa
   * cumple su vida (el render la hace titilar al final). false en todos los demás.
   */
  plantado: boolean
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
  /** Vida que se curó (la Curación de Fabri). */
  curado: number
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
  | 'bombo'
  | 'navaja'
  | 'celular'
  | 'anteojos'
  | 'guante'
  | 'moto'
  | 'bala'
  | 'graffiti'
  | 'break'
  | 'trago'
  | 'botella'
  | 'baile'
  | 'onda'
  | 'gorro'
  | 'dragon'
  | 'pelota'
  | 'leche'
  | 'panal'
  | 'nube'
  | 'mate'
  | 'agua'
  | 'sismo'
  | 'agarre'
  | 'pesado'
  // Quinta tanda (14/nov): con qué pega cada especial nuevo (el sonido y el destello del golpe).
  | 'carta'
  /** La embestida del All In de Chino. */
  | 'dominio'
  | 'hipnosis'
  /** El Gigante de Lautaro (el aplastón). */
  | 'gigante'
  /** El agarre aéreo de Lautaro (también lo llevan sus eventos de golpe del revoleo). */
  | 'lanzamiento'
  | 'secador'
  | 'aerosol'
  /** El Laptopazo de Nacho (su patada de la cadena de GOLPE y su segunda herramienta). */
  | 'laptop'
  /** El agarre de Nacho (los apretones y el tirón también la llevan). */
  | 'ejecucion'
  | 'codigo'
  /** El golpe con el que reaparece Nehuen. */
  | 'fantasma'
  /** El paletazo y la pelota del Smash de Nehuen. */
  | 'paleta'
  /** Los anillos de la Orden Final de Nico M. */
  | 'anillos'
  /** Las púas de Nico M. (en vuelo y la clavada que lo tira). */
  | 'espinas'
  /** El revoleo y el monopatín de Tony. */
  | 'monopatin'
  /** El papel y la patada voladora del Despido Final de Tony. */
  | 'despido'

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
  /** Se curó `cantidad` de vida (sale por cada pedacito de la curación). */
  | { tipo: 'curacion'; quien: Lado; cantidad: number }
  /** Lo agarró: la víctima queda 'agarrado' hasta que la tira al piso. */
  | { tipo: 'agarre'; atacante: Lado; victima: Lado }
  /** Quedó aturdido (estrellas). */
  | { tipo: 'aturdido'; quien: Lado }
  /** Quedó mareado (no puede cubrirse, camina lento). */
  | { tipo: 'mareado'; quien: Lado }
  /** Quedó quemado (daño por segundo). */
  | { tipo: 'quemado'; quien: Lado }
  /** Apareció una nube en el piso en `x` (de `quien`, el que la tiró). */
  | { tipo: 'nube'; quien: Lado; x: number }
  /** Golpe al piso: sale la onda sísmica desde `x`. */
  | { tipo: 'sismo'; quien: Lado; x: number }
  /** Un tiro de una ráfaga de arma (fogonazo y sonido) en (x, y) del mundo. */
  | { tipo: 'disparo'; quien: Lado; x: number; y: number }
  // Quinta tanda (14/nov).
  /**
   * Saltó la contra del All In (Chino = `quien`): el golpe o el tiro que le iba a pegar se anuló y
   * sale la embestida con todo («¡ALL IN!»). Sale una vez por especial, en el tick del contacto.
   */
  | { tipo: 'contra'; quien: Lado }
  /** Quedó hipnotizado (`quien` = la víctima): camina hacia el que lo hipnotizó (efectos.hipnotizado). */
  | { tipo: 'hipnotizado'; quien: Lado }
  /** Quedó cegado (`quien` = la víctima): no puede pegar un rato (efectos.cegado). */
  | { tipo: 'cegado'; quien: Lado }
  /**
   * El Corte de Precisión de Fran (`quien`) pegó limpio con la punta: crítico seguro («¡PRECISIÓN!»).
   * Sale justo después del evento 'golpe' de ese contacto, en el punto del contacto.
   */
  | { tipo: 'precision'; quien: Lado; x: number; y: number }
  /**
   * El tirón del Agarre y Ejecución de Nacho le sacó `cantidad` de carga a la víctima (y él se quedó
   * con hasta 1). Sale en el tick del tirón, después del 'golpe' del tirón; con la carga en 0, no sale.
   */
  | { tipo: 'carga_robada'; atacante: Lado; victima: Lado; cantidad: number }
  /**
   * El Smash de Pádel de Nehuen (`quien`) devolvió un tiro del rival en (x, y): desde ese tick el
   * proyectil es de Nehuen (ProyectilEstado.duenio) y vuelve más rápido contra el que lo tiró.
   */
  | { tipo: 'devuelto'; quien: Lado; x: number; y: number; proyectil: TipoProyectil }
  /**
   * El papel del Despido Final de Tony (`atacante`) entró limpio: la víctima queda arrodillada
   * (aturdida) y la patada voladora del final ya existe. Sale en el tick del papel, después de su 'golpe'.
   */
  | { tipo: 'despido'; atacante: Lado; victima: Lado }
  /**
   * El que le pegó de cerca a Nico M. se pinchó con su pelo (`quien` = el que se pinchó, en (x, y)):
   * perdió un poco de vida, sin aturdimiento ni bloqueo. Sale con cada golpe cuerpo a cuerpo que recibe,
   * cubre o aguanta, y con un agarre.
   */
  | { tipo: 'pinchazo'; quien: Lado; x: number; y: number }
  /** Una púa de las Espinas de Nico M. (`quien`) se clavó en el piso en `x` (el proyectil pasa a `plantado`). */
  | { tipo: 'plantada'; quien: Lado; x: number }
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
//     export function especialListo(l: LuchadorEstado, n: 1 | 2): boolean   (31/oct: la carta del
//       especial se enciende si apretarlo lo tira; la Curación de Fabri pide además vida < 90 %)
//
//   src/lib/juego/render/index.ts
//     export async function cargarRecursos(personajes: IdPersonaje[], arena: IdArena,
//       alProgresar?: (fraccion: number) => void,
//       opciones?: { senal?: AbortSignal }): Promise<RecursosJuego>
//       (31/oct: `senal` opcional; cancelada, rechaza con un AbortError —`esCancelacion`— y lo
//       bajado queda para retomar con Range)
//     export function crearRenderizador(canvas: HTMLCanvasElement, recursos: RecursosJuego,
//       opciones?: Partial<OpcionesRender>): RenderizadorJuego
//       (31/oct: `RenderizadorJuego` = este `Renderizador` + `cajasLuchadores()`, la caja en
//       pantalla de cada luchador; la usa ui/apartar.ts. Los dos cambios son compatibles hacia atrás)
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
